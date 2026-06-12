// src/controllers/qpayController.js
import {
  createCinemaInvoice,
  checkPaymentStatus,
  cancelInvoice   as cancelInv,
  createEbarimt,
  cancelPayment,
} from '../services/qpayService.js';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import { sendPaidBookingEmail as sendPaidBookingEmailShared } from '../services/bookingFulfillmentService.js';

const THEATER_TIME_ZONE = 'Asia/Hovd';

const formatTheaterDateTime = (value) => {
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
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
};

const sendPaidBookingEmail = async (booking) => {
  return sendPaidBookingEmailShared(booking);
  console.log('[QPay/Email] ── sendPaidBookingEmail эхэллээ ──');
  console.log('[QPay/Email] Booking ID:', booking?._id);
  console.log('[QPay/Email] Customer email:', booking?.customer?.email);
  console.log('[QPay/Email] ticketEmailSentAt:', booking?.ticketEmailSentAt);

  if (!booking) {
    console.warn('[QPay/Email] ⚠ Booking объект байхгүй.');
    return { success: false, reason: 'missing_booking' };
  }
  if (booking.ticketEmailSentAt) {
    console.log('[QPay/Email] ℹ И-мэйл аль хэдийн илгээгдсэн — skip.');
    return { success: true, skipped: true, reason: 'already_sent' };
  }
  if (!booking.customer?.email) {
    console.warn('[QPay/Email] ⚠ Customer email байхгүй.');
    return { success: false, reason: 'missing_customer_email' };
  }

  await booking.populate([
    { path: 'movie', select: 'title' },
    { path: 'schedule', populate: { path: 'movie', select: 'title' } },
  ]);

  console.log('[QPay/Email] Schedule showTime:', booking.schedule?.showTime);
  console.log('[QPay/Email] Movie title:', booking.schedule?.movie?.title || booking.movie?.title);

  if (!booking.schedule?.showTime) {
    console.warn('[QPay/Email] ⚠ Schedule showTime байхгүй.');
    return { success: false, reason: 'missing_show_time' };
  }

  const show = formatTheaterDateTime(booking.schedule.showTime);
  console.log('[QPay/Email] 📤 И-мэйл илгээх гэж байна:', {
    to: booking.customer.email,
    movie: booking.schedule.movie?.title || booking.movie?.title || 'Үзвэр',
    date: show.date,
    time: show.time,
  });

  const result = await sendBookingConfirmation({
    to: booking.customer.email,
    orderId: String(booking._id),
    movieTitle: booking.schedule.movie?.title || booking.movie?.title || 'Үзвэр',
    date: show.date,
    time: show.time,
    hall: booking.schedule.hall?.hallName || '—',
    seats: booking.seats || [],
    tickets: booking.tickets || (booking.seats || []).map((seatId) => ({ seatId })),
    totalPrice: booking.totalPrice,
    customer: booking.customer,
  });

  console.log('[QPay/Email] sendBookingConfirmation үр дүн:', JSON.stringify(result));

  if (result?.success) {
    booking.ticketEmailSentAt = new Date();
    await booking.save();
    console.log('[QPay/Email] ✅ ticketEmailSentAt хадгалагдлаа.');
  } else {
    console.warn('[QPay/Email] ⚠ И-мэйл илгээгдсэнгүй:', result?.reason || result?.error);
  }

  return result;
};

const findBookingForInvoice = async ({ invoiceId, bookingId }) => {
  console.log('[QPay] findBookingForInvoice:', { invoiceId, bookingId });

  if (bookingId) {
    if (!mongoose.Types.ObjectId.isValid(String(bookingId))) {
      console.warn('[QPay] ⚠ bookingId буруу форматтай:', bookingId);
      return null;
    }

    const booking = await Booking.findById(bookingId)
      .populate('movie', 'title')
      .populate({
        path: 'schedule',
        select: 'showTime hall movie',
        populate: { path: 'movie', select: 'title' },
      });
    if (booking) {
      console.log('[QPay] Booking олдлоо (by bookingId):', booking._id);
      return booking;
    }
    console.warn('[QPay] ⚠ bookingId-ээр олдсонгүй:', bookingId);
  }

  if (invoiceId) {
    const booking = await Booking.findOne({ 'payment.transactionId': String(invoiceId) })
      .populate('movie', 'title')
      .populate({
        path: 'schedule',
        select: 'showTime hall movie',
        populate: { path: 'movie', select: 'title' },
      });
    if (booking) {
      console.log('[QPay] Booking олдлоо (by invoiceId):', booking._id);
    } else {
      console.warn('[QPay] ⚠ invoiceId-ээр олдсонгүй:', invoiceId);
    }
    return booking;
  }

  console.warn('[QPay] ⚠ invoiceId ба bookingId хоёулаа байхгүй.');
  return null;
};

export const completeTestPayment = async (req, res) => {
  console.log('[QPay] ── completeTestPayment эхэллээ ──');
  try {
    const { invoiceId } = req.params;
    const { bookingId } = req.body || {};
    console.log('[QPay] Test payment params:', { invoiceId, bookingId });

    const { booking, emailResult } = await markBookingPaid({
      invoiceId,
      bookingId,
      paymentId: `TEST-${Date.now()}`,
    });

    console.log('[QPay] Test payment амжилттай. Email result:', JSON.stringify(emailResult));

    return res.json({
      success: true,
      paid: true,
      data: {
        paid: true,
        status: 'PAID',
        invoiceId,
        bookingId: String(booking._id),
        email: emailResult,
      },
    });
  } catch (err) {
    console.error('[QPay] ❌ completeTestPayment алдаа:', err.message);
    return res.status(err.statusCode || 500).json({
      success: false,
      paid: false,
      message: err.message || 'Тест төлбөр баталгаажуулахад алдаа гарлаа.',
    });
  }
};

const markBookingPaid = async ({ invoiceId, bookingId, paymentId = null }) => {
  console.log('[QPay] ── markBookingPaid эхэллээ ──', { invoiceId, bookingId, paymentId });

  const booking = await findBookingForInvoice({ invoiceId, bookingId });
  if (!booking) {
    const err = new Error('Захиалга олдсонгүй.');
    err.statusCode = 404;
    throw err;
  }

  console.log('[QPay] Booking олдлоо:', {
    id: booking._id,
    status: booking.status,
    paymentStatus: booking.payment?.status,
    showTime: booking.schedule?.showTime,
    customerEmail: booking.customer?.email,
  });

  // showTime дууссан эсэхийг шалгах
  const showTime = booking.schedule?.showTime ? new Date(booking.schedule.showTime) : null;
  const now = Date.now();
  if (!showTime || showTime.getTime() <= now) {
    console.warn('[QPay] ⚠ ShowTime дууссан:', {
      showTime: showTime?.toISOString(),
      now: new Date(now).toISOString(),
      diff: showTime ? `${Math.round((now - showTime.getTime()) / 60000)} минут өнгөрсөн` : 'showTime байхгүй',
    });
    booking.payment.status = 'failed';
    booking.status = 'cancelled';
    await booking.save();

    const err = new Error('Энэ үзвэрийн цаг өнгөрсөн тул төлбөр баталгаажуулах боломжгүй.');
    err.statusCode = 400;
    throw err;
  }

  // Booking-г paid болгох
  booking.payment.status = 'paid';
  booking.payment.method = 'qpay';
  booking.payment.transactionId = invoiceId || booking.payment.transactionId || paymentId;
  booking.status = 'active';
  await booking.save();
  console.log('[QPay] ✅ Booking paid болгосон:', booking._id);

  // И-мэйл илгээх
  let emailResult = null;
  try {
    console.log('[QPay] И-мэйл илгээх гэж байна...');
    emailResult = await sendPaidBookingEmail(booking);
    if (!emailResult?.success) {
      console.warn('[QPay] ⚠ Booking paid, гэхдээ и-мэйл илгээгдсэнгүй:', emailResult?.reason || emailResult?.error || 'unknown');
    } else {
      console.log('[QPay] ✅ И-мэйл амжилттай илгээгдлээ.');
    }
  } catch (err) {
    emailResult = { success: false, error: err.message };
    console.error('[QPay] ❌ И-мэйл илгээхэд алдаа:', err.message);
    console.error('[QPay] ❌ Stack:', err.stack);
  }

  return { booking, emailResult };
};

// ── 1. Invoice үүсгэх ─────────────────────────────────────────────────────────
export const createInvoice = async (req, res) => {
  try {
    const { bookingId, amount, seats, movieTitle } = req.body;

    if (!bookingId || !amount)
      return res.status(400).json({ success: false, message: 'bookingId болон amount шаардлагатай' });

    if (!mongoose.Types.ObjectId.isValid(String(bookingId))) {
      return res.status(400).json({
        success: false,
        message: 'Захиалгын дугаар буруу байна. Эхлээд захиалгаа амжилттай үүсгэнэ үү.',
      });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Захиалга олдсонгүй. Эхлээд захиалгаа дахин үүсгэнэ үү.',
      });
    }
    if (booking.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Цуцлагдсан захиалгад төлбөр үүсгэх боломжгүй.',
      });
    }
    if (booking.payment?.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Энэ захиалга аль хэдийн төлөгдсөн байна.',
      });
    }

    const invoiceAmount = Number(booking.totalPrice) || Number(amount);
    if (!invoiceAmount) {
      return res.status(400).json({ success: false, message: 'Төлбөрийн дүн олдсонгүй.' });
    }

    const invoice = await createCinemaInvoice({
      bookingId,
      amount: invoiceAmount,
      seats: booking.seats?.length ? booking.seats : seats,
      movieTitle,
    });
    await Booking.findByIdAndUpdate(bookingId, {
      $set: {
        'payment.method': 'qpay',
        'payment.status': 'pending',
        'payment.transactionId': invoice.invoiceId,
      },
    });
    return res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    console.error('[QPay] Invoice алдаа:', err);
    return res.status(500).json({ success: false, message: 'Invoice үүсгэхэд алдаа', error: err?.error || err?.message || err });
  }
};

// ── 2. Төлбөр шалгах ─────────────────────────────────────────────────────────
export const checkPayment = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    if (!invoiceId)
      return res.status(400).json({ success: false, message: 'invoiceId шаардлагатай' });

    const result = await checkPaymentStatus(invoiceId);
    if (result.paid) {
      console.log('[QPay] checkPayment → paid=true, markBookingPaid дуудаж байна...');
      try {
        const { emailResult } = await markBookingPaid({ invoiceId, paymentId: result.payments?.[0]?.payment_id });
        // И-мэйл үр дүнг response-д оруулна
        result.email = emailResult;
      } catch (err) {
        console.warn('[QPay] Paid invoice booking update warning:', err.message);
        result.bookingError = err.message;
      }
    }
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error('[QPay] Төлбөр шалгах алдаа:', err);
    return res.status(500).json({ success: false, message: 'Статус шалгахад алдаа', error: err?.error || err?.message || err });
  }
};

// ── 3. Callback (QPay → манай сервер) ────────────────────────────────────────
// QPay дуудна: /api/qpay/callback?booking_id=xxx&qpay_payment_id=yyy
export const handleCallback = async (req, res) => {
  const booking_id = req.query.booking_id || req.body?.booking_id || req.body?.bookingId || req.body?.sender_invoice_no;
  const qpay_payment_id = req.query.qpay_payment_id || req.body?.qpay_payment_id || req.body?.payment_id;
  console.log(`[QPay] Callback — method: ${req.method}, booking_id: ${booking_id}, payment_id: ${qpay_payment_id}`);
  try {
    if (!booking_id) {
      console.warn('[QPay] Callback booking_id байхгүй тул booking/email шинэчлэхгүй.');
      return res.status(400).json({ success: false, message: 'booking_id шаардлагатай.' });
    }

    const { emailResult } = await markBookingPaid({
      bookingId: booking_id,
      paymentId: qpay_payment_id || null,
    });
    return res.status(200).json({ success: true, email: emailResult });
  } catch (err) {
    console.error('[QPay] Callback алдаа:', err.message);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── 4. Invoice цуцлах ─────────────────────────────────────────────────────────
export const cancelInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    await cancelInv(invoiceId);
    return res.status(200).json({ success: true, message: 'Invoice цуцлагдлаа' });
  } catch (err) {
    console.error('[QPay] Invoice цуцлах алдаа:', err);
    return res.status(500).json({ success: false, message: 'Цуцлахад алдаа', error: err?.error || err?.message || err });
  }
};

// ── 5. И-баримт үүсгэх ───────────────────────────────────────────────────────
export const createEbarimtHandler = async (req, res) => {
  try {
    const { paymentId, receiverType, receiverPhone } = req.body;

    if (!paymentId)
      return res.status(400).json({ success: false, message: 'paymentId шаардлагатай' });

    const result = await createEbarimt({ paymentId, receiverType, receiverPhone });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('[QPay] И-баримт алдаа:', err);
    return res.status(500).json({ success: false, message: 'И-баримт үүсгэхэд алдаа', error: err?.error || err?.message || err });
  }
};

// ── 6. Төлбөр буцаах ─────────────────────────────────────────────────────────
export const cancelPaymentHandler = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { note }      = req.body;
    await cancelPayment({ paymentId, note });
    return res.status(200).json({ success: true, message: 'Төлбөр буцаагдлаа' });
  } catch (err) {
    console.error('[QPay] Төлбөр буцаах алдаа:', err);
    return res.status(500).json({ success: false, message: 'Буцаахад алдаа', error: err?.error || err?.message || err });
  }
};
