import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { prepareDatabase, applyMigrations } from '../scripts/sql-database.mjs';

const password = `Aa1!${'1'.repeat(48)}`;
const files = readdirSync(new URL('../packages/data/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort();
const checksum = version => createHash('sha256').update(readFileSync(
  new URL(`../packages/data/migrations/${files[version - 1]}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
function fake({ engine = '5', collation = 'SQL_Latin1_General_CP1_CI_AS', history = '', recorded = '1' } = {}) {
  const calls = [];
  return { calls, sql: (database, args, input) => {
    calls.push({ database, args, input });
    const query = args.includes('-Q') ? args[args.indexOf('-Q') + 1] : '';
    if (query.includes('EngineEdition')) return engine;
    if (query.includes('DATABASEPROPERTYEX')) return collation;
    if (query.includes('CONCAT(Version')) return history;
    if (query.includes('SELECT COUNT(*) FROM dbo.SchemaVersions')) return recorded;
    return '';
  } };
}
test('shared SQL setup provisions master first, applies numbered migrations to appdb, and grants restricted runtime access', () => {
  const { calls, sql } = fake();
  prepareDatabase(sql, password);
  assert.equal(calls.find(call => call.args.some(arg => arg.includes('CREATE DATABASE'))).database, 'master');
  const migrations = calls.filter(call => call.args.some(arg => arg.startsWith('/schema/migrations/')));
  assert.equal(migrations.length, files.length);
  migrations.forEach((call, index) => {
    assert.equal(call.database, 'appdb');
    assert.ok(call.args.includes(`MigrationHash=${checksum(index + 1)}`));
  });
  assert.ok(calls.some(call => call.database === 'appdb' && call.args.includes('/schema/permissions.sql')));
});
test('shared SQL setup preserves existing matching migrations without reapplying them', () => {
  const { calls, sql } = fake({ history: files.map((_, index) => `${index + 1}:${checksum(index + 1)}`).join('\n') });
  prepareDatabase(sql, password);
  assert.equal(calls.filter(call => call.args.some(arg => arg.startsWith('/schema/migrations/'))).length, 0);
});
test('shared SQL setup rejects wrong engine and existing collation rather than resetting data', () => {
  assert.throws(() => prepareDatabase(fake({ engine: '3' }).sql, password), /EngineEdition 5/);
  assert.throws(() => prepareDatabase(fake({ collation: 'other' }).sql, password), /collation differs/);
});
test('shared SQL setup rejects altered, unknown and nonconsecutive migration history', () => {
  assert.throws(() => prepareDatabase(fake({ history: `1:${'0'.repeat(64)}` }).sql, password), /changed/);
  assert.throws(() => prepareDatabase(fake({ history: `${files.length + 1}:${'0'.repeat(64)}` }).sql, password), /unknown migrations/);
  assert.throws(() => prepareDatabase(fake({ history: `2:${checksum(2)}` }).sql, password), /not consecutive/);
});
test('shared SQL setup requires a committed migration checksum before proceeding', () => {
  assert.throws(() => prepareDatabase(fake({ recorded: '0' }).sql, password), /did not commit/);
});
test('cloud migrations reuse checksum rules without creating a login or grants', () => {
  const { calls, sql } = fake();
  applyMigrations(sql, file => `C:\\approved\\${file}`);
  assert.equal(calls.filter(call => call.args.includes('-i')).length, files.length);
  assert.ok(calls.every(call => call.database === 'appdb' && !call.input));
  assert.ok(calls.filter(call => call.args.includes('-i')).every(call => call.args.some(arg => arg.startsWith('C:\\approved\\'))));
});
test('a staged index rollout applies schema six before seed/index and preserves later checksum validation', () => {
  const { calls, sql } = fake();
  applyMigrations(sql, file => `C:\\approved\\${file}`, 6);
  assert.equal(calls.filter(call => call.args.includes('-i')).length, 6);
  assert.throws(() => applyMigrations(fake().sql, undefined, 0), /phase boundary/);
  const history = files.map((_, index) => `${index + 1}:${index === 6 ? '0'.repeat(64) : checksum(index + 1)}`).join('\n');
  assert.throws(() => applyMigrations(fake({ history }).sql, undefined, 6), /changed/);
});
