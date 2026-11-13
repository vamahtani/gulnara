import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { composeArguments, localConfiguration, localEndpoints, readEnvironment, root } from './config.ts';

// Real-provider acceptance only. Never intercept API calls or forge identity here.
const env = readEnvironment();
const config = localConfiguration(env);
const apiOrigin = localEndpoints(env).api;
const origin = new URL(config.publicConfig.redirectUri).origin;
const tokens = [env.ACCEPTANCE_TOKEN_A, env.ACCEPTANCE_TOKEN_B];
if (tokens.some(token => !token)) throw new Error('Supply two approved real API tokens through secure environment variables ACCEPTANCE_TOKEN_A/B.');
const claims = tokens.map(token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url')));
assert.ok(claims.every(claim => /^[a-f0-9-]{36}$/i.test(claim.oid) && claim.exp > Date.now() / 1000 + 300), 'Two synthetic test identities with oid and five minutes remaining are required.');
assert.notEqual(claims[0].oid, claims[1].oid);
assert.equal(env.GULNARA_ACCEPTANCE_FIXTURE_APPROVED, 'Y', 'Explicit approval for the isolated fixture is required. Review packages/data/acceptance-fixture.sql.');
const raceId = '10000000-0000-4000-8000-000000000001';
const sharedId = '10000000-0000-4000-8000-000000000002';
const controlId = '10000000-0000-4000-8000-000000000003';
const sampleId = '10000000-0000-4000-8000-000000000004';
const incompleteId = '10000000-0000-4000-8000-000000000005';
const flowerId = '20000000-0000-4000-8000-000000000001';
const flowerControl = '20000000-0000-4000-8000-000000000002';
let stack;
async function start() {
  stack = fork(resolve(root, 'scripts/local.mjs'), ['start'], {
    env: { ...env, ACCEPTANCE_TOKEN_A: '', ACCEPTANCE_TOKEN_B: '' }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  const [event] = await Promise.race([
    once(stack, 'message'),
    once(stack, 'exit').then(() => { throw new Error('Stack exited before acceptance readiness.'); }),
  ]);
  assert.equal(event, 'ready');
}
async function stop() {
  if (!stack || stack.exitCode !== null) return;
  const exited = once(stack, 'exit');
  stack.send('stop');
  const [code] = await exited;
  assert.equal(code, 0, 'Stack must shut down cleanly.');
}
function sql(query, runtime = false) {
  const result = spawnSync('docker', [...composeArguments(env),
    'exec', '-T', '-e', 'SQLCMDPASSWORD', 'sql', '/opt/mssql-tools18/bin/sqlcmd',
    '-S', 'localhost', '-U', runtime ? 'app_api' : 'sa', '-C', '-b', '-d', 'appdb', '-h', '-1', '-W', '-Q', `SET NOCOUNT ON; ${query}`],
  { cwd: root, env: { ...env, SQLCMDPASSWORD: runtime ? env.APP_SQL_PASSWORD : env.MSSQL_SA_PASSWORD }, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Independent SQL observation must succeed; inspect local operator diagnostics without publishing secrets.');
  return result.stdout.trim();
}
const request = (base, path, token, body, extraHeaders = {}) => fetch(`${base}/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extraHeaders },
  body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
});
async function rows(token, filter) {
  const response = await request(origin, `Bookings?$first=100&$filter=${encodeURIComponent(filter)}`, token);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(Array.isArray(result.value));
  return result.value;
}
async function rejected(response) {
  assert.ok([400, 500].includes(response.status), `Expected a DAB database rejection, not an auth or transport failure; got ${response.status}`);
  const result = await response.json();
  assert.equal(result.error?.code, 'DatabaseOperationFailed', 'Unexpected rejection contract: investigate rather than loosening acceptance.');
}
try {
  await start();
  assert.equal(sql(`SELECT CONCAT(CONVERT(int,SERVERPROPERTY('EngineEdition')), ':', DB_NAME());`), '5:appdb');
  assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowerId}';`), '2', 'Fresh fixture must have exactly two shared stems. Never reset a used fixture.');
  assert.equal(sql(`SELECT COUNT(*) FROM dbo.Bookings WHERE DesignId IN ('${raceId}','${sharedId}','${controlId}');`), '0', 'Use a fresh isolated fixture, not a reset.');
  for (const base of [origin, apiOrigin]) {
    const catalogResponse = await request(base, 'Catalog', tokens[0]);
    assert.equal(catalogResponse.status, 200);
    const catalog = (await catalogResponse.json()).value;
    assert.ok(Array.isArray(catalog));
    assert.ok(catalog.some(design => design.Id.toLowerCase() === raceId));
    assert.ok(catalog.every(design => ![sampleId, incompleteId].includes(design.Id.toLowerCase())), 'Samples and incomplete recipes must not enter the live catalog.');
    for (const path of ['Catalog', 'Bookings']) {
      for (const [token, headers] of [[undefined, {}], [undefined, { 'X-MS-API-ROLE': 'authenticated', 'X-MS-CLIENT-PRINCIPAL': 'forged' }], [`${tokens[0].slice(0, -8)}invalid!`, {}]]) {
        assert.ok([401, 403].includes((await request(base, path, token, undefined, headers)).status));
      }
    }
    assert.ok([401, 403].includes((await request(base, 'BookBouquet', undefined, {})).status));
    const bypass = await request(base, 'Catalog', tokens[0], { Name: 'Bypass' });
    assert.ok([400, 403, 405].includes(bypass.status), 'Read views must reject writes.');
    assert.ok([400, 403, 405].includes((await request(base, 'Bookings', tokens[0], {})).status));
  }
  const today = sql("SELECT CONVERT(char(10), DATEADD(day,1,CONVERT(date,SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific Standard Time')),23);");
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  const payload = {
    RequestId: randomUUID(), DesignId: raceId, Size: 'signature', Preferences: '{"text":"synthetic acceptance"}',
    CustomerName: 'Synthetic customer', Email: 'synthetic@example.test', RecipientName: 'Synthetic recipient',
    DeliveryAddress: 'Synthetic address - do not deliver', DeliveryDate: today, CardMessage: 'Synthetic acceptance only',
  };
  const filter = `DesignName eq 'Acceptance shared A' or DesignName eq 'Acceptance shared B'`;
  const inputs = [payload, { ...payload, RequestId: randomUUID(), DesignId: sharedId }];
  const responses = await Promise.all([
    request(origin, 'BookBouquet', tokens[0], inputs[0]),
    request(apiOrigin, 'BookBouquet', tokens[1], inputs[1]),
  ]);
  assert.equal(responses.filter(response => response.ok).length, 1, 'Exactly one competing shared-stem reservation must succeed.');
  const winner = responses.findIndex(response => response.ok);
  const loser = 1 - winner;
  await rejected(responses[loser]);
  const winnerRows = (await responses[winner].json()).value;
  assert.equal(winnerRows.length, 1);
  assert.equal(winnerRows[0].Status, 'requested');
  assert.equal((await rows(tokens[winner], filter)).length, 1);
  assert.equal((await rows(tokens[loser], filter)).length, 0, 'Customer ownership must isolate private records.');
  assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowerId}';`), '0');
  assert.equal(sql(`SELECT SUM(ReservedStems) FROM dbo.BookingStems WHERE FlowerId='${flowerId}';`), '2');
  assert.equal(sql(`SELECT COUNT(*) FROM dbo.Bookings WHERE DesignId IN ('${raceId}','${sharedId}');`), '1');
  const controlInput = { ...payload, RequestId: randomUUID(), DesignId: controlId, Size: 'petite' };
  const controls = await Promise.all([
    request(origin, 'BookBouquet', tokens[0], controlInput),
    request(apiOrigin, 'BookBouquet', tokens[0], controlInput),
  ]);
  assert.ok(controls.every(response => response.ok), 'Concurrent identical retries must succeed as one independent booking.');
  // Token A owns this independent control regardless of who wins the race.
  const controlRow = (await controls[0].json()).value[0];
  assert.equal((await controls[1].json()).value[0].Id, controlRow.Id, 'Concurrent retries must return the same persisted ID.');
  assert.ok(controlRow?.Id);
  assert.equal(sql(`SELECT COUNT(*) FROM dbo.Bookings WHERE DesignId='${controlId}';`), '1');
  {
    const winnerInput = inputs[winner];
    const replay = await request(origin, 'BookBouquet', tokens[winner], winnerInput);
    assert.equal(replay.ok, true);
    assert.deepEqual((await replay.json()).value, winnerRows, 'Identical retries must return the original persisted request.');
    await rejected(await request(origin, 'BookBouquet', tokens[winner], { ...winnerInput, RecipientName: 'Changed payload' }));
    assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowerId}';`), '0');
  }
  for (const invalid of [{ Size: 'enormous' }, { Size: 'grand ' }, { DeliveryDate: '2000-01-01' }, { CustomerName: ' ' }, { Email: 'not-an-email' }, { DesignId: sampleId }, { DesignId: incompleteId }]) {
    await rejected(await request(origin, 'BookBouquet', tokens[0], { ...payload, RequestId: randomUUID(), DesignId: controlId, ...invalid }));
    assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowerControl}';`), '9', 'Rejected writes must not reserve stems.');
  }
  assert.equal(sql("SELECT HAS_PERMS_BY_NAME('dbo.Bookings','OBJECT','SELECT'), HAS_PERMS_BY_NAME('dbo.Flowers','OBJECT','UPDATE'), HAS_PERMS_BY_NAME('api.BookBouquet','OBJECT','EXECUTE');", true), '0 0 1');
  const before = await rows(tokens[winner], filter);
  await stop(); await start();
  assert.deepEqual(await rows(tokens[winner], filter), before, 'Private requests must survive full stack restart.');
  assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowerId}';`), '0');
  const afterRestart = await request(origin, 'BookBouquet', tokens[1], { ...payload, RequestId: randomUUID(), DesignId: controlId, Size: 'petite' });
  assert.equal(afterRestart.ok, true, 'New writes must work after restart.');
  assert.equal(sql(`SELECT AvailableStems FROM dbo.Flowers WHERE Id='${flowerControl}';`), '8');
  console.log('REAL LOCAL API/SQL ACCEPTANCE PASSED: denial, ownership, shared inventory race, invalid writes, restricted grants and restart/new write.');
  console.log('Synthetic evidence rows retained. Real browser provider sign-in/save/reload remains a separate required check.');
} finally { await stop(); }
