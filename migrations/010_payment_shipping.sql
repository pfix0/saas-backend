-- ═══════════════════════════════════════
-- Migration 010: Payment Gateway Config columns
-- محادثة ١٠-١١: إضافة أعمدة لبوابات الدفع والشحن
-- ═══════════════════════════════════════

-- Add payment_ref to orders for external reference tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(255);

-- Add notes to shipments
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS notes TEXT;

-- Ensure tenant_settings table has proper structure
-- (should already exist from settings migration)
CREATE TABLE IF NOT EXISTS tenant_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

-- Index for faster payment lookups
CREATE INDEX IF NOT EXISTS idx_payments_gateway ON payments(tenant_id, gateway);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON shipments(tenant_id, carrier);
CREATE INDEX IF NOT EXISTS idx_shipments_status_carrier ON shipments(tenant_id, status, carrier);
