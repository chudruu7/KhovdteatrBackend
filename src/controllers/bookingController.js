// src/controllers/bookingController.js
import Booking  from '../models/Booking.js';
import Schedule from '../models/Schedule.js';
import mongoose from 'mongoose';
import { sendBookingConfirmation } from '../services/Emailservice.js';

// ── Helper: scheduleId олох ───────────────────────────────────────────────────
async function resolveScheduleId(scheduleId, movieId, date, time, session) {
  if (scheduleId) return scheduleId;
  if (!movieId || !date) return null;

  const allSchedules = await Schedule.find({
    movie: movieId,
    showTime: {
      $gte: new Date(`${date}T00:00:00.000Z`),
      $lte: new Date(`${date}T23:59:59.999Z`),
    },
  }).session(session);

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

// @desc  Шинэ захиалга үүсгэх
// @route POST /api/bookings
export const createBooking = async (req, res) => {
  console.log('📦 Booking payload:', JSON.stringify(req.body, null, 2));

  const { scheduleId, movieId, date, time, seats, totalPrice, customer, paymentMethod = 'qpay' } = req.body;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const resolvedScheduleId = await resolveScheduleId(scheduleId, movieId, date, time, session);

    // Validation
    const missing = [];
    if (!resolvedScheduleId) missing.push('scheduleId');
    if (!seats?.length)       missing.push('seats');
    if (!totalPrice)          missing.push('totalPrice');
    if (!customer?.name)      missing.push('customer.name');
    if (!customer?.email)     missing.push('customer.email');
    if (!customer?.phone)     missing.push('customer.phone');

    if (missing.length > 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Захиалгын үндсэн мэдээллүүд дутуу байна.', missing });
    }

    const selectedSeats = seats.map(s => typeof s === 'string' ? s : (s.seatId || s.id));

    const schedule = await Schedule.findById(resolvedScheduleId).session(session);
    if (!schedule) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Цагийн хуваарь олдсонгүй.' });
    }

    // Суудлыг атомик байдлаар нөөцлөх
    const updated = await Schedule.findOneAndUpdate(
      {
        _id: resolvedScheduleId,
        soldSeats: { $not: { $elemMatch: { $in: selectedSeats } } }
      },
      { $push: { soldSeats: { $each: selectedSeats } } },
      { new: true, session }
    );

    if (!updated) {
      await session.abortTransaction();
      return res.status(409).json({
        message: 'Сонгосон суудлын нэг буюу хэд нь аль хэдийн захиалагдсан байна. Дахин сонгоно уу.',
      });
    }

    // Booking үүсгэх — QPay урсгалд payment.status = 'pending'
    const booking = await new Booking({
      schedule:   resolvedScheduleId,
      movie:      schedule.movie || movieId,
      userId:     req.user?._id || null,
      customer:   { name: customer.name, email: customer.email, phone: customer.phone },
      seats:      selectedSeats,
      totalPrice: Number(totalPrice),
      status:     'active',
      payment: {
        method:        paymentMethod,
        transactionId: `TRX-${Date.now()}`,
        status:        paymentMethod === 'qpay' ? 'pending' : 'paid',
      },
      expiredAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }).save({ session });

    await session.commitTransaction();
    session.endSession();

    // QPay биш бол шууд имэйл илгээнэ
    if (paymentMethod !== 'qpay' && customer.email) {
      _sendEmail({ schedule, booking, selectedSeats, seats, customer }).catch(console.error);
    }

    return res.status(201).json({
      message:    'Захиалга үүслээ.',
      bookingId:  booking._id,
      totalPrice: booking.totalPrice,
      seats:      booking.seats,
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ message: 'Захиалга хийхэд серверт алдаа гарлаа.', error: err.message });
  }
};

// @desc  QPay төлбөр амжилттай болсны дараа booking баталгаажуулах
// @route POST /api/bookings/:id/confirm
export const confirmBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('schedule');
    if (!booking) return res.status(404).json({ message: 'Захиалга олдсонгүй' });

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
      .populate('schedule');

    if (!booking) return res.status(404).json({ message: 'Захиалга олдсонгүй.' });
    return res.json(booking);
  } catch (err) {
    return res.status(500).json({ message: 'Захиалгын мэдээлэл авах алдаа.', error: err.message });
  }
};

// @desc  Бүх захиалга авах (Admin)
// @route GET /api/bookings
export const getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('movie', 'title posterUrl')
      .populate('schedule', 'showTime hall')
      .sort({ createdAt: -1 });

    const formatted = bookings.map(b => {
      const showTime = b.schedule?.showTime ? new Date(b.schedule.showTime) : null;
      const mnTime   = showTime?.toLocaleTimeString('mn-MN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ulaanbaatar' }) || '';
      const mnDate   = showTime?.toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' }) || '';

      return {
        _id:           b._id,
        movieTitle:    b.movie?.title       || 'Тодорхойгүй',
        moviePoster:   b.movie?.posterUrl   || '',
        date:          mnDate,
        time:          mnTime,
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
      .populate('schedule', 'showTime hall')
      .sort({ createdAt: -1 });

    const formatted = bookings.map(b => {
      const showTime = b.schedule?.showTime ? new Date(b.schedule.showTime) : null;
      const mnDate = showTime?.toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' }) || '';
      const mnTime = showTime?.toLocaleTimeString('mn-MN', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ulaanbaatar'
      }) || '';

      return {
        id:            b._id,
        title:         b.movie?.title || 'Тодорхойгүй',
        posterUrl:     b.movie?.posterUrl || '',
        date:          mnDate,
        time:          mnTime,
        hall:          b.schedule?.hall?.hallName || '—',
        seats:         b.seats || [],
        totalPrice:    b.totalPrice || 0,
        status:        b.status,
        paymentStatus: b.payment?.status,
        createdAt:     b.createdAt,
      };
    });

    res.json({ success: true, bookings: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Private helper: имэйл илгээх ─────────────────────────────────────────────
async function _sendEmail({ schedule, booking, selectedSeats, seats, customer }) {
  const d      = new Date(new Date(schedule.showTime).getTime() + 8 * 3600 * 1000);
  const mnTime = `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  const mnDate = d.toISOString().split('T')[0];

  await sendBookingConfirmation({
    to:         customer.email,
    orderId:    String(booking._id),
    movieTitle: schedule.movie?.title || 'Кино',
    date:       mnDate,
    time:       mnTime,
    hall:       schedule.hall?.hallName || '—',
    seats:      selectedSeats,
    tickets:    seats,
    totalPrice: booking.totalPrice,
    customer,
  });
}