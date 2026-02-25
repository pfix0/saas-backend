/**
 * ساس — DB Seed
 * Usage: npm run db:seed
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('❌ DATABASE_URL not set'); process.exit(1); }

  const client = new pg.Client({ connectionString: url, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

  try {
    await client.connect();
    const passwordHash = await bcrypt.hash('password123', 12);

    // Tenant
    const t = await client.query(
      `INSERT INTO tenants (name, slug, description, currency, language, country, plan, status)
       VALUES ('متجر التجربة', 'demo-store', 'متجر تجريبي', 'QAR', 'ar', 'QA', 'pro', 'active')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id, slug`
    );
    const tenantId = t.rows[0].id;
    console.log(`✅ Tenant: demo-store (${tenantId})`);

    // Merchant
    await client.query(
      `INSERT INTO merchants (tenant_id, name, email, phone, password_hash, role, status)
       VALUES ($1, 'محمد أحمد', 'admin@saas.qa', '+97433000001', $2, 'owner', 'active')
       ON CONFLICT (email, tenant_id) DO NOTHING`,
      [tenantId, passwordHash]
    );
    console.log('✅ Merchant: admin@saas.qa / password123');

    // Categories
    for (const cat of ['عطور', 'بخور', 'دهن عود', 'هدايا']) {
      await client.query(
        `INSERT INTO categories (tenant_id, name, slug, status) VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING`,
        [tenantId, cat, cat.replace(/\s/g, '-')]
      );
    }
    console.log('✅ 4 Categories');

    // Products
    const products = [
      { name: 'دهن العود الكمبودي', price: 850 },
      { name: 'بخور الصندل الفاخر', price: 120 },
      { name: 'عطر المسك الأبيض', price: 250 },
      { name: 'طقم هدية فاخر', price: 450 },
    ];
    for (const p of products) {
      await client.query(
        `INSERT INTO products (tenant_id, name, slug, price, quantity, status, is_featured)
         VALUES ($1, $2, $3, $4, 50, 'active', true) ON CONFLICT DO NOTHING`,
        [tenantId, p.name, p.name.replace(/\s/g, '-'), p.price]
      );
    }
    console.log(`✅ ${products.length} Products`);
    console.log('\n🎉 Seed complete!');
  } catch (err: any) {
    console.error('❌ Failed:', err.message); process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
