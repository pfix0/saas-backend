/**
 * ساس — Finance API Routes
 * محادثة ٩: المالية
 */

import { Router } from 'express';
import { query, queryOne } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════
// GET /api/finance/overview — ملخص مالي
// ═══════════════════════════════════════
router.get('/overview', async (req, res) => {
  try {
    const tid = req.tenantId;
    const today = new Date().toISOString().split('T')[0];

    const [totals, todayData, thisMonth, lastMonth] = await Promise.all([
      // All-time
      queryOne(
        `SELECT 
          COALESCE(SUM(total), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total ELSE 0 END), 0) as collected,
          COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN total ELSE 0 END), 0) as pending,
          COALESCE(SUM(shipping_cost), 0) as total_shipping,
          COALESCE(SUM(discount_amount), 0) as total_discounts,
          COUNT(*)::int as total_orders
         FROM orders WHERE tenant_id = $1`,
        [tid]
      ),
      // Today
      queryOne(
        `SELECT COALESCE(SUM(total), 0) as revenue, COUNT(*)::int as orders
         FROM orders WHERE tenant_id = $1 AND created_at::date = $2`,
        [tid, today]
      ),
      // This month
      queryOne(
        `SELECT COALESCE(SUM(total), 0) as revenue, COUNT(*)::int as orders
         FROM orders WHERE tenant_id = $1 AND date_trunc('month', created_at) = date_trunc('month', NOW())`,
        [tid]
      ),
      // Last month
      queryOne(
        `SELECT COALESCE(SUM(total), 0) as revenue, COUNT(*)::int as orders
         FROM orders WHERE tenant_id = $1 AND date_trunc('month', created_at) = date_trunc('month', NOW() - interval '1 month')`,
        [tid]
      ),
    ]);

    // Average order value
    const avgOrder = totals.total_orders > 0
      ? parseFloat(totals.total_revenue) / totals.total_orders
      : 0;

    res.json({
      success: true,
      data: {
        total_revenue: parseFloat(totals.total_revenue),
        collected: parseFloat(totals.collected),
        pending: parseFloat(totals.pending),
        total_shipping: parseFloat(totals.total_shipping),
        total_discounts: parseFloat(totals.total_discounts),
        total_orders: totals.total_orders,
        avg_order: Math.round(avgOrder * 100) / 100,
        today: {
          revenue: parseFloat(todayData.revenue),
          orders: todayData.orders,
        },
        this_month: {
          revenue: parseFloat(thisMonth.revenue),
          orders: thisMonth.orders,
        },
        last_month: {
          revenue: parseFloat(lastMonth.revenue),
          orders: lastMonth.orders,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/finance/by-payment — حسب طريقة الدفع
// ═══════════════════════════════════════
router.get('/by-payment', async (req, res) => {
  try {
    const result = await query(
      `SELECT payment_method,
        COUNT(*)::int as orders,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total ELSE 0 END), 0) as collected
       FROM orders WHERE tenant_id = $1
       GROUP BY payment_method ORDER BY revenue DESC`,
      [req.tenantId]
    );

    const labels: Record<string, string> = {
      cod: 'الدفع عند الاستلام',
      bank_transfer: 'تحويل بنكي',
      skypay: 'سكاي باي كاش',
      sadad: 'سداد',
    };

    res.json({
      success: true,
      data: result.map((r: any) => ({
        method: r.payment_method,
        label: labels[r.payment_method] || r.payment_method,
        orders: r.orders,
        revenue: parseFloat(r.revenue),
        collected: parseFloat(r.collected),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/finance/daily — إيرادات يومية (آخر 30 يوم)
// ═══════════════════════════════════════
router.get('/daily', async (req, res) => {
  try {
    const { days = '30' } = req.query;
    const numDays = Math.min(parseInt(days as string), 90);

    const result = await query(
      `SELECT created_at::date as date,
        COUNT(*)::int as orders,
        COALESCE(SUM(total), 0) as revenue
       FROM orders WHERE tenant_id = $1 AND created_at >= NOW() - $2::int * interval '1 day'
       GROUP BY created_at::date ORDER BY date ASC`,
      [req.tenantId, numDays]
    );

    res.json({
      success: true,
      data: result.map((r: any) => ({
        date: r.date,
        orders: r.orders,
        revenue: parseFloat(r.revenue),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/finance/transactions — آخر المعاملات
// ═══════════════════════════════════════
router.get('/transactions', async (req, res) => {
  try {
    const { page = '1', limit = '20', payment_status, payment_method } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 50);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE o.tenant_id = $1';
    const params: any[] = [req.tenantId];
    let pi = 2;

    if (payment_status && payment_status !== 'all') {
      where += ` AND o.payment_status = $${pi++}`;
      params.push(payment_status);
    }
    if (payment_method && payment_method !== 'all') {
      where += ` AND o.payment_method = $${pi++}`;
      params.push(payment_method);
    }

    const countRes = await queryOne(
      `SELECT COUNT(*)::int as count FROM orders o ${where}`, params
    );

    const orders = await query(
      `SELECT o.id, o.order_number, o.total, o.subtotal, o.shipping_cost, o.discount_amount,
              o.payment_method, o.payment_status, o.status, o.created_at,
              o.customer_name, o.customer_phone
       FROM orders o ${where}
       ORDER BY o.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limitNum, offset]
    );

    res.json({
      success: true,
      data: orders,
      pagination: {
        total: countRes.count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(countRes.count / limitNum),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/finance/shipping-stats — إحصائيات الشحن
// ═══════════════════════════════════════
router.get('/shipping-stats', async (req, res) => {
  try {
    const tid = req.tenantId;

    // By shipping method
    const byMethod = await query(
      `SELECT shipping_method,
        COUNT(*)::int as orders,
        COALESCE(SUM(shipping_cost), 0) as total_cost
       FROM orders WHERE tenant_id = $1
       GROUP BY shipping_method ORDER BY orders DESC`,
      [tid]
    );

    // By delivery status
    const byStatus = await query(
      `SELECT status, COUNT(*)::int as count
       FROM orders WHERE tenant_id = $1 AND shipping_method != 'pickup'
       GROUP BY status`,
      [tid]
    );

    // Pending shipments
    const pendingShipments = await queryOne(
      `SELECT COUNT(*)::int as count
       FROM orders WHERE tenant_id = $1 AND shipping_method != 'pickup'
       AND status IN ('confirmed', 'processing')`,
      [tid]
    );

    // Shipped (in transit)
    const inTransit = await queryOne(
      `SELECT COUNT(*)::int as count
       FROM orders WHERE tenant_id = $1 AND status = 'shipped'`,
      [tid]
    );

    const labels: Record<string, string> = {
      aramex: 'أرامكس', dhl: 'DHL', pickup: 'استلام',
    };

    res.json({
      success: true,
      data: {
        by_method: byMethod.map((r: any) => ({
          method: r.shipping_method,
          label: labels[r.shipping_method] || r.shipping_method,
          orders: r.orders,
          total_cost: parseFloat(r.total_cost),
        })),
        by_status: byStatus,
        pending_shipments: pendingShipments.count,
        in_transit: inTransit.count,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
