/**
 * ساس — Store Public API (Storefront)
 * No auth required — these serve the public store
 */

import { Router } from 'express';
import { query, queryOne, insert } from '../config/database.js';

const router = Router();

// ═══════════════════════════════════════
// GET /api/store/:slug — Store info
// ═══════════════════════════════════════
router.get('/:slug', async (req, res) => {
  try {
    const tenant = await queryOne(
      `SELECT id, name, slug, logo_url, description, currency, language, theme, theme_config, meta, status
       FROM tenants WHERE slug = $1 AND status != 'suspended'`,
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const settings = await query('SELECT key, value FROM store_settings WHERE tenant_id = $1', [tenant.id]);
    const settingsMap: Record<string, any> = {};
    settings.forEach((s: any) => { settingsMap[s.key] = s.value; });

    res.json({ success: true, data: { ...tenant, settings: settingsMap } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/store/:slug/products
// ═══════════════════════════════════════
router.get('/:slug/products', async (req, res) => {
  try {
    const tenant = await queryOne(`SELECT id FROM tenants WHERE slug = $1 AND status != 'suspended'`, [req.params.slug]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const { page = '1', limit = '20', category, sort = 'created_at', search } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 60);
    const offset = (pageNum - 1) * limitNum;

    let where = `WHERE p.tenant_id = $1 AND p.status = 'active'`;
    const params: any[] = [tenant.id];
    let pi = 2;

    if (category) { where += ` AND c.slug = $${pi++}`; params.push(category); }
    if (search) { where += ` AND p.name ILIKE $${pi++}`; params.push(`%${search}%`); }

    const safeSorts: Record<string, string> = { created_at: 'p.created_at DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', popular: 'p.sales_count DESC' };
    const orderBy = safeSorts[sort as string] || 'p.created_at DESC';

    const products = await query(
      `SELECT p.id, p.name, p.slug, p.price, p.sale_price, p.quantity, p.is_featured,
       c.name as category_name, c.slug as category_slug,
       (SELECT url FROM product_images WHERE product_id = p.id AND is_main = true LIMIT 1) as image
       FROM products p LEFT JOIN categories c ON p.category_id = c.id
       ${where} ORDER BY ${orderBy} LIMIT $${pi++} OFFSET $${pi}`,
      [...params, limitNum, offset]
    );

    const total = await queryOne(`SELECT COUNT(*)::int as total FROM products p LEFT JOIN categories c ON p.category_id = c.id ${where}`, params);

    res.json({
      success: true, data: products,
      pagination: { page: pageNum, limit: limitNum, total: total?.total || 0, totalPages: Math.ceil((total?.total || 0) / limitNum) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/store/:slug/categories
// ═══════════════════════════════════════
router.get('/:slug/categories', async (req, res) => {
  try {
    const tenant = await queryOne(`SELECT id FROM tenants WHERE slug = $1 AND status != 'suspended'`, [req.params.slug]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const categories = await query(
      `SELECT id, name, slug, image_url, parent_id, sort_order
       FROM categories WHERE tenant_id = $1 AND status = 'active'
       ORDER BY sort_order, name`,
      [tenant.id]
    );
    res.json({ success: true, data: categories });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/store/:slug/products/:productSlug
// ═══════════════════════════════════════
router.get('/:slug/products/:productSlug', async (req, res) => {
  try {
    const tenant = await queryOne(`SELECT id FROM tenants WHERE slug = $1 AND status != 'suspended'`, [req.params.slug]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const product = await queryOne(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.slug = $1 AND p.tenant_id = $2 AND p.status = 'active'`,
      [req.params.productSlug, tenant.id]
    );
    if (!product) return res.status(404).json({ success: false, error: 'المنتج غير موجود' });

    await query('UPDATE products SET views_count = views_count + 1 WHERE id = $1', [product.id]);

    const [images, options, variants] = await Promise.all([
      query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order', [product.id]),
      query('SELECT * FROM product_options WHERE product_id = $1 ORDER BY sort_order', [product.id]),
      query(`SELECT * FROM product_variants WHERE product_id = $1 AND status = 'active'`, [product.id]),
    ]);

    res.json({ success: true, data: { ...product, images, options, variants } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/store/:slug/checkout-options
// طرق الدفع والشحن المتاحة
// ═══════════════════════════════════════
router.get('/:slug/checkout-options', async (req, res) => {
  try {
    const tenant = await queryOne(
      `SELECT id FROM tenants WHERE slug = $1 AND status != 'suspended'`,
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    // Get settings
    const settings = await query(
      'SELECT key, value FROM store_settings WHERE tenant_id = $1',
      [tenant.id]
    );
    const settingsMap: Record<string, any> = {};
    settings.forEach((s: any) => {
      try { settingsMap[s.key] = JSON.parse(s.value); } catch { settingsMap[s.key] = s.value; }
    });

    const payment = settingsMap.payment || {};
    const shipping = settingsMap.shipping || {};
    const checkout = settingsMap.checkout || {};

    // Build available payment methods
    const paymentMethods: any[] = [];
    if (payment.cod_enabled !== false) {
      paymentMethods.push({ key: 'cod', label: 'الدفع عند الاستلام', icon: 'payments' });
    }
    if (payment.bank_transfer_enabled) {
      paymentMethods.push({
        key: 'bank_transfer', label: 'تحويل بنكي', icon: 'account_balance',
        details: { bank_name: payment.bank_name, account_name: payment.bank_account_name, iban: payment.bank_iban },
      });
    }
    if (payment.skypay_enabled) {
      paymentMethods.push({ key: 'skypay', label: 'سكاي باي كاش', icon: 'credit_card' });
    }
    if (payment.sadad_enabled) {
      paymentMethods.push({ key: 'sadad', label: 'سداد', icon: 'credit_card' });
    }

    // Build available shipping methods
    const shippingMethods: any[] = [];
    if (shipping.pickup_enabled !== false) {
      shippingMethods.push({
        key: 'pickup', label: 'استلام من المحل', icon: 'store', cost: 0,
        address: shipping.pickup_address || null,
      });
    }
    if (shipping.aramex_enabled) {
      shippingMethods.push({
        key: 'aramex', label: 'أرامكس', icon: 'local_shipping',
        cost: shipping.aramex_cost || 25,
      });
    }
    if (shipping.dhl_enabled) {
      shippingMethods.push({
        key: 'dhl', label: 'DHL', icon: 'flight',
        cost: shipping.dhl_cost || 35,
      });
    }

    // Free shipping
    const freeShipping = shipping.free_shipping_enabled
      ? { enabled: true, min: shipping.free_shipping_min || 200 }
      : { enabled: false, min: 0 };

    res.json({
      success: true,
      data: {
        payment_methods: paymentMethods,
        shipping_methods: shippingMethods,
        free_shipping: freeShipping,
        checkout_settings: {
          guest_checkout: checkout.guest_checkout !== false,
          require_address: checkout.require_address !== false,
          require_email: checkout.require_email || false,
          delivery_notes: shipping.delivery_notes || null,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// POST /api/store/:slug/coupon/validate
// التحقق من كوبون الخصم
// ═══════════════════════════════════════
router.post('/:slug/coupon/validate', async (req, res) => {
  try {
    const tenant = await queryOne(`SELECT id FROM tenants WHERE slug = $1 AND status != 'suspended'`, [req.params.slug]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const { code, subtotal } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'كود الكوبون مطلوب' });

    const coupon = await queryOne(
      `SELECT * FROM coupons
       WHERE tenant_id = $1 AND UPPER(code) = UPPER($2) AND status = 'active'`,
      [tenant.id, code]
    );

    if (!coupon) {
      return res.status(404).json({ success: false, error: 'الكوبون غير صالح أو منتهي' });
    }

    // Check expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: 'الكوبون منتهي الصلاحية' });
    }

    // Check start date
    if (coupon.starts_at && new Date(coupon.starts_at) > new Date()) {
      return res.status(400).json({ success: false, error: 'الكوبون لم يبدأ بعد' });
    }

    // Check usage limit
    if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
      return res.status(400).json({ success: false, error: 'الكوبون استُنفد بالكامل' });
    }

    // Check minimum order
    const orderSubtotal = parseFloat(subtotal || '0');
    if (coupon.min_order && orderSubtotal < parseFloat(coupon.min_order)) {
      return res.status(400).json({
        success: false,
        error: `الحد الأدنى للطلب ${parseFloat(coupon.min_order)} ر.ق`,
      });
    }

    // Calculate discount
    let discount = 0;
    if (coupon.type === 'percentage') {
      discount = orderSubtotal * (parseFloat(coupon.value) / 100);
      if (coupon.max_discount) {
        discount = Math.min(discount, parseFloat(coupon.max_discount));
      }
    } else {
      discount = parseFloat(coupon.value);
    }

    discount = Math.min(discount, orderSubtotal);

    res.json({
      success: true,
      data: {
        code: coupon.code,
        type: coupon.type,
        value: parseFloat(coupon.value),
        discount: Math.round(discount * 100) / 100,
        description: coupon.type === 'percentage'
          ? `خصم ${coupon.value}%`
          : `خصم ${coupon.value} ر.ق`,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// POST /api/store/:slug/checkout
// إنشاء طلب جديد (بدون auth — الزبون ضيف أو مسجل)
// ═══════════════════════════════════════
router.post('/:slug/checkout', async (req, res) => {
  try {
    const tenant = await queryOne(
      `SELECT id, name, currency FROM tenants WHERE slug = $1 AND status != 'suspended'`,
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const { customer, address, items, coupon_code, shipping_method, customer_notes, payment_method } = req.body;

    // ═══ Validation ═══
    if (!customer?.name || !customer?.phone) {
      return res.status(400).json({ success: false, error: 'الاسم ورقم الجوال مطلوبين' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'السلة فارغة' });
    }
    if (!address?.city || !address?.area) {
      return res.status(400).json({ success: false, error: 'المدينة والمنطقة مطلوبين' });
    }

    // ═══ 1. Find or create customer ═══
    let existingCustomer = await queryOne(
      `SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2`,
      [tenant.id, customer.phone]
    );

    let customerId: string;
    if (existingCustomer) {
      customerId = existingCustomer.id;
      await query(
        `UPDATE customers SET name = COALESCE($1, name), email = COALESCE($2, email), updated_at = NOW() WHERE id = $3`,
        [customer.name, customer.email || null, customerId]
      );
    } else {
      const newCustomer = await insert('customers', {
        tenant_id: tenant.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email || null,
      });
      customerId = newCustomer.id;
    }

    // ═══ 2. Validate items & calculate subtotal ═══
    let subtotal = 0;
    const validatedItems: any[] = [];

    for (const item of items) {
      const product = await queryOne(
        `SELECT id, name, slug, price, sale_price, quantity, status
         FROM products WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
        [item.product_id, tenant.id]
      );

      if (!product) {
        return res.status(400).json({
          success: false,
          error: `المنتج "${item.name || item.product_id}" غير متوفر`,
        });
      }

      if (product.quantity !== null && product.quantity < item.quantity) {
        return res.status(400).json({
          success: false,
          error: `الكمية المطلوبة من "${product.name}" غير متوفرة (المتاح: ${product.quantity})`,
        });
      }

      const unitPrice = product.sale_price ? parseFloat(product.sale_price) : parseFloat(product.price);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;

      const img = await queryOne(
        `SELECT url FROM product_images WHERE product_id = $1 AND is_main = true LIMIT 1`,
        [product.id]
      );

      validatedItems.push({
        product_id: product.id,
        variant_id: item.variant_id || null,
        name: product.name,
        sku: item.sku || null,
        image_url: img?.url || null,
        options: item.options || {},
        price: unitPrice,
        quantity: item.quantity,
        total: lineTotal,
      });
    }

    // ═══ 3. Apply coupon ═══
    let discountAmount = 0;
    let appliedCouponCode: string | null = null;

    if (coupon_code) {
      const coupon = await queryOne(
        `SELECT * FROM coupons
         WHERE tenant_id = $1 AND UPPER(code) = UPPER($2) AND status = 'active'`,
        [tenant.id, coupon_code]
      );

      if (coupon) {
        const isValid =
          (!coupon.expires_at || new Date(coupon.expires_at) >= new Date()) &&
          (!coupon.starts_at || new Date(coupon.starts_at) <= new Date()) &&
          (!coupon.max_uses || coupon.used_count < coupon.max_uses) &&
          (!coupon.min_order || subtotal >= parseFloat(coupon.min_order));

        if (isValid) {
          if (coupon.type === 'percentage') {
            discountAmount = subtotal * (parseFloat(coupon.value) / 100);
            if (coupon.max_discount) {
              discountAmount = Math.min(discountAmount, parseFloat(coupon.max_discount));
            }
          } else {
            discountAmount = parseFloat(coupon.value);
          }
          discountAmount = Math.min(discountAmount, subtotal);
          appliedCouponCode = coupon.code;

          await query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [coupon.id]);
        }
      }
    }

    // ═══ 4. Shipping cost (from settings) ═══
    const settingsRows = await query(
      'SELECT key, value FROM store_settings WHERE tenant_id = $1',
      [tenant.id]
    );
    const storeSettings: Record<string, any> = {};
    settingsRows.forEach((s: any) => {
      try { storeSettings[s.key] = JSON.parse(s.value); } catch { storeSettings[s.key] = s.value; }
    });

    const shipSettings = storeSettings.shipping || {};
    const checkoutSettings = storeSettings.checkout || {};

    const shippingCosts: Record<string, number> = {
      aramex: shipSettings.aramex_cost || 25,
      dhl: shipSettings.dhl_cost || 35,
      pickup: 0,
    };
    let shippingCost = shippingCosts[shipping_method] || 0;

    // Free shipping check
    if (shipSettings.free_shipping_enabled && subtotal >= (shipSettings.free_shipping_min || 200)) {
      shippingCost = 0;
    }

    // ═══ 5. Total ═══
    const total = subtotal - discountAmount + shippingCost;

    // ═══ 6. Generate order number ═══
    const lastOrder = await queryOne(
      `SELECT order_number FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenant.id]
    );
    let nextNum = 1;
    if (lastOrder?.order_number) {
      const match = lastOrder.order_number.match(/(\d+)$/);
      if (match) nextNum = parseInt(match[1]) + 1;
    }
    const orderPrefix = checkoutSettings.order_prefix || 'SAS';
    const orderNumber = `${orderPrefix}-${String(nextNum).padStart(5, '0')}`;

    // ═══ 7. Create order ═══
    const order = await insert('orders', {
      tenant_id: tenant.id,
      customer_id: customerId,
      order_number: orderNumber,
      subtotal: Math.round(subtotal * 100) / 100,
      shipping_cost: shippingCost,
      discount_amount: Math.round(discountAmount * 100) / 100,
      tax_amount: 0,
      total: Math.round(total * 100) / 100,
      status: 'new',
      payment_method: payment_method || 'cod',
      payment_status: 'pending',
      shipping_method: shipping_method || 'pickup',
      shipping_address: JSON.stringify({
        name: customer.name,
        phone: customer.phone,
        city: address.city,
        area: address.area,
        street: address.street || '',
        building: address.building || '',
        floor_number: address.floor_number || '',
        apartment: address.apartment || '',
        notes: address.notes || '',
      }),
      coupon_code: appliedCouponCode,
      customer_notes: customer_notes || null,
    });

    // ═══ 8. Create order items ═══
    for (const item of validatedItems) {
      await insert('order_items', {
        order_id: order.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        name: item.name,
        sku: item.sku,
        image_url: item.image_url,
        options: JSON.stringify(item.options),
        price: item.price,
        quantity: item.quantity,
        total: item.total,
      });

      // Decrease stock
      await query(
        `UPDATE products SET quantity = GREATEST(0, quantity - $1), sales_count = sales_count + $2 WHERE id = $3 AND quantity IS NOT NULL`,
        [item.quantity, item.quantity, item.product_id]
      );
    }

    // ═══ 9. Initial status history ═══
    await insert('order_status_history', {
      order_id: order.id,
      status: 'new',
      note: 'تم إنشاء الطلب',
      changed_by: null,
    });

    // ═══ 10. Update customer stats ═══
    await query(
      `UPDATE customers SET orders_count = orders_count + 1, total_spent = total_spent + $1, last_order_at = NOW() WHERE id = $2`,
      [total, customerId]
    );

    res.status(201).json({
      success: true,
      data: {
        order_id: order.id,
        order_number: orderNumber,
        total: Math.round(total * 100) / 100,
        status: 'new',
        payment_method: payment_method || 'cod',
      },
      message: 'تم إنشاء الطلب بنجاح!',
    });
  } catch (err: any) {
    console.error('❌ Checkout error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// GET /api/store/:slug/order/:orderNumber
// صفحة تأكيد الطلب (public)
// ═══════════════════════════════════════
router.get('/:slug/order/:orderNumber', async (req, res) => {
  try {
    const tenant = await queryOne(`SELECT id, name FROM tenants WHERE slug = $1 AND status != 'suspended'`, [req.params.slug]);
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const order = await queryOne(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
       FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.order_number = $1 AND o.tenant_id = $2`,
      [req.params.orderNumber, tenant.id]
    );
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

    const items = await query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    const statusHistory = await query(
      'SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC',
      [order.id]
    );

    res.json({
      success: true,
      data: {
        ...order,
        items,
        status_history: statusHistory,
        store_name: tenant.name,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ═══════════════════════════════════════
// *** محادثة ٨: البحث + التقييمات + المفضلة + الصفحات ***
// ═══════════════════════════════════════

// GET /api/store/:slug/search — بحث سريع مع اقتراحات
router.get('/:slug/search', async (req, res) => {
  try {
    const tenant = await queryOne(
      'SELECT id FROM tenants WHERE slug = $1 AND status != \'suspended\'',
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const { q = '', limit = '6' } = req.query;
    if (!q || String(q).trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    const products = await query(
      `SELECT p.id, p.name, p.slug, p.price, p.sale_price,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = true LIMIT 1) as image
       FROM products p
       WHERE p.tenant_id = $1 AND p.status = 'active'
         AND (p.name ILIKE $2 OR p.description ILIKE $2 OR p.sku ILIKE $2)
       ORDER BY p.sales_count DESC, p.name ASC
       LIMIT $3`,
      [tenant.id, `%${q}%`, Math.min(parseInt(limit as string), 10)]
    );

    res.json({ success: true, data: products });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/store/:slug/products/:productSlug/reviews — تقييمات المنتج
router.get('/:slug/products/:productSlug/reviews', async (req, res) => {
  try {
    const tenant = await queryOne(
      'SELECT id FROM tenants WHERE slug = $1 AND status != \'suspended\'',
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const product = await queryOne(
      'SELECT id FROM products WHERE tenant_id = $1 AND slug = $2',
      [tenant.id, req.params.productSlug]
    );
    if (!product) return res.status(404).json({ success: false, error: 'المنتج غير موجود' });

    const { page = '1', limit = '10' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    const reviews = await query(
      `SELECT id, customer_name, rating, comment, created_at
       FROM reviews WHERE product_id = $1 AND status = 'approved'
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [product.id, parseInt(limit as string), offset]
    );

    const stats = await queryOne(
      `SELECT COUNT(*)::int as total, COALESCE(AVG(rating), 0) as avg_rating,
              COUNT(CASE WHEN rating = 5 THEN 1 END)::int as r5,
              COUNT(CASE WHEN rating = 4 THEN 1 END)::int as r4,
              COUNT(CASE WHEN rating = 3 THEN 1 END)::int as r3,
              COUNT(CASE WHEN rating = 2 THEN 1 END)::int as r2,
              COUNT(CASE WHEN rating = 1 THEN 1 END)::int as r1
       FROM reviews WHERE product_id = $1 AND status = 'approved'`,
      [product.id]
    );

    res.json({
      success: true,
      data: { reviews, stats: { ...stats, avg_rating: parseFloat(parseFloat(stats.avg_rating).toFixed(1)) } },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/store/:slug/products/:productSlug/reviews — إضافة تقييم
router.post('/:slug/products/:productSlug/reviews', async (req, res) => {
  try {
    const tenant = await queryOne(
      'SELECT id FROM tenants WHERE slug = $1 AND status != \'suspended\'',
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const product = await queryOne(
      'SELECT id FROM products WHERE tenant_id = $1 AND slug = $2',
      [tenant.id, req.params.productSlug]
    );
    if (!product) return res.status(404).json({ success: false, error: 'المنتج غير موجود' });

    const { customer_name, rating, comment, customer_id } = req.body;
    if (!customer_name || !rating) {
      return res.status(400).json({ success: false, error: 'الاسم والتقييم مطلوبين' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'التقييم بين ١ و ٥' });
    }

    const review = await insert('reviews', {
      tenant_id: tenant.id,
      product_id: product.id,
      customer_id: customer_id || null,
      customer_name,
      rating: parseInt(rating),
      comment: comment || null,
      status: 'approved',
    });

    // Update product avg_rating + review_count
    const avgRes = await queryOne(
      `SELECT COALESCE(AVG(rating), 0) as avg, COUNT(*)::int as cnt
       FROM reviews WHERE product_id = $1 AND status = 'approved'`,
      [product.id]
    );
    await query(
      'UPDATE products SET avg_rating = $1, review_count = $2 WHERE id = $3',
      [parseFloat(parseFloat(avgRes.avg).toFixed(1)), avgRes.cnt, product.id]
    );

    res.status(201).json({ success: true, data: review, message: 'شكراً لتقييمك!' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/store/:slug/wishlist — تبديل المفضلة (toggle)
router.post('/:slug/wishlist', async (req, res) => {
  try {
    const tenant = await queryOne(
      'SELECT id FROM tenants WHERE slug = $1 AND status != \'suspended\'',
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const { customer_id, product_id } = req.body;
    if (!customer_id || !product_id) {
      return res.status(400).json({ success: false, error: 'بيانات ناقصة' });
    }

    const existing = await queryOne(
      'SELECT id FROM wishlists WHERE customer_id = $1 AND product_id = $2',
      [customer_id, product_id]
    );

    if (existing) {
      await query('DELETE FROM wishlists WHERE id = $1', [existing.id]);
      res.json({ success: true, action: 'removed', message: 'تم الإزالة من المفضلة' });
    } else {
      await insert('wishlists', { tenant_id: tenant.id, customer_id, product_id });
      res.json({ success: true, action: 'added', message: 'تمت الإضافة للمفضلة' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/store/:slug/wishlist/:customerId — قائمة المفضلة
router.get('/:slug/wishlist/:customerId', async (req, res) => {
  try {
    const tenant = await queryOne(
      'SELECT id FROM tenants WHERE slug = $1 AND status != \'suspended\'',
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const items = await query(
      `SELECT w.id, w.product_id, w.created_at,
              p.name, p.slug, p.price, p.sale_price, p.status as product_status,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = true LIMIT 1) as image
       FROM wishlists w
       JOIN products p ON p.id = w.product_id
       WHERE w.customer_id = $1 AND w.tenant_id = $2
       ORDER BY w.created_at DESC`,
      [req.params.customerId, tenant.id]
    );

    res.json({ success: true, data: items });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/store/:slug/pages — صفحات المتجر الثابتة
router.get('/:slug/pages', async (req, res) => {
  try {
    const tenant = await queryOne(
      'SELECT id FROM tenants WHERE slug = $1 AND status != \'suspended\'',
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const pages = await query(
      `SELECT id, title, slug, content, sort_order FROM pages
       WHERE tenant_id = $1 AND status = 'published'
       ORDER BY sort_order ASC, created_at ASC`,
      [tenant.id]
    );
    res.json({ success: true, data: pages });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/store/:slug/pages/:pageSlug — صفحة واحدة
router.get('/:slug/pages/:pageSlug', async (req, res) => {
  try {
    const tenant = await queryOne(
      'SELECT id FROM tenants WHERE slug = $1 AND status != \'suspended\'',
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    const page = await queryOne(
      `SELECT id, title, slug, content, created_at, updated_at FROM pages
       WHERE tenant_id = $1 AND slug = $2 AND status = 'published'`,
      [tenant.id, req.params.pageSlug]
    );
    if (!page) return res.status(404).json({ success: false, error: 'الصفحة غير موجودة' });

    res.json({ success: true, data: page });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
