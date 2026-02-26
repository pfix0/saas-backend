/**
 * ساس — Store Settings API Routes
 * محادثة ٨: إعدادات المتجر
 */

import { Router } from 'express';
import { query, queryOne } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require auth
router.use(requireAuth);

// ═══════════════════════════════════════
// GET /api/settings — Get all settings
// ═══════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;

    // Get tenant info
    const tenant = await queryOne(
      `SELECT id, name, slug, logo_url, description, currency, language, 
              theme, theme_config, meta, status, created_at
       FROM tenants WHERE id = $1`,
      [tenantId]
    );

    if (!tenant) {
      return res.status(404).json({ success: false, error: 'المتجر غير موجود' });
    }

    // Get store settings
    const settings = await query(
      'SELECT key, value FROM store_settings WHERE tenant_id = $1',
      [tenantId]
    );

    const settingsMap: Record<string, any> = {};
    settings.forEach((s: any) => {
      try {
        settingsMap[s.key] = JSON.parse(s.value);
      } catch {
        settingsMap[s.key] = s.value;
      }
    });

    res.json({
      success: true,
      data: {
        store: tenant,
        settings: settingsMap,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/settings/store — Update store info
// ═══════════════════════════════════════
router.put('/store', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { name, description, logo_url, currency, language } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'اسم المتجر مطلوب (حرفين على الأقل)',
      });
    }

    const updated = await queryOne(
      `UPDATE tenants SET
        name = $1,
        description = $2,
        logo_url = $3,
        currency = $4,
        language = $5,
        updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, slug, logo_url, description, currency, language, theme, status`,
      [
        name.trim(),
        description || null,
        logo_url || null,
        currency || 'QAR',
        language || 'ar',
        tenantId,
      ]
    );

    res.json({
      success: true,
      data: updated,
      message: 'تم تحديث بيانات المتجر',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/settings/payment — Payment settings
// ═══════════════════════════════════════
router.put('/payment', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { 
      cod_enabled = true,
      bank_transfer_enabled = false,
      bank_name,
      bank_account_name,
      bank_iban,
      skypay_enabled = false,
      skypay_merchant_id,
      sadad_enabled = false,
      sadad_merchant_id,
    } = req.body;

    const paymentSettings = {
      cod_enabled,
      bank_transfer_enabled,
      bank_name: bank_name || null,
      bank_account_name: bank_account_name || null,
      bank_iban: bank_iban || null,
      skypay_enabled,
      skypay_merchant_id: skypay_merchant_id || null,
      sadad_enabled,
      sadad_merchant_id: sadad_merchant_id || null,
    };

    await upsertSetting(tenantId, 'payment', JSON.stringify(paymentSettings));

    res.json({
      success: true,
      data: paymentSettings,
      message: 'تم تحديث إعدادات الدفع',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/settings/shipping — Shipping settings
// ═══════════════════════════════════════
router.put('/shipping', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      pickup_enabled = true,
      pickup_address,
      aramex_enabled = false,
      aramex_cost = 25,
      dhl_enabled = false,
      dhl_cost = 35,
      free_shipping_enabled = false,
      free_shipping_min = 200,
      delivery_notes,
    } = req.body;

    const shippingSettings = {
      pickup_enabled,
      pickup_address: pickup_address || null,
      aramex_enabled,
      aramex_cost: parseFloat(aramex_cost),
      dhl_enabled,
      dhl_cost: parseFloat(dhl_cost),
      free_shipping_enabled,
      free_shipping_min: parseFloat(free_shipping_min),
      delivery_notes: delivery_notes || null,
    };

    await upsertSetting(tenantId, 'shipping', JSON.stringify(shippingSettings));

    res.json({
      success: true,
      data: shippingSettings,
      message: 'تم تحديث إعدادات الشحن',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/settings/notifications — Notification settings
// ═══════════════════════════════════════
router.put('/notifications', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      email_new_order = true,
      email_order_status = true,
      email_low_stock = false,
      low_stock_threshold = 5,
      whatsapp_enabled = false,
      whatsapp_number,
    } = req.body;

    const notifSettings = {
      email_new_order,
      email_order_status,
      email_low_stock,
      low_stock_threshold: parseInt(low_stock_threshold),
      whatsapp_enabled,
      whatsapp_number: whatsapp_number || null,
    };

    await upsertSetting(tenantId, 'notifications', JSON.stringify(notifSettings));

    res.json({
      success: true,
      data: notifSettings,
      message: 'تم تحديث إعدادات الإشعارات',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/settings/social — Social links
// ═══════════════════════════════════════
router.put('/social', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { instagram, twitter, snapchat, tiktok, whatsapp, phone } = req.body;

    const socialSettings = {
      instagram: instagram || null,
      twitter: twitter || null,
      snapchat: snapchat || null,
      tiktok: tiktok || null,
      whatsapp: whatsapp || null,
      phone: phone || null,
    };

    await upsertSetting(tenantId, 'social', JSON.stringify(socialSettings));

    res.json({
      success: true,
      data: socialSettings,
      message: 'تم تحديث روابط التواصل',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// PUT /api/settings/checkout — Checkout settings
// ═══════════════════════════════════════
router.put('/checkout', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      guest_checkout = true,
      require_address = true,
      require_email = false,
      order_prefix = 'SAS',
      thank_you_message,
      terms_url,
    } = req.body;

    const checkoutSettings = {
      guest_checkout,
      require_address,
      require_email,
      order_prefix: order_prefix || 'SAS',
      thank_you_message: thank_you_message || null,
      terms_url: terms_url || null,
    };

    await upsertSetting(tenantId, 'checkout', JSON.stringify(checkoutSettings));

    res.json({
      success: true,
      data: checkoutSettings,
      message: 'تم تحديث إعدادات الطلب',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ Helper: Upsert setting ═══
async function upsertSetting(tenantId: string, key: string, value: string) {
  const existing = await queryOne(
    'SELECT id FROM store_settings WHERE tenant_id = $1 AND key = $2',
    [tenantId, key]
  );

  if (existing) {
    await query(
      'UPDATE store_settings SET value = $1, updated_at = NOW() WHERE tenant_id = $2 AND key = $3',
      [value, tenantId, key]
    );
  } else {
    await query(
      'INSERT INTO store_settings (tenant_id, key, value) VALUES ($1, $2, $3)',
      [tenantId, key, value]
    );
  }
}

export default router;
