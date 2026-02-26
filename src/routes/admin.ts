/**
 * ساس — Platform Admin Routes
 * إدارة المنصة: المتاجر، التجار، الاشتراكات، الإحصائيات
 */

import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, queryOne, insert } from '../config/database.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ═══ Types ═══
interface AdminPayload {
  adminId: string;
  email: string;
  role: 'super_admin' | 'admin';
  type: 'platform_admin';
}

// ═══ Ensure platform_admins table exists ═══
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS platform_admins (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name          VARCHAR(255) NOT NULL,
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role          VARCHAR(20) DEFAULT 'super_admin'
                    CHECK (role IN ('super_admin', 'admin')),
      status        VARCHAR(20) DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
      last_login_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// Run on startup
ensureTable().catch(console.error);

// ═══ Middleware: requirePlatformAdmin ═══
function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'غير مصرح' });
  }

  try {
    const payload = jwt.verify(header.split(' ')[1], JWT_SECRET) as any;
    if (payload.type !== 'platform_admin') {
      return res.status(403).json({ success: false, error: 'صلاحية مدير المنصة مطلوبة' });
    }
    (req as any).admin = payload;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'انتهت صلاحية الجلسة', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, error: 'توكن غير صالح' });
  }
}

// ═══ Generate admin tokens ═══
function generateAdminTokens(payload: AdminPayload) {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
  const refreshToken = jwt.sign({ ...payload, refreshType: 'admin_refresh' }, JWT_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════

// ═══ POST /api/admin/auth/login ═══
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'البريد وكلمة المرور مطلوبان' });
    }

    const admin = await queryOne<any>(
      'SELECT * FROM platform_admins WHERE email = $1 AND status = $2',
      [email, 'active']
    );

    if (!admin) {
      return res.status(401).json({ success: false, error: 'بيانات الدخول غير صحيحة' });
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'بيانات الدخول غير صحيحة' });
    }

    // Update last login
    await query('UPDATE platform_admins SET last_login_at = NOW() WHERE id = $1', [admin.id]);

    const tokens = generateAdminTokens({
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      type: 'platform_admin',
    });

    res.json({
      success: true,
      data: {
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
        tokens,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ GET /api/admin/auth/me ═══
router.get('/auth/me', requirePlatformAdmin, async (req, res) => {
  try {
    const { adminId } = (req as any).admin;
    const admin = await queryOne<any>(
      'SELECT id, name, email, role, status, last_login_at, created_at FROM platform_admins WHERE id = $1',
      [adminId]
    );
    if (!admin) return res.status(404).json({ success: false, error: 'الحساب غير موجود' });
    res.json({ success: true, data: { admin } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ POST /api/admin/auth/setup — Create first admin (one-time) ═══
router.post('/auth/setup', async (req, res) => {
  try {
    // Check if any admin exists
    const existing = await queryOne<any>('SELECT id FROM platform_admins LIMIT 1');
    if (existing) {
      return res.status(403).json({ success: false, error: 'تم إعداد المنصة مسبقاً' });
    }

    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await insert('platform_admins', {
      name,
      email,
      password_hash: passwordHash,
      role: 'super_admin',
      status: 'active',
    });

    const tokens = generateAdminTokens({
      adminId: admin.id,
      email: admin.email,
      role: 'super_admin',
      type: 'platform_admin',
    });

    res.status(201).json({
      success: true,
      data: {
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
        tokens,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════
// DASHBOARD STATS
// ══════════════════════════════════════════

// ═══ GET /api/admin/stats ═══
router.get('/stats', requirePlatformAdmin, async (req, res) => {
  try {
    const [tenants] = await query<any>('SELECT COUNT(*) as count FROM tenants');
    const [merchants] = await query<any>('SELECT COUNT(*) as count FROM merchants');
    const [products] = await query<any>('SELECT COUNT(*) as count FROM products');
    const [orders] = await query<any>('SELECT COUNT(*) as count FROM orders');

    // Revenue
    const [revenue] = await query<any>(`SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status != 'cancelled'`);

    // Today's stats
    const today = new Date().toISOString().split('T')[0];
    const [todayOrders] = await query<any>(
      `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue FROM orders WHERE created_at::date = $1 AND status != 'cancelled'`,
      [today]
    );

    // Active vs trial vs suspended tenants
    const planStats = await query<any>(
      `SELECT plan, status, COUNT(*) as count FROM tenants GROUP BY plan, status ORDER BY plan`
    );

    // Recent signups (last 7 days)
    const [recentSignups] = await query<any>(
      `SELECT COUNT(*) as count FROM tenants WHERE created_at >= NOW() - INTERVAL '7 days'`
    );

    res.json({
      success: true,
      data: {
        totalTenants: parseInt(tenants.count),
        totalMerchants: parseInt(merchants.count),
        totalProducts: parseInt(products.count),
        totalOrders: parseInt(orders.count),
        totalRevenue: parseFloat(revenue.total),
        todayOrders: parseInt(todayOrders.count),
        todayRevenue: parseFloat(todayOrders.revenue),
        recentSignups: parseInt(recentSignups.count),
        planStats,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════
// TENANTS (STORES) MANAGEMENT
// ══════════════════════════════════════════

// ═══ GET /api/admin/tenants ═══
router.get('/tenants', requirePlatformAdmin, async (req, res) => {
  try {
    const { search, status, plan, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      where += ` AND (t.name ILIKE $${paramIndex} OR t.slug ILIKE $${paramIndex} OR t.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (status) {
      where += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (plan) {
      where += ` AND t.plan = $${paramIndex}`;
      params.push(plan);
      paramIndex++;
    }

    const [countResult] = await query<any>(`SELECT COUNT(*) as count FROM tenants t ${where}`, params);

    const tenants = await query<any>(`
      SELECT t.*,
        (SELECT COUNT(*) FROM products WHERE tenant_id = t.id) as products_count,
        (SELECT COUNT(*) FROM orders WHERE tenant_id = t.id) as orders_count,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE tenant_id = t.id AND status != 'cancelled') as revenue,
        (SELECT name FROM merchants WHERE tenant_id = t.id AND role = 'owner' LIMIT 1) as owner_name,
        (SELECT email FROM merchants WHERE tenant_id = t.id AND role = 'owner' LIMIT 1) as owner_email
      FROM tenants t
      ${where}
      ORDER BY t.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, parseInt(limit as string), offset]);

    res.json({
      success: true,
      data: tenants,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: parseInt(countResult.count),
        totalPages: Math.ceil(parseInt(countResult.count) / parseInt(limit as string)),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ GET /api/admin/tenants/:id ═══
router.get('/tenants/:id', requirePlatformAdmin, async (req, res) => {
  try {
    const tenant = await queryOne<any>(`
      SELECT t.*,
        (SELECT COUNT(*) FROM products WHERE tenant_id = t.id) as products_count,
        (SELECT COUNT(*) FROM orders WHERE tenant_id = t.id) as orders_count,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE tenant_id = t.id AND status != 'cancelled') as revenue,
        (SELECT COUNT(*) FROM customers WHERE tenant_id = t.id) as customers_count
      FROM tenants t WHERE t.id = $1
    `, [req.params.id]);

    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const merchants = await query<any>(
      `SELECT id, name, email, phone, role, status, last_login_at, created_at FROM merchants WHERE tenant_id = $1 ORDER BY role, created_at`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...tenant, merchants } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ PUT /api/admin/tenants/:id/status ═══
router.put('/tenants/:id/status', requirePlatformAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended', 'trial'].includes(status)) {
      return res.status(400).json({ success: false, error: 'حالة غير صالحة' });
    }

    const tenant = await queryOne<any>(
      'UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );

    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    res.json({ success: true, data: tenant });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ PUT /api/admin/tenants/:id/plan ═══
router.put('/tenants/:id/plan', requirePlatformAdmin, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!['basic', 'growth', 'pro'].includes(plan)) {
      return res.status(400).json({ success: false, error: 'باقة غير صالحة' });
    }

    const tenant = await queryOne<any>(
      'UPDATE tenants SET plan = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [plan, req.params.id]
    );

    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    res.json({ success: true, data: tenant });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ DELETE /api/admin/tenants/:id ═══
router.delete('/tenants/:id', requirePlatformAdmin, async (req, res) => {
  try {
    // This cascades to merchants, products, orders, etc.
    const tenant = await queryOne<any>('DELETE FROM tenants WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });
    res.json({ success: true, data: { message: `تم حذف المتجر: ${tenant.name}` } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════
// MERCHANTS MANAGEMENT
// ══════════════════════════════════════════

// ═══ GET /api/admin/merchants ═══
router.get('/merchants', requirePlatformAdmin, async (req, res) => {
  try {
    const { search, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      where += ` AND (m.name ILIKE $${paramIndex} OR m.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const [countResult] = await query<any>(`SELECT COUNT(*) as count FROM merchants m ${where}`, params);

    const merchants = await query<any>(`
      SELECT m.id, m.name, m.email, m.phone, m.role, m.status, m.last_login_at, m.created_at,
        t.name as tenant_name, t.slug as tenant_slug, t.plan as tenant_plan, t.status as tenant_status
      FROM merchants m
      LEFT JOIN tenants t ON m.tenant_id = t.id
      ${where}
      ORDER BY m.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, parseInt(limit as string), offset]);

    res.json({
      success: true,
      data: merchants,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: parseInt(countResult.count),
        totalPages: Math.ceil(parseInt(countResult.count) / parseInt(limit as string)),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
