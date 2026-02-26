/**
 * ساس — محادثة ٨: إدارة التقييمات (Admin)
 */

import { Router } from 'express';
import { query, queryOne } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/reviews/stats — إحصائيات التقييمات
router.get('/stats', async (req, res) => {
  try {
    const stats = await queryOne(
      `SELECT
        COUNT(*)::int as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END)::int as pending,
        COUNT(CASE WHEN status = 'approved' THEN 1 END)::int as approved,
        COALESCE(AVG(CASE WHEN status = 'approved' THEN rating END), 0) as avg_rating
       FROM reviews WHERE tenant_id = $1`,
      [req.user!.tenantId]
    );
    stats.avg_rating = parseFloat(parseFloat(stats.avg_rating).toFixed(1));
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/reviews — قائمة التقييمات
router.get('/', async (req, res) => {
  try {
    const { status, rating, search, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let where = 'r.tenant_id = $1';
    const params: any[] = [req.user!.tenantId];
    let pi = 2;

    if (status && status !== 'all') {
      where += ` AND r.status = $${pi++}`;
      params.push(status);
    }
    if (rating) {
      where += ` AND r.rating = $${pi++}`;
      params.push(parseInt(rating as string));
    }
    if (search) {
      where += ` AND (r.customer_name ILIKE $${pi} OR r.comment ILIKE $${pi})`;
      params.push(`%${search}%`);
      pi++;
    }

    const countResult = await queryOne(
      `SELECT COUNT(*)::int as count FROM reviews r WHERE ${where}`,
      params
    );

    const reviews = await query(
      `SELECT r.id, r.customer_name, r.rating, r.comment, r.status, r.created_at,
              p.name as product_name, p.slug as product_slug,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = true LIMIT 1) as product_image
       FROM reviews r
       JOIN products p ON p.id = r.product_id
       WHERE ${where}
       ORDER BY r.created_at DESC
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit as string), offset]
    );

    res.json({
      success: true,
      data: reviews,
      pagination: {
        total: countResult.count,
        page: parseInt(page as string),
        pages: Math.ceil(countResult.count / parseInt(limit as string)),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/reviews/:id/status — تغيير حالة التقييم
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'حالة غير صحيحة' });
    }

    const review = await queryOne(
      'SELECT id, product_id FROM reviews WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user!.tenantId]
    );
    if (!review) return res.status(404).json({ success: false, error: 'التقييم غير موجود' });

    await query(
      'UPDATE reviews SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, review.id]
    );

    // Recalculate product avg
    const avgRes = await queryOne(
      `SELECT COALESCE(AVG(rating), 0) as avg, COUNT(*)::int as cnt
       FROM reviews WHERE product_id = $1 AND status = 'approved'`,
      [review.product_id]
    );
    await query(
      'UPDATE products SET avg_rating = $1, review_count = $2 WHERE id = $3',
      [parseFloat(parseFloat(avgRes.avg).toFixed(1)), avgRes.cnt, review.product_id]
    );

    res.json({ success: true, message: 'تم تحديث حالة التقييم' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/reviews/:id — حذف تقييم
router.delete('/:id', async (req, res) => {
  try {
    const review = await queryOne(
      'SELECT id, product_id FROM reviews WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user!.tenantId]
    );
    if (!review) return res.status(404).json({ success: false, error: 'التقييم غير موجود' });

    await query('DELETE FROM reviews WHERE id = $1', [review.id]);

    // Recalculate product avg
    const avgRes = await queryOne(
      `SELECT COALESCE(AVG(rating), 0) as avg, COUNT(*)::int as cnt
       FROM reviews WHERE product_id = $1 AND status = 'approved'`,
      [review.product_id]
    );
    await query(
      'UPDATE products SET avg_rating = $1, review_count = $2 WHERE id = $3',
      [parseFloat(parseFloat(avgRes.avg).toFixed(1)), avgRes.cnt, review.product_id]
    );

    res.json({ success: true, message: 'تم حذف التقييم' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
