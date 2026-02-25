/**
 * ساس — Products API Routes
 */

import { Router } from 'express';
import { query, queryOne, insert, update } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import slugify from 'slugify';

const router = Router();

// All routes require auth
router.use(requireAuth);

// ═══ GET /api/products — List products ═══
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { page = '1', limit = '20', status, category_id, search, sort = 'created_at', order = 'DESC' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE p.tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (status) {
      where += ` AND p.status = $${paramIndex++}`;
      params.push(status);
    }
    if (category_id) {
      where += ` AND p.category_id = $${paramIndex++}`;
      params.push(category_id);
    }
    if (search) {
      where += ` AND (p.name ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Safe sort columns
    const safeSorts: Record<string, string> = {
      created_at: 'p.created_at',
      name: 'p.name',
      price: 'p.price',
      quantity: 'p.quantity',
      sales_count: 'p.sales_count',
    };
    const sortCol = safeSorts[sort as string] || 'p.created_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    const [products, countResult] = await Promise.all([
      query(
        `SELECT p.*, c.name as category_name,
         (SELECT url FROM product_images WHERE product_id = p.id AND is_main = true LIMIT 1) as main_image
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         ${where}
         ORDER BY ${sortCol} ${sortOrder}
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, limitNum, offset]
      ),
      query(`SELECT COUNT(*) as total FROM products p ${where}`, params),
    ]);

    const total = parseInt(countResult[0].total);

    res.json({
      success: true,
      data: products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ GET /api/products/:id — Get product ═══
router.get('/:id', async (req, res) => {
  try {
    const product = await queryOne(
      `SELECT p.*, c.name as category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1 AND p.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (!product) {
      return res.status(404).json({ success: false, error: 'المنتج غير موجود' });
    }

    // Load images, options, variants
    const [images, options, variants] = await Promise.all([
      query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order', [product.id]),
      query('SELECT * FROM product_options WHERE product_id = $1 ORDER BY sort_order', [product.id]),
      query('SELECT * FROM product_variants WHERE product_id = $1', [product.id]),
    ]);

    res.json({
      success: true,
      data: { ...product, images, options, variants },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ POST /api/products — Create product ═══
router.post('/', async (req, res) => {
  try {
    const { name, description, price, sale_price, cost_price, sku, barcode, quantity, weight, type, category_id, is_featured, tags, status: prodStatus } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ success: false, error: 'اسم المنتج والسعر مطلوبان' });
    }

    const slug = slugify(name, { lower: true, strict: true }) + '-' + Date.now().toString(36);

    const product = await insert('products', {
      tenant_id: req.tenantId,
      name,
      slug,
      description: description || null,
      price: parseFloat(price),
      sale_price: sale_price ? parseFloat(sale_price) : null,
      cost_price: cost_price ? parseFloat(cost_price) : null,
      sku: sku || null,
      barcode: barcode || null,
      quantity: parseInt(quantity || '0'),
      weight: weight ? parseFloat(weight) : null,
      type: type || 'physical',
      category_id: category_id || null,
      is_featured: is_featured || false,
      tags: tags || [],
      status: prodStatus || 'draft',
    });

    res.status(201).json({ success: true, data: product });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ PUT /api/products/:id — Update product ═══
router.put('/:id', async (req, res) => {
  try {
    // Verify ownership
    const existing = await queryOne(
      'SELECT id FROM products WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (!existing) {
      return res.status(404).json({ success: false, error: 'المنتج غير موجود' });
    }

    const allowedFields = ['name', 'description', 'price', 'sale_price', 'cost_price', 'sku', 'barcode', 'quantity', 'weight', 'type', 'category_id', 'is_featured', 'tags', 'status', 'meta'];
    const data: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    if (data.name) {
      data.slug = slugify(data.name, { lower: true, strict: true }) + '-' + Date.now().toString(36);
    }

    const product = await update('products', req.params.id, data);
    res.json({ success: true, data: product });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ DELETE /api/products/:id — Delete product ═══
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM products WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenantId]
    );
    if (result.length === 0) {
      return res.status(404).json({ success: false, error: 'المنتج غير موجود' });
    }
    res.json({ success: true, message: 'تم حذف المنتج' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
