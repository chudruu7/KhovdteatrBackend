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
    getUsers,
    deleteUser,
    updateUserRole,
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

// Онцлох үзвэрүүд
router.get('/featured-movies', getFeaturedMovies);
router.get('/sparklines', getSparklines);
// Удахгүй гарах үзвэрүүд
router.get('/upcoming-movies', getUpcomingMovies);

// Мэдэгдлүүд
router.get('/alerts', getAlerts);

router.get('/users', getUsers);
router.patch('/users/:id/role', updateUserRole);
router.delete('/users/:id', deleteUser);

export default router;
