import Booking from '../models/Booking.js';
import Movie from '../models/Movie.js';
import Schedule from '../models/Schedule.js';
import User from '../models/User.js';

const paidMatch = {
  status: { $in: ['active', 'used', 'confirmed'] },
  $or: [
    { 'payment.status': 'paid' },
    { 'payment.status': { $exists: false } },
    { payment: null },
  ],
};

function getDateRange(query) {
  const now = new Date();
  const start = query.startDate ? new Date(query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = query.endDate ? new Date(query.endDate) : now;
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const dateMatch = (query, field = 'createdAt') => {
  const { start, end } = getDateRange(query);
  return { [field]: { $gte: start, $lte: end } };
};

const ticketCountExpr = { $size: { $ifNull: ['$seats', []] } };
const revenueExpr = { $ifNull: ['$totalPrice', '$totalAmount'] };
const movieExpr = { $ifNull: ['$movie', '$movieId'] };
const scheduleExpr = { $ifNull: ['$schedule', '$scheduleId'] };
const paymentMethodExpr = { $ifNull: ['$payment.method', { $ifNull: ['$paymentMethod', 'other'] }] };

export const dailySales = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalRevenue: { $sum: revenueExpr },
          ticketCount: { $sum: ticketCountExpr },
          bookingCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const rows = data.map((row) => ({
      ...row,
      avgTicketPrice: row.ticketCount ? row.totalRevenue / row.ticketCount : 0,
    }));

    const summary = rows.reduce((acc, row) => ({
      totalRevenue: acc.totalRevenue + (row.totalRevenue || 0),
      ticketCount: acc.ticketCount + (row.ticketCount || 0),
      bookingCount: acc.bookingCount + (row.bookingCount || 0),
    }), { totalRevenue: 0, ticketCount: 0, bookingCount: 0 });

    res.json({ success: true, data: rows, summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const monthlySales = async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const data = await Booking.aggregate([
      {
        $match: {
          ...paidMatch,
          createdAt: { $gte: new Date(`${year}-01-01T00:00:00.000Z`), $lte: new Date(`${year}-12-31T23:59:59.999Z`) },
        },
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          totalRevenue: { $sum: revenueExpr },
          ticketCount: { $sum: ticketCountExpr },
          bookingCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const formatted = Array.from({ length: 12 }, (_, i) => {
      const found = data.find((row) => row._id === i + 1);
      return { month: `${i + 1}-р сар`, monthNum: i + 1, totalRevenue: 0, ticketCount: 0, bookingCount: 0, ...(found || {}) };
    });

    res.json({ success: true, year, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const paymentMethods = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $group: { _id: paymentMethodExpr, totalRevenue: { $sum: revenueExpr }, count: { $sum: 1 } } },
      { $sort: { totalRevenue: -1 } },
    ]);
    const totalRevenue = data.reduce((sum, row) => sum + (row.totalRevenue || 0), 0);
    res.json({ success: true, data: data.map((row) => ({ ...row, percentage: totalRevenue ? ((row.totalRevenue / totalRevenue) * 100).toFixed(1) : 0 })), totalRevenue });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const refunds = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { status: 'cancelled', ...dateMatch(req.query, 'updatedAt') } },
      { $group: { _id: { $ifNull: ['$cancellationReason', 'Тодорхойгүй'] }, refundedAmount: { $sum: revenueExpr }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const totalRefunded = data.reduce((sum, row) => sum + (row.refundedAmount || 0), 0);
    res.json({ success: true, data, totalRefunded });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const movieViewership = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $group: { _id: movieExpr, totalRevenue: { $sum: revenueExpr }, ticketCount: { $sum: ticketCountExpr }, bookingCount: { $sum: 1 } } },
      { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
      { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
      { $project: { movieTitle: { $ifNull: ['$movie.title', 'Тодорхойгүй'] }, genre: '$movie.genre', poster: '$movie.posterUrl', totalRevenue: 1, ticketCount: 1, bookingCount: 1 } },
      { $sort: { totalRevenue: -1 } },
    ]);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const topMovies = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const sortBy = req.query.sortBy === 'tickets' ? 'ticketCount' : 'totalRevenue';
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $group: { _id: movieExpr, totalRevenue: { $sum: revenueExpr }, ticketCount: { $sum: ticketCountExpr }, bookingCount: { $sum: 1 } } },
      { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
      { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
      { $project: { movieTitle: { $ifNull: ['$movie.title', 'Тодорхойгүй'] }, genre: '$movie.genre', poster: '$movie.posterUrl', totalRevenue: 1, ticketCount: 1, bookingCount: 1 } },
      { $sort: { [sortBy]: -1 } },
      { $limit: limit },
    ]);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const newReleases = async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 14;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const movies = await Movie.find({ releaseDate: { $gte: since } }).lean();
    res.json({ success: true, data: movies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const schedulePerformance = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $group: { _id: scheduleExpr, totalRevenue: { $sum: revenueExpr }, ticketCount: { $sum: ticketCountExpr }, bookingCount: { $sum: 1 } } },
      { $lookup: { from: 'schedules', localField: '_id', foreignField: '_id', as: 'schedule' } },
      { $unwind: { path: '$schedule', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'movies', localField: 'schedule.movie', foreignField: '_id', as: 'movie' } },
      { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
      { $project: { showTime: '$schedule.showTime', hall: '$schedule.hall.hallName', movieTitle: { $ifNull: ['$movie.title', 'Тодорхойгүй'] }, totalRevenue: 1, ticketCount: 1, bookingCount: 1 } },
      { $sort: { totalRevenue: -1 } },
    ]);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const bookingChannels = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $group: { _id: { $ifNull: ['$bookingChannel', 'Апп/Веб'] }, totalRevenue: { $sum: revenueExpr }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const totalBookings = data.reduce((sum, row) => sum + row.count, 0);
    res.json({ success: true, data: data.map((row) => ({ ...row, percentage: totalBookings ? ((row.count / totalBookings) * 100).toFixed(1) : 0 })), totalBookings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const advanceBooking = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $lookup: { from: 'schedules', localField: 'schedule', foreignField: '_id', as: 'schedule' } },
      { $unwind: { path: '$schedule', preserveNullAndEmptyArrays: true } },
      { $addFields: { daysInAdvance: { $floor: { $divide: [{ $subtract: ['$schedule.showTime', '$createdAt'] }, 86400000] } } } },
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $lte: ['$daysInAdvance', 0] }, then: 'Өдрийн захиалга' },
                { case: { $lte: ['$daysInAdvance', 3] }, then: '1-3 хоногийн өмнө' },
                { case: { $lte: ['$daysInAdvance', 7] }, then: '4-7 хоногийн өмнө' },
              ],
              default: '7+ хоногийн өмнө',
            },
          },
          count: { $sum: 1 },
          totalRevenue: { $sum: revenueExpr },
        },
      },
      { $sort: { count: -1 } },
    ]);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const seatTypes = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $unwind: { path: '$tickets', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ['$tickets.type', 'adult'] }, count: { $sum: 1 }, totalRevenue: { $sum: { $ifNull: ['$tickets.price', 0] } } } },
      { $sort: { count: -1 } },
    ]);
    const totalSeats = data.reduce((sum, row) => sum + row.count, 0);
    res.json({ success: true, data: data.map((row) => ({ ...row, percentage: totalSeats ? ((row.count / totalSeats) * 100).toFixed(1) : 0 })), totalSeats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const discounts = async (req, res) => {
  res.json({ success: true, data: [], totalDiscountGiven: 0 });
};

export const hallOccupancy = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $group: { _id: scheduleExpr, soldSeats: { $sum: ticketCountExpr }, totalRevenue: { $sum: revenueExpr }, bookingCount: { $sum: 1 } } },
      { $lookup: { from: 'schedules', localField: '_id', foreignField: '_id', as: 'schedule' } },
      { $unwind: { path: '$schedule', preserveNullAndEmptyArrays: true } },
      { $addFields: { capacity: { $ifNull: ['$schedule.hall.totalSeats', 100] }, hallName: { $ifNull: ['$schedule.hall.hallName', 'Танхим'] } } },
      { $group: { _id: '$hallName', totalSoldSeats: { $sum: '$soldSeats' }, totalCapacity: { $sum: '$capacity' }, totalRevenue: { $sum: '$totalRevenue' }, sessionCount: { $sum: 1 } } },
      { $addFields: { avgOccupancy: { $cond: [{ $gt: ['$totalCapacity', 0] }, { $multiply: [{ $divide: ['$totalSoldSeats', '$totalCapacity'] }, 100] }, 0] } } },
      { $sort: { avgOccupancy: -1 } },
    ]);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const peakHours = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $group: { _id: { hour: { $hour: '$createdAt' }, weekday: { $dayOfWeek: '$createdAt' } }, bookingCount: { $sum: 1 }, totalRevenue: { $sum: revenueExpr } } },
      { $sort: { bookingCount: -1 } },
    ]);
    const days = ['', 'Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];
    res.json({ success: true, data: data.map((row) => ({ hour: `${String(row._id.hour).padStart(2, '0')}:00`, weekday: days[row._id.weekday] || '', bookingCount: row.bookingCount, totalRevenue: row.totalRevenue })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const lostRevenue = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const schedules = await Schedule.find({ showTime: { $gte: start, $lte: end } }).populate('movie', 'title').lean();
    const scheduleIds = schedules.map((schedule) => schedule._id);
    const soldStats = await Booking.aggregate([
      { $match: { $and: [paidMatch, { $or: [{ schedule: { $in: scheduleIds } }, { scheduleId: { $in: scheduleIds } }] }] } },
      { $group: { _id: scheduleExpr, soldSeats: { $sum: ticketCountExpr }, revenue: { $sum: revenueExpr } } },
    ]);
    const soldMap = Object.fromEntries(soldStats.map((row) => [String(row._id), row]));
    const data = schedules.map((schedule) => {
      const sold = soldMap[String(schedule._id)]?.soldSeats || 0;
      const capacity = schedule.hall?.totalSeats || 100;
      const emptySeats = Math.max(0, capacity - sold);
      const estimatedLost = emptySeats * (schedule.basePrice || 0);
      return { scheduleId: schedule._id, movieTitle: schedule.movie?.title || '', showTime: schedule.showTime, hall: schedule.hall?.hallName || '', capacity, soldSeats: sold, emptySeats, estimatedLost };
    }).sort((a, b) => b.estimatedLost - a.estimatedLost);
    res.json({ success: true, data, totalLostRevenue: data.reduce((sum, row) => sum + row.estimatedLost, 0) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const userActivity = async (req, res) => {
  try {
    const [newUsers, returningStats] = await Promise.all([
      User.countDocuments(dateMatch(req.query)),
      Booking.aggregate([
        { $match: { ...paidMatch, ...dateMatch(req.query) } },
        { $group: { _id: '$userId', bookingCount: { $sum: 1 } } },
        { $group: { _id: null, totalActiveUsers: { $sum: 1 }, returningUsers: { $sum: { $cond: [{ $gt: ['$bookingCount', 1] }, 1, 0] } }, firstTimeUsers: { $sum: { $cond: [{ $eq: ['$bookingCount', 1] }, 1, 0] } }, avgBookingsPerUser: { $avg: '$bookingCount' } } },
      ]),
    ]);
    res.json({ success: true, newUsers, ...(returningStats[0] || { totalActiveUsers: 0, returningUsers: 0, firstTimeUsers: 0, avgBookingsPerUser: 0 }) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const loyaltyReport = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const data = await Booking.aggregate([
      { $match: paidMatch },
      { $group: { _id: '$userId', totalSpent: { $sum: revenueExpr }, bookingCount: { $sum: 1 }, ticketCount: { $sum: ticketCountExpr }, lastBooking: { $max: '$createdAt' } } },
      { $sort: { totalSpent: -1 } },
      { $limit: limit },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $project: { userName: { $ifNull: ['$user.name', 'Зочин'] }, email: '$user.email', loyaltyPoints: '$user.loyaltyPoints', totalSpent: 1, bookingCount: 1, ticketCount: 1, lastBooking: 1 } },
    ]);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const demographics = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    res.json({ success: true, totalUsers, ageGroups: [], genderDistribution: [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const cancellations = async (req, res) => {
  try {
    const byReason = await Booking.aggregate([
      { $match: { status: 'cancelled', ...dateMatch(req.query, 'updatedAt') } },
      { $group: { _id: { $ifNull: ['$cancellationReason', 'Тодорхойгүй'] }, count: { $sum: 1 }, refundedAmount: { $sum: revenueExpr } } },
      { $sort: { count: -1 } },
    ]);
    const byMovie = await Booking.aggregate([
      { $match: { status: 'cancelled', ...dateMatch(req.query, 'updatedAt') } },
      { $group: { _id: '$movie', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
      { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
      { $project: { movieTitle: { $ifNull: ['$movie.title', 'Тодорхойгүй'] }, count: 1 } },
    ]);
    res.json({ success: true, byReason, byMovie });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const dashboard = async (req, res) => {
  try {
    const match = { ...paidMatch, ...dateMatch(req.query) };
    const [summaryData, topMovies, channels, newUsers] = await Promise.all([
      Booking.aggregate([{ $match: match }, { $group: { _id: null, totalRevenue: { $sum: revenueExpr }, ticketCount: { $sum: ticketCountExpr }, bookingCount: { $sum: 1 } } }]),
      Booking.aggregate([
        { $match: match },
        { $group: { _id: movieExpr, totalRevenue: { $sum: revenueExpr }, ticketCount: { $sum: ticketCountExpr } } },
        { $sort: { totalRevenue: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
        { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
        { $project: { movieTitle: { $ifNull: ['$movie.title', '?'] }, totalRevenue: 1, ticketCount: 1 } },
      ]),
      Booking.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ['$bookingChannel', 'Апп/Веб'] }, count: { $sum: 1 } } }]),
      User.countDocuments(dateMatch(req.query)),
    ]);
    res.json({ success: true, summary: summaryData[0] || { totalRevenue: 0, ticketCount: 0, bookingCount: 0 }, topMovies, channels, newUsers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
