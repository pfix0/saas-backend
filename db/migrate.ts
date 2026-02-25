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

  const client = new pg.Client({ 
    connectionString: url, 
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false 
  });

  try {
    await client.connect();
    console.log('✅ Connected');
    
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    
    // Split by semicolons and run each statement individually
    const statements = schema.split(';').filter(s => s.trim().length > 0);
    let success = 0;
    let skipped = 0;
    
    for (const stmt of statements) {
      try {
        await client.query(stmt + ';');
        success++;
      } catch (err: any) {
        // Skip "already exists" errors
        if (err.message.includes('already exists')) {
          skipped++;
        } else {
          console.warn(`⚠️  ${err.message.substring(0, 80)}`);
        }
      }
    }

    console.log(`✅ Migration: ${success} applied, ${skipped} skipped (already exist)`);

    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    console.log(`📊 ${tables.rows.length} tables total`);
    console.log('🎉 Migration complete!');
  } catch (err: any) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
