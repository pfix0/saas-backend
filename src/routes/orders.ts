/**
 * ساس — Orders API Routes
 */

import { Router } from 'express';
import { query, queryOne, insert } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { page = '1', limit = '20', status, payment_status } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE o.tenant_id = $1';
    const params: any[] = [req.tenantId];
    let pi = 2;

    if (status) { where += ` AND o.status = $${pi++}`; params.push(status); }
    if (payment_status) { where += ` AND o.payment_status = $${pi++}`; params.push(payment_status); }

    const [orders, countResult] = await Promise.all([
      query(
        `SELECT o.*, c.name as customer_name, c.phone as customer_phone
         FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
         ${where} ORDER BY o.created_at DESC LIMIT $${pi++} OFFSET $${pi}`,
        [...params, limitNum, offset]
      ),
      query(`SELECT COUNT(*) as total FROM orders o ${where}`, params),
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: { page: pageNum, limit: limitNum, total: parseInt(countResult[0].total), totalPages: Math.ceil(parseInt(countResult[0].total) / limitNum) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const order = await queryOne(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
       FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

    const [items, statusHistory] = await Promise.all([
      query('SELECT * FROM order_items WHERE order_id = $1', [order.id]),
      query('SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY created_at DESC', [order.id]),
    ]);

    res.json({ success: true, data: { ...order, items, status_history: statusHistory } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/orders/:id/status
router.put('/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'الحالة مطلوبة' });

    const order = await queryOne('SELECT id, status FROM orders WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

    await query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    await insert('order_status_history', {
      order_id: req.params.id, status, note: note || null, changed_by: req.merchant?.merchantId,
    });

    res.json({ success: true, message: 'تم تحديث حالة الطلب' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
