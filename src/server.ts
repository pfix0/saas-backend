/**
 * ساس — Backend API Server
 * Express + PostgreSQL on Railway
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import 'dotenv/config';

import { pool } from './config/database.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import categoryRoutes from './routes/categories.js';
import orderRoutes from './routes/orders.js';
import customerRoutes from './routes/customers.js';
import storeRoutes from './routes/store.js';
import customerAccountRoutes from './routes/customer-account.js';
import adminRoutes from './routes/admin.js';
import couponRoutes from './routes/coupons.js';
import settingsRoutes from './routes/settings.js';
import financeRoutes from './routes/finance.js';
import healthRoutes from './routes/health.js';
import reviewRoutes from './routes/reviews.js';
import pageRoutes from './routes/pages.js';

const app = express();
const PORT = parseInt(process.env.PORT || '4000');

// ═══ Middleware ═══
app.use(helmet());
app.use(morgan('short'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS — Allow Vercel frontend
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    /\.vercel\.app$/,     // Vercel previews
    /\.saas\.qa$/,        // Production domain
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
}));

// ═══ Routes ═══
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/store', customerAccountRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/admin', adminRoutes);

// ═══ 404 Handler ═══
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// ═══ Error Handler ═══
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
  });
});

// ═══ Run Migrations ═══
async function runMigrations() {
  try {
    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        run_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const fs = await import('fs');
    const path = await import('path');
    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      console.log('📁 No migrations directory found');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((f: string) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const existing = await pool.query(
        'SELECT id FROM _migrations WHERE name = $1', [file]
      );
      if (existing.rows.length > 0) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
      await pool.query(
        'INSERT INTO _migrations (name) VALUES ($1)', [file]
      );
      console.log(`✅ Migration: ${file}`);
    }
  } catch (err: any) {
    console.error('⚠️ Migration error:', err.message);
  }
}

// ═══ Start Server ═══
runMigrations().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════╗');
    console.log('  ║   ساس — Backend API Server       ║');
    console.log(`  ║   Port: ${PORT}                      ║`);
    console.log(`  ║   Env:  ${process.env.NODE_ENV || 'development'}              ║`);
    console.log('  ╚══════════════════════════════════╝');
    console.log('');
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down...');
  await pool.end();
  process.exit(0);
});

export default app;
