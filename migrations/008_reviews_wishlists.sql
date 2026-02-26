-- ساس — محادثة ٨: البحث + المفضلة + التقييمات
-- Migration: reviews + wishlists

-- ═══ Reviews (تقييمات المنتجات) ═══
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(100) NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

-- ═══ Wishlists (المفضلة) ═══
CREATE TABLE IF NOT EXISTS wishlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlists_customer ON wishlists(customer_id);

-- ═══ Update products: add avg_rating + review_count ═══
ALTER TABLE products ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(2,1) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;

-- ═══ Pages: add sort_order if not exists ═══
ALTER TABLE pages ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
