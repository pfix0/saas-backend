/**
 * ساس — Categories API Routes
 */

import { Router } from 'express';
import { query, queryOne, insert, update } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import slugify from 'slugify';

const router = Router();
router.use(requireAuth);

// GET /api/categories
router.get('/', async (req, res) => {
  try {
    const categories = await query(
      `SELECT c.*, 
       (SELECT COUNT(*) FROM products WHERE category_id = c.id)::int as products_count
       FROM categories c
       WHERE c.tenant_id = $1
       ORDER BY c.sort_order, c.name`,
      [req.tenantId]
    );
    res.json({ success: true, data: categories });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/categories
router.post('/', async (req, res) => {
  try {
    const { name, description, parent_id, sort_order, image_url } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'اسم التصنيف مطلوب' });

    const slug = slugify(name, { lower: true, strict: true });
    const category = await insert('categories', {
      tenant_id: req.tenantId, name, slug,
      description: description || null,
      parent_id: parent_id || null,
      sort_order: sort_order || 0,
      image_url: image_url || null,
      status: 'active',
    });
    res.status(201).json({ success: true, data: category });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/categories/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await queryOne('SELECT id FROM categories WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
    if (!existing) return res.status(404).json({ success: false, error: 'التصنيف غير موجود' });

    const data: any = {};
    for (const f of ['name', 'description', 'parent_id', 'sort_order', 'image_url', 'status']) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    if (data.name) data.slug = slugify(data.name, { lower: true, strict: true });

    const category = await update('categories', req.params.id, data);
    res.json({ success: true, data: category });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM categories WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenantId]);
    if (!result.length) return res.status(404).json({ success: false, error: 'التصنيف غير موجود' });
    res.json({ success: true, message: 'تم حذف التصنيف' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
