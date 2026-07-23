import Booking from '../models/Booking.js';
import Movie from '../models/Movie.js';
import Schedule from '../models/Schedule.js';
import User from '../models/User.js';

const paidMatch = {
  status: { $in: ['active', 'used', 'confirmed'] },
  'payment.status': 'paid',
};

const bookingMatch = {
  status: { $in: ['active', 'used', 'confirmed', 'cancelled'] },
};

const paidRevenueExpr = {
  $cond: [
    {
      $and: [
        { $in: ['$status', ['active', 'used', 'confirmed']] },
        { $eq: ['$payment.status', 'paid'] },
      ],
    },
    { $ifNull: ['$totalPrice', '$totalAmount'] },
    0,
  ],
};

const unpaidRevenueExpr = {
  $cond: [
    {
      $and: [
        { $in: ['$status', ['active', 'used', 'confirmed']] },
        { $in: [{ $ifNull: ['$payment.status', 'pending'] }, ['pending', 'failed']] },
      ],
    },
    { $ifNull: ['$totalPrice', '$totalAmount'] },
    0,
  ],
};

const refundedRevenueExpr = {
  $cond: [
    { $eq: ['$status', 'cancelled'] },
    { $ifNull: ['$totalPrice', '$totalAmount'] },
    0,
  ],
};

const paidTicketCountExpr = {
  $cond: [
    {
      $and: [
        { $in: ['$status', ['active', 'used', 'confirmed']] },
        { $eq: ['$payment.status', 'paid'] },
      ],
    },
    { $size: { $ifNull: ['$seats', []] } },
    0,
  ],
};

const REPORT_TIMEZONE = '+08:00';

function parseReportDate(value, endOfDay = false) {
  if (!value) return null;
  const clock = endOfDay ? '23:59:59.999' : '00:00:00.000';
  const parsed = new Date(`${value}T${clock}${REPORT_TIMEZONE}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateRange(query) {
  const now = new Date();
  const start = parseReportDate(query.startDate) || new Date(0);
  const end = parseReportDate(query.endDate, true) || now;
  return { start, end };
}

const dateMatch = (query, field = 'createdAt') => {
  if (!query.startDate && !query.endDate) return {};
  const { start, end } = getDateRange(query);
  return { [field]: { $gte: start, $lte: end } };
};

const ticketCountExpr = { $size: { $ifNull: ['$seats', []] } };
const revenueExpr = { $ifNull: ['$totalPrice', '$totalAmount'] };
const movieExpr = { $ifNull: ['$movie', '$movieId'] };
const scheduleExpr = { $ifNull: ['$schedule', '$scheduleId'] };
const paymentMethodExpr = { $ifNull: ['$payment.method', { $ifNull: ['$paymentMethod', 'other'] }] };
const bookingChannelExpr = {
  $cond: [
    { $ne: [{ $ifNull: ['$payment.receivedBy', null] }, null] },
    'cashier',
    { $ifNull: ['$bookingChannel', 'web_app'] },
  ],
};

export const dailySales = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...bookingMatch, ...dateMatch(req.query) } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: REPORT_TIMEZONE } },
          totalRevenue: { $sum: paidRevenueExpr },
          bookedAmount: { $sum: revenueExpr },
          paidRevenue: { $sum: paidRevenueExpr },
          unpaidRevenue: { $sum: unpaidRevenueExpr },
          refundedRevenue: { $sum: refundedRevenueExpr },
          ticketCount: { $sum: paidTicketCountExpr },
          bookingCount: { $sum: 1 },
          paidBookingCount: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['active', 'used', 'confirmed']] }, { $eq: ['$payment.status', 'paid'] }] }, 1, 0] } },
          cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
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
      bookedAmount: acc.bookedAmount + (row.bookedAmount || 0),
      paidRevenue: acc.paidRevenue + (row.paidRevenue || 0),
      unpaidRevenue: acc.unpaidRevenue + (row.unpaidRevenue || 0),
      refundedRevenue: acc.refundedRevenue + (row.refundedRevenue || 0),
      ticketCount: acc.ticketCount + (row.ticketCount || 0),
      bookingCount: acc.bookingCount + (row.bookingCount || 0),
      paidBookingCount: acc.paidBookingCount + (row.paidBookingCount || 0),
      cancelledCount: acc.cancelledCount + (row.cancelledCount || 0),
    }), { totalRevenue: 0, bookedAmount: 0, paidRevenue: 0, unpaidRevenue: 0, refundedRevenue: 0, ticketCount: 0, bookingCount: 0, paidBookingCount: 0, cancelledCount: 0 });

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
          ...bookingMatch,
          createdAt: { $gte: parseReportDate(`${year}-01-01`), $lte: parseReportDate(`${year}-12-31`, true) },
        },
      },
      {
        $group: {
          _id: { $month: { date: '$createdAt', timezone: REPORT_TIMEZONE } },
          totalRevenue: { $sum: paidRevenueExpr },
          paidRevenue: { $sum: paidRevenueExpr },
          ticketCount: { $sum: paidTicketCountExpr },
          bookingCount: { $sum: 1 },
          cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const rows = data.map((row) => ({
      ...row,
      month: `${row._id}-р сар`,
      monthNum: row._id,
    }));

    res.json({ success: true, year, data: rows });
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
      { $group: { _id: { $ifNull: ['$cancellation.reason', 'Тодорхойгүй'] }, refundedAmount: { $sum: revenueExpr }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const totalRefunded = data.reduce((sum, row) => sum + (row.refundedAmount || 0), 0);
    res.json({ success: true, data, totalRefunded, totalCancelledAmount: totalRefunded });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const movieViewership = async (req, res) => {
  try {
    const data = await Booking.aggregate([
      { $match: { ...paidMatch, ...dateMatch(req.query) } },
      { $group: { 
          _id: movieExpr, 
          totalRevenue: { $sum: revenueExpr }, 
          ticketCount: { $sum: ticketCountExpr }, 
          bookingCount: { $sum: 1 },
          payments: { $push: { method: paymentMethodExpr, amount: revenueExpr } },
          tickets: { $push: { seats: { $ifNull: ['$seats', []] }, tickets: { $ifNull: ['$tickets', []] }, ticketCount: { $ifNull: ['$ticketCount', 0] } } }
        } 
      },
      { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
      { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
      { $project: { movieTitle: { $ifNull: ['$movie.title', 'Тодорхойгүй'] }, genre: '$movie.genre', poster: '$movie.posterUrl', totalRevenue: 1, ticketCount: 1, bookingCount: 1, payments: 1, tickets: 1 } },
      { $sort: { totalRevenue: -1 } },
    ]);
    
    // Process payments and tickets in JS
    const processedData = data.map(movie => {
      const paymentBreakdown = movie.payments.reduce((acc, p) => {
        const m = p.method || 'other';
        acc[m] = (acc[m] || 0) + p.amount;
        return acc;
      }, {});
      
      let adultSeats = 0;
      let childSeats = 0;
      movie.tickets.forEach(t => {
        if (t.tickets && t.tickets.length > 0) {
          t.tickets.forEach(tk => {
            if (tk.type === 'child') childSeats++;
            else adultSeats++;
          });
        } else if (t.seats && t.seats.length > 0) {
          adultSeats += t.seats.length;
        } else if (t.ticketCount > 0) {
          adultSeats += t.ticketCount;
        }
      });
      
      return {
        ...movie,
        paymentBreakdown,
        adultSeats,
        childSeats,
        payments: undefined,
        tickets: undefined
      };
    });

    res.json({ success: true, data: processedData });
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
      { $match: { ...bookingMatch, ...dateMatch(req.query) } },
      { $group: {
        _id: bookingChannelExpr,
        totalRevenue: { $sum: paidRevenueExpr },
        count: { $sum: 1 },
        paidCount: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['active', 'used', 'confirmed']] }, { $eq: ['$payment.status', 'paid'] }] }, 1, 0] } },
      } },
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
      { $match: { ...bookingMatch, ...dateMatch(req.query) } },
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
          totalRevenue: { $sum: paidRevenueExpr },
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
      {
        $project: {
          ticketRows: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$tickets', []] } }, 0] },
              '$tickets',
              { $map: { input: { $ifNull: ['$seats', []] }, as: 'seat', in: { type: 'adult', price: 0 } } },
            ],
          },
        },
      },
      { $unwind: '$ticketRows' },
      { $group: { _id: { $ifNull: ['$ticketRows.type', 'adult'] }, count: { $sum: 1 }, totalRevenue: { $sum: { $ifNull: ['$ticketRows.price', 0] } } } },
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
      { $match: paidMatch },
      { $lookup: { from: 'schedules', localField: 'schedule', foreignField: '_id', as: 'schedule' } },
      { $unwind: { path: '$schedule', preserveNullAndEmptyArrays: false } },
      { $match: dateMatch(req.query, 'schedule.showTime') },
      { $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$schedule.showTime', timezone: REPORT_TIMEZONE } },
            hour: { $dateToString: { format: '%H:00', date: '$schedule.showTime', timezone: REPORT_TIMEZONE } },
          },
          bookingCount: { $sum: 1 },
          totalRevenue: { $sum: revenueExpr },
        }
      },
      { $sort: { bookingCount: -1 } },
    ]);
    
    // Group back to a nice format
    res.json({ success: true, data: data.map((row) => ({ 
      date: row._id.date, 
      hour: row._id.hour,
      bookingCount: row.bookingCount, 
      totalRevenue: row.totalRevenue 
    })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const lostRevenue = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const actualEnd = new Date(Math.min(end.getTime(), Date.now())); // Don't calculate future losses
    const schedules = await Schedule.find({ showTime: { $gte: start, $lte: actualEnd } }).populate('movie', 'title').lean();
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
        { $match: { userId: { $ne: null } } },
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
      { $match: { ...paidMatch, ...dateMatch(req.query), userId: { $ne: null } } },
      { $group: { _id: '$userId', totalSpent: { $sum: revenueExpr }, bookingCount: { $sum: 1 }, ticketCount: { $sum: ticketCountExpr }, lastBooking: { $max: '$createdAt' } } },
      { $sort: { totalSpent: -1 } },
      { $limit: limit },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $project: { userName: { $ifNull: ['$user.name', 'Зочин'] }, email: '$user.email', loyaltyPoints: { $ifNull: ['$user.points', 0] }, totalSpent: 1, bookingCount: 1, ticketCount: 1, lastBooking: 1 } },
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
      { $group: { _id: { $ifNull: ['$cancellation.reason', 'Тодорхойгүй'] }, count: { $sum: 1 }, refundedAmount: { $sum: revenueExpr } } },
      { $sort: { count: -1 } },
    ]);
    const byMovie = await Booking.aggregate([
      { $match: { status: 'cancelled', ...dateMatch(req.query, 'updatedAt') } },
      { $group: { _id: movieExpr, count: { $sum: 1 } } },
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
    const match = { ...bookingMatch, ...dateMatch(req.query) };
    const [summaryData, topMovies, channels, newUsers] = await Promise.all([
      Booking.aggregate([{ $match: match }, { $group: {
        _id: null,
        totalRevenue: { $sum: paidRevenueExpr },
        bookedAmount: { $sum: revenueExpr },
        paidRevenue: { $sum: paidRevenueExpr },
        unpaidRevenue: { $sum: unpaidRevenueExpr },
        refundedRevenue: { $sum: refundedRevenueExpr },
        ticketCount: { $sum: paidTicketCountExpr },
        bookingCount: { $sum: 1 },
        paidBookingCount: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['active', 'used', 'confirmed']] }, { $eq: ['$payment.status', 'paid'] }] }, 1, 0] } },
        cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        activeCount: { $sum: { $cond: [{ $in: ['$status', ['active', 'used', 'confirmed']] }, 1, 0] } },
      } }]),
      Booking.aggregate([
        { $match: { ...paidMatch, ...dateMatch(req.query) } },
        { $group: { _id: movieExpr, totalRevenue: { $sum: revenueExpr }, ticketCount: { $sum: ticketCountExpr } } },
        { $sort: { totalRevenue: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
        { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
        { $project: { movieTitle: { $ifNull: ['$movie.title', '?'] }, totalRevenue: 1, ticketCount: 1 } },
      ]),
      Booking.aggregate([{ $match: match }, { $group: { _id: bookingChannelExpr, count: { $sum: 1 } } }]),
      User.countDocuments(dateMatch(req.query)),
    ]);
    res.json({ success: true, summary: summaryData[0] || { totalRevenue: 0, bookedAmount: 0, paidRevenue: 0, unpaidRevenue: 0, refundedRevenue: 0, ticketCount: 0, bookingCount: 0, paidBookingCount: 0, cancelledCount: 0, activeCount: 0 }, topMovies, channels, newUsers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const transactionLogs = async (req, res) => {
  try {
    const data = await Booking.find(dateMatch(req.query))
      .populate('movie', 'title')
      .sort({ createdAt: -1 })
      .lean();
      
    const formattedData = data.map(b => ({
      date: b.createdAt,
      orderId: b._id,
      movieTitle: b.movie?.title || 'Тодорхойгүй',
      paymentMethod: b.payment?.method || 'Тодорхойгүй',
      paymentStatus: b.payment?.status || 'pending',
      status: b.status,
      amount: b.totalPrice || 0
    }));

    res.json({ success: true, data: formattedData });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
