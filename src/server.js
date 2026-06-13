// src/server.js
import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import path from 'path';

import cors from 'cors';
import connectDB from './config/db.js';
import wireRoutes from './routes/wireRoutes.js';
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
import cashierRoutes from './routes/cashierRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
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
const defaultAllowedOrigins = [
  'https://khovdteatr-web-pied.vercel.app',
  'http://localhost:3000',
  'http://localhost:8081',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:5173',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
];

const configuredAllowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  ...defaultAllowedOrigins,
  ...configuredAllowedOrigins,
]);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname)) {
      return true;
    }

    return protocol === 'https:' && hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
};

app.use(cors({
  origin: function (origin, callback) {
    // origin байхгүй үед (Postman, curl) нэвтрүүл
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS-оор зөвшөөрөгдөөгүй'));
    }
  },
  credentials: true,  // ← энэ заавал байх ёстой!
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use('/api/wire/webhook', express.raw({ type: 'application/json' }));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

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
app.use('/api/cashier', cashierRoutes);
app.use('/api/news', newsRoutes); // ЭНЭ МӨРИЙГ НЭМЭХ
app.use('/api/cinema-info', cinemaInfoRoutes); // ЭНЭ МӨРИЙГ НЭМЭХ
app.use('/api/cleanup', cleanupRoutes);
app.use('/api/wire', wireRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/uploads', uploadRoutes);
// Тестийн Home Route
app.get('/', (req, res) => {
  res.send('Cinema API ажиллаж байна...');
});

// Тестийн route - admin route ажиллаж байгаа эсэхийг шалгах
app.get('/api/test', (req, res) => {
  res.json({ message: 'API ажиллаж байна' });
});

// 404 handler - Бүртгэгдээгүй route-уудын хувьд
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Зургийн хэмжээ 10MB-аас бага байх ёстой.' });
  }
  return next(err);
});

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
