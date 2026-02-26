/**
 * ساس — Platform Admin Routes
 * منظومة إدارة المنصة الكاملة
 * 
 * الأدوار:
 * founder    — مؤسس: كل شي + إعدادات المنصة + إدارة الطاقم
 * director   — مدير: المتاجر + التجار + توزيع صلاحيات
 * supervisor — مشرف: مراقبة + إحصائيات (بدون حذف)
 * support    — دعم فني: بيانات المتاجر (قراءة) + التذاكر
 * accountant — محاسب: المالية + الإيرادات
 * employee   — موظف: صلاحيات محدودة
 */

import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, queryOne, insert } from '../config/database.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ═══ Types ═══
type PlatformRole = 'founder' | 'director' | 'supervisor' | 'support' | 'accountant' | 'employee';

interface AdminPayload {
  adminId: string;
  email: string;
  role: PlatformRole;
  type: 'platform_admin';
}

// ═══ Ensure tables ═══
async function ensureTables() {
  // Drop old table with incompatible constraints if it exists
  await query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'platform_admins_role_check' 
        AND table_name = 'platform_admins'
      ) THEN
        ALTER TABLE platform_admins DROP CONSTRAINT platform_admins_role_check;
      END IF;
    END $$;
  `).catch(() => {});

  await query(`
    CREATE TABLE IF NOT EXISTS platform_admins (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name          VARCHAR(255) NOT NULL,
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role          VARCHAR(20) DEFAULT 'employee',
      permissions   JSONB DEFAULT '[]',
      status        VARCHAR(20) DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
      last_login_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Migrate old role values
  await query(`UPDATE platform_admins SET role = 'founder' WHERE role = 'super_admin'`).catch(() => {});
  await query(`UPDATE platform_admins SET role = 'director' WHERE role = 'admin'`).catch(() => {});

  // Add role constraint with new values
  await query(`
    DO $$ BEGIN
      ALTER TABLE platform_admins ADD CONSTRAINT platform_admins_role_check 
        CHECK (role IN ('founder', 'director', 'supervisor', 'support', 'accountant', 'employee'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `).catch(() => {});

  // Add permissions column if missing
  await query(`
    ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'
  `).catch(() => {});
}

ensureTables().catch(console.error);

// ═══ Middleware ═══
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

function requireRoles(...roles: PlatformRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const admin = (req as any).admin as AdminPayload;
    if (!admin) return res.status(401).json({ success: false, error: 'غير مصرح' });
    // founder has access to everything
    if (admin.role === 'founder') return next();
    if (!roles.includes(admin.role)) {
      return res.status(403).json({ success: false, error: 'ليس لديك صلاحية لهذا الإجراء' });
    }
    next();
  };
}

function generateAdminTokens(payload: AdminPayload) {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
  const refreshToken = jwt.sign({ ...payload, refreshType: 'admin_refresh' }, JWT_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════

// POST /api/admin/auth/setup — أول مؤسس (مرة واحدة)
router.post('/auth/setup', async (req, res) => {
  try {
    const existing = await queryOne<any>('SELECT id FROM platform_admins LIMIT 1');
    if (existing) return res.status(403).json({ success: false, error: 'تم إعداد المنصة مسبقاً' });

    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await insert('platform_admins', {
      name, email, password_hash: passwordHash, role: 'founder', status: 'active',
      permissions: JSON.stringify(['*']),
    });

    const tokens = generateAdminTokens({ adminId: admin.id, email: admin.email, role: 'founder', type: 'platform_admin' });
    res.status(201).json({ success: true, data: { admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role }, tokens } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'البريد وكلمة المرور مطلوبان' });

    const admin = await queryOne<any>('SELECT * FROM platform_admins WHERE email = $1 AND status = $2', [email, 'active']);
    if (!admin) return res.status(401).json({ success: false, error: 'بيانات الدخول غير صحيحة' });

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'بيانات الدخول غير صحيحة' });

    await query('UPDATE platform_admins SET last_login_at = NOW() WHERE id = $1', [admin.id]);

    const tokens = generateAdminTokens({ adminId: admin.id, email: admin.email, role: admin.role, type: 'platform_admin' });
    res.json({
      success: true,
      data: {
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, permissions: admin.permissions },
        tokens,
      },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/auth/me
router.get('/auth/me', requirePlatformAdmin, async (req, res) => {
  try {
    const { adminId } = (req as any).admin;
    const admin = await queryOne<any>(
      'SELECT id, name, email, role, permissions, status, last_login_at, created_at FROM platform_admins WHERE id = $1',
      [adminId]
    );
    if (!admin) return res.status(404).json({ success: false, error: 'الحساب غير موجود' });
    res.json({ success: true, data: { admin } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════
// STATS
// ══════════════════════════════════════════

// GET /api/admin/stats — كل الأدوار تشوف الإحصائيات
router.get('/stats', requirePlatformAdmin, async (req, res) => {
  try {
    const role = ((req as any).admin as AdminPayload).role;

    const [tenants] = await query<any>('SELECT COUNT(*) as count FROM tenants');
    const [merchants] = await query<any>('SELECT COUNT(*) as count FROM merchants');
    const [products] = await query<any>('SELECT COUNT(*) as count FROM products');
    const [orders] = await query<any>('SELECT COUNT(*) as count FROM orders');
    const [revenue] = await query<any>(`SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status != 'cancelled'`);

    const today = new Date().toISOString().split('T')[0];
    const [todayOrders] = await query<any>(
      `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue FROM orders WHERE created_at::date = $1 AND status != 'cancelled'`, [today]
    );
    const [recentSignups] = await query<any>(`SELECT COUNT(*) as count FROM tenants WHERE created_at >= NOW() - INTERVAL '7 days'`);
    const planStats = await query<any>(`SELECT plan, status, COUNT(*) as count FROM tenants GROUP BY plan, status ORDER BY plan`);

    // Financial data — only for accountant, director, founder
    let financialData = null;
    if (['founder', 'director', 'accountant'].includes(role)) {
      const monthlyRevenue = await query<any>(`
        SELECT DATE_TRUNC('month', created_at) as month, COALESCE(SUM(total), 0) as revenue, COUNT(*) as orders
        FROM orders WHERE status != 'cancelled' AND created_at >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', created_at) ORDER BY month DESC
      `);
      financialData = { monthlyRevenue };
    }

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
        financialData,
      },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════
// TENANTS
// ══════════════════════════════════════════

// GET /api/admin/tenants
router.get('/tenants', requirePlatformAdmin, async (req, res) => {
  try {
    const { search, status, plan, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let pi = 1;

    if (search) { where += ` AND (t.name ILIKE $${pi} OR t.slug ILIKE $${pi} OR t.email ILIKE $${pi})`; params.push(`%${search}%`); pi++; }
    if (status) { where += ` AND t.status = $${pi}`; params.push(status); pi++; }
    if (plan) { where += ` AND t.plan = $${pi}`; params.push(plan); pi++; }

    const [countResult] = await query<any>(`SELECT COUNT(*) as count FROM tenants t ${where}`, params);

    const tenants = await query<any>(`
      SELECT t.*,
        (SELECT COUNT(*) FROM products WHERE tenant_id = t.id) as products_count,
        (SELECT COUNT(*) FROM orders WHERE tenant_id = t.id) as orders_count,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE tenant_id = t.id AND status != 'cancelled') as revenue,
        (SELECT name FROM merchants WHERE tenant_id = t.id AND role = 'owner' LIMIT 1) as owner_name,
        (SELECT email FROM merchants WHERE tenant_id = t.id AND role = 'owner' LIMIT 1) as owner_email
      FROM tenants t ${where}
      ORDER BY t.created_at DESC
      LIMIT $${pi} OFFSET $${pi + 1}
    `, [...params, parseInt(limit as string), offset]);

    res.json({
      success: true, data: tenants,
      pagination: { page: parseInt(page as string), limit: parseInt(limit as string), total: parseInt(countResult.count), totalPages: Math.ceil(parseInt(countResult.count) / parseInt(limit as string)) },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/tenants/:id
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
      `SELECT id, name, email, phone, role, status, last_login_at, created_at FROM merchants WHERE tenant_id = $1 ORDER BY role, created_at`, [req.params.id]
    );
    res.json({ success: true, data: { ...tenant, merchants } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/admin/tenants/:id/status — founder, director
router.put('/tenants/:id/status', requirePlatformAdmin, requireRoles('director'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended', 'trial'].includes(status)) return res.status(400).json({ success: false, error: 'حالة غير صالحة' });
    const tenant = await queryOne<any>('UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, req.params.id]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });
    res.json({ success: true, data: tenant });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/admin/tenants/:id/plan — founder, director
router.put('/tenants/:id/plan', requirePlatformAdmin, requireRoles('director'), async (req, res) => {
  try {
    const { plan } = req.body;
    if (!['basic', 'growth', 'pro'].includes(plan)) return res.status(400).json({ success: false, error: 'باقة غير صالحة' });
    const tenant = await queryOne<any>('UPDATE tenants SET plan = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [plan, req.params.id]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });
    res.json({ success: true, data: tenant });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/admin/tenants/:id — founder only
router.delete('/tenants/:id', requirePlatformAdmin, requireRoles('founder' as any), async (req, res) => {
  try {
    const tenant = await queryOne<any>('DELETE FROM tenants WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });
    res.json({ success: true, data: { message: `تم حذف المتجر: ${tenant.name}` } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════
// MERCHANTS
// ══════════════════════════════════════════

router.get('/merchants', requirePlatformAdmin, async (req, res) => {
  try {
    const { search, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    let where = 'WHERE 1=1'; const params: any[] = []; let pi = 1;
    if (search) { where += ` AND (m.name ILIKE $${pi} OR m.email ILIKE $${pi})`; params.push(`%${search}%`); pi++; }

    const [countResult] = await query<any>(`SELECT COUNT(*) as count FROM merchants m ${where}`, params);
    const merchants = await query<any>(`
      SELECT m.id, m.name, m.email, m.phone, m.role, m.status, m.last_login_at, m.created_at,
        t.name as tenant_name, t.slug as tenant_slug, t.plan as tenant_plan, t.status as tenant_status
      FROM merchants m LEFT JOIN tenants t ON m.tenant_id = t.id ${where}
      ORDER BY m.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}
    `, [...params, parseInt(limit as string), offset]);

    res.json({
      success: true, data: merchants,
      pagination: { page: parseInt(page as string), limit: parseInt(limit as string), total: parseInt(countResult.count), totalPages: Math.ceil(parseInt(countResult.count) / parseInt(limit as string)) },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════
// STAFF MANAGEMENT — founder, director
// ══════════════════════════════════════════

// GET /api/admin/staff
router.get('/staff', requirePlatformAdmin, requireRoles('director'), async (req, res) => {
  try {
    const staff = await query<any>(
      `SELECT id, name, email, role, permissions, status, last_login_at, created_at FROM platform_admins ORDER BY
        CASE role WHEN 'founder' THEN 1 WHEN 'director' THEN 2 WHEN 'supervisor' THEN 3 WHEN 'support' THEN 4 WHEN 'accountant' THEN 5 ELSE 6 END, created_at`
    );
    res.json({ success: true, data: staff });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/staff — إضافة عضو طاقم
router.post('/staff', requirePlatformAdmin, requireRoles('director'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });

    const validRoles: PlatformRole[] = ['director', 'supervisor', 'support', 'accountant', 'employee'];
    const adminRole = ((req as any).admin as AdminPayload).role;
    
    // Only founders can create directors
    if (role === 'director' && adminRole !== 'founder') {
      return res.status(403).json({ success: false, error: 'فقط المؤسس يمكنه إضافة مدير' });
    }
    // No one can create founders via API
    if (role === 'founder') {
      return res.status(403).json({ success: false, error: 'لا يمكن إضافة مؤسس' });
    }
    if (!validRoles.includes(role)) return res.status(400).json({ success: false, error: 'دور غير صالح' });

    const existing = await queryOne<any>('SELECT id FROM platform_admins WHERE email = $1', [email]);
    if (existing) return res.status(409).json({ success: false, error: 'البريد مسجل مسبقاً' });

    const passwordHash = await bcrypt.hash(password, 12);
    const staff = await insert('platform_admins', { name, email, password_hash: passwordHash, role, status: 'active', permissions: JSON.stringify([]) });

    res.status(201).json({ success: true, data: { id: staff.id, name: staff.name, email: staff.email, role: staff.role } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/admin/staff/:id/role
router.put('/staff/:id/role', requirePlatformAdmin, requireRoles('director'), async (req, res) => {
  try {
    const { role } = req.body;
    if (role === 'founder') return res.status(403).json({ success: false, error: 'لا يمكن تعيين دور مؤسس' });
    const result = await queryOne<any>('UPDATE platform_admins SET role = $1, updated_at = NOW() WHERE id = $2 AND role != $3 RETURNING id, name, role', [role, req.params.id, 'founder']);
    if (!result) return res.status(404).json({ success: false, error: 'العضو غير موجود أو لا يمكن تعديله' });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/admin/staff/:id/status
router.put('/staff/:id/status', requirePlatformAdmin, requireRoles('director'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) return res.status(400).json({ success: false, error: 'حالة غير صالحة' });
    const result = await queryOne<any>('UPDATE platform_admins SET status = $1, updated_at = NOW() WHERE id = $2 AND role != $3 RETURNING id, name, status', [status, req.params.id, 'founder']);
    if (!result) return res.status(404).json({ success: false, error: 'العضو غير موجود أو لا يمكن تعديله' });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/admin/staff/:id — founders only
router.delete('/staff/:id', requirePlatformAdmin, requireRoles('founder' as any), async (req, res) => {
  try {
    const result = await queryOne<any>('DELETE FROM platform_admins WHERE id = $1 AND role != $2 RETURNING id, name', [req.params.id, 'founder']);
    if (!result) return res.status(404).json({ success: false, error: 'لا يمكن حذف هذا العضو' });
    res.json({ success: true, data: { message: `تم حذف: ${result.name}` } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════
// IMPERSONATION — الدخول كتاجر (support, supervisor, director, founder)
// ══════════════════════════════════════════

// POST /api/admin/impersonate/:merchantId
router.post('/impersonate/:merchantId', requirePlatformAdmin, requireRoles('support', 'supervisor', 'director'), async (req, res) => {
  try {
    const admin = (req as any).admin as AdminPayload;
    const merchantId = req.params.merchantId;

    // Fetch merchant + tenant
    const merchant = await queryOne<any>(`
      SELECT m.id, m.name, m.email, m.role, m.tenant_id,
        t.name as tenant_name, t.slug as tenant_slug
      FROM merchants m
      JOIN tenants t ON m.tenant_id = t.id
      WHERE m.id = $1
    `, [merchantId]);

    if (!merchant) {
      return res.status(404).json({ success: false, error: 'التاجر غير موجود' });
    }

    // Generate merchant token with impersonation flag
    const JWT_SECRET_LOCAL = process.env.JWT_SECRET || 'dev-secret-change-me';
    const impersonationToken = jwt.sign({
      merchantId: merchant.id,
      tenantId: merchant.tenant_id,
      role: merchant.role,
      email: merchant.email,
      // Impersonation metadata
      impersonatedBy: admin.adminId,
      impersonatorRole: admin.role,
      impersonatorEmail: admin.email,
      isImpersonation: true,
    }, JWT_SECRET_LOCAL, { expiresIn: '2h' });

    // Log impersonation
    console.log(`🔑 IMPERSONATION: ${admin.email} (${admin.role}) → ${merchant.email} (${merchant.tenant_name})`);

    res.json({
      success: true,
      data: {
        merchant: {
          id: merchant.id,
          name: merchant.name,
          email: merchant.email,
          role: merchant.role,
        },
        tenant: {
          id: merchant.tenant_id,
          name: merchant.tenant_name,
          slug: merchant.tenant_slug,
        },
        token: impersonationToken,
        impersonatedBy: {
          id: admin.adminId,
          email: admin.email,
          role: admin.role,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/tenants/:id/merchants — جلب تجار متجر معين (للدعم)
router.get('/tenants/:id/merchants', requirePlatformAdmin, async (req, res) => {
  try {
    const merchants = await query<any>(
      `SELECT id, name, email, phone, role, status, last_login_at, created_at
       FROM merchants WHERE tenant_id = $1 ORDER BY role, created_at`,
      [req.params.id]
    );
    res.json({ success: true, data: merchants });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
