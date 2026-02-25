/**
 * ساس — Health Check
 */

import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

router.get('/', async (_req, res) => {
  const health: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    platform: 'ساس',
    uptime: process.uptime(),
  };

  try {
    const result = await query('SELECT NOW() as time, current_database() as db');
    health.database = {
      status: 'connected',
      time: result[0].time,
      name: result[0].db,
    };
  } catch (err: any) {
    health.database = { status: 'error', message: err.message };
    health.status = 'degraded';
  }

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

export default router;
