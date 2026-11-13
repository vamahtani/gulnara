import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPublicServer, configuration, validVector } from '../packages/public-api/server.mjs';
const origin = 'https://gentle-beach-033203f0f.5.azurestaticapps.net';
const rows = [8,11,36].map((Id,i)=>({Id,Name:`Sample ${Id}`,Description:'Public flowers',ImagePath:'/maison-blush.svg',IllustrativePriceUsd:125,IsSample:true,Distance:.2+i/10}));
async function fixture(t, overrides={}, configOverrides={}) {
  let attempts=0,calls=0; const logs=[];
  const config = {origin,database:'appdb',...configOverrides};
  const server=createPublicServer(config, {
    database:async()=>({execute:async(name)=>{
      if(name==='api.PublicSearchStatus') return [{engineEdition:5,database:config.database,sampleCount:40,migrationCount:5,remainingRequests:20-attempts}];
      if(name==='api.ClaimPublicSearch') return attempts<20?[{remainingRequests:20-++attempts}]:[];
      if(name==='api.SearchBouquetStudies') return rows;
      return [];
    },close:async()=>{}}),
    embeddings:async()=>{calls++;return {vector:[1,...Array(1535).fill(0)],tokens:17};},
    log:message=>logs.push(message),...overrides,
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {get:()=>fetch(`${base}/demo-api/status`),post:(body,headers={})=>fetch(`${base}/demo-api/search`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),base,calls:()=>calls,logs};
}
test('hosted identity/configuration and normalized dimensions are mandatory',()=>{
  assert.throws(()=>configuration({}));
  assert.equal(validVector(Array(1536).fill(0)),false);
  assert.equal(validVector([1,...Array(1535).fill(0)]),true);
});
test('hosted database configuration permits only the original and approved renamed target', () => {
  const env = {
    PUBLIC_SITE_ORIGIN: origin,
    AZURE_OPENAI_ENDPOINT: 'https://openaimodeldemotechnician.openai.azure.com',
    SQL_SERVER: 'vamahtani.database.windows.net', AZURE_OPENAI_DEPLOYMENT: 'text-embedding-3-small',
    AZURE_OPENAI_KEY: 'fixture-only', WEBSITE_INSTANCE_ID: 'fixture',
    IDENTITY_ENDPOINT: 'fixture', IDENTITY_HEADER: 'fixture',
  };
  for (const database of ['appdb', 'gulnara_db', 'gulnara_db_demo']) {
    assert.equal(configuration({ ...env, SQL_DATABASE: database }).database, database);
  }
  for (const database of [undefined, '', 'master', 'other_db']) {
    assert.throws(() => configuration({ ...env, SQL_DATABASE: database }), /configuration/);
  }
});
test('Hyperscale target is verified before durable claims and uses the same SQL procedures', async t => {
  const f = await fixture(t, {}, { database: 'gulnara_db_demo' });
  assert.equal((await (await f.get()).json()).database, 'gulnara_db_demo');
  assert.equal((await f.post({ query: 'warm sample flowers', consent: true })).status, 200);
  assert.equal(f.calls(), 1);
});
test('renamed cloud status reports the actual configured database without inference', async t => {
  const f = await fixture(t, {}, { database: 'gulnara_db' });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).database, 'gulnara_db');
  assert.equal(f.calls(), 0);
});
test('hosted configuration accepts only the original or approved branded embedding deployment', () => {
  const env = {
    PUBLIC_SITE_ORIGIN: origin, AZURE_OPENAI_ENDPOINT: 'https://openaimodeldemotechnician.openai.azure.com',
    SQL_SERVER: 'vamahtani.database.windows.net', SQL_DATABASE: 'gulnara_db',
    AZURE_OPENAI_KEY: 'fixture-only', WEBSITE_INSTANCE_ID: 'fixture',
    IDENTITY_ENDPOINT: 'fixture', IDENTITY_HEADER: 'fixture',
  };
  for (const deployment of ['text-embedding-3-small', 'gulnara_openaimodel']) {
    assert.equal(configuration({ ...env, AZURE_OPENAI_DEPLOYMENT: deployment }).deployment, deployment);
  }
  for (const deployment of [undefined, '', 'other-model', '../text-embedding-3-small']) {
    assert.throws(() => configuration({ ...env, AZURE_OPENAI_DEPLOYMENT: deployment }), /configuration/);
  }
});
test('public embedding requests use the configured deployment but retain the underlying model contract', async t => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://openaimodeldemotechnician.openai.azure.com/openai/')) {
      requests.push(String(url));
      assert.equal(JSON.parse(options.body).dimensions, 1536);
      return Response.json({
        model: 'text-embedding-3-small',
        data: [{ index: 0, embedding: [1, ...Array(1535).fill(0)] }],
        usage: { total_tokens: 17 },
      });
    }
    return originalFetch(url, options);
  });
  for (const deployment of ['text-embedding-3-small', 'gulnara_openaimodel']) {
    const f = await fixture(t, { embeddings: undefined }, {
      endpoint: 'https://openaimodeldemotechnician.openai.azure.com',
      deployment, key: 'fixture-only',
    });
    assert.equal((await f.post({ query: 'warm sample flowers', consent: true })).status, 200);
    assert.equal(requests.at(-1),
      `https://openaimodeldemotechnician.openai.azure.com/openai/deployments/${deployment}/embeddings?api-version=2024-10-21`);
  }
  assert.equal(requests.length, 2);
});
test('database mismatch fails before claiming allowance or invoking the model', async t => {
  let claims = 0;
  const f = await fixture(t, { database: async () => ({ execute: async name => {
    if (name === 'api.PublicSearchStatus') return [{ engineEdition: 5, database: 'appdb',
      sampleCount: 40, migrationCount: 5, remainingRequests: 20 }];
    claims++; return [];
  }, close: async () => {} }) }, { database: 'gulnara_db' });
  assert.equal((await f.post({ query: 'flowers', consent: true })).status, 503);
  assert.equal(claims, 0);
  assert.equal(f.calls(), 0);
});
test('public server rejects origins, unconsented input and oversized bodies before inference',async t=>{
  const f=await fixture(t);
  assert.equal((await f.post({query:'flowers',consent:true},{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await f.post({query:'flowers'})).status,400);
  assert.equal((await f.post({query:'x'.repeat(5000),consent:true})).status,413);
  assert.equal((await fetch(`${f.base}/api/BookBouquet`)).status,404);
  assert.equal(f.calls(),0);
});
test('concurrent callers cannot exceed the durable claim contract',async t=>{
  const f=await fixture(t);
  const responses=await Promise.all(Array.from({length:21},()=>f.post({query:'Public sample flowers',consent:true})));
  assert.equal(responses.filter(r=>r.status===200).length,20);
  assert.equal(responses.filter(r=>r.status===429).length,1);
  assert.equal(f.calls(),20);
  assert.equal((await (await f.get()).json()).remainingRequests,0);
});
test('SQL failure before reservation never sends a model request or logs sensitive details',async t=>{
  const f=await fixture(t,{database:async()=>{throw new Error('secret credential and customer query');}});
  const response=await f.post({query:'public flowers',consent:true});
  assert.equal(response.status,503); assert.equal(f.calls(),0);
  assert.doesNotMatch(JSON.stringify(f.logs)+await response.text(),/secret credential|customer query/);
});
test('malformed quota results are an error, not a fabricated exhaustion result',async t=>{
  const f=await fixture(t,{database:async()=>({execute:async(name)=>name==='api.PublicSearchStatus'?[{engineEdition:5,database:'appdb',sampleCount:40,migrationCount:5,remainingRequests:20}]:[{remainingRequests:-1}],close:async()=>{}})});
  assert.equal((await f.post({query:'flowers',consent:true})).status,503);
  assert.equal(f.calls(),0);
});
test('public source accepts current DiskANN metadata and expanded IDs only as one verified revision', async t => {
  const expanded = [43, 94, 100].map((Id, index) => ({ ...rows[index], Id }));
  const f = await fixture(t, { database: async () => ({ execute: async name => {
    if (name === 'api.PublicSearchStatus') return [{ engineEdition: 5, database: 'appdb', sampleCount: 100,
      migrationCount: 6, searchMethod: 'diskann', vectorIndexVersion: 3, remainingRequests: 20 }];
    if (name === 'api.ClaimPublicSearch') return [{ remainingRequests: 19 }];
    if (name === 'api.SearchBouquetStudies') return expanded;
    return [];
  }, close: async () => {} }) });
  assert.equal((await (await f.get()).json()).searchMethod, 'diskann');
  assert.equal((await f.post({ query: 'graduation flowers', consent: true })).status, 200);
});
test('public search reserves nothing and sends no inference when the expanded index is unverified', async t => {
  let claims = 0;
  const f = await fixture(t, { database: async () => ({ execute: async name => {
    if (name === 'api.PublicSearchStatus') return [{ engineEdition: 5, database: 'appdb', sampleCount: 100,
      migrationCount: 6, searchMethod: 'unavailable', vectorIndexVersion: null, remainingRequests: 20 }];
    claims++; return [];
  }, close: async () => {} }) });
  assert.equal((await f.post({ query: 'flowers', consent: true })).status, 503);
  assert.equal(claims, 0); assert.equal(f.calls(), 0);
});
test('renewed public allowance preserves prior use and bounds concurrent claims at 120 lifetime attempts', async t => {
  let attempts = 5;
  const f = await fixture(t, { database: async () => ({ execute: async name => {
    if (name === 'api.PublicSearchStatus') return [{ engineEdition: 5, database: 'appdb', sampleCount: 100,
      migrationCount: 7, searchMethod: 'diskann', vectorIndexVersion: 3, searchLimit: 120, remainingRequests: 120 - attempts }];
    if (name === 'api.ClaimPublicSearch') return attempts < 120 ? [{ remainingRequests: 120 - ++attempts }] : [];
    if (name === 'api.SearchBouquetStudies') return rows;
    return [];
  }, close: async () => {} }) });
  const initial = await (await f.get()).json();
  assert.equal(initial.remainingRequests, 115);
  assert.equal(initial.searchMethod, 'diskann');
  assert.equal(initial.searchLimit, 120);
  const responses = await Promise.all(Array.from({ length: 116 }, () => f.post({ query: 'public sample flowers', consent: true })));
  assert.equal(responses.filter(response => response.status === 200).length, 115);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
  assert.equal(f.calls(), 115);
  assert.equal(attempts, 120);
});
test('larger public allowance is rejected without its new schema and verified index', async t => {
  for (const change of [{ migrationCount: 6 }, { vectorIndexVersion: 2 }, { searchLimit: 121 }]) {
    const f = await fixture(t, { database: async () => ({ execute: async () => [{
      engineEdition: 5, database: 'appdb', sampleCount: 100, migrationCount: 7, searchMethod: 'diskann',
      vectorIndexVersion: 3, searchLimit: 120, remainingRequests: 115, ...change,
    }], close: async () => {} }) });
    assert.equal((await f.post({ query: 'public flowers', consent: true })).status, 503);
    assert.equal(f.calls(), 0);
  }
});
test('ANN readiness failure sends no provider request or budget claim', async t => {
  let claims = 0;
  const f = await fixture(t, { database: async () => ({ execute: async name => {
    if (name === 'api.PublicSearchStatus') throw Object.assign(new Error('ANN graph has not been built yet'), { number: 42286 });
    claims++; return [];
  }, close: async () => {} }) });
  const response = await f.post({ query: 'public flowers', consent: true });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'ann-graph-not-ready');
  assert.equal(claims, 0);
  assert.equal(f.calls(), 0);
});
test('300-row corpus requires schema9 and a successful ANN probe before serving new IDs', async t => {
  for (const [version, valid] of [[3, true], [4, true], [3, false], [4, false]]) {
    const f = await fixture(t, { database: async () => ({ execute: async name => {
      if (name === 'api.PublicSearchStatus') return [{ engineEdition: 5, database: 'appdb', sampleCount: 300,
        migrationCount: 9, searchMethod: 'diskann', vectorIndexVersion: version, annReady: valid,
        searchLimit: 120, remainingRequests: 115 }];
      if (name === 'api.ClaimPublicSearch') return [{ remainingRequests: 114 }];
      if (name === 'api.SearchBouquetStudies') return rows.map((row, i) => ({ ...row, Id: 298 + i }));
      return [];
    }, close: async () => {} }) });
    assert.equal((await f.post({ query: 'flowers', consent: true })).status, valid ? 200 : 503);
    assert.equal(f.calls(), valid ? 1 : 0);
  }
});
