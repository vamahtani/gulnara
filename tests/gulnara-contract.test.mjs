import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
test('only protected catalog/read views and booking procedure are exposed', () => {
  const config = JSON.parse(read('packages/data/dab-config.json'));
  assert.deepEqual(Object.keys(config.entities), ['Catalog', 'Bookings', 'BookBouquet']);
  for (const [name, entity] of Object.entries(config.entities)) {
    assert.deepEqual(entity.permissions, [{ role: 'authenticated', actions: [name === 'BookBouquet' ? 'execute' : 'read'] }]);
  }
  assert.deepEqual(config.entities.BookBouquet.rest.methods, ['post']);
});
test('SQL contract contains atomic inventory, identity ownership, replay and private view guards (static only)', () => {
  const sql = read('packages/data/migrations/002-gulnara.sql');
  assert.match(sql, /SERVERPROPERTY\('EngineEdition'\)/);
  assert.match(sql, /SESSION_CONTEXT\(N'oid'\)/);
  assert.match(sql, /sp_getapplock/);
  assert.match(sql, /@LockOwner = 'Transaction'/);
  assert.match(sql, /AvailableStems < r\.StemsPerUnit \* @Units/);
  assert.match(sql, /AvailableStems = f\.AvailableStems - b\.ReservedStems/);
  assert.match(sql, /WHERE OwnerId = TRY_CONVERT/);
  assert.match(sql, /UNIQUE \(OwnerId, RequestId\)/);
  assert.match(sql, /@ExistingHash <> @Hash/);
  assert.match(sql, /IsPublished = 1 AND IsSample = 0/);
  assert.match(sql, /IF XACT_STATE\(\) <> 0 ROLLBACK/);
  assert.doesNotMatch(sql, /INSERT dbo\.(?:Flowers|Designs)\b/);
});
test('runtime grants deny base table bypass and revoke obsolete sample operations', () => {
  const grants = read('packages/data/permissions.sql');
  assert.match(grants, /DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo/);
  assert.match(grants, /REVOKE EXECUTE ON OBJECT::api\.CreateItem/);
  assert.match(grants, /GRANT EXECUTE ON OBJECT::api\.BookBouquet/);
  assert.doesNotMatch(grants, /GRANT (?:INSERT|UPDATE|DELETE)/);
});
test('migration files stay consecutive and checksummed, baseline migration is retained', () => {
  const names = readdirSync(new URL('../packages/data/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort();
  assert.deepEqual(names, ['001-initial.sql', '002-gulnara.sql', '003-vector-demo.sql', '004-bouquet-embeddings.sql', '005-public-search-budget.sql', '006-diskann-search.sql', '007-public-search-renewal.sql', '008-ann-readiness.sql', '009-ann-corpus-expansion.sql']);
  names.forEach((name, index) => {
    assert.equal(Number(name.slice(0, 3)), index + 1);
    assert.match(read(`packages/data/migrations/${name}`), new RegExp(`VALUES \\(${index + 1}, '\\$\\(MigrationHash\\)'\\)`));
  });
});
