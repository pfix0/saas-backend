/**
 * ساس — محادثة ٨: إدارة الصفحات الثابتة (Admin)
 */

import { Router } from 'express';
import { query, queryOne, insert } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/pages — قائمة الصفحات
router.get('/', async (req, res) => {
  try {
    const pages = await query(
      `SELECT id, title, slug, status, sort_order, created_at, updated_at
       FROM pages WHERE tenant_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [req.user!.tenantId]
    );
    res.json({ success: true, data: pages });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/pages/:id — تفاصيل صفحة
router.get('/:id', async (req, res) => {
  try {
    const page = await queryOne(
      'SELECT * FROM pages WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user!.tenantId]
    );
    if (!page) return res.status(404).json({ success: false, error: 'الصفحة غير موجودة' });
    res.json({ success: true, data: page });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/pages — إنشاء صفحة
router.post('/', async (req, res) => {
  try {
    const { title, slug, content, status = 'published', sort_order = 0 } = req.body;
    if (!title || !slug) {
      return res.status(400).json({ success: false, error: 'العنوان والرابط مطلوبين' });
    }

    // Check unique slug
    const existing = await queryOne(
      'SELECT id FROM pages WHERE tenant_id = $1 AND slug = $2',
      [req.user!.tenantId, slug]
    );
    if (existing) {
      return res.status(400).json({ success: false, error: 'رابط الصفحة مستخدم مسبقاً' });
    }

    const page = await insert('pages', {
      tenant_id: req.user!.tenantId,
      title,
      slug,
      content: content || '',
      status,
      sort_order: parseInt(sort_order),
    });

    res.status(201).json({ success: true, data: page });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/pages/:id — تعديل صفحة
router.put('/:id', async (req, res) => {
  try {
    const page = await queryOne(
      'SELECT id FROM pages WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user!.tenantId]
    );
    if (!page) return res.status(404).json({ success: false, error: 'الصفحة غير موجودة' });

    const { title, slug, content, status, sort_order } = req.body;

    // Check unique slug if changed
    if (slug) {
      const existing = await queryOne(
        'SELECT id FROM pages WHERE tenant_id = $1 AND slug = $2 AND id != $3',
        [req.user!.tenantId, slug, page.id]
      );
      if (existing) {
        return res.status(400).json({ success: false, error: 'رابط الصفحة مستخدم مسبقاً' });
      }
    }

    const updates: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (title !== undefined) { updates.push(`title = $${pi++}`); params.push(title); }
    if (slug !== undefined) { updates.push(`slug = $${pi++}`); params.push(slug); }
    if (content !== undefined) { updates.push(`content = $${pi++}`); params.push(content); }
    if (status !== undefined) { updates.push(`status = $${pi++}`); params.push(status); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${pi++}`); params.push(parseInt(sort_order)); }

    updates.push(`updated_at = NOW()`);
    params.push(page.id);

    await query(
      `UPDATE pages SET ${updates.join(', ')} WHERE id = $${pi}`,
      params
    );

    const updated = await queryOne('SELECT * FROM pages WHERE id = $1', [page.id]);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/pages/:id — حذف صفحة
router.delete('/:id', async (req, res) => {
  try {
    const page = await queryOne(
      'SELECT id FROM pages WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user!.tenantId]
    );
    if (!page) return res.status(404).json({ success: false, error: 'الصفحة غير موجودة' });

    await query('DELETE FROM pages WHERE id = $1', [page.id]);
    res.json({ success: true, message: 'تم حذف الصفحة' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
