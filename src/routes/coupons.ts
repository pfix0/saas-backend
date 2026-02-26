/**
 * ساس — Coupons API Routes
 * محادثة ٨: إدارة الكوبونات
 */

import { Router } from 'express';
import { query, queryOne, insert } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require auth
router.use(requireAuth);

// ═══════════════════════════════════════
// GET /api/coupons/stats — Coupon statistics
// ═══════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const tenantId = req.tenantId;

    // Total coupons
    const totalResult = await queryOne(
      'SELECT COUNT(*) as count FROM coupons WHERE tenant_id = $1',
      [tenantId]
    );

    // Active coupons (not expired, not exceeded max uses)
    const activeResult = await queryOne(
      `SELECT COUNT(*) as count FROM coupons 
       WHERE tenant_id = $1 AND is_active = true 
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (max_uses IS NULL OR used_count < max_uses)`,
      [tenantId]
    );

    // Total discount given
    const discountResult = await queryOne(
      `SELECT COALESCE(SUM(o.discount_amount), 0) as total_discount
       FROM orders o WHERE o.tenant_id = $1 AND o.coupon_code IS NOT NULL`,
      [tenantId]
    );

    // Total coupon uses
    const usesResult = await queryOne(
      'SELECT COALESCE(SUM(used_count), 0) as total_uses FROM coupons WHERE tenant_id = $1',
      [tenantId]
    );

    // Most used coupon
    const topCoupon = await queryOne(
      `SELECT code, used_count FROM coupons 
       WHERE tenant_id = $1 AND used_count > 0
       ORDER BY used_count DESC LIMIT 1`,
      [tenantId]
    );

    res.json({
      success: true,
      data: {
        total: parseInt(totalResult.count),
        active: parseInt(activeResult.count),
        total_discount: parseFloat(discountResult.total_discount),
        total_uses: parseInt(usesResult.total_uses),
        top_coupon: topCoupon || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/coupons — List all coupons
// ═══════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { search, status, sort = 'newest', page = '1', limit = '20' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 50);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE c.tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIdx = 2;

    // Search
    if (search) {
      where += ` AND (c.code ILIKE $${paramIdx} OR c.description ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    // Status filter
    if (status === 'active') {
      where += ` AND c.is_active = true AND (c.expires_at IS NULL OR c.expires_at > NOW()) AND (c.max_uses IS NULL OR c.used_count < c.max_uses)`;
    } else if (status === 'expired') {
      where += ` AND (c.expires_at IS NOT NULL AND c.expires_at <= NOW())`;
    } else if (status === 'used_up') {
      where += ` AND (c.max_uses IS NOT NULL AND c.used_count >= c.max_uses)`;
    } else if (status === 'inactive') {
      where += ` AND c.is_active = false`;
    }

    // Sort
    let orderBy = 'ORDER BY c.created_at DESC';
    if (sort === 'oldest') orderBy = 'ORDER BY c.created_at ASC';
    if (sort === 'most_used') orderBy = 'ORDER BY c.used_count DESC';
    if (sort === 'code') orderBy = 'ORDER BY c.code ASC';
    if (sort === 'expiring_soon') orderBy = 'ORDER BY c.expires_at ASC NULLS LAST';

    // Count
    const countResult = await queryOne(
      `SELECT COUNT(*) as count FROM coupons c ${where}`,
      params
    );

    // Fetch
    const coupons = await query(
      `SELECT c.*, 
        CASE 
          WHEN c.is_active = false THEN 'inactive'
          WHEN c.expires_at IS NOT NULL AND c.expires_at <= NOW() THEN 'expired'
          WHEN c.max_uses IS NOT NULL AND c.used_count >= c.max_uses THEN 'used_up'
          WHEN c.starts_at IS NOT NULL AND c.starts_at > NOW() THEN 'scheduled'
          ELSE 'active'
        END as computed_status
       FROM coupons c ${where} ${orderBy}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limitNum, offset]
    );

    res.json({
      success: true,
      data: coupons,
      pagination: {
        total: parseInt(countResult.count),
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(parseInt(countResult.count) / limitNum),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/coupons/:id — Single coupon
// ═══════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const coupon = await queryOne(
      `SELECT c.*,
        CASE 
          WHEN c.is_active = false THEN 'inactive'
          WHEN c.expires_at IS NOT NULL AND c.expires_at <= NOW() THEN 'expired'
          WHEN c.max_uses IS NOT NULL AND c.used_count >= c.max_uses THEN 'used_up'
          WHEN c.starts_at IS NOT NULL AND c.starts_at > NOW() THEN 'scheduled'
          ELSE 'active'
        END as computed_status
       FROM coupons c WHERE c.id = $1 AND c.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (!coupon) {
      return res.status(404).json({ success: false, error: 'الكوبون غير موجود' });
    }

    // Get usage history (orders that used this coupon)
    const orders = await query(
      `SELECT o.id, o.order_number, o.total, o.discount_amount, o.created_at,
              o.customer_name, o.customer_phone
       FROM orders o 
       WHERE o.tenant_id = $1 AND o.coupon_code = $2
       ORDER BY o.created_at DESC LIMIT 20`,
      [req.tenantId, coupon.code]
    );

    res.json({
      success: true,
      data: { ...coupon, orders },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// POST /api/coupons — Create coupon
// ═══════════════════════════════════════
router.post('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      code,
      type, // 'percentage' | 'fixed'
      value,
      description,
      min_order,
      max_discount,
      max_uses,
      starts_at,
      expires_at,
      is_active = true,
    } = req.body;

    // Validation
    if (!code || !type || value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'الكود والنوع والقيمة مطلوبة',
      });
    }

    if (!['percentage', 'fixed'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'نوع الكوبون يجب أن يكون percentage أو fixed',
      });
    }

    if (parseFloat(value) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'قيمة الخصم يجب أن تكون أكبر من صفر',
      });
    }

    if (type === 'percentage' && parseFloat(value) > 100) {
      return res.status(400).json({
        success: false,
        error: 'نسبة الخصم لا تتجاوز 100%',
      });
    }

    // Check unique code per tenant
    const existing = await queryOne(
      'SELECT id FROM coupons WHERE tenant_id = $1 AND LOWER(code) = LOWER($2)',
      [tenantId, code.trim()]
    );
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'كود الكوبون موجود مسبقاً',
      });
    }

    const coupon = await insert('coupons', {
      tenant_id: tenantId,
      code: code.trim().toUpperCase(),
      type,
      value: parseFloat(value),
      description: description || null,
      min_order: min_order ? parseFloat(min_order) : null,
      max_discount: max_discount ? parseFloat(max_discount) : null,
      max_uses: max_uses ? parseInt(max_uses) : null,
      used_count: 0,
      starts_at: starts_at || null,
      expires_at: expires_at || null,
      is_active,
    });

    res.status(201).json({
      success: true,
      data: coupon,
      message: 'تم إنشاء الكوبون بنجاح',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/coupons/:id — Update coupon
// ═══════════════════════════════════════
router.put('/:id', async (req, res) => {
  try {
    const coupon = await queryOne(
      'SELECT * FROM coupons WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );

    if (!coupon) {
      return res.status(404).json({ success: false, error: 'الكوبون غير موجود' });
    }

    const {
      code,
      type,
      value,
      description,
      min_order,
      max_discount,
      max_uses,
      starts_at,
      expires_at,
      is_active,
    } = req.body;

    // Check unique code if changed
    if (code && code.trim().toUpperCase() !== coupon.code) {
      const existing = await queryOne(
        'SELECT id FROM coupons WHERE tenant_id = $1 AND LOWER(code) = LOWER($2) AND id != $3',
        [req.tenantId, code.trim(), req.params.id]
      );
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'كود الكوبون موجود مسبقاً',
        });
      }
    }

    if (type && !['percentage', 'fixed'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'نوع الكوبون يجب أن يكون percentage أو fixed',
      });
    }

    const updatedType = type || coupon.type;
    const updatedValue = value !== undefined ? parseFloat(value) : parseFloat(coupon.value);

    if (updatedType === 'percentage' && updatedValue > 100) {
      return res.status(400).json({
        success: false,
        error: 'نسبة الخصم لا تتجاوز 100%',
      });
    }

    const updated = await queryOne(
      `UPDATE coupons SET
        code = $1,
        type = $2,
        value = $3,
        description = $4,
        min_order = $5,
        max_discount = $6,
        max_uses = $7,
        starts_at = $8,
        expires_at = $9,
        is_active = $10,
        updated_at = NOW()
       WHERE id = $11 AND tenant_id = $12
       RETURNING *`,
      [
        code ? code.trim().toUpperCase() : coupon.code,
        updatedType,
        updatedValue,
        description !== undefined ? description : coupon.description,
        min_order !== undefined ? (min_order ? parseFloat(min_order) : null) : coupon.min_order,
        max_discount !== undefined ? (max_discount ? parseFloat(max_discount) : null) : coupon.max_discount,
        max_uses !== undefined ? (max_uses ? parseInt(max_uses) : null) : coupon.max_uses,
        starts_at !== undefined ? (starts_at || null) : coupon.starts_at,
        expires_at !== undefined ? (expires_at || null) : coupon.expires_at,
        is_active !== undefined ? is_active : coupon.is_active,
        req.params.id,
        req.tenantId,
      ]
    );

    res.json({
      success: true,
      data: updated,
      message: 'تم تحديث الكوبون بنجاح',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// DELETE /api/coupons/:id — Delete coupon
// ═══════════════════════════════════════
router.delete('/:id', async (req, res) => {
  try {
    const coupon = await queryOne(
      'SELECT id, used_count FROM coupons WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );

    if (!coupon) {
      return res.status(404).json({ success: false, error: 'الكوبون غير موجود' });
    }

    // If used, soft-deactivate instead of delete
    if (parseInt(coupon.used_count) > 0) {
      await query(
        'UPDATE coupons SET is_active = false, updated_at = NOW() WHERE id = $1',
        [req.params.id]
      );
      return res.json({
        success: true,
        message: 'تم تعطيل الكوبون (لأنه مستخدم في طلبات سابقة)',
      });
    }

    await query('DELETE FROM coupons WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);

    res.json({
      success: true,
      message: 'تم حذف الكوبون بنجاح',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/coupons/:id/toggle — Toggle active
// ═══════════════════════════════════════
router.put('/:id/toggle', async (req, res) => {
  try {
    const coupon = await queryOne(
      'SELECT id, is_active FROM coupons WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );

    if (!coupon) {
      return res.status(404).json({ success: false, error: 'الكوبون غير موجود' });
    }

    const newStatus = !coupon.is_active;
    await query(
      'UPDATE coupons SET is_active = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, req.params.id]
    );

    res.json({
      success: true,
      data: { is_active: newStatus },
      message: newStatus ? 'تم تفعيل الكوبون' : 'تم تعطيل الكوبون',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
