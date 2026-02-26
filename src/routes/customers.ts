/**
 * ساس — Customers API Routes (Dashboard — merchant auth)
 * محادثة ٧: إدارة العملاء
 */

import { Router } from 'express';
import { query, queryOne } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════
// GET /api/customers/stats
// ═══════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const tid = req.tenantId;
    const today = new Date().toISOString().split('T')[0];

    const [totalRes, todayRes, topRes] = await Promise.all([
      queryOne(`SELECT COUNT(*)::int as total, COALESCE(SUM(total_spent), 0) as revenue FROM customers WHERE tenant_id = $1`, [tid]),
      queryOne(`SELECT COUNT(*)::int as total FROM customers WHERE tenant_id = $1 AND created_at::date = $2`, [tid, today]),
      query(`SELECT id, name, phone, orders_count, total_spent FROM customers WHERE tenant_id = $1 ORDER BY total_spent DESC LIMIT 5`, [tid]),
    ]);

    res.json({
      success: true,
      data: {
        total_customers: totalRes?.total || 0,
        total_revenue: parseFloat(totalRes?.revenue || '0'),
        today_new: todayRes?.total || 0,
        top_customers: topRes,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/customers — قائمة العملاء
// ═══════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const { page = '1', limit = '20', search, sort = 'newest', status } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE tenant_id = $1';
    const params: any[] = [req.tenantId];
    let pi = 2;

    if (search) {
      where += ` AND (name ILIKE $${pi} OR phone ILIKE $${pi} OR email ILIKE $${pi})`;
      params.push(`%${search}%`);
      pi++;
    }
    if (status && status !== 'all') {
      where += ` AND status = $${pi++}`;
      params.push(status);
    }

    const sortMap: Record<string, string> = {
      newest: 'created_at DESC',
      oldest: 'created_at ASC',
      most_orders: 'orders_count DESC',
      highest_spent: 'total_spent DESC',
      name_asc: 'name ASC',
    };
    const orderBy = sortMap[sort as string] || 'created_at DESC';

    const [customers, countResult] = await Promise.all([
      query(
        `SELECT * FROM customers ${where} ORDER BY ${orderBy} LIMIT $${pi++} OFFSET $${pi}`,
        [...params, limitNum, offset]
      ),
      queryOne(`SELECT COUNT(*)::int as total FROM customers ${where}`, params),
    ]);

    res.json({
      success: true,
      data: customers,
      pagination: {
        page: pageNum, limit: limitNum,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total || 0) / limitNum),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/customers/:id — تفاصيل العميل
// ═══════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const customer = await queryOne(
      'SELECT * FROM customers WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (!customer) return res.status(404).json({ success: false, error: 'العميل غير موجود' });

    const [orders, addresses] = await Promise.all([
      query(
        `SELECT id, order_number, status, total, payment_status, payment_method, shipping_method, created_at
         FROM orders WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50`,
        [req.params.id, req.tenantId]
      ),
      query('SELECT * FROM addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC', [req.params.id]),
    ]);

    res.json({ success: true, data: { ...customer, orders, addresses } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/customers/:id — تحديث بيانات العميل
// ═══════════════════════════════════════
router.put('/:id', async (req, res) => {
  try {
    const { name, email, notes, status } = req.body;
    const customer = await queryOne('SELECT id FROM customers WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
    if (!customer) return res.status(404).json({ success: false, error: 'العميل غير موجود' });

    const updates: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (name !== undefined) { updates.push(`name = $${pi++}`); params.push(name); }
    if (email !== undefined) { updates.push(`email = $${pi++}`); params.push(email || null); }
    if (notes !== undefined) { updates.push(`notes = $${pi++}`); params.push(notes || null); }
    if (status !== undefined && ['active', 'blocked'].includes(status)) {
      updates.push(`status = $${pi++}`); params.push(status);
    }

    if (updates.length === 0) return res.status(400).json({ success: false, error: 'لا توجد بيانات للتحديث' });

    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);

    await query(`UPDATE customers SET ${updates.join(', ')} WHERE id = $${pi}`, params);

    res.json({ success: true, message: 'تم تحديث بيانات العميل' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
