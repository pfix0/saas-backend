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

    // ═══ 4. Shipping cost ═══
    const shippingCosts: Record<string, number> = {
      aramex: 25,
      dhl: 35,
      pickup: 0,
    };
    const shippingCost = shippingCosts[shipping_method] || 0;

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
    const orderNumber = `SAS-${String(nextNum).padStart(5, '0')}`;

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

export default router;
