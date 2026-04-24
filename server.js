import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import authRoutes from './server/routes/auth.js';
import kbRoutes, { cleanupExpiredFiles } from './server/routes/kb.js';
import chatRoutes from './server/routes/chat.js';
import analyticsRoutes from './server/routes/analytics.js';
import adminChatRoutes from './server/routes/admin-chat.js';
import tutorialsRoutes from './server/routes/tutorials.js';
import faqRoutes from './server/routes/faq.js';
import { requireAuth } from './server/middleware/auth.js';
import { chatLimiter } from './server/middleware/rateLimit.js';
import rateLimit from 'express-rate-limit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

// --- Middleware ---

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

if (!isProd) {
  const cors = (await import('cors')).default;
  app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
}

app.set('trust proxy', 1);

const PgSession = connectPgSimple(session);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required');
}

app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: isProd ? 'strict' : 'lax',
  },
}));

// File upload middleware is configured in server/upload.js

// --- API Routes ---

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});
app.post('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/kb', requireAuth, kbRoutes);
app.use('/api/chat', chatLimiter, chatRoutes);
app.use('/api/analytics', requireAuth, analyticsRoutes);
app.use('/api/admin-chat', requireAuth, adminChatRoutes);
app.use('/api/tutorials', tutorialsRoutes); // auth handled per-route
app.use('/api/faq', faqRoutes);             // auth handled per-route

// --- Static Files (production) ---

if (isProd) {
  app.use(express.static(join(__dirname, 'dist')));
  app.get(/^\//, (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
  });
}

// --- Global Error Handler ---

app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// --- Start ---

app.listen(PORT, () => {
  console.log(`Prism Support API running on port ${PORT}`);
  if (!isProd) {
    console.log(`  API: http://localhost:${PORT}`);
    console.log(`  UI:  http://localhost:5173`);
  }

  // Run file cleanup on startup and every 24 hours
  const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  cleanupExpiredFiles().catch((err) => console.error('[Cleanup] Startup run failed:', err.message));
  setInterval(() => {
    cleanupExpiredFiles().catch((err) => console.error('[Cleanup] Scheduled run failed:', err.message));
  }, CLEANUP_INTERVAL_MS);
});
