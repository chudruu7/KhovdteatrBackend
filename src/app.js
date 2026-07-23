import express from 'express';
import path from 'path';
import cors from 'cors';

import wireRoutes from './routes/wireRoutes.js';
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

const isPrivateNetworkHost = (hostname = '') => (
  ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) ||
  hostname.startsWith('10.') ||
  hostname.startsWith('192.168.') ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'http:' && (
      ['localhost', '127.0.0.1'].includes(hostname) ||
      (process.env.NODE_ENV !== 'production' && isPrivateNetworkHost(hostname))
    );
  } catch {
    return false;
  }
};

const app = express();

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) callback(null, true);
    else callback(new Error('CORS-оор зөвшөөрөгдөөгүй'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Wire requires the exact raw request body for webhook signature validation.
app.use('/api/wire/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/upload', express.static(path.join(process.cwd(), 'upload')));

if (process.env.NODE_ENV !== 'test') {
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });
}

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

app.get('/', (_req, res) => {
  res.send('Cinema API ажиллаж байна...');
});

app.get('/api/test', (_req, res) => {
  res.json({ message: 'API ажиллаж байна' });
});

app.use((err, _req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Зургийн хэмжээ 10MB-аас бага байх ёстой.' });
  }
  return next(err);
});

app.use((req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`404 - Хүсэлт олдсонгүй: ${req.method} ${req.url}`);
  }
  res.status(404).json({ message: 'Хүсэлт олдсонгүй' });
});

app.use((err, _req, res, _next) => {
  console.error('Серверийн алдаа:', err.stack);
  res.status(500).json({ message: 'Сервер дээр алдаа гарлаа!', error: err.message });
});

export default app;
