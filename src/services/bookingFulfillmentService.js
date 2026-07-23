import Booking from '../models/Booking.js';
import User from '../models/User.js';
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

export const awardPaidBookingPoints = async (bookingOrId) => {
  const bookingId = bookingOrId?._id || bookingOrId;
  if (!bookingId) return { awarded: false, points: 0, reason: 'missing_booking' };

  const booking = await Booking.findById(bookingId)
    .select('userId seats tickets status payment.status rewardPointsAwardedAt');

  if (!booking) return { awarded: false, points: 0, reason: 'missing_booking' };
  if (booking.payment?.status !== 'paid' || !['active', 'used'].includes(booking.status)) {
    return { awarded: false, points: 0, reason: 'booking_not_paid' };
  }
  if (booking.rewardPointsAwardedAt) {
    return { awarded: false, points: 0, reason: 'already_awarded' };
  }

  const userId = booking.userId?._id || booking.userId;
  const user = userId ? await User.findOne({ _id: userId, role: 'user' }).select('_id') : null;
  if (!user) return { awarded: false, points: 0, reason: 'not_customer_account' };

  const points = booking.seats?.length || booking.tickets?.length || 0;
  if (points < 1) return { awarded: false, points: 0, reason: 'no_tickets' };

  const awardedAt = new Date();
  const claimed = await Booking.findOneAndUpdate(
    {
      _id: booking._id,
      rewardPointsAwardedAt: null,
      status: { $in: ['active', 'used'] },
      'payment.status': 'paid',
    },
    { $set: { rewardPointsAwardedAt: awardedAt, rewardPointsAwarded: points } },
    { new: true },
  );

  if (!claimed) return { awarded: false, points: 0, reason: 'already_awarded' };

  try {
    const updatedUser = await User.findOneAndUpdate(
      { _id: user._id, role: 'user' },
      { $inc: { points } },
      { new: true },
    ).select('points');

    if (!updatedUser) throw new Error('Customer account no longer exists.');
    return { awarded: true, points, totalPoints: updatedUser.points };
  } catch (error) {
    await Booking.updateOne(
      { _id: booking._id, rewardPointsAwardedAt: awardedAt },
      { $set: { rewardPointsAwardedAt: null, rewardPointsAwarded: 0 } },
    ).catch(() => {});
    throw error;
  }
};

const logBookingEmailContext = (label, booking, extra = {}) => {
  if (process.env.NODE_ENV === 'test') return;

  console.log(`[Booking/Fulfillment] ${label}`, {
    bookingId: String(booking?._id || ''),
    movieTitle: booking?.schedule?.movie?.title || booking?.movie?.title || null,
    showTime: booking?.schedule?.showTime || null,
    hall: booking?.schedule?.hall?.hallName || null,
    seatCount: booking?.seats?.length || 0,
    totalPrice: booking?.totalPrice,
    bookingStatus: booking?.status,
    paymentStatus: booking?.payment?.status,
    paymentMethod: booking?.payment?.method,
    ticketEmailSentAt: booking?.ticketEmailSentAt || null,
    source: extra.source,
    reason: extra.reason,
    emailSuccess: extra.emailResult?.success,
  });
};

export const sendPaidBookingEmail = async (booking, { force = false } = {}) => {
  if (!booking) return { success: false, reason: 'missing_booking' };
  if (booking.ticketEmailSentAt) return { success: true, skipped: true, reason: 'already_sent' };
  if (!booking.customer?.email) return { success: false, reason: 'missing_customer_email' };

  await booking.populate([
    { path: 'userId', select: 'notifications' },
    { path: 'movie', select: 'title' },
    { path: 'schedule', select: 'showTime hall movie', populate: { path: 'movie', select: 'title' } },
  ]);

  if (!force && booking.userId?.notifications === false) {
    if (!booking.ticketEmailSuppressedAt) {
      booking.ticketEmailSuppressedAt = new Date();
      await booking.save();
    }
    return { success: false, skipped: true, reason: 'notifications_disabled' };
  }

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
    booking.ticketEmailSuppressedAt = null;
    await booking.save();
  }

  logBookingEmailContext('Paid ticket email result', booking, { emailResult: result });

  return result;
};

const sendPaidBookingEmailWithRetry = async (booking, attempts = 3) => {
  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = await sendPaidBookingEmail(booking);
    if (lastResult?.success || lastResult?.skipped) return lastResult;
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
        .populate('userId', 'notifications')
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

      if (booking.payment?.status !== 'paid' || booking.ticketEmailSentAt || booking.ticketEmailSuppressedAt) {
        logBookingEmailContext('Background email skipped', booking, {
          source,
          reason: booking.ticketEmailSentAt
            ? 'already_sent'
            : booking.ticketEmailSuppressedAt
              ? 'notifications_disabled'
              : 'not_paid',
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
    ticketEmailSuppressedAt: null,
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
    .populate('userId', 'notifications')
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

  // ЗАСВАРЛАГДСАН ХЭСЭГ: Тэмдэгтийн алдааг (Garbled text) засаж зөв Монгол үг оруулав
  if (!booking.schedule?.showTime) {
    const err = new Error('Захиалгын үзвэрийн хуваарь эсвэл цаг олдсонгүй.');
    err.statusCode = 400;
    throw err;
  }

  booking.payment.status = 'paid';
  booking.payment.method = paymentMethod;
  booking.payment.transactionId = transactionId || booking.payment.transactionId;
  booking.status = 'active';
  await booking.save();

  const pointsResult = await awardPaidBookingPoints(booking._id);

  logBookingEmailContext('Booking marked paid', booking, { pointsResult });

  if (!awaitEmail) {
    if (booking.userId?.notifications === false) {
      booking.ticketEmailSuppressedAt = booking.ticketEmailSuppressedAt || new Date();
      await booking.save();
      const emailResult = { success: false, skipped: true, reason: 'notifications_disabled' };
      logBookingEmailContext('Booking email suppressed by user preference', booking, { emailResult });
      return { booking, emailResult };
    }
    const emailResult = ensurePaidBookingEmailQueued(booking._id, 'mark_paid');
    logBookingEmailContext('Booking paid notification queued', booking, { emailResult });
    return { booking, emailResult };
  }

  const emailResult = await sendPaidBookingEmailWithRetry(booking);
  logBookingEmailContext('Booking paid notification finished', booking, { emailResult });
  return { booking, emailResult };
};
