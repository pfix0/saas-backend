/**
 * ساس — Customers API Routes
 */

import { Router } from 'express';
import { query, queryOne } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/customers
router.get('/', async (req, res) => {
  try {
    const { page = '1', limit = '20', search } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE tenant_id = $1';
    const params: any[] = [req.tenantId];
    if (search) { where += ` AND (name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)`; params.push(`%${search}%`); }

    const [customers, countResult] = await Promise.all([
      query(`SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limitNum, offset]),
      query(`SELECT COUNT(*) as total FROM customers ${where}`, params),
    ]);

    res.json({
      success: true, data: customers,
      pagination: { page: pageNum, limit: limitNum, total: parseInt(countResult[0].total), totalPages: Math.ceil(parseInt(countResult[0].total) / limitNum) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res) => {
  try {
    const customer = await queryOne('SELECT * FROM customers WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
    if (!customer) return res.status(404).json({ success: false, error: 'العميل غير موجود' });

    const orders = await query(
      'SELECT id, order_number, status, total, payment_status, created_at FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.params.id]
    );

    res.json({ success: true, data: { ...customer, recent_orders: orders } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
