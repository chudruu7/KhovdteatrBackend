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
import adminRoutes from './routes/adminRoutes.js'; 
import newsRoutes from './routes/newsRoutes.js'; 
import cinemaInfoRoutes from './routes/cinemaInfoRoutes.js'; 
import cleanupRoutes from './routes/cleanupRoutes.js';
import cashierRoutes from './routes/cashierRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import { cancelExpiredBookings } from './controllers/bookingController.js';
import { processUnsentPaidBookingEmails } from './services/bookingFulfillmentService.js';
import { autoCleanupExpiredTickets, requestCleanupApproval } from './utils/cleanupService.js';
import cron from 'node-cron';

// Өдөр бүр шөнө 00:05-д
cron.schedule('5 0 * * *', async () => {
  await autoCleanupExpiredTickets(); // expired тасалбар устгана
  await requestCleanupApproval();   // хуучин өгөгдлийн хүсэлт
});

// Мэдээллийн сантай холбогдох
connectDB();

const app = express();

// 💡 ЗАСВАР: ТАНЫ ШИНЭ СЕРВЕРИЙН ДОМЭЙНУУДЫГ CORS ЖАГСААЛТАД НЭМЭВ
const defaultAllowedOrigins = [
  'https://khovdteatr-web-pied.vercel.app',
  'https://www.hovdteatr.com',
  'https://hovdteatr.com',
  'http://west.edu.mn',
  'http://west.edu.mn:7000',
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
  } catch {
    return false;
  }
  return false;
};

app.use(cors({
  origin: function (origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS-оор зөвшөөрөгдөөгүй'));
    }
  },
  credentials: true,  
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use('/api/wire/webhook', express.raw({ type: 'application/json' }));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Зургууд хадгалагдаж буй хавтсыг статик болгох
app.use('/upload', express.static(path.join(process.cwd(), 'upload')));

// Request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api/movies', movieRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes); 
app.use('/api/cashier', cashierRoutes);
app.use('/api/news', newsRoutes); 
app.use('/api/cinema-info', cinemaInfoRoutes); 
app.use('/api/cleanup', cleanupRoutes);
app.use('/api/wire', wireRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/upload', uploadRoutes);

// Тестийн Home Route
app.get('/', (req, res) => {
  res.send('Cinema API ажиллаж байна...');
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'API ажиллаж байна' });
});

// 404 handler
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
processUnsentPaidBookingEmails().catch((err) => {
  console.error('[Booking/Fulfillment] Initial unsent paid email scan failed:', err.message);
});
setInterval(() => {
  processUnsentPaidBookingEmails().catch((err) => {
    console.error('[Booking/Fulfillment] Scheduled unsent paid email scan failed:', err.message);
  });
}, 60 * 1000);

const PORT = process.env.PORT || 7000; // 💡 Шинэ серверийн порт 7000 болгов
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});