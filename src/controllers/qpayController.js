// src/controllers/qpayController.js
import {
  createCinemaInvoice,
  checkPaymentStatus,
  cancelInvoice   as cancelInv,
  createEbarimt,
  cancelPayment,
} from '../services/qpayService.js';
import Booking from '../models/Booking.js';

const findBookingForInvoice = async ({ invoiceId, bookingId }) => {
  if (bookingId) {
    const booking = await Booking.findById(bookingId).populate('schedule');
    if (booking) return booking;
  }

  if (invoiceId) {
    return Booking.findOne({ 'payment.transactionId': String(invoiceId) }).populate('schedule');
  }

  return null;
};

export const completeTestPayment = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { bookingId } = req.body || {};
    const booking = await markBookingPaid({
      invoiceId,
      bookingId,
      paymentId: `TEST-${Date.now()}`,
    });

    return res.json({
      success: true,
      paid: true,
      data: {
        paid: true,
        status: 'PAID',
        invoiceId,
        bookingId: String(booking._id),
      },
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      paid: false,
      message: err.message || 'Тест төлбөр баталгаажуулахад алдаа гарлаа.',
    });
  }
};

const markBookingPaid = async ({ invoiceId, bookingId, paymentId = null }) => {
  const booking = await findBookingForInvoice({ invoiceId, bookingId });
  if (!booking) {
    const err = new Error('Захиалга олдсонгүй.');
    err.statusCode = 404;
    throw err;
  }

  if (!booking.schedule?.showTime || new Date(booking.schedule.showTime).getTime() <= Date.now()) {
    booking.payment.status = 'failed';
    booking.status = 'cancelled';
    await booking.save();

    const err = new Error('Энэ үзвэрийн цаг өнгөрсөн тул төлбөр баталгаажуулах боломжгүй.');
    err.statusCode = 400;
    throw err;
  }

  booking.payment.status = 'paid';
  booking.payment.method = 'qpay';
  booking.payment.transactionId = paymentId || invoiceId || booking.payment.transactionId;
  booking.status = 'active';
  await booking.save();

  return booking;
};

// ── 1. Invoice үүсгэх ─────────────────────────────────────────────────────────
export const createInvoice = async (req, res) => {
  try {
    const { bookingId, amount, seats, movieTitle } = req.body;

    if (!bookingId || !amount)
      return res.status(400).json({ success: false, message: 'bookingId болон amount шаардлагатай' });

    const invoice = await createCinemaInvoice({ bookingId, amount, seats, movieTitle });
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
      try {
        await markBookingPaid({ invoiceId, paymentId: result.payments?.[0]?.payment_id });
      } catch (err) {
        console.warn('[QPay] Paid invoice booking update warning:', err.message);
      }
    }
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error('[QPay] Төлбөр шалгах алдаа:', err);
    return res.status(500).json({ success: false, message: 'Статус шалгахад алдаа', error: err?.error || err?.message || err });
  }
};

// ── 3. Callback (QPay → манай сервер) ────────────────────────────────────────
// QPay GET дуудна: /api/qpay/callback?booking_id=xxx&qpay_payment_id=yyy
export const handleCallback = async (req, res) => {
  const { booking_id, qpay_payment_id } = req.query;
  console.log(`[QPay] Callback — booking_id: ${booking_id}, payment_id: ${qpay_payment_id}`);
  // TODO: Booking статусыг PAID болгох
  // await Booking.findByIdAndUpdate(booking_id, { paymentStatus: 'paid' });
  return res.status(200).json({ success: true });
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
