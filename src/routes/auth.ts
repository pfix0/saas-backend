/**
 * ساس — Auth Routes
 * POST /api/auth/register
 * POST /api/auth/login
 * POST /api/auth/refresh
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, queryOne, insert } from '../config/database.js';
import { generateTokens, verifyRefreshToken } from '../middleware/auth.js';
import slugify from 'slugify';

const router = Router();

// ═══ Register merchant + create tenant ═══
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, storeName } = req.body;

    // Validation
    if (!name || !email || !password || !storeName) {
      return res.status(400).json({
        success: false,
        error: 'جميع الحقول مطلوبة: name, email, password, storeName',
      });
    }

    // Check if email exists
    const existing = await queryOne(
      'SELECT id FROM merchants WHERE email = $1',
      [email]
    );
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'البريد الإلكتروني مسجل مسبقاً',
      });
    }

    // Create slug for store
    const slug = slugify(storeName, { lower: true, strict: true });

    // Check if slug exists
    const slugExists = await queryOne(
      'SELECT id FROM tenants WHERE slug = $1',
      [slug]
    );
    if (slugExists) {
      return res.status(409).json({
        success: false,
        error: 'اسم المتجر محجوز — جرّب اسم ثاني',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create tenant (store)
    const tenant = await insert('tenants', {
      name: storeName,
      slug,
      currency: 'QAR',
      language: 'ar',
      country: 'QA',
      plan: 'basic',
      status: 'trial',
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
    });

    // Create merchant (owner)
    const merchant = await insert('merchants', {
      tenant_id: tenant.id,
      name,
      email,
      phone: phone || null,
      password_hash: passwordHash,
      role: 'owner',
      status: 'active',
    });

    // Create default pages
    const defaultPages = [
      { title: 'من نحن', slug: 'about', content: '' },
      { title: 'سياسة الاسترجاع', slug: 'refund-policy', content: '' },
      { title: 'الشروط والأحكام', slug: 'terms', content: '' },
    ];
    for (const page of defaultPages) {
      await insert('pages', { tenant_id: tenant.id, ...page, status: 'published' });
    }

    // Generate tokens
    const tokens = generateTokens({
      merchantId: merchant.id,
      tenantId: tenant.id,
      role: merchant.role,
      email: merchant.email,
    });

    res.status(201).json({
      success: true,
      data: {
        merchant: {
          id: merchant.id,
          name: merchant.name,
          email: merchant.email,
          role: merchant.role,
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          storeUrl: `${tenant.slug}.saas.qa`,
        },
        tokens,
      },
    });
  } catch (err: any) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ Login ═══
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'البريد الإلكتروني وكلمة المرور مطلوبان',
      });
    }

    // Find merchant with tenant info
    const merchant = await queryOne<any>(
      `SELECT m.*, t.name as tenant_name, t.slug as tenant_slug, t.plan, t.status as tenant_status
       FROM merchants m
       JOIN tenants t ON m.tenant_id = t.id
       WHERE m.email = $1 AND m.status = 'active'`,
      [email]
    );

    if (!merchant) {
      return res.status(401).json({
        success: false,
        error: 'بيانات الدخول غير صحيحة',
      });
    }

    // Verify password
    const valid = await bcrypt.compare(password, merchant.password_hash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        error: 'بيانات الدخول غير صحيحة',
      });
    }

    // Update last login
    await query(
      'UPDATE merchants SET last_login_at = NOW() WHERE id = $1',
      [merchant.id]
    );

    // Generate tokens
    const tokens = generateTokens({
      merchantId: merchant.id,
      tenantId: merchant.tenant_id,
      role: merchant.role,
      email: merchant.email,
    });

    res.json({
      success: true,
      data: {
        merchant: {
          id: merchant.id,
          name: merchant.name,
          email: merchant.email,
          role: merchant.role,
          avatar_url: merchant.avatar_url,
        },
        tenant: {
          id: merchant.tenant_id,
          name: merchant.tenant_name,
          slug: merchant.tenant_slug,
          plan: merchant.plan,
        },
        tokens,
      },
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ Refresh Token ═══
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Refresh token مطلوب' });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ success: false, error: 'Refresh token غير صالح' });
    }

    const tokens = generateTokens(payload);
    res.json({ success: true, data: { tokens } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
