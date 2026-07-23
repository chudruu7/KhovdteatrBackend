import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import CashierScan from '../models/CashierScan.js';

const THEATER_TIME_ZONE = 'Asia/Hovd';
const ENTRY_BEFORE_MINUTES = 30;
const ENTRY_AFTER_MINUTES = 40;

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

const getPopulatedBooking = (bookingId) => Booking.findById(bookingId)
  .populate('movie', 'title posterUrl duration')
  .populate({
    path: 'schedule',
    select: 'showTime hall movie',
    populate: { path: 'movie', select: 'title posterUrl duration' },
  });

const getMovie = (booking) => {
  if (booking.movie?.title) return booking.movie;
  if (booking.schedule?.movie?.title) return booking.schedule.movie;
  return null;
};

const getAdmissionStatus = (booking) => {
  const showTime = booking.schedule?.showTime ? new Date(booking.schedule.showTime) : null;
  const now = Date.now();

  if (!booking) {
    return { result: 'invalid', allowed: false, label: 'Олдсонгүй', reason: 'Тасалбар олдсонгүй.' };
  }
  if (booking.status === 'used') {
    return { result: 'warning', allowed: false, label: 'Ашиглагдсан', reason: 'Энэ тасалбар аль хэдийн уншуулагдсан байна.' };
  }
  if (booking.status === 'cancelled' || booking.status === 'expired') {
    return { result: 'invalid', allowed: false, label: 'Ашиглах боломжгүй', reason: booking.status === 'cancelled' ? 'Энэ тасалбар цуцлагдсан байна.' : 'Нэвтрэх хугацаа дууссан байна.' };
  }
  if (booking.payment?.status !== 'paid') {
    return { result: 'invalid', allowed: false, label: 'Төлбөр хүлээгдэж байна', reason: 'Төлбөр баталгаажаагүй байна.' };
  }
  if (!showTime || Number.isNaN(showTime.getTime())) {
    return { result: 'warning', allowed: false, label: 'Ашиглах боломжгүй', reason: 'Үзвэрийн цагийн мэдээлэл дутуу байна.' };
  }

  const opensAt = showTime.getTime() - ENTRY_BEFORE_MINUTES * 60 * 1000;
  const closesAt = showTime.getTime() + ENTRY_AFTER_MINUTES * 60 * 1000;

  if (now < opensAt) {
    return { result: 'warning', allowed: false, label: 'Нэвтрэх хугацаа болоогүй', reason: 'Үзвэр эхлэхээс 30 минутын өмнө QR тасалбар нээгдэнэ.' };
  }
  if (now > closesAt) {
    return { result: 'invalid', allowed: false, label: 'Ашиглах боломжгүй', reason: 'Үзвэр эхэлснээс хойш 40 минут өнгөрсөн тул нэвтрэх хугацаа дууссан.' };
  }

  return { result: 'valid', allowed: true, label: 'Ашиглах боломжтой', reason: 'QR тасалбар нэвтрүүлэх боломжтой.' };
};

const formatBookingForCashier = (booking) => {
  const movie = getMovie(booking);
  const showTime = booking.schedule?.showTime ? new Date(booking.schedule.showTime) : null;
  const show = formatTheaterDateTime(showTime);
  const admission = getAdmissionStatus(booking);

  return {
    id: String(booking._id),
    bookingCode: String(booking._id),
    movieTitle: movie?.title || 'Тодорхойгүй үзвэр',
    posterUrl: movie?.posterUrl || '',
    date: show.date,
    dateISO: show.dateISO,
    time: show.time,
    showDatetime: showTime?.toISOString() || null,
    hall: booking.schedule?.hall?.hallName || '—',
    seats: booking.seats || [],
    totalPrice: booking.totalPrice || 0,
    status: booking.status,
    paymentStatus: booking.payment?.status || 'pending',
    paymentMethod: booking.payment?.method || '',
    customerName: booking.customer?.name || '',
    customerEmail: booking.customer?.email || '',
    customerPhone: booking.customer?.phone || '',
    admission,
    scannedAt: new Date().toISOString(),
  };
};

const extractBookingCode = (value = '') => {
  let raw = String(value || '').trim();
  if (!raw) return '';

  try {
    raw = decodeURIComponent(raw);
  } catch {}

  try {
    const parsed = JSON.parse(raw);
    if (parsed.bookingCode) return String(parsed.bookingCode).trim();
    if (parsed.bookingId) return String(parsed.bookingId).trim();
    if (parsed.id) return String(parsed.id).trim();
    if (parsed.verifyUrl) return extractBookingCode(parsed.verifyUrl);
    if (parsed.qrPayload) return extractBookingCode(parsed.qrPayload);
    if (parsed.data) return extractBookingCode(parsed.data);
  } catch {}

  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const ticketIndex = parts.findIndex((part) => part === 'ticket-verify');
    if (ticketIndex >= 0 && parts[ticketIndex + 1]) return parts[ticketIndex + 1];
    const verifyIndex = parts.findIndex((part) => ['verify', 'ticket', 'tickets'].includes(part));
    if (verifyIndex >= 0 && parts[verifyIndex + 1]) return parts[verifyIndex + 1];
    const code = url.searchParams.get('bookingId') || url.searchParams.get('bookingCode') || url.searchParams.get('code') || url.searchParams.get('id');
    if (code) return code;
  } catch {}

  const objectId = raw.match(/[a-f\d]{24}/i);
  if (objectId) return objectId[0];

  return raw.replace(/^#/, '').trim();
};

export const scanTicketToStation = async (req, res) => {
  try {
    const { stationKey } = req.params;
    const qrData = req.body.qrData || req.body.bookingCode || '';
    const bookingCode = extractBookingCode(qrData);

    if (!stationKey || stationKey.length < 8) {
      return res.status(400).json({ success: false, message: 'Station key буруу байна.' });
    }
    if (!mongoose.Types.ObjectId.isValid(bookingCode)) {
      const scan = await CashierScan.create({
        stationKey,
        scannedBy: req.user._id,
        qrData,
        result: 'invalid',
        message: 'QR кодоос захиалгын дугаар уншиж чадсангүй.',
      });
      return res.status(400).json({ success: false, scan, message: scan.message });
    }

    const booking = await getPopulatedBooking(bookingCode);
    if (!booking) {
      const scan = await CashierScan.create({
        stationKey,
        scannedBy: req.user._id,
        qrData,
        result: 'invalid',
        message: 'Тасалбар олдсонгүй.',
      });
      return res.status(404).json({ success: false, scan, message: scan.message });
    }

    const formatted = formatBookingForCashier(booking);
    const scan = await CashierScan.create({
      stationKey,
      booking: booking._id,
      scannedBy: req.user._id,
      qrData,
      result: formatted.admission.result,
      message: formatted.admission.reason,
      payload: formatted,
    });

    return res.json({ success: true, scan, booking: formatted });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Тасалбар уншихад алдаа гарлаа.', error: err.message });
  }
};

export const getLatestStationScan = async (req, res) => {
  try {
    const scan = await CashierScan.findOne({ stationKey: req.params.stationKey })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, scan: scan || null });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Station мэдээлэл авахад алдаа гарлаа.', error: err.message });
  }
};

export const getCashierTicket = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.bookingId)) {
      return res.status(400).json({ success: false, message: 'Захиалгын дугаар буруу байна.' });
    }

    const booking = await getPopulatedBooking(req.params.bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Тасалбар олдсонгүй.' });

    return res.json({ success: true, booking: formatBookingForCashier(booking) });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Тасалбар шалгахад алдаа гарлаа.', error: err.message });
  }
};

export const admitTicket = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.bookingId)) {
      return res.status(400).json({ success: false, message: 'Захиалгын дугаар буруу байна.' });
    }

    const booking = await getPopulatedBooking(req.params.bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Тасалбар олдсонгүй.' });

    const admission = getAdmissionStatus(booking);
    if (!admission.allowed) {
      return res.status(409).json({
        success: false,
        message: admission.reason,
        booking: formatBookingForCashier(booking),
      });
    }

    booking.status = 'used';
    booking.expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await booking.save();

    const fresh = await getPopulatedBooking(booking._id);
    return res.json({
      success: true,
      message: 'Тасалбар нэвтрүүлэгдлээ.',
      booking: formatBookingForCashier(fresh),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Тасалбар нэвтрүүлэхэд алдаа гарлаа.', error: err.message });
  }
};
