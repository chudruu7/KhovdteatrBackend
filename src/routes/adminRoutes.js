// src/routes/adminRoutes.js

import express from 'express';
import { 
    getDashboardStats,
    getRecentShowtimes,
    getRecentBookings,
    getFeaturedMovies,
    getUpcomingMovies,
    getAlerts,
    getSparklines,
} from '../controllers/adminController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Бүх admin route-ууд хамгаалагдсан байх ёстой
router.use(protect);
router.use(admin);

// Dashboard статистик
router.get('/dashboard', getDashboardStats);

// Сүүлийн үзвэрүүд
router.get('/recent-showtimes', getRecentShowtimes);

// Сүүлийн захиалгууд
router.get('/recent-bookings', getRecentBookings);

// Онцлох кинонууд
router.get('/featured-movies', getFeaturedMovies);
router.get('/sparklines', getSparklines);
// Удахгүй гарах кинонууд
router.get('/upcoming-movies', getUpcomingMovies);

// Мэдэгдлүүд
router.get('/alerts', getAlerts);

export default router;