import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import sql from 'mssql';

const model = 'text-embedding-3-small:1:1536';
export function configuration(env) {
  const origin = new URL(env.PUBLIC_SITE_ORIGIN || '');
  const endpoint = new URL(env.AZURE_OPENAI_ENDPOINT || '');
  if (origin.origin !== 'https://gentle-beach-033203f0f.5.azurestaticapps.net' ||
      endpoint.origin !== 'https://openaimodeldemotechnician.openai.azure.com' ||
      env.SQL_SERVER !== 'vamahtani.database.windows.net' || !['appdb', 'gulnara_db', 'gulnara_db_demo'].includes(env.SQL_DATABASE) ||
      !['text-embedding-3-small', 'gulnara_openaimodel'].includes(env.AZURE_OPENAI_DEPLOYMENT) || !env.AZURE_OPENAI_KEY ||
      !env.WEBSITE_INSTANCE_ID || !env.IDENTITY_ENDPOINT || !env.IDENTITY_HEADER) {
    throw new Error('Approved hosted managed-identity configuration is required.');
  }
  return { origin: origin.origin, endpoint: endpoint.origin, deployment: env.AZURE_OPENAI_DEPLOYMENT,
    key: env.AZURE_OPENAI_KEY, server: env.SQL_SERVER, database: env.SQL_DATABASE };
}
export function validVector(value) {
  return Array.isArray(value) && value.length === 1536 &&
    value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1) &&
    Math.abs(Math.hypot(...value) - 1) <= .001;
}
async function connect(config) {
  const pool = new sql.ConnectionPool({
    server: config.server, database: config.database,
    authentication: { type: 'azure-active-directory-msi-app-service', options: {} },
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 20000, requestTimeout: 20000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
  });
  await pool.connect();
  return {
    execute: async (procedure, values = {}) => {
      const request = pool.request();
      for (const [name, value] of Object.entries(values)) {
        request.input(name, typeof value === 'number' ? sql.Int : sql.NVarChar(sql.MAX), value);
      }
      return (await request.execute(procedure)).recordset;
    },
    close: () => pool.close(),
  };
}
async function embed(config, query) {
  const response = await fetch(`${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/embeddings?api-version=2024-10-21`, {
    method: 'POST', headers: { 'api-key': config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: [query], dimensions: 1536, encoding_format: 'float' }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Provider unavailable');
  const body = await response.json();
  if (body.model !== 'text-embedding-3-small' || body.data?.length !== 1 ||
      body.data[0].index !== 0 || !validVector(body.data[0].embedding) ||
      !Number.isInteger(body.usage?.total_tokens) || body.usage.total_tokens < 0) {
    throw new Error('Provider shape invalid');
  }
  return { vector: body.data[0].embedding, tokens: body.usage.total_tokens };
}
function verifiedStatus(rows, database) {
  const row = rows?.[0];
  const exact = row?.sampleCount === 40 && row.migrationCount === 5 &&
    (row.searchMethod === undefined || row.searchMethod === 'exact');
  const diskann = row?.sampleCount === 100 && row.migrationCount === 6 && row.searchMethod === 'diskann' &&
    Number.isInteger(row.vectorIndexVersion) && row.vectorIndexVersion >= 3;
  const renewed = ((row?.sampleCount === 100 && [7, 8].includes(row.migrationCount)) ||
    (row?.sampleCount === 300 && row.migrationCount === 9)) &&
    (row.migrationCount < 8 || row.annReady === true) && row.searchMethod === 'diskann' &&
    Number.isInteger(row.vectorIndexVersion) && row.vectorIndexVersion >= 3 && row.searchLimit === 120;
  const searchLimit = renewed ? 120 : 20;
  if (!['appdb', 'gulnara_db', 'gulnara_db_demo'].includes(database) ||
      rows?.length !== 1 || row?.engineEdition !== 5 || row.database !== database ||
      (!renewed && (!(exact || diskann) || (row.searchLimit !== undefined && row.searchLimit !== 20))) ||
      ((diskann || renewed) && row.vectorIndexVersion >= 4 && row.annReady !== true) ||
      !Number.isInteger(row.remainingRequests) || row.remainingRequests < 0 || row.remainingRequests > searchLimit) {
    throw new Error('SQL readiness invalid');
  }
  return { target: 'cloud', engineEdition: 5, database: row.database, table: 'dbo.vamahtani_embeddings',
    model, dimensions: 1536, sampleCount: row.sampleCount, searchMethod: diskann || renewed ? 'diskann' : 'exact',
    vectorIndexVersion: diskann || renewed ? row.vectorIndexVersion : 0, searchLimit, remainingRequests: row.remainingRequests };
}
function verifiedResults(rows, maxId) {
  if (rows?.length !== 3 || new Set(rows.map(row => row.Id)).size !== 3 ||
      rows.some((row, i) => !Number.isInteger(row.Id) || row.Id < 1 || row.Id > maxId ||
        typeof row.Name !== 'string' || typeof row.Description !== 'string' || row.IsSample !== true ||
        !['/maison-blush.svg','/maison-calla.svg','/maison-wine.svg'].includes(row.ImagePath) ||
        !Number.isFinite(row.IllustrativePriceUsd) || row.IllustrativePriceUsd <= 0 || row.IllustrativePriceUsd > 10000 ||
        !Number.isFinite(row.Distance) || row.Distance < 0 || row.Distance > 2 ||
        (i && row.Distance < rows[i - 1].Distance))) throw new Error('SQL result invalid');
  return rows;
}
export function createPublicServer(config, { database = connect, embeddings = embed, log = console.error } = {}) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.origin && req.headers.origin !== config.origin) return send(403, { error: 'Origin not allowed.' });
    if (req.headers.origin === config.origin) res.setHeader('Access-Control-Allow-Origin', config.origin);
    if (req.method === 'OPTIONS') {
      if (req.headers.origin !== config.origin) return send(403, { error: 'Origin not allowed.' });
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204); return res.end();
    }
    const path = new URL(req.url || '/', 'https://api.invalid').pathname;
    if (path === '/health' && req.method === 'GET') return send(200, { service: 'Gulnara bounded read-only demo', configured: true });
    if (!['/demo-api/status','/demo-api/search'].includes(path)) return send(404, { error: 'No customer booking or administration API.' });
    if ((path.endsWith('/status') && req.method !== 'GET') || (path.endsWith('/search') && req.method !== 'POST')) return send(405, { error: 'Method not allowed.' });
    let query;
    if (path.endsWith('/search')) {
      if (req.headers.origin !== config.origin || req.headers['content-type'] !== 'application/json') return send(403, { error: 'Same-site JSON required.' });
      let bytes = 0; const chunks = [];
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4096) return send(413, { error: 'Demo input exceeds four KiB.' });
          chunks.push(chunk);
        }
      } catch {
        log('Public request stream failed; content omitted.');
        if (!res.destroyed) send(400, { error: 'Request was interrupted.' });
        return;
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body.consent !== true || typeof body.query !== 'string' || !body.query.trim() || body.query.trim().length > 500) {
          return send(400, { error: 'Confirm public-sample processing and enter one to 500 characters.' });
        }
        query = body.query.trim();
      } catch { return send(400, { error: 'Invalid JSON input.' }); }
    }
    let db; let remainingRequests; let phase = 'sql-connect';
    try {
      db = await database(config);
      phase = 'sql-readiness';
      const status = verifiedStatus(await db.execute('api.PublicSearchStatus'), config.database);
      remainingRequests = status.remainingRequests;
      if (!query) return send(200, status);
      phase = 'sql-claim';
      const claims = await db.execute('api.ClaimPublicSearch');
      if (claims?.length === 0) {
        return send(429, { error: 'The shared public demo allowance is exhausted.', remainingRequests: 0 });
      }
      if (claims?.length !== 1 || !Number.isInteger(claims[0].remainingRequests) ||
          claims[0].remainingRequests < 0 || claims[0].remainingRequests >= status.searchLimit) throw new Error('Quota shape invalid');
      remainingRequests = claims[0].remainingRequests;
      phase = 'embedding';
      const response = await embeddings(config, query);
      phase = 'sql-vector-search';
      const rows = await db.execute('api.SearchBouquetStudies', { QueryEmbedding: JSON.stringify(response.vector), EmbeddingModel: model, Top: 3 });
      phase = 'sql-token-accounting';
      await db.execute('api.RecordPublicSearchTokens', { Tokens: response.tokens });
      phase = 'sql-result-validation';
      return send(200, { results: verifiedResults(rows, status.sampleCount), remainingRequests });
    } catch (cause) {
      const allowedCodes = ['ELOGIN', 'ESOCKET', 'ETIMEOUT', 'EREQUEST', 'ECONNCLOSED'];
      const code = [cause?.code, cause?.originalError?.code].find(value => allowedCodes.includes(value));
      const number = [cause?.number, cause?.originalError?.number, cause?.originalError?.info?.number]
        .find(value => Number.isInteger(value) && value >= 0 && value <= 2147483647);
      const message = cause?.originalError?.message || cause?.message || '';
      const category = /token-identified principal/i.test(message) ? 'sql-principal-rejected'
        : /not allowed to access/i.test(message) ? 'sql-firewall-rejected'
        : /credential|managed.?identity|AADSTS|retrieve.*token/i.test(message) ? 'identity-token-error'
        : 'unclassified';
      const clientIpv4 = phase === 'sql-connect'
        ? message.match(/Client with IP address '(\d{1,3}(?:\.\d{1,3}){3})'/i)?.[1] : undefined;
      log('Public floral search failed; request text, credentials and provider payload omitted.', { phase, code, number, category, clientIpv4 });
      const annUnavailable = phase === 'sql-readiness' && number === 42286;
      return send(503, { error: annUnavailable
        ? 'The cloud DiskANN index exists, but its ANN graph is not ready. No AI request was sent.'
        : 'The SQL-backed demo is temporarily unavailable. No matches are confirmed; failed attempts are not automatically retried.',
        ...(annUnavailable ? { reason: 'ann-graph-not-ready' } : {}),
        ...(remainingRequests === undefined ? {} : { remainingRequests }) });
    } finally {
      if (db) {
        try { await db.close(); } catch { log('Public SQL connection cleanup failed.'); }
      }
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createPublicServer(configuration(process.env));
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
}
