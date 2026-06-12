// src/controllers/bookingController.js
import Booking  from '../models/Booking.js';
import Schedule from '../models/Schedule.js';
import { sendBookingConfirmation } from '../services/Emailservice.js';

const THEATER_TIME_ZONE = 'Asia/Hovd';

const formatTheaterDateTime = (value) => {
  if (!value) return { dateISO: '', date: '', time: '' };

  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: THEATER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    dateISO: `${parts.year}-${parts.month}-${parts.day}`,
    date: date.toLocaleDateString('mn-MN', { timeZone: THEATER_TIME_ZONE }),
    time: `${parts.hour}:${parts.minute}`,
  };
};

const getPopulatedMovie = (booking) => {
  if (booking.movie?.title) return booking.movie;
  if (booking.schedule?.movie?.title) return booking.schedule.movie;
  return null;
};

const getFrontendUrl = () => (
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  'https://khovdteatr-web-pied.vercel.app'
).replace(/\/$/, '');

const getTicketStatus = (booking, showTime) => {
  if (booking.status !== 'active') {
    return { isActive: false, label: 'Идэвхгүй', reason: booking.status === 'used' ? 'Ашигласан тасалбар' : 'Цуцлагдсан тасалбар' };
  }
  if (booking.payment?.status !== 'paid') {
    return { isActive: false, label: 'Идэвхгүй', reason: 'Төлбөр баталгаажаагүй' };
  }
  if (showTime && showTime.getTime() < Date.now()) {
    return { isActive: false, label: 'Идэвхгүй', reason: 'Үзвэрийн цаг өнгөрсөн' };
  }
  return { isActive: true, label: 'Идэвхтэй', reason: 'Нэвтрүүлэх боломжтой' };
};

const formatBookingForClient = (booking) => {
  const movie = getPopulatedMovie(booking);
  const showTime = booking.schedule?.showTime ? new Date(booking.schedule.showTime) : null;
  const showDateTime = formatTheaterDateTime(showTime);
  const bookingCode = String(booking._id);
  const ticketStatus = getTicketStatus(booking, showTime);
  const verifyUrl = `${getFrontendUrl()}/ticket-verify/${bookingCode}`;

  const formatted = {
    id:            booking._id,
    _id:           booking._id,
    bookingCode,
    title:         movie?.title || 'Тодорхойгүй үзвэр',
    movieTitle:    movie?.title || 'Тодорхойгүй үзвэр',
    posterUrl:     movie?.posterUrl || '',
    date:          showDateTime.date,
    dateISO:       showDateTime.dateISO,
    time:          showDateTime.time,
    showDatetime:  showTime?.toISOString() || null,
    hall:          booking.schedule?.hall?.hallName || '—',
    seats:         booking.seats || [],
    totalPrice:    booking.totalPrice || 0,
    status:        booking.status,
    paymentStatus: booking.payment?.status || 'pending',
    paymentMethod: booking.payment?.method || '',
    transactionId: booking.payment?.transactionId || '',
    customerName:  booking.customer?.name || '',
    customerEmail: booking.customer?.email || '',
    customerPhone: booking.customer?.phone || '',
    createdAt:     booking.createdAt,
    ticketStatus,
    verifyUrl,
  };

  formatted.qrPayload = JSON.stringify({
    type: 'KDT_TICKET_VERIFY',
    bookingCode,
    verifyUrl,
  });

  return formatted;
};

const markExpiredActiveBookings = async () => {
  const now = new Date();
  const deleteAfter = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const activeBookings = await Booking.find({ status: 'active' }).populate('schedule', 'showTime');
  const expiredIds = activeBookings
    .filter((booking) => booking.schedule?.showTime && new Date(booking.schedule.showTime) < now)
    .map((booking) => booking._id);

  if (!expiredIds.length) return 0;

  const result = await Booking.updateMany(
    { _id: { $in: expiredIds } },
    { $set: { status: 'used', expiredAt: deleteAfter } }
  );

  return result.modifiedCount || 0;
};

// ── Helper: scheduleId олох ───────────────────────────────────────────────────
async function resolveScheduleId(scheduleId, movieId, date, time) {
  if (scheduleId && /^[a-f\d]{24}$/i.test(String(scheduleId))) return scheduleId;
  if (!movieId || !date) return null;
  if (!/^[a-f\d]{24}$/i.test(String(movieId))) return null;

  const allSchedules = await Schedule.find({
    movie: movieId,
    showTime: {
      $gte: new Date(`${date}T00:00:00.000Z`),
      $lte: new Date(`${date}T23:59:59.999Z`),
    },
  });

  if (!allSchedules.length) return null;

  if (time) {
    const found = allSchedules.find(s => {
      const localTime = new Date(s.showTime).toLocaleTimeString('mn-MN', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ulaanbaatar',
      });
      return localTime === time;
    });
    if (found) return found._id;
  }

  return allSchedules[0]._id;
}

const getSeatId = (seat) => (typeof seat === 'string' ? seat : (seat?.seatId || seat?.id));
const getTicketType = (seat) => (typeof seat === 'object' && seat?.type === 'child' ? 'child' : 'adult');
const getPositivePrice = (value, fallback) => {
  const price = Number(value);
  return Number.isFinite(price) && price >= 1 ? price : fallback;
};
const getSchedulePrices = (schedule) => ({
  adult: getPositivePrice(schedule.basePrice, 15000),
  child: getPositivePrice(schedule.childPrice, 10000),
});

// @desc  Шинэ захиалга үүсгэх
// @route POST /api/bookings
export const createBooking = async (req, res) => {
  console.log('📦 Booking payload:', JSON.stringify(req.body, null, 2));

  const { scheduleId, movieId, date, time, seats, totalPrice, customer, paymentMethod = 'qpay' } = req.body;
  let resolvedScheduleId = null;
  let selectedSeats = [];

  try {
    resolvedScheduleId = await resolveScheduleId(scheduleId, movieId, date, time);

    // Validation
    const missing = [];
    if (!resolvedScheduleId) missing.push('scheduleId');
    if (!seats?.length)       missing.push('seats');
    if (!customer?.name)      missing.push('customer.name');
    if (!customer?.email)     missing.push('customer.email');
    if (!customer?.phone)     missing.push('customer.phone');

    if (missing.length > 0) {
      return res.status(400).json({ message: 'Захиалгын үндсэн мэдээллүүд дутуу байна.', missing });
    }

    selectedSeats = seats.map(getSeatId).filter(Boolean).map(String);
    if (selectedSeats.length !== seats.length || new Set(selectedSeats).size !== selectedSeats.length) {
      return res.status(400).json({ message: 'Суудлын мэдээлэл буруу байна.' });
    }

    const schedule = await Schedule.findById(resolvedScheduleId);
    if (!schedule) {
      return res.status(404).json({ message: 'Цагийн хуваарь олдсонгүй.' });
    }

    // Суудлыг атомик байдлаар нөөцлөх
    if (!schedule.showTime || new Date(schedule.showTime).getTime() <= Date.now()) {
      return res.status(400).json({
        message: 'Энэ үзвэрийн цаг өнгөрсөн тул тасалбар захиалах боломжгүй.',
      });
    }

    const updated = await Schedule.findOneAndUpdate(
      {
        _id: resolvedScheduleId,
        showTime: { $gt: new Date() },
        soldSeats: { $not: { $elemMatch: { $in: selectedSeats } } }
      },
      { $push: { soldSeats: { $each: selectedSeats } } },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({
        message: 'Сонгосон суудлын нэг буюу хэд нь аль хэдийн захиалагдсан байна. Дахин сонгоно уу.',
      });
    }

    const prices = getSchedulePrices(schedule);
    const ticketDetails = seats.map((seat) => {
      const seatId = getSeatId(seat);
      const type = getTicketType(seat);
      return {
        seatId,
        type,
        price: type === 'child' ? prices.child : prices.adult,
      };
    });
    const computedTotalPrice = ticketDetails.reduce((sum, ticket) => sum + ticket.price, 0);

    // Booking үүсгэх — QPay урсгалд payment.status = 'pending'
    const booking = await new Booking({
      schedule:   resolvedScheduleId,
      movie:      schedule.movie || movieId,
      userId:     req.user?._id || null,
      customer:   { name: customer.name, email: customer.email, phone: customer.phone },
      seats:      selectedSeats,
      tickets:    ticketDetails,
      totalPrice: computedTotalPrice,
      status:     'active',
      payment: {
        method:        paymentMethod,
        transactionId: `TRX-${Date.now()}`,
        status:        ['qpay', 'wire'].includes(paymentMethod) ? 'pending' : 'paid',
      },
      expiredAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }).save();

    // Бэлэн/кассын төлбөр бол шууд имэйл илгээнэ. External checkout (QPay/Wire) төлбөр баталгаажсаны дараа илгээнэ.
    if (!['qpay', 'wire'].includes(paymentMethod) && customer.email) {
      _sendEmail({ schedule, booking, selectedSeats, seats, customer }).catch(console.error);
    }

    return res.status(201).json({
      message:    'Захиалга үүслээ.',
      bookingId:  booking._id,
      totalPrice: booking.totalPrice,
      seats:      booking.seats,
      tickets:    booking.tickets,
    });

  } catch (err) {
    if (resolvedScheduleId && selectedSeats?.length) {
      await Schedule.findByIdAndUpdate(resolvedScheduleId, {
        $pull: { soldSeats: { $in: selectedSeats } },
      }).catch(() => {});
    }
    return res.status(500).json({ message: 'Захиалга хийхэд серверт алдаа гарлаа.', error: err.message });
  }
};

// @desc  QPay төлбөр амжилттай болсны дараа booking баталгаажуулах
// @route POST /api/bookings/:id/confirm
export const confirmBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('schedule');
    if (!booking) return res.status(404).json({ message: 'Захиалга олдсонгүй' });

    if (!booking.schedule?.showTime || new Date(booking.schedule.showTime).getTime() <= Date.now()) {
      booking.payment.status = 'cancelled';
      booking.status = 'cancelled';
      await booking.save();

      if (booking.schedule && booking.seats?.length) {
        await Schedule.findByIdAndUpdate(booking.schedule._id, {
          $pull: { soldSeats: { $in: booking.seats } },
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Энэ үзвэрийн цаг өнгөрсөн тул тасалбар баталгаажуулах боломжгүй.',
      });
    }

    booking.payment.status  = 'paid';
    booking.payment.method  = 'qpay';
    booking.status          = 'active';
    await booking.save();

    // Баталгаажсаны дараа имэйл илгээнэ
    if (booking.customer?.email && booking.schedule) {
      _sendEmail({
        schedule:      booking.schedule,
        booking,
        selectedSeats: booking.seats,
        seats:         booking.seats.map(s => ({ seatId: s })),
        customer:      booking.customer,
      }).catch(console.error);
    }

    return res.json({ success: true, booking });
  } catch (err) {
    return res.status(500).json({ message: 'Алдаа гарлаа', error: err.message });
  }
};

// @desc  Захиалгын дэлгэрэнгүй
// @route GET /api/bookings/:bookingId
export const getBookingDetails = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId)
      .populate('movie', 'title posterUrl')
      .populate({
        path: 'schedule',
        select: 'showTime hall movie',
        populate: { path: 'movie', select: 'title posterUrl' },
      });

    if (!booking) return res.status(404).json({ message: 'Захиалга олдсонгүй.' });

    const isOwner = booking.userId && req.user?._id && String(booking.userId) === String(req.user._id);
    if (req.user?.role !== 'admin' && !isOwner) {
      return res.status(403).json({ message: 'Энэ захиалгын мэдээллийг харах эрхгүй байна.' });
    }

    return res.json({ success: true, booking: formatBookingForClient(booking) });
  } catch (err) {
    return res.status(500).json({ message: 'Захиалгын мэдээлэл авах алдаа.', error: err.message });
  }
};

export const verifyBookingStatus = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId)
      .populate('movie', 'title posterUrl')
      .populate({
        path: 'schedule',
        select: 'showTime hall movie',
        populate: { path: 'movie', select: 'title posterUrl' },
      });

    if (!booking) {
      return res.status(404).json({
        success: false,
        isActive: false,
        label: 'Идэвхгүй',
        reason: 'Тасалбар олдсонгүй',
      });
    }

    const formatted = formatBookingForClient(booking);
    return res.json({
      success: true,
      isActive: formatted.ticketStatus.isActive,
      label: formatted.ticketStatus.label,
      reason: formatted.ticketStatus.reason,
      booking: formatted,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Тасалбар шалгахад алдаа гарлаа', error: err.message });
  }
};

// @desc  Бүх захиалга авах (Admin)
// @route GET /api/bookings
export const getAllBookings = async (req, res) => {
  try {
    await markExpiredActiveBookings();

    const bookings = await Booking.find()
      .populate('movie', 'title posterUrl')
      .populate('schedule', 'showTime hall')
      .sort({ createdAt: -1 });

    const formatted = bookings.map(b => {
      const showTime = b.schedule?.showTime ? new Date(b.schedule.showTime) : null;
      const showDateTime = formatTheaterDateTime(showTime);

      return {
        _id:           b._id,
        movieTitle:    b.movie?.title       || 'Тодорхойгүй',
        moviePoster:   b.movie?.posterUrl   || '',
        date:          showDateTime.date,
        dateISO:       showDateTime.dateISO,
        time:          showDateTime.time,
        showDatetime:  showTime?.toISOString() || null,
        hall:          b.schedule?.hall?.hallName || '—',
        userName:      b.customer?.name    || 'Зочин',
        userEmail:     b.customer?.email   || '',
        userPhone:     b.customer?.phone   || '',
        seat:          b.seats?.join(', ') || '',
        seats:         b.seats             || [],
        totalPrice:    b.totalPrice        || 0,
        status:        b.status            || 'active',
        paymentStatus: b.payment?.status   || 'pending',
        createdAt:     b.createdAt,
      };
    });

    return res.json({ success: true, bookings: formatted });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Захиалгын статистик (Admin)
// @route GET /api/bookings/stats
export const getBookingStats = async (req, res) => {
  try {
    await markExpiredActiveBookings();

    const [total, active, used, cancelled] = await Promise.all([
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'active' }),
      Booking.countDocuments({ status: 'used' }),
      Booking.countDocuments({ status: 'cancelled' }),
    ]);
    return res.json({ success: true, stats: { total, active, used, cancelled } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Захиалга цуцлах (Admin)
// @route POST /api/bookings/:id/cancel
export const cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Захиалга олдсонгүй.' });
    if (booking.status === 'cancelled') {
      return res.status(400).json({ message: 'Захиалга аль хэдийн цуцлагдсан байна.' });
    }

    if (booking.schedule && booking.seats?.length) {
      await Schedule.findByIdAndUpdate(booking.schedule, {
        $pull: { soldSeats: { $in: booking.seats } },
      });
    }

    booking.status = 'cancelled';
    await booking.save();

    return res.json({ success: true, message: 'Захиалга амжилттай цуцлагдлаа.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const cancelExpiredBookings = async () => {
  try {
    const expiredBookings = await Booking.find({
      'payment.status': 'pending',
      createdAt: { $lt: new Date(Date.now() - 15 * 60 * 1000) }
    }).populate('schedule');

    for (const booking of expiredBookings) {
      if (booking.schedule && booking.seats?.length) {
        await Schedule.findByIdAndUpdate(booking.schedule._id, {
          $pull: { soldSeats: { $in: booking.seats } }
        });
      }
      booking.status = 'cancelled';
      booking.payment.status = 'cancelled';
      await booking.save();
    }

    if (expiredBookings.length > 0) {
      console.log(`✅ ${expiredBookings.length} хугацаа дууссан booking цуцлагдлаа`);
    }
  } catch (err) {
    console.error('Expired booking цуцлах алдаа:', err);
  }
};

export const getMyHistory = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: 'Нэвтрээгүй байна' });

    const bookings = await Booking.find({ userId })
      .populate('movie', 'title posterUrl')
      .populate({
        path: 'schedule',
        select: 'showTime hall movie',
        populate: { path: 'movie', select: 'title posterUrl' },
      })
      .sort({ createdAt: -1 });

    const formatted = bookings.map(formatBookingForClient);

    res.json({ success: true, bookings: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const resendBookingConfirmation = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('movie', 'title posterUrl')
      .populate({
        path: 'schedule',
        select: 'showTime hall movie',
        populate: { path: 'movie', select: 'title posterUrl' },
      });

    if (!booking) return res.status(404).json({ success: false, message: 'Захиалга олдсонгүй.' });

    const isOwner = booking.userId && req.user?._id && String(booking.userId) === String(req.user._id);
    if (req.user?.role !== 'admin' && !isOwner) {
      return res.status(403).json({ success: false, message: 'Энэ захиалгын имэйлийг дахин илгээх эрхгүй байна.' });
    }

    if (booking.payment?.status !== 'paid') {
      return res.status(400).json({ success: false, message: 'Төлбөр баталгаажаагүй захиалгын имэйл илгээх боломжгүй.' });
    }

    const result = await _sendEmail({
      schedule: booking.schedule,
      booking,
      selectedSeats: booking.seats,
      seats: booking.tickets?.length ? booking.tickets : booking.seats.map((seatId) => ({ seatId })),
      customer: booking.customer,
      force: true,
    });

    return res.json({ success: Boolean(result?.success), email: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Имэйл дахин илгээхэд алдаа гарлаа.', error: err.message });
  }
};

// ── Private helper: имэйл илгээх ─────────────────────────────────────────────
async function _sendEmail({ schedule, booking, selectedSeats, seats, customer, force = false }) {
  if (booking.ticketEmailSentAt && !force) return { success: true, skipped: true, reason: 'already_sent' };

  const populatedSchedule = schedule?.movie?.title
    ? schedule
    : await Schedule.findById(schedule._id || schedule).populate('movie', 'title');

  if (!populatedSchedule?.showTime) return;

  const d = new Date(new Date(populatedSchedule.showTime).getTime() + 8 * 3600 * 1000);
  const mnTime = `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  const mnDate = d.toISOString().split('T')[0];

  const result = await sendBookingConfirmation({
    to: customer.email,
    orderId: String(booking._id),
    movieTitle: populatedSchedule.movie?.title || 'Үзвэр',
    date: mnDate,
    time: mnTime,
    hall: populatedSchedule.hall?.hallName || '—',
    seats: selectedSeats,
    tickets: seats,
    totalPrice: booking.totalPrice,
    customer,
  });

  if (result?.success) {
    booking.ticketEmailSentAt = new Date();
    await booking.save();
  }

  return result;
}
