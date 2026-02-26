/**
 * ساس — Store Public API (Storefront)
 * No auth required — these serve the public store
 */

import { Router } from 'express';
import { query, queryOne } from '../config/database.js';

const router = Router();

// GET /api/store/:slug — Store info
router.get('/:slug', async (req, res) => {
  try {
    const tenant = await queryOne(
      `SELECT id, name, slug, logo_url, description, currency, language, theme, theme_config, meta, status
       FROM tenants WHERE slug = $1 AND status != 'suspended'`,
      [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ success: false, error: 'المتجر غير موجود' });

    // Load settings
    const settings = await query('SELECT key, value FROM store_settings WHERE tenant_id = $1', [tenant.id]);
    const settingsMap: Record<string, any> = {};
    settings.forEach((s: any) => { settingsMap[s.key] = s.value; });

    res.json({ success: true, data: { ...tenant, settings: settingsMap } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/store/:slug/products
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

// GET /api/store/:slug/categories
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

// GET /api/store/:slug/products/:productSlug
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

    // Increment views
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

export default router;
