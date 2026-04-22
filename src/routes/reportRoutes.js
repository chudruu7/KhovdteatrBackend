// backend/src/routes/reportRoutes.js

import express from 'express';
import * as ctrl from '../controllers/reportController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Бүх тайлан зөвхөн admin хандана
router.use(protect, admin);

// Dashboard
router.get('/dashboard', ctrl.dashboard);

// ── Санхүүгийн тайлан ─────────────────────────────────────
router.get('/financial/daily',            ctrl.dailySales);
router.get('/financial/monthly',          ctrl.monthlySales);
router.get('/financial/payment-methods',  ctrl.paymentMethods);
router.get('/financial/refunds',          ctrl.refunds);

// ── Кино ба үзэлт ─────────────────────────────────────────
router.get('/movies/viewership',          ctrl.movieViewership);
router.get('/movies/top',                 ctrl.topMovies);
router.get('/movies/new-releases',        ctrl.newReleases);
router.get('/movies/schedule-performance',ctrl.schedulePerformance);

// ── Тасалбар захиалга ─────────────────────────────────────
router.get('/tickets/channels',           ctrl.bookingChannels);
router.get('/tickets/advance',            ctrl.advanceBooking);
router.get('/tickets/seat-types',         ctrl.seatTypes);
router.get('/tickets/discounts',          ctrl.discounts);

// ── Танхим ба дүүргэлт ───────────────────────────────────
router.get('/halls/occupancy',            ctrl.hallOccupancy);
router.get('/halls/peak-hours',           ctrl.peakHours);
router.get('/halls/lost-revenue',         ctrl.lostRevenue);

// ── Үзэгч ба идэвх ───────────────────────────────────────
router.get('/audience/activity',          ctrl.userActivity);
router.get('/audience/loyalty',           ctrl.loyaltyReport);
router.get('/audience/demographics',      ctrl.demographics);
router.get('/audience/cancellations',     ctrl.cancellations);

export default router;