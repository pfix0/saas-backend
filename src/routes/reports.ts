/**
 * ساس — Reports & Analytics Routes
 * محادثة ١٢: التقارير والإحصائيات المتقدمة
 */

import { Router, Request, Response } from 'express';
import { pool } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ═══════════════════════════════════════
// GET /api/reports/overview — ملخص عام (Dashboard cards)
// ═══════════════════════════════════════
router.get('/overview', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { period = '30d' } = req.query;

    // Calculate date range
    let days = 30;
    if (period === '7d') days = 7;
    else if (period === '90d') days = 90;
    else if (period === '365d') days = 365;
    else if (period === 'today') days = 0;

    const dateFilter = days === 0
      ? `DATE(o.created_at) = CURRENT_DATE`
      : `o.created_at >= NOW() - INTERVAL '${days} days'`;

    const prevDateFilter = days === 0
      ? `DATE(o.created_at) = CURRENT_DATE - INTERVAL '1 day'`
      : `o.created_at >= NOW() - INTERVAL '${days * 2} days' AND o.created_at < NOW() - INTERVAL '${days} days'`;

    // Current period stats
    const current = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) as revenue,
        COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total ELSE NULL END), 0) as avg_order,
        COUNT(DISTINCT customer_id) as unique_customers,
        COUNT(*) FILTER (WHERE payment_status = 'paid') as paid_orders,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_orders
      FROM orders o WHERE tenant_id = $1 AND ${dateFilter}
    `, [tenantId]);

    // Previous period for comparison
    const previous = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) as revenue,
        COUNT(DISTINCT customer_id) as unique_customers
      FROM orders o WHERE tenant_id = $1 AND ${prevDateFilter}
    `, [tenantId]);

    // Products stats
    const products = await pool.query(`
      SELECT COUNT(*) as total, 
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE stock <= 0) as out_of_stock
      FROM products WHERE tenant_id = $1
    `, [tenantId]);

    // Customers total
    const customers = await pool.query(`
      SELECT COUNT(*) as total FROM customers WHERE tenant_id = $1
    `, [tenantId]);

    const c = current.rows[0];
    const p = previous.rows[0];

    const calcGrowth = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    res.json({
      success: true,
      data: {
        revenue: {
          value: parseFloat(c.revenue),
          growth: calcGrowth(parseFloat(c.revenue), parseFloat(p.revenue)),
        },
        orders: {
          total: parseInt(c.total_orders),
          paid: parseInt(c.paid_orders),
          delivered: parseInt(c.delivered_orders),
          cancelled: parseInt(c.cancelled_orders),
          growth: calcGrowth(parseInt(c.total_orders), parseInt(p.total_orders)),
        },
        avgOrder: {
          value: parseFloat(c.avg_order),
        },
        customers: {
          total: parseInt(customers.rows[0].total),
          unique: parseInt(c.unique_customers),
          growth: calcGrowth(parseInt(c.unique_customers), parseInt(p.unique_customers)),
        },
        products: {
          total: parseInt(products.rows[0].total),
          active: parseInt(products.rows[0].active),
          outOfStock: parseInt(products.rows[0].out_of_stock),
        },
        period,
      },
    });
  } catch (err: any) {
    console.error('❌ Reports overview error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل الملخص' });
  }
});

// ═══════════════════════════════════════
// GET /api/reports/sales — تقرير المبيعات اليومي/الشهري
// ═══════════════════════════════════════
router.get('/sales', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { period = '30d', groupBy = 'day' } = req.query;

    let days = 30;
    if (period === '7d') days = 7;
    else if (period === '90d') days = 90;
    else if (period === '365d') days = 365;

    let dateFormat = 'YYYY-MM-DD';
    let dateTrunc = 'day';
    if (groupBy === 'week') { dateTrunc = 'week'; dateFormat = 'YYYY-"W"WW'; }
    if (groupBy === 'month') { dateTrunc = 'month'; dateFormat = 'YYYY-MM'; }

    const result = await pool.query(`
      SELECT 
        DATE_TRUNC($3, o.created_at) as date,
        TO_CHAR(DATE_TRUNC($3, o.created_at), $4) as label,
        COUNT(*) as orders,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN shipping_cost ELSE 0 END), 0) as shipping,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN discount_amount ELSE 0 END), 0) as discounts,
        COUNT(DISTINCT customer_id) as customers,
        COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total ELSE NULL END), 0) as avg_order
      FROM orders o
      WHERE tenant_id = $1 AND o.created_at >= NOW() - INTERVAL '${days} days'
        AND status != 'cancelled'
      GROUP BY DATE_TRUNC($3, o.created_at), TO_CHAR(DATE_TRUNC($3, o.created_at), $4)
      ORDER BY date
    `, [tenantId, days, dateTrunc, dateFormat]);

    res.json({
      success: true,
      data: result.rows.map(r => ({
        date: r.date,
        label: r.label,
        orders: parseInt(r.orders),
        revenue: parseFloat(r.revenue),
        shipping: parseFloat(r.shipping),
        discounts: parseFloat(r.discounts),
        customers: parseInt(r.customers),
        avgOrder: parseFloat(r.avg_order),
      })),
    });
  } catch (err: any) {
    console.error('❌ Sales report error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل تقرير المبيعات' });
  }
});

// ═══════════════════════════════════════
// GET /api/reports/products — أفضل المنتجات
// ═══════════════════════════════════════
router.get('/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { period = '30d', limit = '10', sort = 'revenue' } = req.query;

    let days = 30;
    if (period === '7d') days = 7;
    else if (period === '90d') days = 90;
    else if (period === '365d') days = 365;

    const orderBy = sort === 'quantity' ? 'total_qty' : sort === 'orders' ? 'total_orders' : 'total_revenue';

    const result = await pool.query(`
      SELECT 
        p.id, p.name, p.slug, p.price, p.compare_price,
        p.stock, p.status,
        COUNT(DISTINCT oi.order_id) as total_orders,
        COALESCE(SUM(oi.quantity), 0) as total_qty,
        COALESCE(SUM(oi.quantity * oi.price), 0) as total_revenue,
        COALESCE(AVG(r.rating), 0) as avg_rating,
        COUNT(DISTINCT r.id) as review_count
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.id
      LEFT JOIN orders o ON o.id = oi.order_id 
        AND o.status != 'cancelled'
        AND o.created_at >= NOW() - INTERVAL '${days} days'
      LEFT JOIN reviews r ON r.product_id = p.id AND r.status = 'approved'
      WHERE p.tenant_id = $1
      GROUP BY p.id
      ORDER BY ${orderBy} DESC
      LIMIT $2
    `, [tenantId, parseInt(limit as string)]);

    res.json({
      success: true,
      data: result.rows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        price: parseFloat(r.price),
        comparePrice: r.compare_price ? parseFloat(r.compare_price) : null,
        stock: parseInt(r.stock),
        status: r.status,
        totalOrders: parseInt(r.total_orders),
        totalQty: parseInt(r.total_qty),
        totalRevenue: parseFloat(r.total_revenue),
        avgRating: parseFloat(r.avg_rating),
        reviewCount: parseInt(r.review_count),
      })),
    });
  } catch (err: any) {
    console.error('❌ Products report error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل تقرير المنتجات' });
  }
});

// ═══════════════════════════════════════
// GET /api/reports/customers — تقرير العملاء
// ═══════════════════════════════════════
router.get('/customers', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { period = '30d', limit = '10' } = req.query;

    let days = 30;
    if (period === '7d') days = 7;
    else if (period === '90d') days = 90;
    else if (period === '365d') days = 365;

    // Top customers by spending
    const topCustomers = await pool.query(`
      SELECT 
        c.id, c.name, c.phone, c.email,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(o.total), 0) as total_spent,
        MAX(o.created_at) as last_order,
        MIN(o.created_at) as first_order
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id AND o.status != 'cancelled'
        AND o.created_at >= NOW() - INTERVAL '${days} days'
      WHERE c.tenant_id = $1
      GROUP BY c.id
      ORDER BY total_spent DESC
      LIMIT $2
    `, [tenantId, parseInt(limit as string)]);

    // Customer acquisition (new vs returning)
    const acquisition = await pool.query(`
      SELECT 
        DATE_TRUNC('day', c.created_at) as date,
        TO_CHAR(DATE_TRUNC('day', c.created_at), 'YYYY-MM-DD') as label,
        COUNT(*) as new_customers
      FROM customers c
      WHERE c.tenant_id = $1 AND c.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('day', c.created_at)
      ORDER BY date
    `, [tenantId]);

    // Customer stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '${days} days') as new_period,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as new_week
      FROM customers WHERE tenant_id = $1
    `, [tenantId]);

    // Repeat customers
    const repeatCustomers = await pool.query(`
      SELECT COUNT(*) as repeat_count FROM (
        SELECT customer_id FROM orders 
        WHERE tenant_id = $1 AND status != 'cancelled'
          AND created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY customer_id HAVING COUNT(*) > 1
      ) sub
    `, [tenantId]);

    res.json({
      success: true,
      data: {
        topCustomers: topCustomers.rows.map(r => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          email: r.email,
          totalOrders: parseInt(r.total_orders),
          totalSpent: parseFloat(r.total_spent),
          lastOrder: r.last_order,
          firstOrder: r.first_order,
        })),
        acquisition: acquisition.rows.map(r => ({
          date: r.date,
          label: r.label,
          newCustomers: parseInt(r.new_customers),
        })),
        stats: {
          total: parseInt(stats.rows[0].total),
          newInPeriod: parseInt(stats.rows[0].new_period),
          newThisWeek: parseInt(stats.rows[0].new_week),
          repeatCustomers: parseInt(repeatCustomers.rows[0].repeat_count),
        },
      },
    });
  } catch (err: any) {
    console.error('❌ Customer report error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل تقرير العملاء' });
  }
});

// ═══════════════════════════════════════
// GET /api/reports/orders — تقرير الطلبات حسب الحالة
// ═══════════════════════════════════════
router.get('/orders', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { period = '30d' } = req.query;

    let days = 30;
    if (period === '7d') days = 7;
    else if (period === '90d') days = 90;
    else if (period === '365d') days = 365;

    // Orders by status
    const byStatus = await pool.query(`
      SELECT status, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM orders WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY status ORDER BY count DESC
    `, [tenantId]);

    // Orders by payment method
    const byPayment = await pool.query(`
      SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM orders WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
        AND payment_method IS NOT NULL
      GROUP BY payment_method ORDER BY count DESC
    `, [tenantId]);

    // Orders by shipping method
    const byShipping = await pool.query(`
      SELECT shipping_method, COUNT(*) as count, COALESCE(SUM(shipping_cost), 0) as total_cost
      FROM orders WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
        AND shipping_method IS NOT NULL
      GROUP BY shipping_method ORDER BY count DESC
    `, [tenantId]);

    // Hourly distribution
    const hourly = await pool.query(`
      SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
      FROM orders WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY EXTRACT(HOUR FROM created_at) ORDER BY hour
    `, [tenantId]);

    // Conversion rate (orders vs visits - approximate from customers)
    const conversionData = await pool.query(`
      SELECT 
        COUNT(DISTINCT customer_id) as buying_customers,
        (SELECT COUNT(*) FROM customers WHERE tenant_id = $1) as total_customers
      FROM orders WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
    `, [tenantId]);

    res.json({
      success: true,
      data: {
        byStatus: byStatus.rows.map(r => ({
          status: r.status,
          count: parseInt(r.count),
          total: parseFloat(r.total),
        })),
        byPayment: byPayment.rows.map(r => ({
          method: r.payment_method,
          count: parseInt(r.count),
          total: parseFloat(r.total),
        })),
        byShipping: byShipping.rows.map(r => ({
          method: r.shipping_method,
          count: parseInt(r.count),
          totalCost: parseFloat(r.total_cost),
        })),
        hourlyDistribution: hourly.rows.map(r => ({
          hour: parseInt(r.hour),
          count: parseInt(r.count),
        })),
        conversion: {
          buyingCustomers: parseInt(conversionData.rows[0].buying_customers),
          totalCustomers: parseInt(conversionData.rows[0].total_customers),
        },
      },
    });
  } catch (err: any) {
    console.error('❌ Orders report error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل تقرير الطلبات' });
  }
});

// ═══════════════════════════════════════
// GET /api/reports/categories — أداء التصنيفات
// ═══════════════════════════════════════
router.get('/categories', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { period = '30d' } = req.query;

    let days = 30;
    if (period === '7d') days = 7;
    else if (period === '90d') days = 90;

    const result = await pool.query(`
      SELECT 
        cat.id, cat.name, cat.slug,
        COUNT(DISTINCT p.id) as product_count,
        COUNT(DISTINCT oi.order_id) as total_orders,
        COALESCE(SUM(oi.quantity), 0) as total_qty,
        COALESCE(SUM(oi.quantity * oi.price), 0) as total_revenue
      FROM categories cat
      LEFT JOIN products p ON p.category_id = cat.id
      LEFT JOIN order_items oi ON oi.product_id = p.id
      LEFT JOIN orders o ON o.id = oi.order_id AND o.status != 'cancelled'
        AND o.created_at >= NOW() - INTERVAL '${days} days'
      WHERE cat.tenant_id = $1
      GROUP BY cat.id
      ORDER BY total_revenue DESC
    `, [tenantId]);

    res.json({
      success: true,
      data: result.rows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        productCount: parseInt(r.product_count),
        totalOrders: parseInt(r.total_orders),
        totalQty: parseInt(r.total_qty),
        totalRevenue: parseFloat(r.total_revenue),
      })),
    });
  } catch (err: any) {
    console.error('❌ Categories report error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل تقرير التصنيفات' });
  }
});

export default router;
