-- ══════════════════════════════════════════════════════════════
-- ساس — Complete Database Schema
-- PostgreSQL (Netlify DB / Neon)
-- ══════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════
-- 1. TENANTS (المتاجر)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,                          -- اسم المتجر
  slug          VARCHAR(100) NOT NULL UNIQUE,                   -- الرابط (subdomain)
  logo_url      TEXT,
  description   TEXT,
  domain        VARCHAR(255),                                   -- دومين مخصص
  currency      VARCHAR(3) DEFAULT 'QAR',                       -- العملة
  language      VARCHAR(5) DEFAULT 'ar',                        -- اللغة
  timezone      VARCHAR(50) DEFAULT 'Asia/Qatar',
  country       VARCHAR(2) DEFAULT 'QA',
  phone         VARCHAR(20),
  email         VARCHAR(255),
  plan          VARCHAR(20) DEFAULT 'basic'                     -- basic | growth | pro
                CHECK (plan IN ('basic', 'growth', 'pro')),
  status        VARCHAR(20) DEFAULT 'active'                    -- active | suspended | trial
                CHECK (status IN ('active', 'suspended', 'trial')),
  trial_ends_at TIMESTAMPTZ,
  theme         VARCHAR(50) DEFAULT 'default',
  theme_config  JSONB DEFAULT '{}',                             -- ألوان وإعدادات الثيم
  meta          JSONB DEFAULT '{}',                             -- بيانات إضافية
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- ═══════════════════════════════════════
-- 2. MERCHANTS (التجار / المستخدمون)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS merchants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  phone         VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) DEFAULT 'owner'                     -- owner | admin | staff
                CHECK (role IN ('owner', 'admin', 'staff')),
  permissions   JSONB DEFAULT '[]',                             -- صلاحيات مخصصة
  avatar_url    TEXT,
  status        VARCHAR(20) DEFAULT 'active'
                CHECK (status IN ('active', 'inactive', 'suspended')),
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(email, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_merchants_tenant ON merchants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);

-- ═══════════════════════════════════════
-- 3. CATEGORIES (التصنيفات)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) NOT NULL,
  description   TEXT,
  image_url     TEXT,
  parent_id     UUID REFERENCES categories(id) ON DELETE SET NULL, -- تصنيف فرعي
  sort_order    INTEGER DEFAULT 0,
  status        VARCHAR(20) DEFAULT 'active'
                CHECK (status IN ('active', 'inactive')),
  meta          JSONB DEFAULT '{}',                             -- SEO meta
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(slug, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(tenant_id, slug);

-- ═══════════════════════════════════════
-- 4. PRODUCTS (المنتجات)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  name          VARCHAR(500) NOT NULL,
  slug          VARCHAR(500) NOT NULL,
  description   TEXT,
  price         DECIMAL(12, 2) NOT NULL DEFAULT 0,              -- السعر
  sale_price    DECIMAL(12, 2),                                 -- سعر التخفيض
  cost_price    DECIMAL(12, 2),                                 -- سعر التكلفة
  sku           VARCHAR(100),
  barcode       VARCHAR(100),
  quantity      INTEGER DEFAULT 0,                              -- الكمية
  weight        DECIMAL(8, 2),                                  -- الوزن (كجم)
  type          VARCHAR(20) DEFAULT 'physical'                  -- physical | digital
                CHECK (type IN ('physical', 'digital')),
  status        VARCHAR(20) DEFAULT 'active'
                CHECK (status IN ('active', 'draft', 'archived')),
  is_featured   BOOLEAN DEFAULT FALSE,                          -- منتج مميز
  tags          TEXT[] DEFAULT '{}',                             -- تاقز
  meta          JSONB DEFAULT '{}',                             -- SEO + بيانات إضافية
  views_count   INTEGER DEFAULT 0,
  sales_count   INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(slug, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(tenant_id, is_featured) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_products_search ON products USING gin(to_tsvector('arabic', name || ' ' || COALESCE(description, '')));

-- ═══════════════════════════════════════
-- 5. PRODUCT IMAGES (صور المنتجات)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS product_images (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  alt_text      VARCHAR(255),
  sort_order    INTEGER DEFAULT 0,
  is_main       BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

-- ═══════════════════════════════════════
-- 6. PRODUCT OPTIONS (خيارات المنتج - لون/مقاس)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS product_options (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,                          -- مثل: اللون، المقاس
  display_type  VARCHAR(20) DEFAULT 'dropdown'                  -- dropdown | color | button
                CHECK (display_type IN ('dropdown', 'color', 'button')),
  values        JSONB NOT NULL DEFAULT '[]',                    -- ["أحمر", "أزرق"] أو [{label, value, color}]
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_options_product ON product_options(product_id);

-- ═══════════════════════════════════════
-- 7. PRODUCT VARIANTS (متغيرات المنتج)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS product_variants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku           VARCHAR(100),
  price         DECIMAL(12, 2),                                 -- سعر خاص للمتغير
  sale_price    DECIMAL(12, 2),
  quantity      INTEGER DEFAULT 0,
  weight        DECIMAL(8, 2),
  option_values JSONB NOT NULL DEFAULT '{}',                    -- {"اللون": "أحمر", "المقاس": "XL"}
  image_url     TEXT,
  status        VARCHAR(20) DEFAULT 'active'
                CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);

-- ═══════════════════════════════════════
-- 8. CUSTOMERS (العملاء)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255),
  phone         VARCHAR(20),
  email         VARCHAR(255),
  status        VARCHAR(20) DEFAULT 'active'
                CHECK (status IN ('active', 'blocked')),
  notes         TEXT,
  orders_count  INTEGER DEFAULT 0,
  total_spent   DECIMAL(12, 2) DEFAULT 0,
  last_order_at TIMESTAMPTZ,
  meta          JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(phone, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(tenant_id, email) WHERE email IS NOT NULL;

-- ═══════════════════════════════════════
-- 9. ADDRESSES (عناوين العملاء)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS addresses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label         VARCHAR(100) DEFAULT 'المنزل',                  -- المنزل، العمل
  name          VARCHAR(255),
  phone         VARCHAR(20),
  country       VARCHAR(2) DEFAULT 'QA',
  city          VARCHAR(100),
  area          VARCHAR(255),
  street        VARCHAR(255),
  building      VARCHAR(100),
  floor_number  VARCHAR(20),
  apartment     VARCHAR(20),
  postal_code   VARCHAR(20),
  notes         TEXT,
  latitude      DECIMAL(10, 8),
  longitude     DECIMAL(11, 8),
  is_default    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id);

-- ═══════════════════════════════════════
-- 10. ORDERS (الطلبات)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  order_number    VARCHAR(20) NOT NULL,                          -- رقم الطلب (SAS-00001)
  
  -- المبالغ
  subtotal        DECIMAL(12, 2) NOT NULL DEFAULT 0,             -- المجموع الفرعي
  shipping_cost   DECIMAL(12, 2) DEFAULT 0,                      -- تكلفة الشحن
  discount_amount DECIMAL(12, 2) DEFAULT 0,                      -- مبلغ الخصم
  tax_amount      DECIMAL(12, 2) DEFAULT 0,                      -- الضريبة
  total           DECIMAL(12, 2) NOT NULL DEFAULT 0,             -- الإجمالي
  
  -- الحالة
  status          VARCHAR(30) DEFAULT 'new'                      -- new | confirmed | processing | shipped | delivered | cancelled | returned
                  CHECK (status IN ('new', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned')),
  
  -- الدفع
  payment_method  VARCHAR(30),                                   -- sadad | skipcash | cod
  payment_status  VARCHAR(20) DEFAULT 'pending'                  -- pending | paid | failed | refunded
                  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  
  -- الشحن
  shipping_method VARCHAR(30),                                   -- aramex | dhl | pickup
  shipping_address JSONB,                                        -- snapshot من العنوان
  
  -- بيانات إضافية
  coupon_code     VARCHAR(50),
  customer_notes  TEXT,                                           -- ملاحظات العميل
  admin_notes     TEXT,                                           -- ملاحظات التاجر
  meta            JSONB DEFAULT '{}',
  
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(order_number, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(tenant_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(tenant_id, order_number);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(tenant_id, created_at DESC);

-- ═══════════════════════════════════════
-- 11. ORDER ITEMS (عناصر الطلب)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS order_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id    UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  
  -- Snapshot (نسخة وقت الطلب)
  name          VARCHAR(500) NOT NULL,
  sku           VARCHAR(100),
  image_url     TEXT,
  options       JSONB DEFAULT '{}',                              -- {"اللون": "أحمر"}
  
  price         DECIMAL(12, 2) NOT NULL,                         -- سعر الوحدة
  quantity      INTEGER NOT NULL DEFAULT 1,
  total         DECIMAL(12, 2) NOT NULL,                         -- السعر × الكمية
  
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- ═══════════════════════════════════════
-- 12. ORDER STATUS HISTORY (تاريخ حالات الطلب)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS order_status_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status        VARCHAR(30) NOT NULL,
  note          TEXT,
  changed_by    UUID,                                           -- merchant_id أو NULL للنظام
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_order ON order_status_history(order_id);

-- ═══════════════════════════════════════
-- 13. PAYMENTS (المعاملات المالية)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  gateway         VARCHAR(30) NOT NULL,                          -- sadad | skipcash | cod
  amount          DECIMAL(12, 2) NOT NULL,
  currency        VARCHAR(3) DEFAULT 'QAR',
  status          VARCHAR(20) DEFAULT 'pending'                  -- pending | completed | failed | refunded
                  CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  transaction_id  VARCHAR(255),                                  -- معرف البوابة
  gateway_response JSONB DEFAULT '{}',                           -- رد البوابة الكامل
  refund_amount   DECIMAL(12, 2),
  refund_reason   TEXT,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id);

-- ═══════════════════════════════════════
-- 14. SHIPMENTS (الشحنات)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS shipments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier         VARCHAR(30) NOT NULL,                          -- aramex | dhl
  tracking_number VARCHAR(100),
  label_url       TEXT,                                          -- رابط بوليصة الشحن
  status          VARCHAR(30) DEFAULT 'pending'
                  CHECK (status IN ('pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'failed')),
  estimated_delivery TIMESTAMPTZ,
  shipping_cost   DECIMAL(12, 2),
  weight          DECIMAL(8, 2),
  dimensions      JSONB,                                         -- {length, width, height}
  carrier_response JSONB DEFAULT '{}',
  shipped_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_tenant ON shipments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);

-- ═══════════════════════════════════════
-- 15. COUPONS (كوبونات الخصم)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS coupons (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          VARCHAR(50) NOT NULL,
  type          VARCHAR(20) NOT NULL DEFAULT 'percentage'        -- percentage | fixed
                CHECK (type IN ('percentage', 'fixed')),
  value         DECIMAL(12, 2) NOT NULL,                         -- النسبة أو المبلغ
  min_order     DECIMAL(12, 2) DEFAULT 0,                        -- الحد الأدنى للطلب
  max_discount  DECIMAL(12, 2),                                  -- أقصى خصم (للنسبة)
  max_uses      INTEGER,                                         -- عدد مرات الاستخدام
  used_count    INTEGER DEFAULT 0,
  applies_to    VARCHAR(20) DEFAULT 'all'                        -- all | products | categories
                CHECK (applies_to IN ('all', 'products', 'categories')),
  product_ids   UUID[] DEFAULT '{}',
  category_ids  UUID[] DEFAULT '{}',
  status        VARCHAR(20) DEFAULT 'active'
                CHECK (status IN ('active', 'inactive', 'expired')),
  starts_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(code, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON coupons(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(tenant_id, code);

-- ═══════════════════════════════════════
-- 16. PAGES (الصفحات الثابتة)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS pages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) NOT NULL,
  content       TEXT,
  status        VARCHAR(20) DEFAULT 'published'
                CHECK (status IN ('published', 'draft')),
  sort_order    INTEGER DEFAULT 0,
  meta          JSONB DEFAULT '{}',                              -- SEO
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(slug, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_pages_tenant ON pages(tenant_id);

-- ═══════════════════════════════════════
-- 17. STORE SETTINGS (إعدادات المتجر)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS store_settings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key           VARCHAR(100) NOT NULL,
  value         JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_store_settings_tenant ON store_settings(tenant_id);

-- ═══════════════════════════════════════
-- 18. REVIEWS (التقييمات)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS reviews (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  rating        INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment       TEXT,
  status        VARCHAR(20) DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON reviews(tenant_id);

-- ═══════════════════════════════════════
-- 19. WISHLIST (المفضلة)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS wishlist (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_customer ON wishlist(customer_id);

-- ═══════════════════════════════════════
-- 20. OTP CODES (رموز التحقق)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS otp_codes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone         VARCHAR(20) NOT NULL,
  code          VARCHAR(6) NOT NULL,
  purpose       VARCHAR(20) DEFAULT 'login'                     -- login | verify
                CHECK (purpose IN ('login', 'verify')),
  attempts      INTEGER DEFAULT 0,
  is_used       BOOLEAN DEFAULT FALSE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, is_used);

-- ═══════════════════════════════════════
-- UPDATED_AT TRIGGER (تحديث تلقائي)
-- ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'updated_at'
    AND table_schema = 'public'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      t, t
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;
