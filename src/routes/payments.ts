/**
 * ساس — Payment Processing Routes
 * محادثة ١٠: بوابات الدفع (SkipCash + SADAD + COD + Bank Transfer)
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ═══════════════════════════════════════
// POST /api/payments/initiate — بدء عملية الدفع
// ═══════════════════════════════════════
router.post('/initiate', async (req: Request, res: Response) => {
  try {
    const { orderId, gateway, tenantId, returnUrl } = req.body;

    if (!orderId || !gateway || !tenantId) {
      return res.status(400).json({
        success: false,
        error: 'orderId, gateway, tenantId مطلوبين',
      });
    }

    // Get order details
    const orderResult = await pool.query(
      `SELECT o.*, t.name as store_name, t.slug as store_slug
       FROM orders o
       JOIN tenants t ON t.id = o.tenant_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [orderId, tenantId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    }

    const order = orderResult.rows[0];

    if (order.payment_status === 'paid') {
      return res.status(400).json({ success: false, error: 'الطلب مدفوع مسبقاً' });
    }

    // Get tenant payment settings
    const settingsResult = await pool.query(
      `SELECT settings FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    const settings = settingsResult.rows[0]?.settings || {};

    let paymentUrl = '';
    let transactionId = '';
    let paymentRecord: any = {};

    switch (gateway) {
      case 'skipcash': {
        const skipConfig = settings.payment?.skipcash || {};
        if (!skipConfig.enabled) {
          return res.status(400).json({ success: false, error: 'SkipCash غير مفعّل' });
        }

        transactionId = `SC-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        
        // SkipCash API integration
        const apiKey = process.env.SKIPCASH_API_KEY || skipConfig.apiKey;
        const baseUrl = skipConfig.sandbox
          ? 'https://sandbox.skipcash.app/api/v1'
          : 'https://api.skipcash.app/api/v1';

        const callbackUrl = `${process.env.BACKEND_URL || 'https://api.saas.qa'}/api/payments/callback/skipcash`;

        const payload = {
          amount: parseFloat(order.total),
          currency: 'QAR',
          reference: transactionId,
          description: `طلب #${order.order_number} — ${order.store_name}`,
          customer_name: order.shipping_address?.name || 'عميل',
          customer_phone: order.shipping_address?.phone || '',
          customer_email: order.shipping_address?.email || '',
          callback_url: callbackUrl,
          return_url: returnUrl || `${process.env.FRONTEND_URL}/store/${order.store_slug}/order/${order.order_number}`,
        };

        try {
          const response = await fetch(`${baseUrl}/payments`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
          });

          const data = await response.json();

          if (data.payment_url) {
            paymentUrl = data.payment_url;
            transactionId = data.transaction_id || transactionId;
          } else {
            // Fallback: generate mock URL for development
            paymentUrl = `${baseUrl}/pay/${transactionId}`;
          }
        } catch (apiErr) {
          // Development fallback
          console.warn('⚠️ SkipCash API unavailable, using mock');
          paymentUrl = `${returnUrl || '/'}?payment=pending&ref=${transactionId}`;
        }

        paymentRecord = {
          gateway: 'skipcash',
          gateway_response: { payload, transactionId },
        };
        break;
      }

      case 'sadad': {
        const sadadConfig = settings.payment?.sadad || {};
        if (!sadadConfig.enabled) {
          return res.status(400).json({ success: false, error: 'سداد غير مفعّل' });
        }

        transactionId = `SD-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        const secretKey = process.env.SADAD_SECRET_KEY || sadadConfig.secretKey;
        const callbackUrl = process.env.SADAD_CALLBACK_URL || 
          `${process.env.BACKEND_URL || 'https://api.saas.qa'}/api/payments/callback/sadad`;

        // SADAD payment request
        const sadadPayload = {
          merchantId: sadadConfig.merchantId,
          amount: parseFloat(order.total),
          currency: 'QAR',
          orderId: transactionId,
          description: `طلب #${order.order_number}`,
          callbackUrl,
          returnUrl: returnUrl || `${process.env.FRONTEND_URL}/store/${order.store_slug}/order/${order.order_number}`,
        };

        // Generate signature
        const signatureStr = `${sadadPayload.merchantId}${sadadPayload.amount}${sadadPayload.orderId}${secretKey}`;
        const signature = crypto.createHash('sha256').update(signatureStr).digest('hex');

        try {
          const baseUrl = sadadConfig.sandbox
            ? 'https://sandbox.sadad.qa/api/v1'
            : 'https://api.sadad.qa/api/v1';

          const response = await fetch(`${baseUrl}/invoices`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Signature': signature,
              'Authorization': `Bearer ${secretKey}`,
            },
            body: JSON.stringify(sadadPayload),
          });

          const data = await response.json();

          if (data.payment_url) {
            paymentUrl = data.payment_url;
            transactionId = data.invoice_id || transactionId;
          } else {
            paymentUrl = `${returnUrl || '/'}?payment=pending&ref=${transactionId}`;
          }
        } catch (apiErr) {
          console.warn('⚠️ SADAD API unavailable, using mock');
          paymentUrl = `${returnUrl || '/'}?payment=pending&ref=${transactionId}`;
        }

        paymentRecord = {
          gateway: 'sadad',
          gateway_response: { sadadPayload, transactionId },
        };
        break;
      }

      case 'bank_transfer': {
        transactionId = `BT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const bankConfig = settings.payment?.bankTransfer || {};

        paymentRecord = {
          gateway: 'bank_transfer',
          gateway_response: {
            bankName: bankConfig.bankName || '',
            accountName: bankConfig.accountName || '',
            iban: bankConfig.iban || '',
            instructions: 'يرجى التحويل وإرسال إيصال الدفع',
          },
        };

        // No redirect needed — show bank details
        paymentUrl = '';
        break;
      }

      case 'cod': {
        transactionId = `COD-${Date.now()}`;
        
        // COD — mark as pending, no payment needed
        await pool.query(
          `UPDATE orders SET payment_method = 'cod', payment_status = 'pending', updated_at = NOW()
           WHERE id = $1`,
          [orderId]
        );

        paymentRecord = {
          gateway: 'cod',
          gateway_response: { note: 'الدفع عند الاستلام' },
        };

        paymentUrl = '';
        break;
      }

      default:
        return res.status(400).json({ success: false, error: 'بوابة دفع غير مدعومة' });
    }

    // Save payment record
    await pool.query(
      `INSERT INTO payments (tenant_id, order_id, gateway, amount, currency, status, transaction_id, gateway_response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenantId,
        orderId,
        paymentRecord.gateway,
        order.total,
        'QAR',
        gateway === 'cod' ? 'completed' : 'pending',
        transactionId,
        JSON.stringify(paymentRecord.gateway_response),
      ]
    );

    // Update order payment method
    await pool.query(
      `UPDATE orders SET payment_method = $1, updated_at = NOW() WHERE id = $2`,
      [gateway, orderId]
    );

    res.json({
      success: true,
      data: {
        transactionId,
        paymentUrl,
        gateway,
        amount: order.total,
        bankDetails: gateway === 'bank_transfer' ? paymentRecord.gateway_response : undefined,
      },
    });
  } catch (err: any) {
    console.error('❌ Payment initiate error:', err.message);
    res.status(500).json({ success: false, error: 'فشل بدء عملية الدفع' });
  }
});

// ═══════════════════════════════════════
// POST /api/payments/callback/skipcash — SkipCash Webhook
// ═══════════════════════════════════════
router.post('/callback/skipcash', async (req: Request, res: Response) => {
  try {
    const { transaction_id, status, reference, amount } = req.body;
    console.log('📥 SkipCash callback:', { transaction_id, status, reference });

    const paymentResult = await pool.query(
      `SELECT p.*, o.tenant_id FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.transaction_id = $1 OR p.transaction_id = $2`,
      [transaction_id, reference]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'معاملة غير موجودة' });
    }

    const payment = paymentResult.rows[0];

    const newStatus = status === 'success' || status === 'paid' ? 'completed' : 'failed';

    // Update payment
    await pool.query(
      `UPDATE payments SET 
        status = $1,
        transaction_id = COALESCE($2, transaction_id),
        gateway_response = gateway_response || $3::jsonb,
        paid_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE paid_at END,
        updated_at = NOW()
       WHERE id = $4`,
      [
        newStatus,
        transaction_id,
        JSON.stringify({ callback: req.body }),
        payment.id,
      ]
    );

    // Update order payment status
    await pool.query(
      `UPDATE orders SET 
        payment_status = $1,
        status = CASE WHEN $1 = 'paid' THEN 'confirmed' ELSE status END,
        updated_at = NOW()
       WHERE id = $2`,
      [newStatus === 'completed' ? 'paid' : 'failed', payment.order_id]
    );

    res.json({ success: true, message: 'تم تحديث حالة الدفع' });
  } catch (err: any) {
    console.error('❌ SkipCash callback error:', err.message);
    res.status(500).json({ success: false, error: 'فشل معالجة الـ callback' });
  }
});

// ═══════════════════════════════════════
// POST /api/payments/callback/sadad — SADAD Webhook
// ═══════════════════════════════════════
router.post('/callback/sadad', async (req: Request, res: Response) => {
  try {
    const { invoice_id, status, order_id: sadadOrderId } = req.body;
    console.log('📥 SADAD callback:', { invoice_id, status, sadadOrderId });

    // Verify signature if provided
    const signature = req.headers['x-signature'] as string;
    if (signature && process.env.SADAD_SECRET_KEY) {
      const expected = crypto.createHash('sha256')
        .update(`${invoice_id}${status}${process.env.SADAD_SECRET_KEY}`)
        .digest('hex');
      if (signature !== expected) {
        return res.status(403).json({ success: false, error: 'توقيع غير صالح' });
      }
    }

    const paymentResult = await pool.query(
      `SELECT p.*, o.tenant_id FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.transaction_id = $1`,
      [sadadOrderId || invoice_id]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'معاملة غير موجودة' });
    }

    const payment = paymentResult.rows[0];
    const newStatus = status === 'paid' || status === 'success' ? 'completed' : 'failed';

    await pool.query(
      `UPDATE payments SET 
        status = $1,
        gateway_response = gateway_response || $2::jsonb,
        paid_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE paid_at END,
        updated_at = NOW()
       WHERE id = $3`,
      [newStatus, JSON.stringify({ callback: req.body }), payment.id]
    );

    await pool.query(
      `UPDATE orders SET 
        payment_status = $1,
        status = CASE WHEN $1 = 'paid' THEN 'confirmed' ELSE status END,
        updated_at = NOW()
       WHERE id = $2`,
      [newStatus === 'completed' ? 'paid' : 'failed', payment.order_id]
    );

    res.json({ success: true, message: 'تم تحديث حالة الدفع' });
  } catch (err: any) {
    console.error('❌ SADAD callback error:', err.message);
    res.status(500).json({ success: false, error: 'فشل معالجة الـ callback' });
  }
});

// ═══════════════════════════════════════
// GET /api/payments/verify/:transactionId — تحقق من حالة الدفع
// ═══════════════════════════════════════
router.get('/verify/:transactionId', async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    const result = await pool.query(
      `SELECT p.*, o.order_number, o.total, o.status as order_status
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.transaction_id = $1`,
      [transactionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'معاملة غير موجودة' });
    }

    const payment = result.rows[0];

    res.json({
      success: true,
      data: {
        transactionId: payment.transaction_id,
        gateway: payment.gateway,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        orderNumber: payment.order_number,
        orderStatus: payment.order_status,
        paidAt: payment.paid_at,
      },
    });
  } catch (err: any) {
    console.error('❌ Payment verify error:', err.message);
    res.status(500).json({ success: false, error: 'فشل التحقق من الدفع' });
  }
});

// ═══════════════════════════════════════
// GET /api/payments — قائمة المعاملات (Dashboard)
// ═══════════════════════════════════════
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { page = '1', limit = '20', status, gateway } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let where = 'p.tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIdx = 2;

    if (status) {
      where += ` AND p.status = $${paramIdx++}`;
      params.push(status);
    }
    if (gateway) {
      where += ` AND p.gateway = $${paramIdx++}`;
      params.push(gateway);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM payments p WHERE ${where}`,
      params
    );

    const result = await pool.query(
      `SELECT p.*, o.order_number
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, parseInt(limit as string), offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        pages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit as string)),
      },
    });
  } catch (err: any) {
    console.error('❌ Payments list error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل المعاملات' });
  }
});

// ═══════════════════════════════════════
// POST /api/payments/:id/refund — استرجاع مبلغ
// ═══════════════════════════════════════
router.post('/:id/refund', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { amount, reason } = req.body;

    const result = await pool.query(
      `SELECT p.*, o.total FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.id = $1 AND p.tenant_id = $2 AND p.status = 'completed'`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'معاملة غير موجودة أو لم تكتمل' });
    }

    const payment = result.rows[0];
    const refundAmount = amount ? parseFloat(amount) : parseFloat(payment.amount);

    if (refundAmount > parseFloat(payment.amount)) {
      return res.status(400).json({ success: false, error: 'مبلغ الاسترجاع أكبر من المبلغ الأصلي' });
    }

    // Update payment
    await pool.query(
      `UPDATE payments SET 
        status = 'refunded',
        refund_amount = $1,
        refund_reason = $2,
        updated_at = NOW()
       WHERE id = $3`,
      [refundAmount, reason || 'استرجاع', id]
    );

    // Update order
    await pool.query(
      `UPDATE orders SET 
        payment_status = 'refunded',
        status = 'cancelled',
        updated_at = NOW()
       WHERE id = $1`,
      [payment.order_id]
    );

    res.json({
      success: true,
      message: 'تم الاسترجاع بنجاح',
      data: { refundAmount, paymentId: id },
    });
  } catch (err: any) {
    console.error('❌ Refund error:', err.message);
    res.status(500).json({ success: false, error: 'فشل عملية الاسترجاع' });
  }
});

// ═══════════════════════════════════════
// POST /api/payments/confirm-transfer — تأكيد التحويل البنكي
// ═══════════════════════════════════════
router.post('/confirm-transfer', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { orderId, transferRef, transferDate } = req.body;

    const result = await pool.query(
      `SELECT p.* FROM payments p
       WHERE p.order_id = $1 AND p.tenant_id = $2 AND p.gateway = 'bank_transfer' AND p.status = 'pending'`,
      [orderId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'لم يتم العثور على معاملة تحويل بنكي' });
    }

    const payment = result.rows[0];

    await pool.query(
      `UPDATE payments SET 
        status = 'completed',
        transaction_id = COALESCE($1, transaction_id),
        gateway_response = gateway_response || $2::jsonb,
        paid_at = NOW(),
        updated_at = NOW()
       WHERE id = $3`,
      [
        transferRef,
        JSON.stringify({ confirmedBy: req.merchant?.email, transferDate, transferRef }),
        payment.id,
      ]
    );

    await pool.query(
      `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    res.json({ success: true, message: 'تم تأكيد التحويل البنكي' });
  } catch (err: any) {
    console.error('❌ Confirm transfer error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تأكيد التحويل' });
  }
});

// ═══════════════════════════════════════
// GET /api/payments/stats — إحصائيات الدفع
// ═══════════════════════════════════════
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;

    const result = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
        COUNT(*) FILTER (WHERE status = 'refunded') as refunded_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) as total_collected,
        COALESCE(SUM(refund_amount) FILTER (WHERE status = 'refunded'), 0) as total_refunded,
        COUNT(DISTINCT gateway) as gateways_used
       FROM payments WHERE tenant_id = $1`,
      [tenantId]
    );

    const byGateway = await pool.query(
      `SELECT gateway, 
        COUNT(*) as count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) as total
       FROM payments WHERE tenant_id = $1
       GROUP BY gateway`,
      [tenantId]
    );

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        byGateway: byGateway.rows,
      },
    });
  } catch (err: any) {
    console.error('❌ Payment stats error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل الإحصائيات' });
  }
});

export default router;
