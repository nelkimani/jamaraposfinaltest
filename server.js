// server.js — Jamara POS API entry point
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const rateLimit = require('express-rate-limit');

const { testConnection } = require('./config/database');
const routes = require('./routes/index');

const app  = express();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));

// ── Security headers ─────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Managed separately if needed
}));

// ── CORS — allow the frontend origin ────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:5500',   // VS Code Live Server
  'http://localhost:5500',
  'http://localhost:8080',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow Postman / curl (no origin) + configured origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate limiting ─────────────────────────────────────────────
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { status: 'error', message: 'Too many login attempts — wait 15 minutes' },
}));
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  message: { status: 'error', message: 'Rate limit exceeded' },
}));

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Health check ──────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const db = await testConnection().catch(() => false);
  res.status(db ? 200 : 503).json({
    status: db ? 'healthy' : 'degraded',
    service: 'Jamara POS API',
    version: '2.0.0',
    database: db ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ── API info ──────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  service: 'Jamara Uniforms & Clothing — POS API v2',
  status: 'running',
  endpoints: {
    auth:     'POST /api/auth/login | GET /api/auth/me',
    products: 'GET /api/products | GET /api/products/:id',
    sales:    'POST /api/sales | GET /api/sales',
    reports:  'GET /api/reports/summary | /daily | /best-selling',
    health:   'GET /health',
  },
}));

// ── All API routes ────────────────────────────────────────────
app.use('/api', routes);

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);

  // PostgreSQL errors
  if (err.code === '23505') return res.status(409).json({ status: 'error', message: 'Duplicate entry' });
  if (err.code === '23503') return res.status(400).json({ status: 'error', message: 'Referenced record does not exist' });

  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production' && status === 500
      ? 'Internal server error'
      : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────
const start = async () => {
  const ok = await testConnection();
  if (!ok) {
    console.error('❌ Cannot connect to database. Check DATABASE_URL in .env');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`\n🚀 Jamara POS API running`);
    console.log(`   URL:  http://localhost:${PORT}`);
    console.log(`   Env:  ${process.env.NODE_ENV || 'development'}`);
    console.log(`   CORS: ${allowedOrigins.join(', ')}\n`);
  });
};

process.on('unhandledRejection', r => console.error('Unhandled rejection:', r));
process.on('SIGTERM', () => { console.log('Shutting down...'); process.exit(0); });

start();
module.exports = app;
