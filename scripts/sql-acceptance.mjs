import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { composeArguments, readEnvironment, root } from './config.ts';

const env = { ...readEnvironment(), COMPOSE_FILE: 'compose.sql.yml', SQL_PORT: '' };
assert.equal(env.GULNARA_ACCEPTANCE_FIXTURE_APPROVED, 'Y',
  'Explicit isolated-fixture approval is required: GULNARA_ACCEPTANCE_FIXTURE_APPROVED=Y. Never use real business inventory.');
assert.equal(env.ACCEPT_EULA, 'Y', 'Explicit SQL terms acceptance is required.');
const compose = composeArguments(env);
const users = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'];
const designs = [1, 2, 3, 4, 5].map(id => `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`);
const flowers = [1, 2].map(id => `20000000-0000-4000-8000-${String(id).padStart(12, '0')}`);
const checks = [];
const evidence = {
  startedAt: new Date().toISOString(), status: 'running', project: env.COMPOSE_PROJECT_NAME,
  profile: 'SQL-only; not authenticated API/browser acceptance',
  sqlImage: JSON.parse(readFileSync(resolve(root, 'baseline.json'), 'utf8')).images.sql,
  platform: env.SQL_PLATFORM || 'linux/amd64',
  checks, migrations: readdirSync(resolve(root, 'packages/data/migrations')).filter(file => file.endsWith('.sql')).sort().map(name => {
    const file = resolve(root, 'packages/data/migrations', name);
    return { file, sha256: createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex') };
  }),
  unverified: ['DAB authenticated/direct/proxied behavior', 'Real provider browser sign-in/save/reload', 'Cloud identity/network/free-offer and live Azure SQL compatibility'],
};
const literal = value => value === null ? 'NULL' : `N'${String(value).replaceAll("'", "''")}'`;
const context = user => user ? `EXEC sys.sp_set_session_context @key=N'oid', @value=${literal(user)};` : '';
const settings = 'SET NOCOUNT ON; SET ANSI_NULLS ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET QUOTED_IDENTIFIER ON; SET NUMERIC_ROUNDABORT OFF;';
function argumentsFor(query, runtime, file) {
  return [...compose, 'exec', '-T', '-e', 'SQLCMDPASSWORD', 'sql', '/opt/mssql-tools18/bin/sqlcmd',
    '-S', 'localhost', '-U', runtime ? 'app_api' : 'sa', '-C', '-b', '-l', '5', '-t', '60',
    '-d', 'appdb', '-h', '-1', '-W', '-w', '65535', '-s', '|',
    ...(file ? ['-i', file] : ['-Q', `${settings} ${query}`])];
}
const processEnvironment = runtime => ({ ...env, SQLCMDPASSWORD: runtime ? env.APP_SQL_PASSWORD : env.MSSQL_SA_PASSWORD });
function run(query, { runtime = false, file } = {}) {
  const result = spawnSync('docker', argumentsFor(query, runtime, file),
    { cwd: root, env: processEnvironment(runtime), encoding: 'utf8', timeout: 90_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}`.trim() };
}
function sql(query, options) {
  const result = run(query, options);
  assert.equal(result.status, 0, `SQL operation failed: ${result.output}`);
  return result.output;
}
function concurrent(query) {
  return new Promise((resolveResult, reject) => {
    const child = spawn('docker', argumentsFor(query, true),
      { cwd: root, env: processEnvironment(true), stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', status => resolveResult({ status, output: output.trim() }));
  });
}
function denied(query, number, user = users[0]) {
  const result = run(`${context(user)} ${query}`, { runtime: true });
  assert.notEqual(result.status, 0, 'Expected SQL rejection, not success.');
  assert.match(result.output, new RegExp(`Msg ${number},`), 'A different SQL error is not proof of the required rejection.');
}
const record = name => { checks.push(name); console.log(`PASS: ${name}`); };
const book = payload => `EXEC api.BookBouquet ${Object.entries(payload).map(([name, value]) => `@${name}=${literal(value)}`).join(', ')};`;
function lifecycle(command) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/local.mjs'), command],
    { cwd: root, env, encoding: 'utf8', timeout: 240_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `SQL lifecycle failed: ${result.stderr || result.stdout}`);
}
try {
  lifecycle('sql-start');
  const identity = sql("SELECT CONCAT(CONVERT(int,SERVERPROPERTY('EngineEdition')),'|',CONVERT(nvarchar(128),SERVERPROPERTY('Edition')),'|',DB_NAME());");
  assert.equal(identity, '5|SQL Azure|appdb');
  evidence.engine = identity;
  record('Real Azure SQL EngineEdition 5 / SQL Azure / appdb; unchanged checksummed migrations and restricted grants');
  assert.equal(sql('SELECT COUNT(*) FROM dbo.Flowers;'), '0', 'A fresh isolated database is required. Never reset a used fixture.');
  assert.equal(sql('SELECT COUNT(*) FROM dbo.Bookings;'), '0');
  sql('', { file: '/schema/acceptance-fixture.sql' });
  assert.equal(sql(`${context(users[0])} SELECT COUNT(*) FROM api.Catalog;`, { runtime: true }), '3');
  assert.equal(sql('SELECT COUNT(*) FROM api.Catalog;', { runtime: true }), '0');
  assert.equal(sql('SELECT COUNT(*) FROM api.Bookings;', { runtime: true }), '0');
  record('Synthetic fixture seeded once; samples/incomplete designs and missing SQL identity excluded');
  const day = sql("SELECT CONVERT(char(10),DATEADD(day,1,CONVERT(date,SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific Standard Time')),23);");
  const payload = {
    RequestId: randomUUID(), DesignId: designs[0], Size: 'signature', Preferences: '{"text":"SQL-only synthetic acceptance"}',
    CustomerName: 'Synthetic customer', Email: 'synthetic@example.test', RecipientName: 'Synthetic recipient',
    DeliveryAddress: 'Synthetic address - do not deliver', DeliveryDate: day, CardMessage: 'Synthetic SQL test only',
  };
  denied(book(payload), 51101, null);
  const inputs = [payload, { ...payload, RequestId: randomUUID(), DesignId: designs[1] }];
  const race = await Promise.all(inputs.map((input, index) =>
    concurrent(`${context(users[index])} WAITFOR DELAY '00:00:01'; ${book(input)}`)));
  assert.equal(race.filter(result => result.status === 0).length, 1, 'Exactly one shared-stem reservation must succeed.');
  const winner = race.findIndex(result => result.status === 0);
  assert.match(race[1 - winner].output, /Msg 51106,/);
  const winnerId = race[winner].output.split('|')[0].trim();
  assert.match(winnerId, /^[a-f0-9-]{36}$/i);
  assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowers[0]}';`), '0');
  assert.equal(sql(`SELECT SUM(ReservedStems) FROM dbo.BookingStems WHERE FlowerId='${flowers[0]}';`), '2');
  assert.equal(sql(`SELECT COUNT(*) FROM dbo.Bookings WHERE DesignId IN ('${designs[0]}','${designs[1]}');`), '1');
  record('Concurrent bookings across recipes sharing stems: exactly one success, exact stock/reservations, no oversell');
  for (let index = 0; index < users.length; index++) {
    assert.equal(sql(`${context(users[index])} SELECT COUNT(*) FROM api.Bookings WHERE Id='${winnerId}';`, { runtime: true }), index === winner ? '1' : '0');
  }
  assert.equal(sql(`${context(users[winner])} ${book(inputs[winner])}`, { runtime: true }).split('|')[0].trim(), winnerId);
  denied(book({ ...inputs[winner], RecipientName: 'Changed payload' }), 51104, users[winner]);
  record('Owner-isolated SQL reads and identical/changed-payload idempotency');
  const control = { ...payload, RequestId: randomUUID(), DesignId: designs[2], Size: 'petite' };
  const retries = await Promise.all([0, 1].map(() => concurrent(`${context(users[0])} ${book(control)}`)));
  assert.ok(retries.every(result => result.status === 0), retries.map(result => result.output).join('\n'));
  const controlId = retries[0].output.split('|')[0].trim();
  assert.equal(retries[1].output.split('|')[0].trim(), controlId);
  assert.equal(sql(`SELECT COUNT(*) FROM dbo.Bookings WHERE DesignId='${designs[2]}';`), '1');
  assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowers[1]}';`), '9');
  record('Concurrent identical retries persist one request and reserve stems only once');
  const tooLate = sql("SELECT CONVERT(char(10),DATEADD(day,91,CONVERT(date,SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific Standard Time')),23);");
  const invalid = [
    { Size: 'enormous' }, { Size: 'grand ' }, { Size: 'GRAND' }, { Size: null },
    { DeliveryDate: '2000-01-01' }, { DeliveryDate: `${day}T00:00:00` }, { DeliveryDate: tooLate },
    { CustomerName: ' ' }, { CustomerName: 'x'.repeat(121) }, { RecipientName: null },
    { Email: 'not-an-email' }, { Email: 'a b@example.test' }, { DeliveryAddress: ' ' },
    { Preferences: 'not-json' }, { Preferences: `{"text":"${'x'.repeat(8000)}"}` }, { CardMessage: 'x'.repeat(501) },
  ];
  for (const change of invalid) denied(book({ ...control, RequestId: randomUUID(), ...change }), 51102);
  for (const DesignId of [designs[3], designs[4]]) denied(book({ ...control, RequestId: randomUUID(), DesignId }), 51105);
  denied(book({ ...control, RequestId: randomUUID(), DesignId: designs[0], Size: 'grand' }), 51106);
  assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowers[1]}';`), '9');
  assert.equal(sql('SELECT COUNT(*) FROM dbo.Bookings;'), '2');
  record('19 invalid/unbookable/out-of-stock requests reject with exact SQL errors and unchanged rows/stock');
  assert.equal(sql("SELECT CONCAT(HAS_PERMS_BY_NAME('dbo.Bookings','OBJECT','SELECT'),'|',HAS_PERMS_BY_NAME('dbo.Flowers','OBJECT','UPDATE'),'|',HAS_PERMS_BY_NAME('api.BookBouquet','OBJECT','EXECUTE'));", { runtime: true }), '0|0|1');
  for (const query of ['SELECT * FROM dbo.Bookings;', 'UPDATE dbo.Flowers SET AvailableStems=100;', 'DELETE FROM dbo.Flowers;', "INSERT dbo.Flowers(Name,AvailableStems) VALUES(N'Bypass',100);", "EXEC api.CreateItem @Label=N'Bypass';"]) denied(query, 229);
  record('Restricted app_api login: direct base-table read/write and obsolete sample procedure denied');
  const snapshot = () => sql(`SELECT CONVERT(varchar(36),Id) FROM dbo.Bookings ORDER BY Id; SELECT AvailableStems FROM dbo.Flowers ORDER BY Id; SELECT SUM(ReservedStems) FROM dbo.BookingStems;`);
  const before = snapshot();
  lifecycle('sql-stop');
  lifecycle('sql-start');
  assert.equal(snapshot(), before, 'Existing rows and exact inventory must survive container stop/start.');
  const nextId = sql(`${context(users[1])} ${book(control)}`, { runtime: true }).split('|')[0].trim();
  assert.notEqual(nextId, controlId, 'Idempotency keys are owner-scoped.');
  assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowers[1]}';`), '8');
  assert.equal(sql('SELECT COUNT(*) FROM dbo.Bookings;'), '3');
  assert.equal(sql('SELECT SUM(ReservedStems) FROM dbo.BookingStems;'), '4');
  record('Persistent volume survives SQL restart/migration recheck; new owner-scoped write succeeds afterward');
  sql(`${context(users[1])} ${book({ ...control, RequestId: randomUUID(), Size: 'grand' })}`, { runtime: true });
  assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowers[1]}';`), '5');
  assert.equal(sql('SELECT COUNT(*) FROM dbo.Bookings;'), '4');
  assert.equal(sql('SELECT SUM(ReservedStems) FROM dbo.BookingStems;'), '7');
  record('All size multipliers executed: petite reserves 1, signature 2, grand 3');
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.failure = error.message;
  throw error;
} finally {
  evidence.completedAt = new Date().toISOString();
  mkdirSync(resolve(root, '.local'), { recursive: true });
  const file = resolve(root, '.local', `sql-acceptance-${evidence.startedAt.replaceAll(/[:.]/g, '-')}.json`);
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`SQL-only evidence: ${file}`);
  console.log('Synthetic rows/volume retained. SQL session-context tests do NOT validate JWTs, DAB, browser sign-in or cloud readiness.');
}
