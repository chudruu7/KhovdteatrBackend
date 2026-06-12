import Booking from '../models/Booking.js';
import { sendBookingConfirmation } from './Emailservice.js';

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

export const sendPaidBookingEmail = async (booking) => {
  if (!booking) return { success: false, reason: 'missing_booking' };
  if (booking.ticketEmailSentAt) return { success: true, skipped: true, reason: 'already_sent' };
  if (!booking.customer?.email) return { success: false, reason: 'missing_customer_email' };

  await booking.populate([
    { path: 'movie', select: 'title' },
    { path: 'schedule', select: 'showTime hall movie', populate: { path: 'movie', select: 'title' } },
  ]);

  if (!booking.schedule?.showTime) return { success: false, reason: 'missing_show_time' };

  const show = formatTheaterDateTime(booking.schedule.showTime);
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

  if (result?.success) {
    booking.ticketEmailSentAt = new Date();
    await booking.save();
  }

  return result;
};

export const markBookingPaidAndNotify = async ({ bookingId, paymentMethod, transactionId }) => {
  const booking = await Booking.findById(bookingId)
    .populate('movie', 'title')
    .populate({
      path: 'schedule',
      select: 'showTime hall movie',
      populate: { path: 'movie', select: 'title' },
    });

  if (!booking) {
    const err = new Error('Захиалга олдсонгүй.');
    err.statusCode = 404;
    throw err;
  }

  const showTime = booking.schedule?.showTime ? new Date(booking.schedule.showTime) : null;
  if (!showTime || showTime.getTime() <= Date.now()) {
    booking.payment.status = 'failed';
    booking.status = 'cancelled';
    await booking.save();

    const err = new Error('Энэ үзвэрийн цаг өнгөрсөн тул төлбөр баталгаажуулах боломжгүй.');
    err.statusCode = 400;
    throw err;
  }

  booking.payment.status = 'paid';
  booking.payment.method = paymentMethod;
  booking.payment.transactionId = transactionId || booking.payment.transactionId;
  booking.status = 'active';
  await booking.save();

  const emailResult = await sendPaidBookingEmail(booking);
  return { booking, emailResult };
};
