/**
 * ساس — Shipments & Shipping Routes
 * محادثة ١١: شركات الشحن (Aramex + DHL + Local)
 */

import { Router, Request, Response } from 'express';
import { pool } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ═══════════════════════════════════════
// POST /api/shipments — إنشاء شحنة جديدة
// ═══════════════════════════════════════
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { orderId, carrier, weight, dimensions } = req.body;

    if (!orderId || !carrier) {
      return res.status(400).json({ success: false, error: 'orderId و carrier مطلوبين' });
    }

    // Get order
    const orderResult = await pool.query(
      `SELECT o.*, t.name as store_name FROM orders o
       JOIN tenants t ON t.id = o.tenant_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [orderId, tenantId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    }

    const order = orderResult.rows[0];
    const address = order.shipping_address || {};

    // Get tenant shipping settings
    const settingsResult = await pool.query(
      `SELECT settings FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    const settings = settingsResult.rows[0]?.settings || {};

    let trackingNumber = '';
    let labelUrl = '';
    let estimatedDelivery = null;
    let shippingCost = parseFloat(order.shipping_cost || '0');
    let carrierResponse: any = {};

    switch (carrier) {
      case 'aramex': {
        const aramexConfig = settings.shipping?.aramex || {};
        
        // Generate tracking number
        trackingNumber = `ARX${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

        try {
          const aramexPayload = {
            ClientInfo: {
              UserName: process.env.ARAMEX_USERNAME || aramexConfig.username,
              Password: process.env.ARAMEX_PASSWORD || aramexConfig.password,
              AccountNumber: process.env.ARAMEX_ACCOUNT_NUMBER || aramexConfig.accountNumber,
              AccountPin: process.env.ARAMEX_ACCOUNT_PIN || aramexConfig.accountPin,
              AccountEntity: aramexConfig.entity || 'DOH',
              AccountCountryCode: 'QA',
              Version: 'v1',
            },
            Shipments: [{
              Reference1: order.order_number,
              Shipper: {
                AccountNumber: process.env.ARAMEX_ACCOUNT_NUMBER || aramexConfig.accountNumber,
                PartyAddress: {
                  City: aramexConfig.city || 'Doha',
                  CountryCode: 'QA',
                },
                Contact: {
                  PersonName: order.store_name,
                  PhoneNumber1: aramexConfig.phone || '',
                },
              },
              Consignee: {
                PartyAddress: {
                  Line1: address.address || '',
                  City: address.city || 'Doha',
                  CountryCode: address.country || 'QA',
                },
                Contact: {
                  PersonName: address.name || '',
                  PhoneNumber1: address.phone || '',
                  EmailAddress: address.email || '',
                },
              },
              ShippingDateTime: new Date().toISOString(),
              DueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
              Details: {
                NumberOfPieces: 1,
                ActualWeight: { Value: weight || 1, Unit: 'KG' },
                Dimensions: dimensions ? {
                  Length: dimensions.length || 0,
                  Width: dimensions.width || 0,
                  Height: dimensions.height || 0,
                  Unit: 'CM',
                } : undefined,
                ProductGroup: 'DOM',
                ProductType: 'ONP',
                PaymentType: 'P',
                DescriptionOfGoods: `طلب #${order.order_number}`,
              },
            }],
            LabelInfo: { ReportID: 9201, ReportType: 'URL' },
          };

          const baseUrl = aramexConfig.sandbox
            ? 'https://ws.dev.aramex.net/ShippingAPI.V2'
            : 'https://ws.aramex.net/ShippingAPI.V2';

          const response = await fetch(`${baseUrl}/Shipping/Service_1_0.svc/json/CreateShipments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(aramexPayload),
          });

          const data = await response.json();
          
          if (data.Shipments?.[0]?.ID) {
            trackingNumber = data.Shipments[0].ID;
            labelUrl = data.Shipments[0].ShipmentLabel?.LabelURL || '';
          }

          carrierResponse = data;
        } catch (apiErr) {
          console.warn('⚠️ Aramex API unavailable, using generated tracking');
          carrierResponse = { mock: true };
        }

        estimatedDelivery = new Date(Date.now() + 3 * 86400000); // 3 days
        break;
      }

      case 'dhl': {
        const dhlConfig = settings.shipping?.dhl || {};
        
        trackingNumber = `DHL${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

        try {
          const apiKey = process.env.DHL_API_KEY || dhlConfig.apiKey;
          const apiSecret = process.env.DHL_API_SECRET || dhlConfig.apiSecret;

          const baseUrl = dhlConfig.sandbox
            ? 'https://express.api.dhl.com/mydhlapi/test'
            : 'https://express.api.dhl.com/mydhlapi';

          const dhlPayload = {
            plannedShippingDateAndTime: new Date().toISOString(),
            pickup: { isRequested: false },
            productCode: 'P',
            accounts: [{
              typeCode: 'shipper',
              number: dhlConfig.accountNumber || '',
            }],
            customerDetails: {
              shipperDetails: {
                postalAddress: {
                  cityName: dhlConfig.city || 'Doha',
                  countryCode: 'QA',
                  addressLine1: dhlConfig.address || '',
                },
                contactInformation: {
                  fullName: order.store_name,
                  phone: dhlConfig.phone || '',
                },
              },
              receiverDetails: {
                postalAddress: {
                  cityName: address.city || 'Doha',
                  countryCode: address.country || 'QA',
                  addressLine1: address.address || '',
                },
                contactInformation: {
                  fullName: address.name || '',
                  phone: address.phone || '',
                  email: address.email || '',
                },
              },
            },
            content: {
              packages: [{
                weight: weight || 1,
                dimensions: dimensions ? {
                  length: dimensions.length || 10,
                  width: dimensions.width || 10,
                  height: dimensions.height || 10,
                } : { length: 10, width: 10, height: 10 },
              }],
              description: `Order #${order.order_number}`,
            },
          };

          const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

          const response = await fetch(`${baseUrl}/shipments`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Basic ${credentials}`,
            },
            body: JSON.stringify(dhlPayload),
          });

          const data = await response.json();
          
          if (data.shipmentTrackingNumber) {
            trackingNumber = data.shipmentTrackingNumber;
            labelUrl = data.documents?.[0]?.url || '';
          }

          carrierResponse = data;
        } catch (apiErr) {
          console.warn('⚠️ DHL API unavailable, using generated tracking');
          carrierResponse = { mock: true };
        }

        estimatedDelivery = new Date(Date.now() + 5 * 86400000); // 5 days
        break;
      }

      case 'local': {
        trackingNumber = `LOC-${Date.now()}`;
        estimatedDelivery = new Date(Date.now() + 1 * 86400000); // 1 day
        carrierResponse = { type: 'local_delivery' };
        break;
      }

      case 'pickup': {
        trackingNumber = `PU-${Date.now()}`;
        carrierResponse = { type: 'store_pickup' };
        break;
      }

      default:
        return res.status(400).json({ success: false, error: 'شركة شحن غير مدعومة' });
    }

    // Save shipment
    const shipmentResult = await pool.query(
      `INSERT INTO shipments (tenant_id, order_id, carrier, tracking_number, label_url, status, 
        estimated_delivery, shipping_cost, weight, dimensions, carrier_response, shipped_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING *`,
      [
        tenantId,
        orderId,
        carrier,
        trackingNumber,
        labelUrl,
        carrier === 'pickup' ? 'pending' : 'picked_up',
        estimatedDelivery,
        shippingCost,
        weight || null,
        dimensions ? JSON.stringify(dimensions) : null,
        JSON.stringify(carrierResponse),
      ]
    );

    // Update order status
    await pool.query(
      `UPDATE orders SET 
        shipping_method = $1,
        status = CASE WHEN status != 'cancelled' THEN 'shipped' ELSE status END,
        updated_at = NOW()
       WHERE id = $2`,
      [carrier, orderId]
    );

    res.json({
      success: true,
      data: shipmentResult.rows[0],
    });
  } catch (err: any) {
    console.error('❌ Create shipment error:', err.message);
    res.status(500).json({ success: false, error: 'فشل إنشاء الشحنة' });
  }
});

// ═══════════════════════════════════════
// GET /api/shipments — قائمة الشحنات
// ═══════════════════════════════════════
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { page = '1', limit = '20', status, carrier } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let where = 's.tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIdx = 2;

    if (status) {
      where += ` AND s.status = $${paramIdx++}`;
      params.push(status);
    }
    if (carrier) {
      where += ` AND s.carrier = $${paramIdx++}`;
      params.push(carrier);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM shipments s WHERE ${where}`,
      params
    );

    const result = await pool.query(
      `SELECT s.*, o.order_number, o.shipping_address
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       WHERE ${where}
       ORDER BY s.created_at DESC
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
    console.error('❌ Shipments list error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل الشحنات' });
  }
});

// ═══════════════════════════════════════
// GET /api/shipments/:id — تفاصيل الشحنة
// ═══════════════════════════════════════
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT s.*, o.order_number, o.shipping_address, o.total
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'الشحنة غير موجودة' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    console.error('❌ Shipment detail error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل الشحنة' });
  }
});

// ═══════════════════════════════════════
// PATCH /api/shipments/:id/status — تحديث حالة الشحنة
// ═══════════════════════════════════════
router.patch('/:id/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'حالة غير صالحة' });
    }

    const result = await pool.query(
      `UPDATE shipments SET 
        status = $1,
        delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
        updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [status, id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'الشحنة غير موجودة' });
    }

    // Update order status if delivered
    if (status === 'delivered') {
      await pool.query(
        `UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = $1`,
        [result.rows[0].order_id]
      );
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    console.error('❌ Shipment status error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحديث الحالة' });
  }
});

// ═══════════════════════════════════════
// GET /api/shipments/track/:trackingNumber — تتبع الشحنة (Public)
// ═══════════════════════════════════════
router.get('/track/:trackingNumber', async (req: Request, res: Response) => {
  try {
    const { trackingNumber } = req.params;

    const result = await pool.query(
      `SELECT s.carrier, s.tracking_number, s.status, s.estimated_delivery,
        s.shipped_at, s.delivered_at, s.created_at,
        o.order_number
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       WHERE s.tracking_number = $1`,
      [trackingNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'رقم التتبع غير موجود' });
    }

    const shipment = result.rows[0];

    // Build tracking timeline
    const timeline = [];
    timeline.push({
      status: 'created',
      label: 'تم إنشاء الشحنة',
      date: shipment.created_at,
      done: true,
    });

    if (['picked_up', 'in_transit', 'out_for_delivery', 'delivered'].includes(shipment.status)) {
      timeline.push({
        status: 'picked_up',
        label: 'تم الاستلام من التاجر',
        date: shipment.shipped_at,
        done: true,
      });
    }

    if (['in_transit', 'out_for_delivery', 'delivered'].includes(shipment.status)) {
      timeline.push({
        status: 'in_transit',
        label: 'في الطريق',
        date: null,
        done: true,
      });
    }

    if (['out_for_delivery', 'delivered'].includes(shipment.status)) {
      timeline.push({
        status: 'out_for_delivery',
        label: 'خرج للتوصيل',
        date: null,
        done: true,
      });
    }

    if (shipment.status === 'delivered') {
      timeline.push({
        status: 'delivered',
        label: 'تم التسليم',
        date: shipment.delivered_at,
        done: true,
      });
    }

    res.json({
      success: true,
      data: {
        ...shipment,
        timeline,
      },
    });
  } catch (err: any) {
    console.error('❌ Track shipment error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تتبع الشحنة' });
  }
});

// ═══════════════════════════════════════
// POST /api/shipments/calculate-rate — حساب تكلفة الشحن
// ═══════════════════════════════════════
router.post('/calculate-rate', async (req: Request, res: Response) => {
  try {
    const { tenantId, carrier, weight, destination } = req.body;

    // Get tenant shipping settings
    const settingsResult = await pool.query(
      `SELECT settings FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    const settings = settingsResult.rows[0]?.settings || {};
    const shippingSettings = settings.shipping || {};

    let rate = 0;
    let estimatedDays = 0;

    switch (carrier) {
      case 'aramex': {
        const aramexConfig = shippingSettings.aramex || {};
        // Base rate + weight-based
        rate = parseFloat(aramexConfig.baseRate || '25');
        if (weight > 1) rate += (weight - 1) * parseFloat(aramexConfig.perKgRate || '5');
        estimatedDays = 2;
        break;
      }
      case 'dhl': {
        const dhlConfig = shippingSettings.dhl || {};
        rate = parseFloat(dhlConfig.baseRate || '35');
        if (weight > 1) rate += (weight - 1) * parseFloat(dhlConfig.perKgRate || '8');
        estimatedDays = 3;
        break;
      }
      case 'local': {
        rate = parseFloat(shippingSettings.local?.rate || '15');
        estimatedDays = 1;
        break;
      }
      case 'pickup': {
        rate = 0;
        estimatedDays = 0;
        break;
      }
    }

    // Check free shipping threshold
    const freeThreshold = parseFloat(shippingSettings.freeShippingThreshold || '0');
    if (freeThreshold > 0 && req.body.orderTotal >= freeThreshold) {
      rate = 0;
    }

    res.json({
      success: true,
      data: {
        carrier,
        rate,
        currency: 'QAR',
        estimatedDays,
        freeShipping: rate === 0 && freeThreshold > 0,
      },
    });
  } catch (err: any) {
    console.error('❌ Calculate rate error:', err.message);
    res.status(500).json({ success: false, error: 'فشل حساب تكلفة الشحن' });
  }
});

// ═══════════════════════════════════════
// GET /api/shipments/stats — إحصائيات الشحن
// ═══════════════════════════════════════
router.get('/stats/overview', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;

    const result = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'picked_up') as picked_up,
        COUNT(*) FILTER (WHERE status = 'in_transit') as in_transit,
        COUNT(*) FILTER (WHERE status = 'out_for_delivery') as out_for_delivery,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
        COUNT(*) FILTER (WHERE status = 'returned') as returned,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COALESCE(SUM(shipping_cost), 0) as total_cost,
        COALESCE(AVG(EXTRACT(EPOCH FROM (delivered_at - shipped_at)) / 86400) 
          FILTER (WHERE delivered_at IS NOT NULL), 0) as avg_delivery_days
       FROM shipments WHERE tenant_id = $1`,
      [tenantId]
    );

    const byCarrier = await pool.query(
      `SELECT carrier, COUNT(*) as count,
        COALESCE(SUM(shipping_cost), 0) as total_cost
       FROM shipments WHERE tenant_id = $1
       GROUP BY carrier`,
      [tenantId]
    );

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        byCarrier: byCarrier.rows,
      },
    });
  } catch (err: any) {
    console.error('❌ Shipment stats error:', err.message);
    res.status(500).json({ success: false, error: 'فشل تحميل الإحصائيات' });
  }
});

export default router;
