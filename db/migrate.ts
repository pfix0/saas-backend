/**
 * ساس — DB Migration Runner
 * Usage: npm run db:migrate
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('❌ DATABASE_URL not set'); process.exit(1); }

  const client = new pg.Client({ connectionString: url, ssl: url.includes('railway') ? { rejectUnauthorized: false } : false });

  try {
    await client.connect();
    console.log('✅ Connected');
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await client.query(schema);
    console.log('✅ Schema applied');

    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
    console.log(`📊 ${tables.rows.length} tables created`);
    tables.rows.forEach((r, i) => console.log(`   ${i + 1}. ${r.table_name}`));
    console.log('\n🎉 Migration complete!');
  } catch (err: any) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
