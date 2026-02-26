/**
 * ساس — Orders API Routes
 * محادثة ٦: إدارة الطلبات
 */

import { Router } from 'express';
import { query, queryOne, insert } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════
// GET /api/orders/stats — ملخص إحصائي
// ═══════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const tid = req.tenantId;
    const today = new Date().toISOString().split('T')[0];

    const [totalRes, todayRes, statusRes, revenueRes] = await Promise.all([
      queryOne(`SELECT COUNT(*)::int as total FROM orders WHERE tenant_id = $1`, [tid]),
      queryOne(`SELECT COUNT(*)::int as total, COALESCE(SUM(total), 0) as revenue FROM orders WHERE tenant_id = $1 AND created_at::date = $2`, [tid, today]),
      query(`SELECT status, COUNT(*)::int as count FROM orders WHERE tenant_id = $1 GROUP BY status`, [tid]),
      queryOne(`SELECT COALESCE(SUM(total), 0) as total_revenue, COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total ELSE 0 END), 0) as paid_revenue FROM orders WHERE tenant_id = $1`, [tid]),
    ]);

    const statusCounts: Record<string, number> = {};
    statusRes.forEach((r: any) => { statusCounts[r.status] = r.count; });

    res.json({
      success: true,
      data: {
        total_orders: totalRes?.total || 0,
        today_orders: todayRes?.total || 0,
        today_revenue: parseFloat(todayRes?.revenue || '0'),
        total_revenue: parseFloat(revenueRes?.total_revenue || '0'),
        paid_revenue: parseFloat(revenueRes?.paid_revenue || '0'),
        new_orders: statusCounts['new'] || 0,
        processing_orders: (statusCounts['confirmed'] || 0) + (statusCounts['processing'] || 0),
        shipped_orders: statusCounts['shipped'] || 0,
        delivered_orders: statusCounts['delivered'] || 0,
        cancelled_orders: statusCounts['cancelled'] || 0,
        by_status: statusCounts,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/orders — قائمة الطلبات
// ═══════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const { page = '1', limit = '20', status, payment_status, search, date_from, date_to, sort = 'newest' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE o.tenant_id = $1';
    const params: any[] = [req.tenantId];
    let pi = 2;

    if (status && status !== 'all') { where += ` AND o.status = $${pi++}`; params.push(status); }
    if (payment_status && payment_status !== 'all') { where += ` AND o.payment_status = $${pi++}`; params.push(payment_status); }
    if (search) {
      where += ` AND (o.order_number ILIKE $${pi} OR c.name ILIKE $${pi} OR c.phone ILIKE $${pi})`;
      params.push(`%${search}%`);
      pi++;
    }
    if (date_from) { where += ` AND o.created_at >= $${pi++}`; params.push(date_from); }
    if (date_to) { where += ` AND o.created_at <= $${pi++}`; params.push(`${date_to}T23:59:59`); }

    const sortMap: Record<string, string> = {
      newest: 'o.created_at DESC',
      oldest: 'o.created_at ASC',
      highest: 'o.total DESC',
      lowest: 'o.total ASC',
    };
    const orderBy = sortMap[sort as string] || 'o.created_at DESC';

    const [orders, countResult] = await Promise.all([
      query(
        `SELECT o.id, o.order_number, o.subtotal, o.shipping_cost, o.discount_amount, o.total,
                o.status, o.payment_method, o.payment_status, o.shipping_method,
                o.coupon_code, o.created_at,
                c.name as customer_name, c.phone as customer_phone,
                (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) as items_count
         FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
         ${where} ORDER BY ${orderBy} LIMIT $${pi++} OFFSET $${pi}`,
        [...params, limitNum, offset]
      ),
      queryOne(`SELECT COUNT(*)::int as total FROM orders o LEFT JOIN customers c ON o.customer_id = c.id ${where}`, params),
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total || 0) / limitNum),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/orders/:id — تفاصيل الطلب
// ═══════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const order = await queryOne(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
              c.orders_count as customer_orders_count, c.total_spent as customer_total_spent
       FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

    // Parse shipping_address if string
    if (typeof order.shipping_address === 'string') {
      try { order.shipping_address = JSON.parse(order.shipping_address); } catch {}
    }

    const [items, statusHistory] = await Promise.all([
      query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at', [order.id]),
      query('SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY created_at DESC', [order.id]),
    ]);

    res.json({ success: true, data: { ...order, items, status_history: statusHistory } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/orders/:id/status — تحديث حالة الطلب
// ═══════════════════════════════════════
router.put('/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'الحالة مطلوبة' });

    const validStatuses = ['new', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'حالة غير صالحة' });
    }

    const order = await queryOne('SELECT id, status, payment_status FROM orders WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

    await query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
    await insert('order_status_history', {
      order_id: req.params.id,
      status,
      note: note || null,
      changed_by: req.merchant?.merchantId,
    });

    // If delivered and COD → mark as paid
    if (status === 'delivered' && order.payment_status === 'pending') {
      await query('UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2', ['paid', req.params.id]);
    }

    res.json({ success: true, message: 'تم تحديث حالة الطلب' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/orders/:id/notes — تحديث ملاحظات التاجر
// ═══════════════════════════════════════
router.put('/:id/notes', async (req, res) => {
  try {
    const { admin_notes } = req.body;
    const order = await queryOne('SELECT id FROM orders WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

    await query('UPDATE orders SET admin_notes = $1, updated_at = NOW() WHERE id = $2', [admin_notes || null, req.params.id]);

    res.json({ success: true, message: 'تم تحديث الملاحظات' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/orders/:id/payment — تحديث حالة الدفع
// ═══════════════════════════════════════
router.put('/:id/payment', async (req, res) => {
  try {
    const { payment_status } = req.body;
    const validStatuses = ['pending', 'paid', 'failed', 'refunded'];
    if (!payment_status || !validStatuses.includes(payment_status)) {
      return res.status(400).json({ success: false, error: 'حالة الدفع غير صالحة' });
    }

    const order = await queryOne('SELECT id FROM orders WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

    await query('UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2', [payment_status, req.params.id]);

    res.json({ success: true, message: 'تم تحديث حالة الدفع' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
