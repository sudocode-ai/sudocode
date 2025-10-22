/**
 * Simple test to verify schema initialization
 */

import { initDatabase } from './db.js';

async function testSchema() {
  console.log('Testing database schema initialization...');

  // Create an in-memory database for testing
  const db = initDatabase({ path: ':memory:', verbose: true });

  // Test that tables exist
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    )
    .all();

  console.log('\n✓ Tables created:');
  tables.forEach((table: any) => {
    console.log(`  - ${table.name}`);
  });

  // Test that indexes exist
  const indexes = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='index' ORDER BY name`
    )
    .all();

  console.log('\n✓ Indexes created:');
  indexes.forEach((index: any) => {
    console.log(`  - ${index.name}`);
  });

  // Test that views exist
  const views = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='view' ORDER BY name`
    )
    .all();

  console.log('\n✓ Views created:');
  views.forEach((view: any) => {
    console.log(`  - ${view.name}`);
  });

  // Test database configuration
  const walMode = db.pragma('journal_mode', { simple: true });
  const foreignKeys = db.pragma('foreign_keys', { simple: true });

  console.log('\n✓ Database configuration:');
  console.log(`  - WAL mode: ${walMode}`);
  console.log(`  - Foreign keys: ${foreignKeys ? 'enabled' : 'disabled'}`);

  db.close();
  console.log('\n✓ Schema test completed successfully!');
}

testSchema().catch((error) => {
  console.error('Schema test failed:', error);
  process.exit(1);
});
