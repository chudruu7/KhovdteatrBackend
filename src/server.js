// src/server.js
import dotenv from 'dotenv';
dotenv.config();
import express from 'express';

import cors from 'cors';
import connectDB from './config/db.js';
import qpayRoutes from './routes/qpayRoutes.js';
// Route-уудыг импортлох
import movieRoutes from './routes/movieRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js'; // ЭНЭ МӨРИЙГ НЭМЭХ
import newsRoutes from './routes/newsRoutes.js'; // ЭНЭ МӨРИЙГ НЭМЭХ
import cinemaInfoRoutes from './routes/cinemaInfoRoutes.js'; // ЭНЭ МӨРИЙГ НЭМЭХ
import cleanupRoutes from './routes/cleanupRoutes.js';
import { cancelExpiredBookings } from './controllers/bookingController.js';
import { autoCleanupExpiredTickets, requestCleanupApproval } from './utils/cleanupService.js';
import cron from 'node-cron';
// Environment variable-уудыг ачаалах

// Өдөр бүр шөнө 00:05-д
cron.schedule('5 0 * * *', async () => {
  await autoCleanupExpiredTickets(); // expired тасалбар устгана
  await requestCleanupApproval();   // хуучин өгөгдлийн хүсэлт
});
// Мэдээллийн сантай холбогдох
connectDB();

const app = express();
// ✅ ДАРАА — зөв
const allowedOrigins = [
  'https://khovdteatr-web-pied.vercel.app',
  'http://localhost:3000', // локал dev-д ажиллуулахын тулд
];

app.use(cors({
  origin: function (origin, callback) {
    // origin байхгүй үед (Postman, curl) нэвтрүүл
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS-оор зөвшөөрөгдөөгүй'));
    }
  },
  credentials: true,  // ← энэ заавал байх ёстой!
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger (хөгжүүлэлтэд)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});


// API Routes - БҮХ ROUTE-УУДЫГ БҮРТГЭХ
app.use('/api/movies', movieRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes); // ЭНЭ МӨРИЙГ НЭМЭХ
app.use('/api/news', newsRoutes); // ЭНЭ МӨРИЙГ НЭМЭХ
app.use('/api/cinema-info', cinemaInfoRoutes); // ЭНЭ МӨРИЙГ НЭМЭХ
app.use('/api/cleanup', cleanupRoutes);
app.use('/api/qpay', qpayRoutes);
app.use('/api/reports', reportRoutes);
// Тестийн Home Route
app.get('/', (req, res) => {
  res.send('Cinema API ажиллаж байна...');
});

// Тестийн route - admin route ажиллаж байгаа эсэхийг шалгах
app.get('/api/test', (req, res) => {
  res.json({ message: 'API ажиллаж байна' });
});

// 404 handler - Бүртгэгдээгүй route-уудын хувьд
app.use((req, res) => {
  console.log(`404 - Хүсэлт олдсонгүй: ${req.method} ${req.url}`);
  res.status(404).json({ message: 'Хүсэлт олдсонгүй' });
});

// Алдааг барих Middleware
app.use((err, req, res, next) => {
  console.error('Серверийн алдаа:', err.stack);
  res.status(500).json({ message: 'Сервер дээр алдаа гарлаа!', error: err.message });
});
cancelExpiredBookings();
setInterval(cancelExpiredBookings, 5 * 60 * 1000);
const PORT = process.env.PORT || 5000; // Render өөрийн PORT-ыг энд дамжуулдаг
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  console.log('Бүртгэгдсэн route-ууд:');
  console.log('- /api/movies');
  console.log('- /api/auth');
  console.log('- /api/schedules');
  console.log('- /api/bookings');
  console.log('- /api/admin');
  console.log('- /api/news');
  console.log('- /api/tickets');
  console.log('- /api/cinema-info');
});
