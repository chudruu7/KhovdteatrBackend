// src/controllers/scheduleController.js

import Schedule from '../models/Schedule.js';
import Movie    from '../models/Movie.js';

// Mongolia = UTC+8, DST байхгүй
const MONGOLIA_MS = 8 * 60 * 60 * 1000;

/**
 * "YYYY-MM-DD" → тухайн өдрийн UTC range
 * Mongolia-д 10:00 local = 02:00 UTC тул UTC day range хангалттай
 */
const mongoliaDateToUTCRange = (dateStr) => {
  // Аргумент нь "2026-03-17" format
  const [y, m, d] = dateStr.split('-').map(Number);
  // Mongolia өдрийн эхлэл: local 00:00 = UTC-8h = өмнөх өдрийн 16:00 UTC
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - MONGOLIA_MS);
  // Mongolia өдрийн төгсгөл: local 23:59:59 = UTC-8h
  const end   = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - MONGOLIA_MS);
  return { start, end };
};

// @desc    Өдрөөр цагийн хуваарийг буцаах
// @route   GET /api/schedules?date=YYYY-MM-DD
export const getSchedulesByDate = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Огноо оруулна уу.' });
    }

    const { start, end } = mongoliaDateToUTCRange(date);

    console.log(`[Schedule] date=${date} UTC range: ${start.toISOString()} ~ ${end.toISOString()}`);

    const schedules = await Schedule.find({
      showTime: { $gte: start, $lte: end },
    })
      .sort({ showTime: 1 })
      .populate('movie', 'title posterUrl duration genre rating status price');

    console.log(`[Schedule] found: ${schedules.length}`);

    res.json(schedules);
  } catch (error) {
    console.error('SCHEDULE FETCH ERROR:', error.message);
    res.status(500).json({ message: 'Цагийн хуваарь ачаалахад алдаа гарлаа.', error: error.message });
  }
};

// @desc    Нэг киноны цагийн хуваарийг буцаах
// @route   GET /api/schedules/:movieId?date=YYYY-MM-DD
export const getScheduleByMovie = async (req, res) => {
  try {
    const { movieId } = req.params;
    const dateStr = req.query.date || new Date().toISOString().split('T')[0];

    const { start, end } = mongoliaDateToUTCRange(dateStr);

    const schedules = await Schedule.find({
      movie:    movieId,
      showTime: { $gte: start, $lte: end },
    })
      .sort({ showTime: 1 })
      .populate('movie', 'title posterUrl');

    res.json(schedules);
  } catch (error) {
    console.error('SCHEDULE FETCH BY MOVIE ERROR:', error.message);
    res.status(500).json({ message: 'Цагийн хуваарь ачаалахад алдаа гарлаа.', error: error.message });
  }
};

// @desc    Тухайн цагийн хуваарийн зарагдсан суудлуудыг авах
// @route   GET /api/schedules/seats/:scheduleId
export const getOccupiedSeats = async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const schedule = await Schedule.findById(scheduleId).populate('movie', 'title');

    if (!schedule) {
      return res.status(404).json({ message: 'Цагийн хуваарь олдсонгүй.' });
    }

    res.json({
      scheduleId:  schedule._id,
      movieTitle:  schedule.movie?.title,
      showTime:    schedule.showTime,
      hall:        schedule.hall,
      soldSeats:   schedule.soldSeats,
      basePrice:   schedule.basePrice,
    });
  } catch (error) {
    console.error('OCCUPIED SEATS FETCH ERROR:', error.message);
    res.status(500).json({ message: 'Суудлын мэдээлэл авахад алдаа гарлаа.', error: error.message });
  }
};

// @desc    Шинэ цагийн хуваарь үүсгэх
// @route   POST /api/schedules
export const createSchedule = async (req, res) => {
  try {
    console.log('BODY:', JSON.stringify(req.body, null, 2));
    const { movieId, showTime, hall, basePrice } = req.body;

    const movie = await Movie.findById(movieId);
    if (!movie) {
      return res.status(404).json({ message: 'Кино олдсонгүй.' });
    }

    const hallData = {
      hallName:    hall?.hallName    || hall?.name || 'Танхим А',
      rows:        Number(hall?.rows)        || 8,
      seatsPerRow: Number(hall?.seatsPerRow) || 10,
      totalSeats:  Number(hall?.totalSeats)  || 80,
    };

    const schedule = await Schedule.create({
      movie:     movieId,
      showTime:  new Date(showTime),
      hall:      hallData,
      basePrice: Number(basePrice) || 15000,
      soldSeats: [],
    });

    res.status(201).json(schedule);
  } catch (error) {
    console.error('SCHEDULE CREATE ERROR:', error.message);
    res.status(500).json({ message: 'Цагийн хуваарь үүсгэхэд алдаа гарлаа.', error: error.message });
  }
};

// @desc    Цагийн хуваарийг шинэчлэх
// @route   PUT /api/schedules/:id
export const updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { showTime, hall, basePrice } = req.body;

    const schedule = await Schedule.findById(id);
    if (!schedule) {
      return res.status(404).json({ message: 'Цагийн хуваарь олдсонгүй.' });
    }

    if (showTime)   schedule.showTime  = new Date(showTime);
    if (basePrice)  schedule.basePrice = Number(basePrice);
    if (hall) {
      schedule.hall = {
        hallName:    hall?.hallName    || hall?.name || schedule.hall.hallName,
        rows:        Number(hall?.rows)        || schedule.hall.rows,
        seatsPerRow: Number(hall?.seatsPerRow) || schedule.hall.seatsPerRow,
        totalSeats:  Number(hall?.totalSeats)  || schedule.hall.totalSeats,
      };
    }

    await schedule.save();
    res.json(schedule);
  } catch (error) {
    console.error('SCHEDULE UPDATE ERROR:', error.message);
    res.status(500).json({ message: 'Цагийн хуваарь шинэчлэхэд алдаа гарлаа.', error: error.message });
  }
};

// @desc    Цагийн хуваарийг устгах
// @route   DELETE /api/schedules/:id
export const deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;

    const schedule = await Schedule.findById(id);
    if (!schedule) {
      return res.status(404).json({ message: 'Цагийн хуваарь олдсонгүй.' });
    }

    await schedule.deleteOne();
    res.json({ message: 'Цагийн хуваарь амжилттай устгагдлаа.' });
  } catch (error) {
    console.error('SCHEDULE DELETE ERROR:', error.message);
    res.status(500).json({ message: 'Цагийн хуваарь устгахад алдаа гарлаа.', error: error.message });
  }
};