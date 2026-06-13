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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const queuedEmailBookingIds = new Set();

const logBookingEmailContext = (label, booking, extra = {}) => {
  console.log(`[Booking/Fulfillment] ${label}`, {
    bookingId: String(booking?._id || ''),
    customerEmail: booking?.customer?.email || null,
    movieTitle: booking?.schedule?.movie?.title || booking?.movie?.title || null,
    showTime: booking?.schedule?.showTime || null,
    hall: booking?.schedule?.hall?.hallName || null,
    seats: booking?.seats || [],
    tickets: booking?.tickets || [],
    totalPrice: booking?.totalPrice,
    bookingStatus: booking?.status,
    paymentStatus: booking?.payment?.status,
    paymentMethod: booking?.payment?.method,
    transactionId: booking?.payment?.transactionId,
    ticketEmailSentAt: booking?.ticketEmailSentAt || null,
    ...extra,
  });
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

  logBookingEmailContext('Sending paid ticket email', booking);

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

  logBookingEmailContext('Paid ticket email result', booking, { emailResult: result });

  return result;
};

const sendPaidBookingEmailWithRetry = async (booking, attempts = 3) => {
  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = await sendPaidBookingEmail(booking);
    if (lastResult?.success) return lastResult;
    console.warn('[Booking/Fulfillment] Ticket email failed, retrying...', {
      bookingId: String(booking?._id || ''),
      attempt,
      attempts,
      reason: lastResult?.reason || lastResult?.error || lastResult?.code || 'unknown',
    });
    if (attempt < attempts) await wait(1200);
  }
  return lastResult || { success: false, reason: 'email_failed' };
};

export const ensurePaidBookingEmailQueued = (bookingOrId, source = 'unspecified') => {
  const bookingKey = String(bookingOrId?._id || bookingOrId || '');
  if (!bookingKey || queuedEmailBookingIds.has(bookingKey)) {
    return { success: null, queued: false, reason: 'email_already_queued' };
  }
  queuedEmailBookingIds.add(bookingKey);
  setImmediate(async () => {
    let booking = null;
    try {
      booking = await Booking.findById(bookingKey)
        .populate('movie', 'title')
        .populate({
          path: 'schedule',
          select: 'showTime hall movie',
          populate: { path: 'movie', select: 'title' },
        });

      if (!booking) {
        console.warn('[Booking/Fulfillment] Background email skipped: booking not found', {
          bookingId: bookingKey,
          source,
        });
        return;
      }

      if (booking.payment?.status !== 'paid' || booking.ticketEmailSentAt) {
        logBookingEmailContext('Background email skipped', booking, {
          source,
          reason: booking.ticketEmailSentAt ? 'already_sent' : 'not_paid',
        });
        return;
      }

      const emailResult = await sendPaidBookingEmailWithRetry(booking);
      logBookingEmailContext('Background paid ticket email finished', booking, { source, emailResult });
    } catch (err) {
      console.error('[Booking/Fulfillment] Background paid ticket email crashed', {
        bookingId: bookingKey,
        source,
        error: err.message,
      });
    } finally {
      queuedEmailBookingIds.delete(bookingKey);
    }
  });
  return { success: null, queued: true, reason: 'background_email', source };
};

export const processUnsentPaidBookingEmails = async (limit = 20) => {
  const lookbackMinutes = Number(process.env.UNSENT_EMAIL_SCAN_LOOKBACK_MINUTES || 30);
  const updatedAfter = new Date(Date.now() - lookbackMinutes * 60 * 1000);
  const bookings = await Booking.find({
    status: 'active',
    'payment.status': 'paid',
    ticketEmailSentAt: null,
    updatedAt: { $gte: updatedAfter },
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('_id');

  let queued = 0;
  for (const booking of bookings) {
    const result = ensurePaidBookingEmailQueued(booking._id, 'scheduled_scan');
    if (result.queued) queued += 1;
  }

  if (queued) {
    console.log('[Booking/Fulfillment] Scheduled unsent paid email scan queued jobs', {
      queued,
      checked: bookings.length,
    });
  }

  return { checked: bookings.length, queued };
};

export const markBookingPaidAndNotify = async ({
  bookingId,
  paymentMethod,
  transactionId,
  awaitEmail = true,
}) => {
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

  if (!booking.schedule?.showTime) {
    const err = new Error('???????? ??? ????????? ??? ?????????? ????? ?????? ?????????.');
    err.statusCode = 400;
    throw err;
  }

  booking.payment.status = 'paid';
  booking.payment.method = paymentMethod;
  booking.payment.transactionId = transactionId || booking.payment.transactionId;
  booking.status = 'active';
  await booking.save();

  logBookingEmailContext('Booking marked paid', booking);

  if (!awaitEmail) {
    const emailResult = ensurePaidBookingEmailQueued(booking._id, 'mark_paid');
    logBookingEmailContext('Booking paid notification queued', booking, { emailResult });
    return { booking, emailResult };
  }

  const emailResult = await sendPaidBookingEmailWithRetry(booking);
  logBookingEmailContext('Booking paid notification finished', booking, { emailResult });
  return { booking, emailResult };
};
