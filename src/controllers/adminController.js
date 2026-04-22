// src/controllers/adminController.js

import Movie      from '../models/Movie.js';
import Schedule   from '../models/Schedule.js';
import User       from '../models/User.js';
import Booking    from '../models/Booking.js';
import News       from '../models/News.js';
import CinemaInfo from '../models/CinemaInfo.js';

// ================================================
// TIMEZONE HELPER  (UTC+8, DST байхгүй)
// ================================================

const MN_MS = 8 * 60 * 60 * 1000;

const mnDayRange = (date = new Date()) => {
  const mnNow = new Date(date.getTime() + MN_MS);
  const y = mnNow.getUTCFullYear();
  const m = mnNow.getUTCMonth();
  const d = mnNow.getUTCDate();
  return {
    start: new Date(Date.UTC(y, m, d,  0,  0,  0,   0) - MN_MS),
    end:   new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - MN_MS),
  };
};

const utcToMnTime = (iso) => {
  const d = new Date(new Date(iso).getTime() + MN_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

// ================================================
// ТУСЛАХ ФУНКЦ
// ================================================

const getTimeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  const intervals = [
    { label: 'жилийн өмнө',  secs: 31536000 },
    { label: 'сарын өмнө',   secs: 2592000  },
    { label: 'өдрийн өмнө',  secs: 86400    },
    { label: 'цагийн өмнө',  secs: 3600     },
    { label: 'минутын өмнө', secs: 60       },
  ];
  for (const { label, secs } of intervals) {
    const val = Math.floor(seconds / secs);
    if (val >= 1) return `${val} ${label}`;
  }
  return `${Math.floor(seconds)} секундын өмнө`;
};

/**
 * Өсөлт/бууралт хувь тооцоолох
 * today=0, yesterday=0 → '+0%'
 * yesterday=0, today>0 → '+100%' (шинэ орлого)
 */
const calcGrowth = (today, yesterday) => {
  if (yesterday === 0 && today === 0) return { value: 0, label: '+0%' };
  if (yesterday === 0) return { value: 100, label: '+100%' };
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  return {
    value: pct,
    label: pct >= 0 ? `+${pct}%` : `${pct}%`,
  };
};

// ================================================
// DASHBOARD STATISTICS
// ================================================

export const getDashboardStats = async (req, res) => {
  try {
    // ── Өнөөдөр ──────────────────────────────────────────────────────
    const { start: today, end: todayEnd } = mnDayRange();

    // ── Өчигдөр ──────────────────────────────────────────────────────
    const yesterdayDate = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const { start: yesterday, end: yesterdayEnd } = mnDayRange(yesterdayDate);

    // ── Долоо хоног ───────────────────────────────────────────────────
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const startOfMonth = (() => {
      const mn = new Date(today.getTime() + MN_MS);
      return new Date(Date.UTC(mn.getUTCFullYear(), mn.getUTCMonth(), 1) - MN_MS);
    })();
    const startOfYear = (() => {
      const mn = new Date(today.getTime() + MN_MS);
      return new Date(Date.UTC(mn.getUTCFullYear(), 0, 1) - MN_MS);
    })();
    const tomorrow = new Date(todayEnd.getTime() + 1);

    // ── Өнөөдрийн захиалгууд ──────────────────────────────────────────
    const todayBookings = await Booking.find({
      createdAt: { $gte: today, $lte: todayEnd },
      'payment.status': 'paid',
    });
    const todayRevenue = todayBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
    const todayTickets = todayBookings.reduce((s, b) => s + (b.seats?.length || 0), 0);

    // ── Өчигдрийн захиалгууд ─────────────────────────────────────────
    const yesterdayBookings = await Booking.find({
      createdAt: { $gte: yesterday, $lte: yesterdayEnd },
      'payment.status': 'paid',
    });
    const yesterdayRevenue = yesterdayBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
    const yesterdayTickets = yesterdayBookings.reduce((s, b) => s + (b.seats?.length || 0), 0);

    // ── Танхим дүүргэлт (өнөөдөр) ────────────────────────────────────
    const todaySchedules = await Schedule.find({ showTime: { $gte: today, $lte: todayEnd } });
    let totalSeats = 0, soldSeats = 0;
    todaySchedules.forEach(s => {
      totalSeats += s.hall?.totalSeats  || 0;
      soldSeats  += s.soldSeats?.length || 0;
    });
    const occupancyRate = totalSeats > 0 ? Math.round((soldSeats / totalSeats) * 100) : 0;

    // ── Танхим дүүргэлт (өчигдөр) ────────────────────────────────────
    const yesterdaySchedules = await Schedule.find({ showTime: { $gte: yesterday, $lte: yesterdayEnd } });
    let yTotalSeats = 0, ySoldSeats = 0;
    yesterdaySchedules.forEach(s => {
      yTotalSeats += s.hall?.totalSeats  || 0;
      ySoldSeats  += s.soldSeats?.length || 0;
    });
    const yesterdayOccupancy = yTotalSeats > 0 ? Math.round((ySoldSeats / yTotalSeats) * 100) : 0;

    // ── Хэрэглэгч ─────────────────────────────────────────────────────
    const newUsers           = await User.countDocuments({ createdAt: { $gte: today,     $lte: todayEnd     } });
    const yesterdayNewUsers  = await User.countDocuments({ createdAt: { $gte: yesterday, $lte: yesterdayEnd } });
    const totalUsers         = await User.countDocuments();

    // ── Кино / Үзвэр ──────────────────────────────────────────────────
    const totalMovies   = await Movie.countDocuments();
    const activeShows   = await Schedule.countDocuments({ showTime: { $gte: today, $lte: todayEnd } });
    const upcomingShows = await Schedule.countDocuments({ showTime: { $gte: tomorrow } });

    // ── Дундаж IMDb ───────────────────────────────────────────────────
    const ratedMovies = await Movie.find({ imdb: { $exists: true, $ne: null } });
    const avgRating   = ratedMovies.length > 0
      ? (ratedMovies.reduce((s, m) => s + (parseFloat(m.imdb) || 0), 0) / ratedMovies.length).toFixed(1)
      : '0.0';

    // ── Analytics cards ───────────────────────────────────────────────
    const avgTicketPrice = todayTickets > 0 ? Math.round(todayRevenue / todayTickets) : 0;
    const yesterdayAvgTicket = yesterdayTickets > 0 ? Math.round(yesterdayRevenue / yesterdayTickets) : 0;

    const allPaidBookings  = await Booking.find({ 'payment.status': 'paid' });
    const totalRevenue     = allPaidBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);

    const mnToday     = new Date(today.getTime() + MN_MS);
    const dayOfMonth  = mnToday.getUTCDate();
    const daysInMonth = new Date(Date.UTC(mnToday.getUTCFullYear(), mnToday.getUTCMonth() + 1, 0)).getUTCDate();
    const projectedRevenue = dayOfMonth > 0
      ? parseFloat(((todayRevenue / dayOfMonth) * daysInMonth / 1_000_000).toFixed(1))
      : 0;

    // ── Долоо хоногийн өсөлт ──────────────────────────────────────────
    const lastWeekBookings = await Booking.find({
      createdAt: { $gte: weekAgo, $lt: today }, 'payment.status': 'paid',
    });
    const lastWeekRevenue = lastWeekBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
    const weeklyGrowth = lastWeekRevenue > 0
      ? `+${Math.round(((todayRevenue - lastWeekRevenue) / lastWeekRevenue) * 100)}%`
      : '+0%';

    // ── Сарын / Жилийн орлого ─────────────────────────────────────────
    const monthBookings  = await Booking.find({ createdAt: { $gte: startOfMonth }, 'payment.status': 'paid' });
    const monthlyRevenue = monthBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);

    const yearBookings  = await Booking.find({ createdAt: { $gte: startOfYear }, 'payment.status': 'paid' });
    const yearlyRevenue = yearBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);

    // ── Өсөлт/бууралт тооцоолол ──────────────────────────────────────
    const revenueGrowth    = calcGrowth(todayRevenue,  yesterdayRevenue);
    const ticketsGrowth    = calcGrowth(todayTickets,  yesterdayTickets);
    const occupancyGrowth  = calcGrowth(occupancyRate, yesterdayOccupancy);
    const usersGrowth      = calcGrowth(newUsers,      yesterdayNewUsers);
    const ticketPriceGrowth = calcGrowth(avgTicketPrice, yesterdayAvgTicket);

    return res.json({
      // ── Stat cards ────────────────────────────────────────────
      todayRevenue:   `₮ ${todayRevenue.toLocaleString()}`,
      totalTickets:   todayTickets.toString(),
      occupancyRate:  `${occupancyRate}%`,
      newUsers:       newUsers.toString(),

      // ── Өнөөдөр raw (тооцоолол хийхэд) ──────────────────────
      todayRevenueRaw:   todayRevenue,
      todayTicketsRaw:   todayTickets,
      occupancyRateRaw:  occupancyRate,
      newUsersRaw:       newUsers,

      // ── Өчигдөр raw ──────────────────────────────────────────
      yesterdayRevenueRaw:  yesterdayRevenue,
      yesterdayTicketsRaw:  yesterdayTickets,
      yesterdayOccupancy,
      yesterdayNewUsers,

      // ── Өсөлт/бууралт (label + sign) ─────────────────────────
      revenueGrowth:   revenueGrowth.label,
      ticketsGrowth:   ticketsGrowth.label,
      occupancyGrowth: occupancyGrowth.label,
      usersGrowth:     usersGrowth.label,
      ticketPriceGrowth: ticketPriceGrowth.label,

      // ── Кино / Үзвэр ─────────────────────────────────────────
      totalMovies,
      activeShows,
      upcomingShows,
      totalUsers,
      avgRating,
      weeklyGrowth,

      // ── Сар / Жил ────────────────────────────────────────────
      monthlyRevenue:  `₮ ${monthlyRevenue.toLocaleString()}`,
      yearlyRevenue:   `₮ ${yearlyRevenue.toLocaleString()}`,

      // ── Analytics cards ───────────────────────────────────────
      avgTicketPrice,
      totalRevenue,
      projectedRevenue,
    });
  } catch (error) {
    console.error('getDashboardStats error:', error);
    return res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
  }
};

// ================================================
// СҮҮЛИЙН ҮЗВЭРҮҮД
// ================================================

export const getRecentShowtimes = async (req, res) => {
  try {
    const { start: today, end: todayEnd } = mnDayRange();

    const schedules = await Schedule.find({
      showTime: { $gte: today, $lte: todayEnd },
    })
      .populate('movie', 'title posterUrl duration genre')
      .sort({ showTime: 1 })
      .limit(10);

    const showtimes = schedules.map(s => ({
      id:          s._id,
      movie:       s.movie?.title    || 'Тодорхойгүй',
      poster:      s.movie?.posterUrl || null,
      genre:       s.movie?.genre?.[0] || null,
      hall:        s.hall?.hallName  || s.hall?.name || '—',
      time:        utcToMnTime(s.showTime),
      showDatetime: s.showTime,
      seats:       s.soldSeats?.length || 0,
      totalSeats:  s.hall?.totalSeats  || 0,
      occupancy:   s.hall?.totalSeats > 0
        ? `${Math.round(((s.soldSeats?.length || 0) / s.hall.totalSeats) * 100)}%`
        : '0%',
    }));

    return res.json(showtimes);
  } catch (error) {
    console.error('getRecentShowtimes error:', error);
    return res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
  }
};

// ================================================
// СҮҮЛИЙН ЗАХИАЛГУУД
// ================================================

export const getRecentBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('customer', 'name email')
      .populate({
        path:     'schedule',
        populate: { path: 'movie', select: 'title' },
      })
      .sort({ createdAt: -1 })
      .limit(10);

    const recentBookings = bookings.map(b => ({
      id:          b._id,
      customer:    b.customer?.name         || 'Зочин',
      movie:       b.schedule?.movie?.title || 'Тодорхойгүй',
      seats:       b.seats?.length          || 0,
      amount:      `₮ ${(b.totalPrice || 0).toLocaleString()}`,
      time:        getTimeAgo(b.createdAt),
      status:      b.status                 || 'active',
      payment:     b.payment?.status        || 'pending',
      showDatetime: b.schedule?.showTime    || null,
    }));

    return res.json(recentBookings);
  } catch (error) {
    console.error('getRecentBookings error:', error);
    return res.status(500).json({ message: error.message });
  }
};

// ================================================
// ОНЦЛОХ КИНОНУУД
// ================================================

export const getFeaturedMovies = async (req, res) => {
  try {
    const movies = await Movie.find({ status: 'nowShowing' })
      .sort({ createdAt: -1 })
      .limit(6);

    const featuredMovies = await Promise.all(movies.map(async (movie) => {
      const schedules   = await Schedule.find({ movie: movie._id });
      const scheduleIds = schedules.map(s => s._id);
      const bookings    = await Booking.find({
        schedule: { $in: scheduleIds }, 'payment.status': 'paid',
      });

      const revenue     = bookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
      const ticketsSold = bookings.reduce((s, b) => s + (b.seats?.length || 0), 0);

      return {
        id:            movie._id,
        title:         movie.title,
        originalTitle: movie.originalTitle || '',
        revenue:       `₮ ${(revenue / 1_000_000).toFixed(1)}M`,
        rating:        parseFloat(movie.imdb) || 0,
        status:        movie.status,
        genre:         movie.genre      || [],
        duration:      movie.duration   || '',
        releaseDate:   movie.releaseDate || '',
        tickets:       ticketsSold,
      };
    }));

    return res.json(featuredMovies);
  } catch (error) {
    console.error('getFeaturedMovies error:', error);
    return res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
  }
};

// ================================================
// УДАХГҮЙ ГАРАХ КИНОНУУД
// ================================================

export const getUpcomingMovies = async (req, res) => {
  try {
    const movies = await Movie.find({ status: 'comingSoon' })
      .sort({ releaseDate: 1 })
      .limit(6);

    const upcomingMovies = await Promise.all(movies.map(async (movie) => {
      const schedules   = await Schedule.find({ movie: movie._id });
      const scheduleIds = schedules.map(s => s._id);
      const preOrders   = await Booking.countDocuments({ schedule: { $in: scheduleIds } });

      return {
        id:             movie._id,
        title:          movie.title,
        originalTitle:  movie.originalTitle || '',
        expectedRating: parseFloat(movie.imdb) || 0,
        status:         movie.status,
        genre:          movie.genre      || [],
        duration:       movie.duration   || '',
        releaseDate:    movie.releaseDate || '',
        preOrders,
      };
    }));

    return res.json(upcomingMovies);
  } catch (error) {
    console.error('getUpcomingMovies error:', error);
    return res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
  }
};

// ================================================
// МЭДЭГДЛҮҮД
// ================================================

export const getAlerts = async (req, res) => {
  try {
    const alerts = [];
    const { start: today, end: todayEnd } = mnDayRange();

    const schedules = await Schedule.find({ showTime: { $gte: today, $lte: todayEnd } });

    schedules.forEach(s => {
      const total = s.hall?.totalSeats  || 0;
      const sold  = s.soldSeats?.length || 0;
      if (total > 0 && sold / total >= 0.9) {
        alerts.push({
          id:      `full-${s._id}`,
          message: `${s.hall?.hallName || 'Танхим'} 90%-иас дээш дүүрсэн байна`,
          time:    'Өнөөдөр',
          type:    'warning',
        });
      }
    });
// GET /api/admin/sparklines
// Сүүлийн 14 хоногийн өдөр тутмын: орлого, тасалбар, дүүргэлт, хэрэглэгч
 const getSparklines = async (req, res) => {
  try {
    const days = 14;
    const result = { revenue: [], tickets: [], occupancy: [], users: [] };

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const { start, end } = mnDayRange(date);

      const bookings = await Booking.find({
        createdAt: { $gte: start, $lte: end },
        'payment.status': 'paid',
      });
      const rev     = bookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
      const tickets = bookings.reduce((s, b) => s + (b.seats?.length || 0), 0);

      const schedules = await Schedule.find({ showTime: { $gte: start, $lte: end } });
      let totalSeats = 0, soldSeats = 0;
      schedules.forEach(s => {
        totalSeats += s.hall?.totalSeats  || 0;
        soldSeats  += s.soldSeats?.length || 0;
      });
      const occ = totalSeats > 0 ? Math.round((soldSeats / totalSeats) * 100) : 0;

      const newUsers = await User.countDocuments({ createdAt: { $gte: start, $lte: end } });

      result.revenue.push(rev);
      result.tickets.push(tickets);
      result.occupancy.push(occ);
      result.users.push(newUsers);
    }

    return res.json(result);
  } catch (error) {
    console.error('getSparklines error:', error);
    return res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
  }
};
    const emptyShows = schedules.filter(s => (s.soldSeats?.length || 0) === 0);
    if (emptyShows.length > 0) {
      alerts.push({
        id:      'empty-shows',
        message: `${emptyShows.length} үзвэрт захиалга хийгдээгүй байна`,
        time:    'Өнөөдөр',
        type:    'info',
      });
    }

    const oneHourAgo  = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await Booking.countDocuments({ createdAt: { $gte: oneHourAgo } });
    if (recentCount > 0) {
      alerts.push({
        id:      'recent-bookings',
        message: `Сүүлийн 1 цагт ${recentCount} шинэ захиалга хийгдлээ`,
        time:    '1 цагийн өмнө',
        type:    'success',
      });
    }

    return res.json(alerts);
  } catch (error) {
    console.error('getAlerts error:', error);
    return res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
  }
};
// @desc  Сүүлийн 14 хоногийн өдөр тутмын sparkline өгөгдөл
// @route GET /api/admin/sparklines
// @access Private/Admin
export const getSparklines = async (req, res) => {
  try {
    const days = 14;
    const result = { revenue: [], tickets: [], occupancy: [], users: [] };

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const { start, end } = mnDayRange(date);

      const bookings = await Booking.find({
        createdAt: { $gte: start, $lte: end },
        'payment.status': 'paid',
      });
      const rev     = bookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
      const tickets = bookings.reduce((s, b) => s + (b.seats?.length || 0), 0);

      const schedules = await Schedule.find({ showTime: { $gte: start, $lte: end } });
      let totalSeats = 0, soldSeats = 0;
      schedules.forEach(s => {
        totalSeats += s.hall?.totalSeats  || 0;
        soldSeats  += s.soldSeats?.length || 0;
      });
      const occ = totalSeats > 0 ? Math.round((soldSeats / totalSeats) * 100) : 0;

      const newUsers = await User.countDocuments({ createdAt: { $gte: start, $lte: end } });

      result.revenue.push(rev);
      result.tickets.push(tickets);
      result.occupancy.push(occ);
      result.users.push(newUsers);
    }

    return res.json(result);
  } catch (error) {
    console.error('getSparklines error:', error);
    return res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
  }
};