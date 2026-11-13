import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateEmbedding, validateQuery, validateConfiguration, requestEmbeddings, validateResults, seedSql, catalogSeedSql, diskANNSeedSql, loadCatalogStudies, loadDiskANNStudies, loadExpandedANNStudies, loadRefinedANNStudies, refinementSql, approveCatalogRefinement, refineCatalog, searchSql, createDemoServer, reserveAttempt, approveCatalogExpansion, approveDiskANNExpansion, approvePrivateSearchRenewal, approveANNCorpusExpansion, readBudget, status } from '../scripts/vector-demo.mjs';

const vector = () => [1, ...Array(1535).fill(0)];
const config = { subscription: '00000000-0000-0000-0000-000000000001', endpoint: 'https://approved.openai.azure.com/', deployment: 'embedding' };
test('refined catalog preserves100 and adds200 distinctive descriptions about shape, palette and intent', () => {
  const previous = loadExpandedANNStudies(), refined = loadRefinedANNStudies();
  assert.deepEqual(refined.slice(0, 100), previous.slice(0, 100));
  assert.equal(new Set(refined.map(study => study.description)).size, 300);
  for (let index = 100; index < 300; index++) {
    assert.notEqual(refined[index].description, previous[index].description);
    assert.deepEqual({ ...refined[index], description: previous[index].description }, previous[index]);
    assert.ok(refined[index].description.split('.').length >= 4);
    assert.doesNotMatch(refined[index].description, /graduation flowers:|lush and warm bouquet/);
  }
  assert.ok(refined.slice(100).reduce((sum, study) => sum + Buffer.byteLength(study.description) + 16, 0) <= 50000);
});
test('refinement adds exactly one bounded local seed approval without resetting history', t => {
  const state = { seedAttempts: 2, searchAttempts: 11, tokens: 1000 };
  approveCatalogExpansion(state); reserveAttempt(state, 'catalog-seed');
  approveDiskANNExpansion(state); reserveAttempt(state, 'diskann-seed');
  state.searchAttempts = 31; approvePrivateSearchRenewal(state, 100);
  approveANNCorpusExpansion(state); reserveAttempt(state, 'ann-corpus-seed');
  const prior = structuredClone(state);
  approveCatalogRefinement(state);
  assert.equal(state.authorizedSeedAttempts, 6);
  assert.equal(state.authorizedSearchAttempts, prior.authorizedSearchAttempts);
  assert.equal(state.tokens, prior.tokens);
  assert.deepEqual(state.annCorpusExpansionApproval, prior.annCorpusExpansionApproval);
  assert.throws(() => approveCatalogRefinement(state), /Only one/);
  assert.throws(() => reserveAttempt(state, 'ann-corpus-seed'), /only for/);
  reserveAttempt(state, 'catalog-refinement');
  assert.throws(() => reserveAttempt(state, 'catalog-refinement'), /already attempted/);
  const file = join(tmpdir(), `gulnara-refinement-${randomUUID()}.json`);
  t.after(() => unlinkSync(file));
  writeFileSync(file, JSON.stringify(state));
  assert.deepEqual(readBudget(file), state);
  for (const change of [{ catalogRefinementApproval: undefined }, { authorizedSeedAttempts: 7 },
    { catalogRefinementApproval: { ...state.catalogRefinementApproval, scope: 'cloud' } },
    { catalogRefinementApproval: { ...state.catalogRefinementApproval, maximumInputTokens: 50001 } },
    { searchAttempts: 0 }, { tokens: 0 }]) {
    writeFileSync(file, JSON.stringify({ ...state, ...change }));
    assert.throws(() => readBudget(file), /Invalid AI usage ledger/);
  }
});
test('refinement SQL atomically checks old/new revisions and updates only200 paired records', () => {
  const previous = loadExpandedANNStudies(), refined = loadRefinedANNStudies();
  const vectors = previous.map(vector);
  const query = refinementSql(previous, vectors, refined, vectors);
  assert.equal((query.match(/UPDATE dbo.vamahtani_embeddings/g) || []).length, 200);
  assert.doesNotMatch(query, /WHERE Id=100 AND SeedChecksum/);
  assert.match(query, /WHERE Id=101 AND SeedChecksum/);
  assert.match(query, /BEGIN TRANSACTION/);
  assert.match(query, /VECTOR_DISTANCE\('euclidean'/);
  assert.match(query, /SET QUOTED_IDENTIFIER ON/);
  assert.match(query, /SET Description=.*SeedChecksum=/);
  assert.throws(() => refinementSql(previous, vectors, refined.map((study, index) => index === 0 ? { ...study, description: 'changed' } : study), vectors), /preserve/);
});
test('cloud refinement and oversized regeneration fail before SQL or model access', async () => {
  await assert.rejects(() => refineCatalog(() => { throw new Error('SQL must not execute'); }, { target: 'cloud' }), /local container only/);
  let calls = 0;
  await assert.rejects(() => requestEmbeddings(config, Array(200).fill('x'.repeat(500)), 'catalog-refinement', {
    token: () => { calls++; }, reserve: () => { calls++; }, request: () => { calls++; },
  }), /50,000/);
  assert.equal(calls, 0);
});
test('300-study experiment preserves original100 and creates exactly200 distinct bounded descriptions', () => {
  const studies = loadExpandedANNStudies();
  assert.equal(studies.length, 300);
  assert.deepEqual(studies.slice(0, 100), loadDiskANNStudies());
  assert.equal(new Set(studies.map(s => s.description)).size, 300);
  assert.equal(new Set(studies.map(s => s.name)).size, 300);
  assert.ok(studies.slice(100).reduce((sum, s) => sum + Buffer.byteLength(s.description) + 16, 0) <= 50000);
});
test('corpus approval authorizes one seed batch without changing private search cap or prior approvals', t => {
  const state = { seedAttempts: 2, searchAttempts: 11, tokens: 1000 };
  approveCatalogExpansion(state); reserveAttempt(state, 'catalog-seed');
  approveDiskANNExpansion(state); reserveAttempt(state, 'diskann-seed');
  state.searchAttempts = 31; approvePrivateSearchRenewal(state, 100);
  const prior = structuredClone(state);
  approveANNCorpusExpansion(state);
  assert.equal(state.authorizedSearchAttempts, prior.authorizedSearchAttempts);
  assert.equal(state.tokens, prior.tokens);
  assert.deepEqual(state.privateSearchRenewalApproval, prior.privateSearchRenewalApproval);
  assert.throws(() => approveANNCorpusExpansion(state), /one approved/);
  assert.throws(() => reserveAttempt(state, 'diskann-seed'), /Reuse earlier caches/);
  reserveAttempt(state, 'ann-corpus-seed');
  assert.throws(() => reserveAttempt(state, 'ann-corpus-seed'), /already attempted/);
  const file = join(tmpdir(), `gulnara-corpus-${randomUUID()}.json`);
  t.after(() => unlinkSync(file));
  writeFileSync(file, JSON.stringify(state));
  assert.deepEqual(readBudget(file), state);
  for (const change of [{ authorizedSeedAttempts: 6 }, { annCorpusExpansionApproval: undefined },
    { annCorpusExpansionApproval: { ...state.annCorpusExpansionApproval, maximumInputTokens: 50001 } }]) {
    writeFileSync(file, JSON.stringify({ ...state, ...change }));
    assert.throws(() => readBudget(file), /Invalid AI usage ledger/);
  }
});
test('oversized experiment batch is rejected before credential retrieval, reservation or inference', async () => {
  let calls = 0;
  await assert.rejects(() => requestEmbeddings(config, Array(200).fill('x'.repeat(500)), 'ann-corpus-seed', {
    token: () => { calls++; }, reserve: () => { calls++; }, request: async () => { calls++; },
  }), /50,000/);
  assert.equal(calls, 0);
});
test('private renewal retains cumulative history and allows exactly one hundred new attempts', t => {
  const state = { seedAttempts: 2, searchAttempts: 11, tokens: 1000 };
  approveCatalogExpansion(state);
  reserveAttempt(state, 'catalog-seed');
  approveDiskANNExpansion(state);
  reserveAttempt(state, 'diskann-seed');
  state.searchAttempts = 31; state.tokens = 4578;
  const earlier = structuredClone(state);
  approvePrivateSearchRenewal(state, 100);
  assert.equal(state.authorizedSearchAttempts, 131);
  assert.equal(state.searchAttempts, 31);
  assert.equal(state.tokens, 4578);
  assert.equal(state.seedAttempts, 4);
  assert.equal(state.authorizedSeedAttempts, 4);
  assert.deepEqual(state.catalogExpansionApproval, earlier.catalogExpansionApproval);
  assert.deepEqual(state.diskANNExpansionApproval, earlier.diskANNExpansionApproval);
  assert.equal(state.privateSearchRenewalApproval.refreshPolicy, 'none');
  assert.throws(() => approvePrivateSearchRenewal(state, 100), /cannot be replayed/);
  const file = join(tmpdir(), `gulnara-renewal-${randomUUID()}.json`);
  t.after(() => unlinkSync(file));
  writeFileSync(file, JSON.stringify(state));
  assert.deepEqual(readBudget(file), state);
  for (const invalid of [
    { ...state, authorizedSearchAttempts: 132 },
    { ...state, searchAttempts: 0 },
    { ...state, tokens: 0 },
    { ...state, privateSearchRenewalApproval: undefined },
  ]) {
    writeFileSync(file, JSON.stringify(invalid));
    assert.throws(() => readBudget(file), /Invalid AI usage ledger/);
  }
  for (let i = 0; i < 100; i++) reserveAttempt(state, 'search');
  assert.equal(state.searchAttempts, 131);
  assert.throws(() => reserveAttempt(state, 'search'), /exhausted/);
});
test('private renewal rejects unapproved sizes and renewal before exhaustion', () => {
  const state = { seedAttempts: 4, searchAttempts: 31, tokens: 4578, authorizedSeedAttempts: 4, authorizedSearchAttempts: 31 };
  for (const size of [undefined, 0, 1, 101, '100']) assert.throws(() => approvePrivateSearchRenewal({ ...state }, size), /explicit approval/);
  assert.throws(() => approvePrivateSearchRenewal({ ...state, searchAttempts: 30 }, 100), /exhaustion/);
});
test('embedding guards reject wrong dimensions, nonnumbers, nonfinite, zero and unnormalized vectors', () => {
  assert.equal(validateEmbedding(vector()).length, 1536);
  for (const value of [[], Array(1536).fill(0), Array(1536).fill(1), [NaN, ...Array(1535).fill(0)], ['1', ...Array(1535).fill(0)]]) {
    assert.throws(() => validateEmbedding(value), /embedding components/);
  }
});
test('demo prompts are bounded and endpoints cannot redirect Azure tokens to arbitrary hosts', () => {
  assert.equal(validateQuery('  soft flowers  '), 'soft flowers');
  for (const query of ['', ' ', 1, 'x'.repeat(501)]) assert.throws(() => validateQuery(query));
  const env = { DEMO_AZURE_SUBSCRIPTION_ID: config.subscription, AZURE_OPENAI_ENDPOINT: config.endpoint, AZURE_OPENAI_DEPLOYMENT: 'embedding', DEMO_SQL_SERVER: 'approved.database.windows.net' };
  assert.equal(validateConfiguration(env).endpoint, config.endpoint);
  for (const endpoint of ['http://approved.openai.azure.com/', 'https://attacker.test/', 'https://approved.openai.azure.com/?token=secret', 'https://user:password@approved.openai.azure.com/']) {
    assert.throws(() => validateConfiguration({ ...env, AZURE_OPENAI_ENDPOINT: endpoint }));
  }
});
test('real-provider response contract includes model, indexes, dimensions and metered usage', async () => {
  let calls = 0; const state = { seedAttempts: 0, searchAttempts: 0, tokens: 0 };
  const response = await requestEmbeddings(config, ['soft flowers'], 'search', {
    token: () => 'fixture-only', reserve: update => update(state),
    request: async (url, options) => {
      calls++;
      assert.match(url.href, /approved\.openai\.azure\.com\/openai\/deployments\/embedding\/embeddings/);
      assert.equal(options.headers.Authorization, 'Bearer fixture-only');
      assert.deepEqual(JSON.parse(options.body), { input: ['soft flowers'], dimensions: 1536, encoding_format: 'float' });
      return { ok: true, json: async () => ({ model: 'text-embedding-3-small', data: [{ index: 0, embedding: vector() }], usage: { total_tokens: 2 } }) };
    },
  });
  assert.equal(calls, 1); assert.equal(response.tokens, 2);
  assert.deepEqual(state, { seedAttempts: 0, searchAttempts: 1, tokens: 2 });
});
test('exhausted approval budget sends no model request', async () => {
  let calls = 0;
  await assert.rejects(() => requestEmbeddings(config, ['soft flowers'], 'search', {
    token: () => 'fixture-only', reserve: () => { throw new Error('budget exhausted'); },
    request: async () => { calls++; },
  }), /budget exhausted/);
  assert.equal(calls, 0);
});
test('branded local deployment retains the underlying model and vector dimensions', async () => {
  await requestEmbeddings({ ...config, deployment: 'gulnara_openaimodel' }, ['warm sample flowers'], 'search', {
    token: () => 'fixture-only', reserve: () => {},
    request: async (url, options) => {
      assert.equal(url.pathname, '/openai/deployments/gulnara_openaimodel/embeddings');
      assert.equal(JSON.parse(options.body).dimensions, 1536);
      return { ok: true, json: async () => ({
        model: 'text-embedding-3-small', data: [{ index: 0, embedding: vector() }],
        usage: { total_tokens: 2 },
      }) };
    },
  });
});
test('provider denials do not trigger retries, key fallback or fabricated embeddings', async () => {
  let calls = 0;
  await assert.rejects(() => requestEmbeddings(config, ['soft flowers'], 'search', {
    token: () => 'fixture-only', reserve: () => {},
    request: async () => { calls++; return { ok: false, status: 403 }; },
  }), /403.*no credential fallback/);
  assert.equal(calls, 1);
});
test('API-key mode is explicit and sends no bearer token or key in the URL/body', async () => {
  let calls = 0;
  await requestEmbeddings({ ...config, authentication: 'api-key' }, ['soft flowers'], 'search', {
    token: () => 'fixture-credential-only', reserve: () => {},
    request: async (url, options) => {
      calls++;
      assert.equal(options.headers['api-key'], 'fixture-credential-only');
      assert.equal(options.headers.Authorization, undefined);
      assert.ok(!url.href.includes('fixture-credential-only'));
      assert.ok(!options.body.includes('fixture-credential-only'));
      return { ok: true, json: async () => ({ model: 'text-embedding-3-small', data: [{ index: 0, embedding: vector() }], usage: { total_tokens: 2 } }) };
    },
  });
  assert.equal(calls, 1);
});
test('seed renewal permits exactly one additional attempt without resetting prior usage', () => {
  const state = { seedAttempts: 1, searchAttempts: 19, tokens: 25 };
  assert.throws(() => reserveAttempt(state, 'seed'), /already attempted/);
  state.authorizedSeedAttempts = 2;
  reserveAttempt(state, 'seed');
  assert.equal(state.seedAttempts, 2);
  assert.equal(state.tokens, 25);
  assert.throws(() => reserveAttempt(state, 'seed'), /already attempted/);
  reserveAttempt(state, 'search');
  assert.equal(state.searchAttempts, 20);
  assert.throws(() => reserveAttempt(state, 'search'), /exhausted/);
});
test('credential configuration rejects implicit fallback and missing approved key scope', () => {
  const env = { DEMO_AZURE_SUBSCRIPTION_ID: config.subscription, AZURE_OPENAI_ENDPOINT: config.endpoint, AZURE_OPENAI_DEPLOYMENT: 'embedding', DEMO_SQL_SERVER: 'approved.database.windows.net' };
  assert.equal(validateConfiguration(env).authentication, 'entra');
  assert.throws(() => validateConfiguration({ ...env, DEMO_OPENAI_AUTH: 'auto' }), /explicit/);
  assert.throws(() => validateConfiguration({ ...env, DEMO_OPENAI_AUTH: 'api-key' }), /RESOURCE_GROUP/);
  assert.equal(validateConfiguration({ ...env, DEMO_OPENAI_AUTH: 'api-key', DEMO_OPENAI_RESOURCE_GROUP: 'approved-group' }).authentication, 'api-key');
});
test('invalid provider model and embedding metadata never become a successful result', async () => {
  for (const body of [
    { model: 'other', data: [{ index: 0, embedding: vector() }], usage: { total_tokens: 1 } },
    { model: 'text-embedding-3-small', data: [{ index: 1, embedding: vector() }], usage: { total_tokens: 1 } },
    { model: 'text-embedding-3-small', data: [{ index: 0, embedding: [1] }], usage: { total_tokens: 1 } },
  ]) {
    await assert.rejects(() => requestEmbeddings(config, ['soft flowers'], 'search', {
      token: () => 'fixture-only', reserve: () => {},
      request: async () => ({ ok: true, json: async () => body }),
    }));
  }
});
test('seed is isolated, checksummed and refuses overwriting changed demo data', () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: "A rose's story", description: 'Sample only', image: '/maison-blush.svg' }));
  const query = seedSql(rows, rows.map(vector));
  assert.match(query, /A rose''s story/);
  assert.match(query, /SeedChecksum COLLATE Latin1_General_100_BIN2<>/);
  assert.match(query, /VECTOR\(1536\)/);
  assert.doesNotMatch(query, /INSERT dbo\.(Flowers|Designs|Bookings)|DELETE|TRUNCATE|UPDATE/);
});
test('large real-shaped embedding literals stay below sqlcmd line limits without nvarchar truncation', () => {
  const component = 1 / Math.sqrt(1536);
  const vectors = Array.from({ length: 6 }, () => Array(1536).fill(component));
  const rows = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: 'A study', description: 'Sample only', image: '/maison-blush.svg' }));
  const query = seedSql(rows, vectors);
  assert.match(query, /CAST\(N'' AS nvarchar\(max\)\)/);
  assert.ok(query.split('\n').every(line => line.length < 4096));
});
test('search passes a declared max-length parameter instead of an unsupported EXEC expression', () => {
  const query = searchSql(Array(1536).fill(1 / Math.sqrt(1536)));
  assert.match(query, /DECLARE @q nvarchar\(max\)=/);
  assert.match(query, /@QueryEmbedding=@q,/);
  assert.ok(query.split('\n').every(line => line.length < 4096));
});
test('SQL results require unique sample IDs, actual distances and sorted ranking', () => {
  const rows = [1, 2, 3].map(Id => ({ Id, Name: 'sample', Description: 'sample', ImagePath: '/maison-blush.svg', IllustrativePriceUsd: 145, IsSample: true, Distance: Id / 10 }));
  assert.equal(validateResults(rows).length, 3);
  assert.throws(() => validateResults([...rows].reverse()));
  assert.throws(() => validateResults(rows.map(row => ({ ...row, IsSample: false }))));
  assert.throws(() => validateResults(rows.map(row => ({ ...row, ImagePath: 'https://external.test/image.jpg' }))));
});
test('forty-study corpus and SQL seed preserve distinct sample IDs and illustrative prices', () => {
  const studies = loadCatalogStudies();
  assert.equal(studies.length, 40);
  assert.equal(studies[39].id, 40);
  const query = catalogSeedSql(studies, studies.map(vector));
  assert.match(query, /SET QUOTED_IDENTIFIER ON/);
  assert.match(query, /SET NUMERIC_ROUNDABORT OFF/);
  assert.equal((query.match(/INSERT dbo\.vamahtani_embeddings/g) || []).length, 40);
  assert.match(query, /IllustrativePriceUsd<>/);
  assert.doesNotMatch(query, /INSERT dbo\.(Flowers|Designs|Bookings|DemoDesignEmbeddings)/);
  assert.throws(() => catalogSeedSql(studies.map(s => ({ ...s, priceUsd: 'unsafe' })), studies.map(vector)), /metadata/);
});
test('catalog expansion preserves prior usage and permits only one 34-description seed plus twenty new searches', () => {
  const state = { seedAttempts: 2, searchAttempts: 9, tokens: 375 };
  approveCatalogExpansion(state);
  assert.equal(state.authorizedSeedAttempts, 3);
  assert.equal(state.authorizedSearchAttempts, 29);
  assert.equal(state.tokens, 375);
  assert.throws(() => approveCatalogExpansion(state), /one explicit/);
  assert.throws(() => reserveAttempt(state, 'seed'), /only/);
  reserveAttempt(state, 'catalog-seed');
  assert.throws(() => reserveAttempt(state, 'catalog-seed'), /already attempted/);
  for (let i = 0; i < 20; i++) reserveAttempt(state, 'search');
  assert.throws(() => reserveAttempt(state, 'search'), /exhausted/);
});
test('operator HTTP boundary rejects rebinding, cross-origin, invalid JSON and customer API access', async t => {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  let calls = 0;
  const server = createDemoServer({ sql: null, config, target: 'local', port,
    statusOperation: () => ({ target: 'local' }), searchOperation: async () => { calls++; return []; } });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${port}`;
  const rebinding = await new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}/demo-api/status`, { headers: { Host: 'attacker.test' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(rebinding, 403);
  assert.equal((await fetch(`${origin}/demo-api/search`, { method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: '{"query":"flowers"}' })).status, 403);
  assert.equal((await fetch(`${origin}/demo-api/search`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(`${origin}/api/Bookings`)).status, 404);
  assert.equal((await fetch(`${origin}/config.json`)).status, 404);
  assert.equal(calls, 0);
});
  test('DiskANN corpus adds sixty distinct studies without changing the original forty', () => {
    const studies = loadDiskANNStudies();
    assert.equal(studies.length, 100);
    assert.deepEqual(studies.slice(0, 40), loadCatalogStudies());
    assert.equal(new Set(studies.map(study => study.description)).size, 100);
    const query = diskANNSeedSql(studies, studies.map(vector));
    assert.equal((query.match(/INSERT dbo\.vamahtani_embeddings/g) || []).length, 100);
    assert.match(query, /SeedChecksum COLLATE Latin1_General_100_BIN2<>/);
    assert.doesNotMatch(query, /UPDATE|DELETE|TRUNCATE|INSERT dbo\.(Bookings|Flowers)/);
  });
  test('DiskANN approval authorizes one sixty-description batch without resetting usage or raising the search cap', () => {
    const state = { seedAttempts: 2, searchAttempts: 11, tokens: 375 };
    approveCatalogExpansion(state);
    reserveAttempt(state, 'catalog-seed');
    state.searchAttempts = 24;
    approveDiskANNExpansion(state);
    assert.equal(state.authorizedSeedAttempts, 4);
    assert.equal(state.authorizedSearchAttempts, 31);
    assert.equal(state.tokens, 375);
    assert.equal(state.searchAttempts, 24);
    assert.equal(state.diskANNExpansionApproval.newDescriptions, 60);
    assert.throws(() => approveDiskANNExpansion(state), /one explicit/);
    assert.throws(() => reserveAttempt(state, 'catalog-seed'), /only/);
    reserveAttempt(state, 'diskann-seed');
    assert.equal(state.seedAttempts, 4);
    assert.throws(() => reserveAttempt(state, 'diskann-seed'), /already attempted/);
    assert.throws(() => reserveAttempt({ seedAttempts: 0 }, 'diskann-seed'), /approval/);
  });
  test('DiskANN request shape permits exactly sixty descriptions and reserves before provider calls', async () => {
    const state = { seedAttempts: 3, searchAttempts: 24, authorizedSeedAttempts: 4,
      diskANNExpansionApproval: {}, tokens: 1990 };
    let calls = 0;
    const response = await requestEmbeddings(config, loadDiskANNStudies().slice(40).map(s => s.description), 'diskann-seed', {
      token: () => 'fixture-only', reserve: update => update(state),
      request: async (_url, options) => {
        calls++;
        assert.equal(state.seedAttempts, 4);
        assert.equal(JSON.parse(options.body).input.length, 60);
        return { ok: true, json: async () => ({ model: 'text-embedding-3-small',
          data: Array.from({ length: 60 }, (_, index) => ({ index, embedding: vector() })),
          usage: { total_tokens: 2500 } }) };
      },
    });
    assert.equal(response.vectors.length, 60);
    assert.equal(calls, 1);
    assert.equal(state.tokens, 4490);
    await assert.rejects(() => requestEmbeddings(config, ['short batch'], 'diskann-seed'), /shape/);
  });
  test('readiness fails closed for an unbuilt or old DiskANN index but retains legacy exact cloud support', () => {
    const metadata = { engineEdition: 5, database: 'appdb', signatureRows: 1,
      sampleCount: 100, migrationCount: 6, vectorIndexVersion: 3 };
    const sql = () => JSON.stringify(metadata);
    const ready = status(sql, 'local');
    assert.equal(ready.searchMethod, 'diskann');
    assert.equal(ready.sampleCount, 100);
    for (const version of [undefined, 2]) {
      metadata.vectorIndexVersion = version;
      assert.throws(() => status(sql, 'local'), /no fallback/);
    }
    metadata.sampleCount = 40; metadata.migrationCount = 5;
    assert.equal(status(sql, 'cloud').searchMethod, 'exact');
  });
  test('renamed cloud readiness is explicit and leaves the local database unchanged', () => {
    const metadata = { engineEdition: 5, database: 'gulnara_db', signatureRows: 1,
      sampleCount: 300, migrationCount: 9, vectorIndexVersion: 3 };
    const sql = () => JSON.stringify(metadata);
    assert.equal(status(sql, 'cloud', 'gulnara_db').database, 'gulnara_db');
    assert.throws(() => status(sql, 'cloud'), /no fallback/);
    assert.throws(() => status(sql, 'local', 'gulnara_db'), /no fallback/);
    metadata.database = 'appdb';
    assert.equal(status(sql, 'local', 'gulnara_db').database, 'appdb');
    assert.throws(() => status(sql, 'cloud', 'master'), /configuration/);
  });
  test('approved Hyperscale configuration preserves local appdb and the cloud model contract', () => {
    const env = { DEMO_AZURE_SUBSCRIPTION_ID: config.subscription, AZURE_OPENAI_ENDPOINT: config.endpoint,
      AZURE_OPENAI_DEPLOYMENT: 'gulnara_openaimodel', DEMO_SQL_SERVER: 'approved.database.windows.net',
      DEMO_SQL_DATABASE: 'gulnara_db_demo' };
    assert.equal(validateConfiguration(env).sqlDatabase, 'gulnara_db_demo');
    const metadata = { engineEdition: 5, database: 'gulnara_db_demo', signatureRows: 1,
      sampleCount: 300, migrationCount: 9, vectorIndexVersion: 3 };
    const sql = () => JSON.stringify(metadata);
    assert.equal(status(sql, 'cloud', 'gulnara_db_demo').database, 'gulnara_db_demo');
    assert.throws(() => status(sql, 'local', 'gulnara_db_demo'), /no fallback/);
    metadata.database = 'appdb';
    assert.equal(status(sql, 'local', 'gulnara_db_demo').database, 'appdb');
  });
  test('result ID bounds follow the verified corpus, not an unconditional expanded limit', () => {
    const rows = [43, 94, 100].map((Id, index) => ({ Id, Name: 'sample', Description: 'sample',
      ImagePath: '/maison-blush.svg', IllustrativePriceUsd: 145, IsSample: true, Distance: .2 + index / 10 }));
    assert.equal(validateResults(rows, 100).length, 3);
    assert.throws(() => validateResults(rows, 40), /ranking/);
    assert.throws(() => validateResults(rows.map(r => ({ ...r, Id: 101 })), 100), /ranking/);
  });
