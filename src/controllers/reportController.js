// ================================================================
// reportController.js
// Байршил: backend/src/controllers/reportController.js
// ================================================================

import Booking  from '../models/Booking.js';
import Movie    from '../models/Movie.js';
import Schedule from '../models/Schedule.js';
import User     from '../models/User.js';

// ─── Туслах: огноон хязгаар ────────────────────────────────
function getDateRange(query) {
  const now   = new Date();
  const start = query.startDate ? new Date(query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = query.endDate   ? new Date(query.endDate)   : now;
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ================================================================
// 1. САНХҮҮГИЙН ТАЙЛАН
// ================================================================
export const dailySales = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalRevenue:   { $sum: '$totalAmount' },
          ticketCount:    { $sum: { $size: { $ifNull: ['$seats', []] } } },
          bookingCount:   { $sum: 1 },
          avgTicketPrice: { $avg: '$totalAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const summary = data.reduce(
      (acc, d) => ({
        totalRevenue:  acc.totalRevenue  + d.totalRevenue,
        ticketCount:   acc.ticketCount   + d.ticketCount,
        bookingCount:  acc.bookingCount  + d.bookingCount,
      }),
      { totalRevenue: 0, ticketCount: 0, bookingCount: 0 }
    );

    res.json({ success: true, data, summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const monthlySales = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = await Booking.aggregate([
      {
        $match: {
          status: 'confirmed',
          createdAt: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) },
        },
      },
      {
        $group: {
          _id:          { $month: '$createdAt' },
          totalRevenue: { $sum: '$totalAmount' },
          ticketCount:  { $sum: { $size: { $ifNull: ['$seats', []] } } },
          bookingCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const months = ['1-р сар','2-р сар','3-р сар','4-р сар','5-р сар','6-р сар',
                    '7-р сар','8-р сар','9-р сар','10-р сар','11-р сар','12-р сар'];
    const formatted = months.map((name, i) => {
      const found = data.find(d => d._id === i + 1);
      return { month: name, monthNum: i + 1, ...(found || { totalRevenue: 0, ticketCount: 0, bookingCount: 0 }) };
    });

    res.json({ success: true, year, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const paymentMethods = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id:          '$paymentMethod',
          totalRevenue: { $sum: '$totalAmount' },
          count:        { $sum: 1 },
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    const total  = data.reduce((s, d) => s + d.totalRevenue, 0);
    const result = data.map(d => ({ ...d, percentage: total ? ((d.totalRevenue / total) * 100).toFixed(1) : 0 }));

    res.json({ success: true, data: result, totalRevenue: total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const refunds = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'cancelled', updatedAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id:            '$cancellationReason',
          refundedAmount: { $sum: '$totalAmount' },
          count:          { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalRefunded = data.reduce((s, d) => s + d.refundedAmount, 0);
    res.json({ success: true, data, totalRefunded });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ================================================================
// 2. КИНО БА ҮЗЭЛТИЙН ТАЙЛАН
// ================================================================
export const movieViewership = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id:          '$movieId',
          totalRevenue: { $sum: '$totalAmount' },
          ticketCount:  { $sum: { $size: { $ifNull: ['$seats', []] } } },
          bookingCount: { $sum: 1 },
        },
      },
      { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
      { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          movieTitle:   { $ifNull: ['$movie.title', 'Тодорхойгүй'] },
          genre:        '$movie.genre',
          poster:       '$movie.poster',
          totalRevenue: 1,
          ticketCount:  1,
          bookingCount: 1,
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const topMovies = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const limit  = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy === 'tickets' ? 'ticketCount' : 'totalRevenue';

    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id:          '$movieId',
          totalRevenue: { $sum: '$totalAmount' },
          ticketCount:  { $sum: { $size: { $ifNull: ['$seats', []] } } },
        },
      },
      { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
      { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          movieTitle:   { $ifNull: ['$movie.title', 'Тодорхойгүй'] },
          genre:        '$movie.genre',
          poster:       '$movie.poster',
          totalRevenue: 1,
          ticketCount:  1,
        },
      },
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
    const days  = parseInt(req.query.days) || 14;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const movies   = await Movie.find({ releaseDate: { $gte: since } }).lean();
    const movieIds = movies.map(m => m._id);

    const stats = await Booking.aggregate([
      { $match: { status: 'confirmed', movieId: { $in: movieIds } } },
      {
        $group: {
          _id:          '$movieId',
          totalRevenue: { $sum: '$totalAmount' },
          ticketCount:  { $sum: { $size: { $ifNull: ['$seats', []] } } },
        },
      },
    ]);

    const statsMap = Object.fromEntries(stats.map(s => [String(s._id), s]));
    const data = movies.map(m => ({
      ...m,
      totalRevenue: statsMap[String(m._id)]?.totalRevenue || 0,
      ticketCount:  statsMap[String(m._id)]?.ticketCount  || 0,
    }));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const schedulePerformance = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id:          '$scheduleId',
          totalRevenue: { $sum: '$totalAmount' },
          ticketCount:  { $sum: { $size: { $ifNull: ['$seats', []] } } },
        },
      },
      { $lookup: { from: 'schedules', localField: '_id', foreignField: '_id', as: 'schedule' } },
      { $unwind: { path: '$schedule', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'movies', localField: 'schedule.movieId', foreignField: '_id', as: 'movie' } },
      { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          showTime:     '$schedule.showTime',
          hall:         '$schedule.hall',
          movieTitle:   { $ifNull: ['$movie.title', 'Тодорхойгүй'] },
          totalRevenue: 1,
          ticketCount:  1,
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ================================================================
// 3. ТАСАЛБАР ЗАХИАЛГЫН ТАЙЛАН
// ================================================================
export const bookingChannels = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id:          { $ifNull: ['$bookingChannel', 'Бусад'] },
          totalRevenue: { $sum: '$totalAmount' },
          count:        { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const total  = data.reduce((s, d) => s + d.count, 0);
    const result = data.map(d => ({ ...d, percentage: total ? ((d.count / total) * 100).toFixed(1) : 0 }));

    res.json({ success: true, data: result, totalBookings: total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const advanceBooking = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      { $lookup: { from: 'schedules', localField: 'scheduleId', foreignField: '_id', as: 'schedule' } },
      { $unwind: { path: '$schedule', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          daysInAdvance: {
            $floor: {
              $divide: [
                { $subtract: ['$schedule.showTime', '$createdAt'] },
                1000 * 60 * 60 * 24,
              ],
            },
          },
        },
      },
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
          count:        { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
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
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      { $unwind: { path: '$seats', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id:          { $ifNull: ['$seats.type', 'Энгийн'] },
          count:        { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ['$seats.price', 0] } },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalSeats = data.reduce((s, d) => s + d.count, 0);
    const result     = data.map(d => ({ ...d, percentage: totalSeats ? ((d.count / totalSeats) * 100).toFixed(1) : 0 }));

    res.json({ success: true, data: result, totalSeats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const discounts = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      {
        $match: {
          status: 'confirmed',
          createdAt: { $gte: start, $lte: end },
          discountType: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id:           '$discountType',
          count:         { $sum: 1 },
          totalDiscount: { $sum: { $ifNull: ['$discountAmount', 0] } },
          totalRevenue:  { $sum: '$totalAmount' },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalDiscountGiven = data.reduce((s, d) => s + d.totalDiscount, 0);
    res.json({ success: true, data, totalDiscountGiven });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ================================================================
// 4. ТАНХИМ БА ДҮҮРГЭЛТИЙН ТАЙЛАН
// ================================================================
export const hallOccupancy = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id:          '$scheduleId',
          soldSeats:    { $sum: { $size: { $ifNull: ['$seats', []] } } },
          totalRevenue: { $sum: '$totalAmount' },
        },
      },
      { $lookup: { from: 'schedules', localField: '_id', foreignField: '_id', as: 'schedule' } },
      { $unwind: { path: '$schedule', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          capacity:      { $ifNull: ['$schedule.capacity', 100] },
          occupancyRate: {
            $multiply: [
              { $divide: ['$soldSeats', { $ifNull: ['$schedule.capacity', 100] }] },
              100,
            ],
          },
        },
      },
      {
        $group: {
          _id:            '$schedule.hall',
          avgOccupancy:   { $avg: '$occupancyRate' },
          totalSoldSeats: { $sum: '$soldSeats' },
          totalCapacity:  { $sum: '$capacity' },
          totalRevenue:   { $sum: '$totalRevenue' },
          sessionCount:   { $sum: 1 },
        },
      },
      { $sort: { avgOccupancy: -1 } },
    ]);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const peakHours = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            hour:    { $hour: '$createdAt' },
            weekday: { $dayOfWeek: '$createdAt' },
          },
          bookingCount: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
        },
      },
      { $sort: { bookingCount: -1 } },
    ]);

    const days   = ['', 'Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];
    const result = data.map(d => ({
      hour:         `${String(d._id.hour).padStart(2, '0')}:00`,
      weekday:      days[d._id.weekday] || '',
      bookingCount: d.bookingCount,
      totalRevenue: d.totalRevenue,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const lostRevenue = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const schedules  = await Schedule.find({ showTime: { $gte: start, $lte: end } }).lean();
    const scheduleIds = schedules.map(s => s._id);

    const soldStats = await Booking.aggregate([
      { $match: { status: 'confirmed', scheduleId: { $in: scheduleIds } } },
      {
        $group: {
          _id:       '$scheduleId',
          soldSeats: { $sum: { $size: { $ifNull: ['$seats', []] } } },
          avgPrice:  { $avg: '$totalAmount' },
        },
      },
    ]);

    const soldMap  = Object.fromEntries(soldStats.map(s => [String(s._id), s]));
    let totalLost  = 0;
    const data = schedules.map(s => {
      const sold       = soldMap[String(s._id)]?.soldSeats || 0;
      const capacity   = s.capacity || 100;
      const avgPrice   = soldMap[String(s._id)]?.avgPrice  || 0;
      const emptySeats = Math.max(0, capacity - sold);
      const lost       = emptySeats * (avgPrice / Math.max(sold, 1));
      totalLost       += lost;
      return { scheduleId: s._id, showTime: s.showTime, hall: s.hall, capacity, soldSeats: sold, emptySeats, estimatedLost: Math.round(lost) };
    });

    res.json({ success: true, data: data.sort((a, b) => b.estimatedLost - a.estimatedLost), totalLostRevenue: Math.round(totalLost) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ================================================================
// 5. ҮЗЭГЧ БА ИДЭВХИЙН ТАЙЛАН
// ================================================================
export const userActivity = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const [newUsers, returningStats] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: start, $lte: end } }),
      Booking.aggregate([
        { $match: { status: 'confirmed', createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$userId', bookingCount: { $sum: 1 } } },
        {
          $group: {
            _id:                 null,
            totalActiveUsers:    { $sum: 1 },
            returningUsers:      { $sum: { $cond: [{ $gt: ['$bookingCount', 1] }, 1, 0] } },
            firstTimeUsers:      { $sum: { $cond: [{ $eq: ['$bookingCount', 1] }, 1, 0] } },
            avgBookingsPerUser:  { $avg: '$bookingCount' },
          },
        },
      ]),
    ]);

    res.json({ success: true, newUsers, ...(returningStats[0] || { totalActiveUsers: 0, returningUsers: 0, firstTimeUsers: 0, avgBookingsPerUser: 0 }) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const loyaltyReport = async (req, res) => {
  try {
    const limit   = parseInt(req.query.limit) || 20;
    const topUsers = await Booking.aggregate([
      { $match: { status: 'confirmed' } },
      {
        $group: {
          _id:          '$userId',
          totalSpent:   { $sum: '$totalAmount' },
          bookingCount: { $sum: 1 },
          ticketCount:  { $sum: { $size: { $ifNull: ['$seats', []] } } },
          lastBooking:  { $max: '$createdAt' },
        },
      },
      { $sort: { totalSpent: -1 } },
      { $limit: limit },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          userName:      { $ifNull: ['$user.name', 'Тодорхойгүй'] },
          email:         '$user.email',
          loyaltyPoints: '$user.loyaltyPoints',
          totalSpent:    1,
          bookingCount:  1,
          ticketCount:   1,
          lastBooking:   1,
        },
      },
    ]);

    res.json({ success: true, data: topUsers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const demographics = async (req, res) => {
  try {
    const now   = new Date();
    const users = await User.find({}, { birthDate: 1, gender: 1 }).lean();

    const ageGroups = { '18-25': 0, '26-35': 0, '36-45': 0, '46-55': 0, '55+': 0, 'Тодорхойгүй': 0 };
    const genderMap = {};

    users.forEach(u => {
      if (u.gender) genderMap[u.gender] = (genderMap[u.gender] || 0) + 1;
      if (u.birthDate) {
        const age = Math.floor((now - new Date(u.birthDate)) / (365.25 * 24 * 3600 * 1000));
        if      (age < 26) ageGroups['18-25']++;
        else if (age < 36) ageGroups['26-35']++;
        else if (age < 46) ageGroups['36-45']++;
        else if (age < 56) ageGroups['46-55']++;
        else               ageGroups['55+']++;
      } else {
        ageGroups['Тодорхойгүй']++;
      }
    });

    res.json({
      success: true,
      totalUsers:          users.length,
      ageGroups:           Object.entries(ageGroups).map(([group, count]) => ({ group, count })),
      genderDistribution:  Object.entries(genderMap).map(([gender, count]) => ({ gender, count })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const cancellations = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const data = await Booking.aggregate([
      { $match: { status: 'cancelled', updatedAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id:            '$cancellationReason',
          count:          { $sum: 1 },
          refundedAmount: { $sum: '$totalAmount' },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const byMovie = await Booking.aggregate([
      { $match: { status: 'cancelled', updatedAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$movieId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
      { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
      { $project: { movieTitle: { $ifNull: ['$movie.title', 'Тодорхойгүй'] }, count: 1 } },
    ]);

    res.json({ success: true, byReason: data, byMovie });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ================================================================
// DASHBOARD
// ================================================================
export const dashboard = async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const match = { status: 'confirmed', createdAt: { $gte: start, $lte: end } };

    const [revenueData, topMoviesData, channelData, newUsersCount] = await Promise.all([
      Booking.aggregate([
        { $match: match },
        { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' }, ticketCount: { $sum: { $size: { $ifNull: ['$seats', []] } } }, bookingCount: { $sum: 1 } } },
      ]),
      Booking.aggregate([
        { $match: match },
        { $group: { _id: '$movieId', totalRevenue: { $sum: '$totalAmount' }, ticketCount: { $sum: { $size: { $ifNull: ['$seats', []] } } } } },
        { $sort: { totalRevenue: -1 } }, { $limit: 5 },
        { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
        { $unwind: { path: '$movie', preserveNullAndEmptyArrays: true } },
        { $project: { movieTitle: { $ifNull: ['$movie.title', '?'] }, totalRevenue: 1, ticketCount: 1 } },
      ]),
      Booking.aggregate([
        { $match: match },
        { $group: { _id: { $ifNull: ['$bookingChannel', 'Бусад'] }, count: { $sum: 1 } } },
      ]),
      User.countDocuments({ createdAt: { $gte: start, $lte: end } }),
    ]);

    res.json({
      success:   true,
      summary:   revenueData[0] || { totalRevenue: 0, ticketCount: 0, bookingCount: 0 },
      topMovies: topMoviesData,
      channels:  channelData,
      newUsers:  newUsersCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};