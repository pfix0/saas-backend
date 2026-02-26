/**
 * ساس — Customer Account API (Storefront — public)
 * محادثة ٧: حساب المستهلك
 *
 * OTP-based auth — في الإصدار الحالي OTP = آخر ٤ أرقام من الجوال (للتطوير)
 * بوابة SMS تُضاف لاحقاً
 */

import { Router } from 'express';
import { query, queryOne, insert } from '../config/database.js';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'saas-dev-secret';

// Simple middleware to extract customer from token
async function requireCustomer(req: any, res: any, next: any) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'يرجى تسجيل الدخول' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.type !== 'customer') {
      return res.status(401).json({ success: false, error: 'توكن غير صالح' });
    }
    req.customerId = decoded.customerId;
    req.tenantId = decoded.tenantId;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'انتهت صلاحية الجلسة' });
  }
}

// ═══════════════════════════════════════
// POST /api/store/:slug/account/send-otp
// إرسال OTP (حالياً: آخر ٤ أرقام)
// ═══════════════════════════════════════
router.post('/:slug/account/send-otp', async (req, res) => {
  try {
    const tenant = await queryOne(`SELECT id FROM tenants WHERE slug = $1 AND status != 'suspended'`, [req.params.slug]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const { phone } = req.body;
    if (!phone || phone.length < 8) {
      return res.status(400).json({ success: false, error: 'رقم الجوال مطلوب (٨ أرقام)' });
    }

    // Find or create customer
    let customer = await queryOne(
      'SELECT id, name, phone FROM customers WHERE tenant_id = $1 AND phone = $2',
      [tenant.id, phone]
    );

    if (!customer) {
      customer = await insert('customers', {
        tenant_id: tenant.id,
        phone,
        name: 'عميل جديد',
      });
    }

    // In production: send SMS with real OTP
    // For now: OTP = last 4 digits of phone
    const otp = phone.slice(-4);
    console.log(`📱 OTP for ${phone}: ${otp}`);

    res.json({
      success: true,
      message: 'تم إرسال رمز التحقق',
      // Remove in production:
      dev_otp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// POST /api/store/:slug/account/verify-otp
// التحقق من OTP → JWT token
// ═══════════════════════════════════════
router.post('/:slug/account/verify-otp', async (req, res) => {
  try {
    const tenant = await queryOne(`SELECT id, name FROM tenants WHERE slug = $1 AND status != 'suspended'`, [req.params.slug]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ success: false, error: 'رقم الجوال ورمز التحقق مطلوبين' });
    }

    // Verify OTP (dev: last 4 digits)
    const expectedOtp = phone.slice(-4);
    if (otp !== expectedOtp) {
      return res.status(400).json({ success: false, error: 'رمز التحقق غير صحيح' });
    }

    const customer = await queryOne(
      'SELECT id, name, phone, email FROM customers WHERE tenant_id = $1 AND phone = $2 AND status = $3',
      [tenant.id, phone, 'active']
    );
    if (!customer) {
      return res.status(404).json({ success: false, error: 'الحساب غير موجود أو محظور' });
    }

    // Generate JWT
    const token = jwt.sign(
      { type: 'customer', customerId: customer.id, tenantId: tenant.id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      data: {
        token,
        customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/store/:slug/account/me — بياناتي
// ═══════════════════════════════════════
router.get('/:slug/account/me', requireCustomer, async (req: any, res) => {
  try {
    const customer = await queryOne(
      'SELECT id, name, phone, email, orders_count, total_spent, created_at FROM customers WHERE id = $1 AND tenant_id = $2',
      [req.customerId, req.tenantId]
    );
    if (!customer) return res.status(404).json({ success: false, error: 'الحساب غير موجود' });

    res.json({ success: true, data: customer });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/store/:slug/account/me — تحديث بياناتي
// ═══════════════════════════════════════
router.put('/:slug/account/me', requireCustomer, async (req: any, res) => {
  try {
    const { name, email } = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (name) { updates.push(`name = $${pi++}`); params.push(name); }
    if (email !== undefined) { updates.push(`email = $${pi++}`); params.push(email || null); }

    if (updates.length === 0) return res.status(400).json({ success: false, error: 'لا توجد بيانات' });

    updates.push('updated_at = NOW()');
    params.push(req.customerId);

    await query(`UPDATE customers SET ${updates.join(', ')} WHERE id = $${pi}`, params);
    res.json({ success: true, message: 'تم تحديث البيانات' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/store/:slug/account/orders — طلباتي
// ═══════════════════════════════════════
router.get('/:slug/account/orders', requireCustomer, async (req: any, res) => {
  try {
    const { page = '1', limit = '10' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 50);
    const offset = (pageNum - 1) * limitNum;

    const [orders, countRes] = await Promise.all([
      query(
        `SELECT o.id, o.order_number, o.status, o.total, o.payment_status, o.payment_method,
                o.shipping_method, o.created_at,
                (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) as items_count
         FROM orders o WHERE o.customer_id = $1 AND o.tenant_id = $2
         ORDER BY o.created_at DESC LIMIT $3 OFFSET $4`,
        [req.customerId, req.tenantId, limitNum, offset]
      ),
      queryOne('SELECT COUNT(*)::int as total FROM orders WHERE customer_id = $1 AND tenant_id = $2', [req.customerId, req.tenantId]),
    ]);

    res.json({
      success: true, data: orders,
      pagination: { page: pageNum, limit: limitNum, total: countRes?.total || 0, totalPages: Math.ceil((countRes?.total || 0) / limitNum) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/store/:slug/account/orders/:id — تفاصيل طلب
// ═══════════════════════════════════════
router.get('/:slug/account/orders/:orderId', requireCustomer, async (req: any, res) => {
  try {
    const order = await queryOne(
      `SELECT o.* FROM orders o WHERE o.id = $1 AND o.customer_id = $2 AND o.tenant_id = $3`,
      [req.params.orderId, req.customerId, req.tenantId]
    );
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

    if (typeof order.shipping_address === 'string') {
      try { order.shipping_address = JSON.parse(order.shipping_address); } catch {}
    }

    const [items, statusHistory] = await Promise.all([
      query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at', [order.id]),
      query('SELECT id, status, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC', [order.id]),
    ]);

    res.json({ success: true, data: { ...order, items, status_history: statusHistory } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/store/:slug/account/addresses — عناويني
// ═══════════════════════════════════════
router.get('/:slug/account/addresses', requireCustomer, async (req: any, res) => {
  try {
    const addresses = await query(
      'SELECT * FROM addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC',
      [req.customerId]
    );
    res.json({ success: true, data: addresses });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// POST /api/store/:slug/account/addresses — إضافة عنوان
// ═══════════════════════════════════════
router.post('/:slug/account/addresses', requireCustomer, async (req: any, res) => {
  try {
    const { label, city, area, street, building, floor_number, apartment, notes, is_default } = req.body;
    if (!city || !area) return res.status(400).json({ success: false, error: 'المدينة والمنطقة مطلوبين' });

    // If setting as default, unset others
    if (is_default) {
      await query('UPDATE addresses SET is_default = false WHERE customer_id = $1', [req.customerId]);
    }

    const address = await insert('addresses', {
      customer_id: req.customerId,
      label: label || 'المنزل',
      name: req.body.name || null,
      phone: req.body.phone || null,
      city, area,
      street: street || null,
      building: building || null,
      floor_number: floor_number || null,
      apartment: apartment || null,
      notes: notes || null,
      is_default: is_default || false,
    });

    res.status(201).json({ success: true, data: address });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// DELETE /api/store/:slug/account/addresses/:id
// ═══════════════════════════════════════
router.delete('/:slug/account/addresses/:addrId', requireCustomer, async (req: any, res) => {
  try {
    const addr = await queryOne('SELECT id FROM addresses WHERE id = $1 AND customer_id = $2', [req.params.addrId, req.customerId]);
    if (!addr) return res.status(404).json({ success: false, error: 'العنوان غير موجود' });

    await query('DELETE FROM addresses WHERE id = $1', [req.params.addrId]);
    res.json({ success: true, message: 'تم حذف العنوان' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
