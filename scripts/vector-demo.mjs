import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { readEnvironment, root } from './config.ts';
import { applyMigrations } from './sql-database.mjs';
import { refinedCompositions } from '../packages/data/composition-refinement.mjs';

export const model = 'text-embedding-3-small:1:1536';
const hash = value => createHash('sha256').update(value).digest('hex');
const literal = value => `N'${String(value).replaceAll("'", "''")}'`;
// sqlcmd can insert newlines into long input lines, even inside JSON literals.
const longLiteral = value => `(CAST(N'' AS nvarchar(max)) +\n${value.match(/[\s\S]{1,2000}/g).map(literal).join(' +\n')})`;
export function validateEmbedding(value) {
  if (!Array.isArray(value) || value.length !== 1536 ||
    !value.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1) ||
    !value.some(number => number !== 0) || Math.abs(Math.hypot(...value) - 1) > 0.001) throw new Error('Expected 1536 finite, nonzero, normalized embedding components.');
  return value;
}
export function validateQuery(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) throw new Error('Enter one to 500 characters of demo bouquet preferences.');
  return value.trim();
}
export function validateConfiguration(env) {
  const authentication = env.DEMO_OPENAI_AUTH || 'entra';
  if (!['entra', 'api-key'].includes(authentication)) throw new Error('Select explicit Entra or api-key authentication; no automatic fallback is supported.');
  if (authentication === 'api-key' && !/^[a-z0-9_.()-]{1,90}$/i.test(env.DEMO_OPENAI_RESOURCE_GROUP || '')) throw new Error('Set the approved DEMO_OPENAI_RESOURCE_GROUP for key retrieval.');
  if (!/^[a-f0-9-]{36}$/i.test(env.DEMO_AZURE_SUBSCRIPTION_ID || '')) throw new Error('Set the approved DEMO_AZURE_SUBSCRIPTION_ID in .env.demo.');
  const endpoint = new URL(env.AZURE_OPENAI_ENDPOINT || '');
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.openai\.azure\.com$/i.test(endpoint.hostname) ||
    endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('Use the approved Azure OpenAI HTTPS account endpoint, without credentials or a path.');
  }
  if (!/^[a-z0-9_-]{1,64}$/i.test(env.AZURE_OPENAI_DEPLOYMENT || '')) throw new Error('Set the approved embedding deployment name.');
  if (!/^[a-z0-9-]+\.database\.windows\.net$/i.test(env.DEMO_SQL_SERVER || '')) throw new Error('Set the approved Azure SQL hostname.');
  const sqlDatabase = env.DEMO_SQL_DATABASE ?? 'appdb';
  if (!['appdb', 'gulnara_db', 'gulnara_db_demo'].includes(sqlDatabase)) throw new Error('Select an approved Gulnara cloud database.');
  return { subscription: env.DEMO_AZURE_SUBSCRIPTION_ID, endpoint: endpoint.href, deployment: env.AZURE_OPENAI_DEPLOYMENT, sqlServer: env.DEMO_SQL_SERVER, sqlDatabase, authentication, resourceGroup: env.DEMO_OPENAI_RESOURCE_GROUP };
}
function execute(command, args, { sensitive = false, ...options } = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(sensitive
    ? `Approved credential retrieval failed (exit ${result.status ?? 'spawn failure'}). Check authorized credential access; no credential was logged or model request sent.`
    : `${command} failed: ${result.error?.message || result.stderr || result.stdout || 'unknown error'}`);
  return result.stdout.trim();
}
function azure(args, options) {
  if (process.platform !== 'win32') return execute('az', args, options);
  const quoted = args.map(argument => `'${argument.replaceAll("'", "''")}'`).join(' ');
  return execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; & az ${quoted}; exit $LASTEXITCODE`], options);
}
const keys = new WeakMap();
function credential(config) {
  if (config.authentication !== 'api-key') return azure(['account', 'get-access-token', '--subscription', config.subscription, '--resource', 'https://cognitiveservices.azure.com/', '--query', 'accessToken', '-o', 'tsv'], { sensitive: true });
  if (!keys.has(config)) {
    const key = azure(['cognitiveservices', 'account', 'keys', 'list', '--subscription', config.subscription,
      '--resource-group', config.resourceGroup, '--name', new URL(config.endpoint).hostname.split('.')[0],
      '--query', 'key1', '-o', 'tsv', '--only-show-errors'], { sensitive: true });
    if (!/^[a-z0-9+/=_-]{16,512}$/i.test(key)) throw new Error('Approved key retrieval returned an invalid credential; no model request sent.');
    keys.set(config, key);
  }
  return keys.get(config);
}
function sqlAdapter(target, config, env) {
  const selectedDatabase = target === 'cloud' ? config.sqlDatabase : 'appdb';
  return (database, args = [], input) => {
    if (database !== 'appdb') throw new Error('The demo can only access its configured application database.');
    const unlimitedWidth = args.includes('-y') && args[args.indexOf('-y') + 1] === '0';
    const common = ['-d', selectedDatabase, '-b', '-l', '30', '-t', '60', ...(unlimitedWidth ? [] : ['-h', '-1']),
      ...(args.includes('-y') ? [] : ['-y', '8000']), '-w', '65535', ...args];
    const normalize = output => output.split(/\r?\n/).map(line => line.trim()).join('\n').trim();
    if (target === 'cloud') return normalize(execute('sqlcmd', ['-S', `tcp:${config.sqlServer},1433`, '--authentication-method', 'ActiveDirectoryAzCli', '-N', 'true', ...common], { input }));
    if (!/^sqlapps-[a-f0-9]{12}$/.test(env.COMPOSE_PROJECT_NAME || '')) throw new Error('Expected the existing isolated local project.');
    return normalize(execute('docker', ['exec', '-i', `${env.COMPOSE_PROJECT_NAME}-sql-1`, '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', 'sa', '-C', ...common], { input }));
  };
}
function jsonSql(sql, query) {
  return JSON.parse(sql('appdb', [], `SET NOCOUNT ON;\n${query}\nGO\n`));
}
function budgetPaths() {
  const directory = resolve(root, '.local');
  mkdirSync(directory, { recursive: true });
  return { state: resolve(directory, 'vector-demo-usage.json'), lock: resolve(directory, 'vector-demo-usage.lock') };
}
export function readBudget(file = budgetPaths().state) {
  if (!existsSync(file)) return { seedAttempts: 0, searchAttempts: 0, tokens: 0 };
  const value = JSON.parse(readFileSync(file, 'utf8'));
  const seedLimit = value.authorizedSeedAttempts ?? 1;
  const searchLimit = value.authorizedSearchAttempts ?? 20;
  const expansion = value.catalogExpansionApproval;
  const diskann = value.diskANNExpansionApproval;
  const renewal = value.privateSearchRenewalApproval;
  const corpus = value.annCorpusExpansionApproval;
  const refinement = value.catalogRefinementApproval;
  const corpusSeedLimit = refinement ? refinement.priorSeedLimit : seedLimit;
  const historicalSeedLimit = corpus ? corpus.priorSeedLimit : seedLimit;
  const originalSearchLimit = renewal ? renewal.priorSearchLimit : searchLimit;
  const originalSeedLimit = diskann ? diskann.priorSeedAttempts : seedLimit;
  if (![1, 2, 3, 4, 5, 6].includes(seedLimit) || !Number.isInteger(value.seedAttempts) || value.seedAttempts < 0 || value.seedAttempts > seedLimit ||
    ((seedLimit === 6) !== !!refinement) ||
    (refinement && (refinement.scope !== 'local-only' || refinement.priorSeedLimit !== 5 ||
      refinement.priorSeedAttempts !== 5 || refinement.reusedDescriptions !== 100 ||
      refinement.changedDescriptions !== 200 || refinement.maximumInputTokens !== 50000 ||
      refinement.maximumSeedRequests !== 1 || !/^[a-f0-9]{64}$/.test(refinement.sourceHash) ||
      searchLimit !== refinement.priorSearchLimit || value.searchAttempts < refinement.priorSearchAttempts ||
      value.seedAttempts < refinement.priorSeedAttempts || value.tokens < refinement.priorTokens ||
      !Number.isInteger(refinement.priorSearchAttempts) || refinement.priorSearchAttempts < 0 ||
      !Number.isInteger(refinement.priorTokens) || refinement.priorTokens < 0 ||
      !Number.isInteger(refinement.inputTokens) || refinement.inputTokens < 0 || refinement.inputTokens > 50000)) ||
    ((corpusSeedLimit === 5) !== !!corpus) ||
    (corpus && (corpus.priorSeedLimit !== 4 || corpus.priorSeedAttempts !== 4 ||
      corpus.reusedDescriptions !== 100 || corpus.newDescriptions !== 200 || corpus.totalDescriptions !== 300 ||
      corpus.maximumInputTokens !== 50000 || corpus.maximumSeedRequests !== 1 ||
      corpus.scope !== 'local-seed-cloud-cached' || corpusSeedLimit !== corpus.priorSeedLimit + 1 ||
      searchLimit !== corpus.priorSearchLimit || value.searchAttempts < corpus.priorSearchAttempts ||
      value.seedAttempts < corpus.priorSeedAttempts || value.tokens < corpus.priorTokens ||
      !Number.isInteger(corpus.priorSearchAttempts) || corpus.priorSearchAttempts < 0 ||
      !Number.isInteger(corpus.priorTokens) || corpus.priorTokens < 0 ||
      !Number.isInteger(corpus.inputTokens) || corpus.inputTokens < 0 || corpus.inputTokens > 50000)) ||
    !Number.isInteger(searchLimit) || searchLimit < 20 || searchLimit > 140 ||
    !Number.isInteger(originalSearchLimit) || originalSearchLimit < 20 || originalSearchLimit > 40 ||
    (renewal && (renewal.scope !== 'private-operator' || renewal.refreshPolicy !== 'none' ||
      ![50, 100].includes(renewal.additionalSearches) ||
      searchLimit !== originalSearchLimit + renewal.additionalSearches ||
      renewal.priorSearchAttempts !== originalSearchLimit ||
      value.searchAttempts < renewal.priorSearchAttempts ||
      value.seedAttempts < renewal.priorSeedAttempts || historicalSeedLimit !== renewal.priorSeedLimit ||
      !Number.isInteger(renewal.priorTokens) || renewal.priorTokens < 0 || value.tokens < renewal.priorTokens)) ||
    !Number.isInteger(value.searchAttempts) || value.searchAttempts < 0 || value.searchAttempts > searchLimit ||
    ((seedLimit >= 3 || originalSearchLimit !== 20) && !expansion) ||
    (expansion && (expansion.table !== 'dbo.vamahtani_embeddings' || expansion.newDescriptions !== 34 ||
      originalSeedLimit !== expansion.priorSeedAttempts + 1 || originalSearchLimit !== expansion.priorSearchAttempts + 20)) ||
    ((historicalSeedLimit === 4) !== !!diskann) ||
    (diskann && (diskann.table !== 'dbo.vamahtani_embeddings' || diskann.newDescriptions !== 60 ||
      diskann.reusedDescriptions !== 40 || diskann.priorSeedAttempts !== 3 ||
      historicalSeedLimit !== diskann.priorSeedAttempts + 1 || originalSearchLimit !== diskann.priorSearchLimit ||
      diskann.newSearchAllowance !== 0 || diskann.maxAcceptanceSearches !== 3 ||
      !Number.isInteger(diskann.priorSearchAttempts) || diskann.priorSearchAttempts < 0 ||
      value.searchAttempts < diskann.priorSearchAttempts ||
      !Number.isInteger(diskann.priorTokens) || diskann.priorTokens < 0 || value.tokens < diskann.priorTokens)) ||
    !Number.isInteger(value.tokens) || value.tokens < 0) throw new Error('Invalid AI usage ledger. Review it; do not reset approval to bypass the budget.');
  return value;
}
function updateBudget(update) {
  const { state, lock } = budgetPaths();
  let descriptor;
  try {
    descriptor = openSync(lock, 'wx');
    const value = readBudget(state);
    update(value);
    const pending = `${state}.pending`;
    writeFileSync(pending, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(pending, state);
  } finally {
    if (descriptor !== undefined) { closeSync(descriptor); unlinkSync(lock); }
  }
}
export function reserveAttempt(value, kind) {
  if (!['seed', 'catalog-seed', 'diskann-seed', 'ann-corpus-seed', 'catalog-refinement', 'search'].includes(kind)) throw new Error('Unknown embedding operation.');
  if (kind !== 'search') {
    if (kind === 'catalog-refinement') {
      if (!value.catalogRefinementApproval) throw new Error('Description refinement requires explicit local-only approval.');
    } else if (value.catalogRefinementApproval) throw new Error('The new allowance is only for the approved description refinement.');
    if (kind === 'ann-corpus-seed' || kind === 'catalog-refinement') {
      if (!value.annCorpusExpansionApproval) throw new Error('The 200-description corpus experiment requires explicit approval.');
    } else if (value.annCorpusExpansionApproval) throw new Error('Reuse earlier caches; the new allowance is only for the 200-description experiment.');
    if (kind === 'diskann-seed' && !value.diskANNExpansionApproval) throw new Error('The 60-description DiskANN expansion requires explicit recorded approval.');
    if (!['diskann-seed', 'ann-corpus-seed', 'catalog-refinement'].includes(kind) && value.diskANNExpansionApproval) throw new Error('The new seed allowance is only for the approved 60 additional descriptions; reuse earlier caches.');
    if (kind === 'catalog-seed' && !value.catalogExpansionApproval) throw new Error('The 34-description expansion requires explicit recorded approval.');
    if (kind === 'seed' && value.catalogExpansionApproval) throw new Error('The new seed allowance is only for the approved 34 additional descriptions; reuse the six-vector cache.');
    if (value.seedAttempts >= (value.authorizedSeedAttempts ?? 1)) throw new Error('The approved seed request was already attempted. Reuse its cache or review renewed approval.');
    value.seedAttempts++;
  } else {
    if (value.searchAttempts >= (value.authorizedSearchAttempts ?? 20)) throw new Error('The approved AI search budget is exhausted. No request was sent.');
    value.searchAttempts++;
  }
}
export function approveCatalogRefinement(value) {
  if (value.catalogRefinementApproval || value.authorizedSeedAttempts !== 5 || value.seedAttempts !== 5 ||
      !value.annCorpusExpansionApproval) throw new Error('Only one approved refinement of the original 300-composition catalog is supported.');
  value.catalogRefinementApproval = { at: new Date().toISOString(), scope: 'local-only',
    priorSeedAttempts: value.seedAttempts, priorSeedLimit: value.authorizedSeedAttempts,
    priorSearchAttempts: value.searchAttempts, priorSearchLimit: value.authorizedSearchAttempts,
    priorTokens: value.tokens, reusedDescriptions: 100, changedDescriptions: 200,
    maximumInputTokens: 50000, maximumSeedRequests: 1, inputTokens: 0,
    sourceHash: hash(JSON.stringify(loadRefinedANNStudies())) };
  value.authorizedSeedAttempts = 6;
}
export function approveANNCorpusExpansion(value) {
  if (value.annCorpusExpansionApproval || !value.diskANNExpansionApproval ||
      value.seedAttempts !== 4 || value.authorizedSeedAttempts !== 4) {
    throw new Error('Only one approved 200-description expansion of the cached hundred-vector corpus is supported.');
  }
  value.annCorpusExpansionApproval = { at: new Date().toISOString(), scope: 'local-seed-cloud-cached',
    priorSeedAttempts: value.seedAttempts, priorSeedLimit: value.authorizedSeedAttempts,
    priorSearchAttempts: value.searchAttempts, priorSearchLimit: value.authorizedSearchAttempts,
    priorTokens: value.tokens, reusedDescriptions: 100, newDescriptions: 200, totalDescriptions: 300,
    maximumInputTokens: 50000, maximumSeedRequests: 1, inputTokens: 0 };
  value.authorizedSeedAttempts = 5;
}
export function approveDiskANNExpansion(value) {
  if (value.diskANNExpansionApproval || !value.catalogExpansionApproval || value.seedAttempts !== 3 ||
      value.authorizedSeedAttempts !== 3) throw new Error('Only one explicit DiskANN expansion of the verified forty-vector demo is supported.');
  value.diskANNExpansionApproval = { at: new Date().toISOString(), table: 'dbo.vamahtani_embeddings',
    reusedDescriptions: 40, newDescriptions: 60, priorSeedAttempts: value.seedAttempts,
    priorSearchAttempts: value.searchAttempts, priorSearchLimit: value.authorizedSearchAttempts,
    priorTokens: value.tokens, newSearchAllowance: 0, maxAcceptanceSearches: 3,
    scope: 'User-approved local-only 100-composition DiskANN update. One existing-resource/key batch; no cloud writes, publication, new grants or budget resets.' };
  value.authorizedSeedAttempts = value.seedAttempts + 1;
}
export function approveCatalogExpansion(value) {
  if (value.catalogExpansionApproval || ![1, 2].includes(value.seedAttempts) || value.searchAttempts > 20) throw new Error('Only one explicit 40-study expansion of the existing six-vector demo is supported.');
  value.catalogExpansionApproval = { at: new Date().toISOString(), table: 'dbo.vamahtani_embeddings', reusedDescriptions: 6,
    newDescriptions: 34, priorSeedAttempts: value.seedAttempts, priorSearchAttempts: value.searchAttempts, newSearchAllowance: 20 };
  value.authorizedSeedAttempts = value.seedAttempts + 1;
  value.authorizedSearchAttempts = value.searchAttempts + 20;
}
export function approvePrivateSearchRenewal(value, additionalSearches) {
  const priorSearchLimit = value.authorizedSearchAttempts ?? 20;
  if (value.privateSearchRenewalApproval || ![50, 100].includes(additionalSearches) ||
      value.searchAttempts !== priorSearchLimit) {
    throw new Error('Renewal requires explicit approval for fifty or one hundred additional searches after exhaustion; it cannot be replayed.');
  }
  value.privateSearchRenewalApproval = { at: new Date().toISOString(), scope: 'private-operator',
    refreshPolicy: 'none', additionalSearches, priorSearchLimit, priorSearchAttempts: value.searchAttempts,
    priorSeedAttempts: value.seedAttempts, priorSeedLimit: value.authorizedSeedAttempts ?? 1,
    priorTokens: value.tokens,
    operation: 'User-approved additional private local/cloud-preview searches using the existing Azure OpenAI resource. No seed renewal, public allowance change or usage reset.' };
  value.authorizedSearchAttempts = priorSearchLimit + additionalSearches;
}
function remainingRequests() {
  const value = readBudget();
  return (value.authorizedSearchAttempts ?? 20) - value.searchAttempts;
}
export async function requestEmbeddings(config, texts, kind, { request = fetch, token = () => credential(config), reserve = updateBudget } = {}) {
  const expected = { seed: 6, 'catalog-seed': 34, 'diskann-seed': 60, 'ann-corpus-seed': 200, 'catalog-refinement': 200, search: 1 }[kind];
  if (!expected || !Array.isArray(texts) || texts.length !== expected) throw new Error('Unexpected embedding request shape.');
  texts.forEach(validateQuery);
  if (['ann-corpus-seed', 'catalog-refinement'].includes(kind) && texts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8') + 16, 0) > 50000) {
    throw new Error('The approved experiment exceeds its conservative 50,000-input-token bound. No request was sent.');
  }
  const accessToken = token();
  reserve(value => reserveAttempt(value, kind));
  const authorization = config.authentication === 'api-key' ? { 'api-key': accessToken } : { Authorization: `Bearer ${accessToken}` };
  const endpoint = new URL(`openai/deployments/${encodeURIComponent(config.deployment)}/embeddings?api-version=2024-10-21`, config.endpoint);
  const response = await request(endpoint, {
    method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, dimensions: 1536, encoding_format: 'float' }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    let detail = '';
    const type = response.headers?.get('content-type') || '';
    if (type.includes('application/json')) {
      const failure = await response.json();
      if (typeof failure.error?.code === 'string' && /^[a-z0-9_-]{1,80}$/i.test(failure.error.code)) detail = ` / ${failure.error.code}`;
    }
    throw new Error(`Azure OpenAI embedding request failed (${response.status}${detail}). Check the explicitly selected ${config.authentication || 'entra'} credential and deployment; no credential fallback, role changes or automatic retries were used.`);
  }
  const body = await response.json();
  if (body.model !== 'text-embedding-3-small' || !Array.isArray(body.data) || body.data.length !== texts.length ||
    !Number.isInteger(body.usage?.total_tokens) || body.usage.total_tokens < 0) throw new Error('Azure OpenAI returned unexpected model or usage metadata.');
  const vectors = Array(texts.length);
  for (const item of body.data) {
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= texts.length || vectors[item.index]) throw new Error('Azure OpenAI returned invalid embedding indexes.');
    vectors[item.index] = validateEmbedding(item.embedding);
  }
  reserve(value => {
    value.tokens += body.usage.total_tokens;
    if (kind === 'ann-corpus-seed') value.annCorpusExpansionApproval.inputTokens += body.usage.total_tokens;
    if (kind === 'catalog-refinement') value.catalogRefinementApproval.inputTokens += body.usage.total_tokens;
  });
  if (['ann-corpus-seed', 'catalog-refinement'].includes(kind) && body.usage.total_tokens > 50000) throw new Error('Provider usage exceeded the approved input-token bound; stop and review the recorded usage.');
  return { vectors, tokens: body.usage.total_tokens };
}
function loadStudies() {
  const studies = JSON.parse(readFileSync(resolve(root, 'packages/data/demo-studies.json'), 'utf8'));
  if (!Array.isArray(studies) || studies.length !== 6 || studies.some((study, index) => study.id !== index + 1 ||
    typeof study.name !== 'string' || study.name.length > 120 ||
    typeof study.description !== 'string' || /[\r\n]/.test(study.description) ||
    !['/maison-blush.svg', '/maison-calla.svg', '/maison-wine.svg'].includes(study.image))) throw new Error('Unexpected six-study sample corpus.');
  studies.forEach(study => validateQuery(study.description));
  return studies;
}
export function loadCatalogStudies() {
  const originalPrices = [145, 115, 165, 135, 125, 155];
  const additions = JSON.parse(readFileSync(resolve(root, 'packages/data/additional-studies.json'), 'utf8'));
  const studies = [...loadStudies().map((study, index) => ({ ...study, priceUsd: originalPrices[index] })), ...additions];
  if (studies.length !== 40 || studies.some((study, index) => study.id !== index + 1 ||
    typeof study.name !== 'string' || !study.name.trim() || study.name.length > 120 ||
    typeof study.description !== 'string' || /[\r\n]/.test(study.description) ||
    !['/maison-blush.svg', '/maison-calla.svg', '/maison-wine.svg'].includes(study.image) ||
    !Number.isInteger(study.priceUsd) || study.priceUsd <= 0 || study.priceUsd > 10000) ||
    new Set(studies.map(study => study.name.toLowerCase())).size !== 40) throw new Error('Expected forty distinct, priced sample bouquet studies.');
  studies.forEach(study => validateQuery(study.description));
  return studies;
}
export function loadDiskANNStudies() {
  const additions = JSON.parse(readFileSync(resolve(root, 'packages/data/diskann-studies.json'), 'utf8'));
  const studies = [...loadCatalogStudies(), ...additions];
  if (studies.length !== 100 || studies.some((study, index) => study.id !== index + 1 ||
    typeof study.name !== 'string' || !study.name.trim() || study.name.length > 120 ||
    typeof study.description !== 'string' || /[\r\n]/.test(study.description) ||
    !['/maison-blush.svg', '/maison-calla.svg', '/maison-wine.svg'].includes(study.image) ||
    !Number.isInteger(study.priceUsd) || study.priceUsd <= 0 || study.priceUsd > 10000) ||
    new Set(studies.map(study => study.name.toLowerCase())).size !== 100 ||
    new Set(studies.map(study => study.description)).size !== 100) throw new Error('Expected one hundred distinct, priced synthetic compositions.');
  studies.forEach(study => validateQuery(study.description));
  return studies;
}
export function loadExpandedANNStudies() {
  const flowers = [
    ['Rose', 'garden roses and lisianthus'], ['Peony', 'peonies and eucalyptus'],
    ['Calla', 'calla lilies and orchids'], ['Ranunculus', 'ranunculus and sweet peas'],
    ['Dahlia', 'dahlias and amaranthus'], ['Tulip', 'tulips and anemones'],
    ['Hydrangea', 'hydrangeas and delphinium'], ['Sunflower', 'sunflowers and snapdragons'],
  ];
  const palettes = [['Ivory', 'ivory and white'], ['Blush', 'blush and pink'],
    ['Garnet', 'burgundy and wine'], ['Honey', 'apricot and gold'], ['Lilac', 'lavender and lilac']];
  const occasions = ['Graduation', 'Anniversary', 'Wedding', 'Thank You', 'Birthday'];
  const moods = ['lush and warm', 'soft and romantic', 'quiet and sculptural', 'joyful and radiant', 'refined and serene'];
  const additions = Array.from({ length: 200 }, (_, index) => {
    const flower = flowers[index % 8], palette = palettes[Math.floor(index / 8) % 5];
    const occasion = occasions[Math.floor(index / 40)];
    return { id: index + 101, name: `${palette[0]} ${flower[0]} - ${occasion}`,
      description: `${occasion.toLowerCase()} flowers: a ${moods[(index % 8 + Math.floor(index / 40)) % 5]} bouquet of ${flower[1]} in ${palette[1]}, with seasonal foliage. Sample composition; not verified stock.`,
      image: palette[0] === 'Garnet' ? '/maison-wine.svg' : palette[0] === 'Ivory' ? '/maison-calla.svg' : '/maison-blush.svg',
      priceUsd: 125 + (index % 8) * 5 + Math.floor(index / 40) * 10 };
  });
  const studies = [...loadDiskANNStudies(), ...additions];
  if (new Set(studies.map(study => study.name)).size !== 300 ||
      new Set(studies.map(study => study.description)).size !== 300) throw new Error('The expanded sample corpus must be distinct.');
  studies.forEach(study => validateQuery(study.description));
  return studies;
}
export function seedSql(studies, vectors) {
  return writeSeedSql(studies, vectors, false);
}
export function loadRefinedANNStudies() {
  const studies = refinedCompositions(loadExpandedANNStudies());
  studies.forEach(study => validateQuery(study.description));
  if (new Set(studies.map(study => study.description)).size !== 300 ||
      studies.slice(100).reduce((sum, study) => sum + Buffer.byteLength(study.description) + 16, 0) > 50000) {
    throw new Error('Refined descriptions must be distinct and fit the approved conservative token bound.');
  }
  return studies;
}
export function catalogSeedSql(studies, vectors) {
  return writeSeedSql(studies, vectors, true);
}
export function diskANNSeedSql(studies, vectors) {
  return writeSeedSql(studies, vectors, true, 100);
}
export function expandedANNSeedSql(studies, vectors) {
  return writeSeedSql(studies, vectors, true, 300);
}
function writeSeedSql(studies, vectors, expanded, count = expanded ? 40 : 6) {
  if (studies.length !== count || vectors.length !== count) throw new Error(`Expected ${count} study vectors.`);
  if (studies.some((study, index) => study.id !== index + 1 || typeof study.name !== 'string' || !study.name.trim() ||
    typeof study.description !== 'string' || !['/maison-blush.svg', '/maison-calla.svg', '/maison-wine.svg'].includes(study.image) ||
    (expanded && (!Number.isInteger(study.priceUsd) || study.priceUsd <= 0 || study.priceUsd > 10000)))) throw new Error('Invalid sample seed metadata.');
  studies.forEach(study => validateQuery(study.description));
  const table = expanded ? 'dbo.vamahtani_embeddings' : 'dbo.DemoDesignEmbeddings';
  const rows = studies.map((study, index) => {
    const vector = JSON.stringify(validateEmbedding(vectors[index]));
    return { ...study, vector, checksum: hash(JSON.stringify({ study, vector, model })) };
  });
  const checks = rows.map(row => `IF EXISTS (SELECT 1 FROM ${table} WHERE Id=${row.id} AND
(SeedChecksum COLLATE Latin1_General_100_BIN2<>${literal(row.checksum)} OR Name COLLATE Latin1_General_100_BIN2<>${literal(row.name)} OR Description COLLATE Latin1_General_100_BIN2<>${literal(row.description)}
OR ImagePath COLLATE Latin1_General_100_BIN2<>${literal(row.image)} OR EmbeddingModel COLLATE Latin1_General_100_BIN2<>${literal(model)}
${expanded ? `OR IllustrativePriceUsd<>${row.priceUsd}` : ''}
OR VECTOR_DISTANCE('euclidean', Embedding, CAST(${longLiteral(row.vector)} AS VECTOR(1536)))<>0))
THROW 51303, 'Existing demo seed differs; preserve it and review changes.', 1;`).join('\n');
  const inserts = rows.map(row => `IF NOT EXISTS (SELECT 1 FROM ${table} WHERE Id=${row.id})
INSERT ${table}(Id,Name,Description,ImagePath,${expanded ? 'IllustrativePriceUsd,' : ''}Embedding,EmbeddingModel,SeedChecksum)
VALUES (${row.id},${literal(row.name)},${literal(row.description)},${literal(row.image)},${expanded ? `${row.priceUsd},` : ''}CAST(${longLiteral(row.vector)} AS VECTOR(1536)),${literal(model)},${literal(row.checksum)});`).join('\n');
  return `SET NOCOUNT ON; SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON;
SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock=sys.sp_getapplock @Resource=N'Gulnara.VectorDemoSeed', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
IF @lock<0 THROW 51303, 'Demo seed is busy.', 1;
${checks}
${inserts}
COMMIT TRANSACTION;
GO\n`;
}
async function seed(sql, config) {
  const studies = loadStudies();
  const sourceHash = hash(JSON.stringify(studies));
  const file = resolve(root, '.local/vector-demo-embeddings.json');
  let cache;
  if (existsSync(file)) {
    cache = JSON.parse(readFileSync(file, 'utf8'));
    if (cache.sourceHash !== sourceHash || cache.model !== model || !Array.isArray(cache.vectors) || cache.vectors.length !== 6) throw new Error('Embedding cache differs from the corpus/model. Review regeneration approval, not a silent overwrite.');
    cache.vectors.forEach(validateEmbedding);
  } else {
    const response = await requestEmbeddings(config, studies.map(study => study.description), 'seed');
    cache = { model, sourceHash, generatedAt: new Date().toISOString(), tokens: response.tokens, vectors: response.vectors };
    writeFileSync(file, JSON.stringify(cache), { mode: 0o600 });
  }
  sql('appdb', [], seedSql(studies, cache.vectors));
  console.log('Six real Azure OpenAI embeddings seeded in the demo table only. No business inventory or bookings changed.');
}
async function seedCatalog(sql, config) {
  const studies = loadCatalogStudies();
  const original = JSON.parse(readFileSync(resolve(root, '.local/vector-demo-embeddings.json'), 'utf8'));
  if (original.sourceHash !== hash(JSON.stringify(loadStudies())) || original.model !== model || original.vectors?.length !== 6) throw new Error('A verified six-vector cache is required. Run the approved original seed first; do not fabricate or silently regenerate it.');
  original.vectors.forEach(validateEmbedding);
  const sourceHash = hash(JSON.stringify(studies));
  const file = resolve(root, '.local/bouquet-study-embeddings.json');
  let cache;
  if (existsSync(file)) {
    cache = JSON.parse(readFileSync(file, 'utf8'));
    if (cache.sourceHash !== sourceHash || cache.model !== model || cache.vectors?.length !== 40 ||
      JSON.stringify(cache.vectors.slice(0, 6)) !== JSON.stringify(original.vectors)) throw new Error('Expanded cache differs; preserve it and review regeneration approval.');
    cache.vectors.forEach(validateEmbedding);
  } else {
    const response = await requestEmbeddings(config, studies.slice(6).map(study => study.description), 'catalog-seed');
    cache = { model, sourceHash, generatedAt: new Date().toISOString(), reusedVectors: 6, newVectors: 34,
      tokens: response.tokens, vectors: [...original.vectors, ...response.vectors] };
    writeFileSync(file, JSON.stringify(cache), { mode: 0o600, flag: 'wx' });
  }
  sql('appdb', [], catalogSeedSql(studies, cache.vectors));
  console.log('Forty real embeddings seeded in dbo.vamahtani_embeddings: six reused, thirty-four generated once. Samples only; business inventory/bookings unchanged.');
}
export async function enableDiskANN(sql, config, { cachedOnly = false } = {}) {
  if (config.target === 'cloud' && !cachedOnly) throw new Error('Cloud DiskANN rollout must reuse the approved complete cache; new inference is not authorized.');
  const studies = loadDiskANNStudies();
  const original = JSON.parse(readFileSync(resolve(root, '.local/bouquet-study-embeddings.json'), 'utf8'));
  if (original.model !== model || original.sourceHash !== hash(JSON.stringify(loadCatalogStudies())) ||
      original.vectors?.length !== 40) throw new Error('The original verified forty-vector cache is required; no regeneration is permitted.');
  original.vectors.forEach(validateEmbedding);
  const sourceHash = hash(JSON.stringify(studies));
  const file = resolve(root, '.local/diskann-study-embeddings.json');
  let cache;
  if (existsSync(file)) {
    cache = JSON.parse(readFileSync(file, 'utf8'));
    if (cache.sourceHash !== sourceHash || cache.model !== model || cache.vectors?.length !== 100 ||
        JSON.stringify(cache.vectors.slice(0, 40)) !== JSON.stringify(original.vectors)) {
      throw new Error('DiskANN cache differs; preserve it and review regeneration approval.');
    }
    cache.vectors.forEach(validateEmbedding);
  } else {
    if (cachedOnly) throw new Error('The approved hundred-vector cache is missing. No migration, seeding or inference was sent.');
    if (!readBudget().diskANNExpansionApproval) throw new Error('Record explicit local DiskANN expansion approval before inference or SQL changes.');
    const response = await requestEmbeddings(config, studies.slice(40).map(study => study.description), 'diskann-seed');
    cache = { model, sourceHash, generatedAt: new Date().toISOString(), reusedVectors: 40,
      newVectors: 60, tokens: response.tokens, vectors: [...original.vectors, ...response.vectors] };
    writeFileSync(file, JSON.stringify(cache), { mode: 0o600, flag: 'wx' });
  }
  if (new Set(cache.vectors.map(vector => hash(JSON.stringify(vector)))).size !== 100) {
    throw new Error('The DiskANN corpus must contain one hundred distinct real embeddings; no duplicate padding is allowed.');
  }
  const migrationPath = config.target === 'cloud' ? file => resolve(root, 'packages/data/migrations', file) : undefined;
  applyMigrations(sql, migrationPath, 6);
  sql('appdb', [], diskANNSeedSql(studies, cache.vectors));
  sql('appdb', ['-Q', 'EXEC dbo.BuildBouquetDiskANNIndex;']);
  applyMigrations(sql, migrationPath);
  console.log(JSON.stringify(status(sql, config.target, config.sqlDatabase), null, 2));
  console.log('One hundred cached sample embeddings and native DiskANN verified on', config.target, '; earlier vectors/business data and private usage retained.');
}
export async function expandANNCorpus(sql, config, { cachedOnly = false } = {}) {
  if (config.target === 'cloud' && !cachedOnly) throw new Error('Cloud expansion must reuse the verified complete cache; no new inference is approved.');
  if (!readBudget().annCorpusExpansionApproval) throw new Error('Record the explicit 200-embedding experiment approval first.');
  const studies = loadExpandedANNStudies();
  const original = JSON.parse(readFileSync(resolve(root, '.local/diskann-study-embeddings.json'), 'utf8'));
  if (original.model !== model || original.sourceHash !== hash(JSON.stringify(loadDiskANNStudies())) ||
      original.vectors?.length !== 100) throw new Error('The original hundred-vector cache must be preserved.');
  original.vectors.forEach(validateEmbedding);
  const file = resolve(root, '.local/ann-experiment-embeddings.json');
  const sourceHash = hash(JSON.stringify(studies));
  let cache;
  if (existsSync(file)) {
    cache = JSON.parse(readFileSync(file, 'utf8'));
    if (cache.model !== model || cache.sourceHash !== sourceHash || cache.vectors?.length !== 300 ||
        JSON.stringify(cache.vectors.slice(0, 100)) !== JSON.stringify(original.vectors)) throw new Error('Expanded cache differs; no regeneration or overwrite is permitted.');
  } else {
    if (cachedOnly) throw new Error('The complete approved cache is missing. No cloud writes or model requests sent.');
    const response = await requestEmbeddings(config, studies.slice(100).map(study => study.description), 'ann-corpus-seed');
    cache = { model, sourceHash, generatedAt: new Date().toISOString(), reusedVectors: 100,
      newVectors: 200, tokens: response.tokens, vectors: [...original.vectors, ...response.vectors] };
    writeFileSync(file, JSON.stringify(cache), { mode: 0o600, flag: 'wx' });
  }
  cache.vectors.forEach(validateEmbedding);
  if (new Set(cache.vectors.map(vector => hash(JSON.stringify(vector)))).size !== 300) throw new Error('Duplicate vector padding is forbidden.');
  applyMigrations(sql, config.target === 'cloud' ? file => resolve(root, 'packages/data/migrations', file) : undefined);
  sql('appdb', [], expandedANNSeedSql(studies, cache.vectors));
  sql('appdb', ['-Q', 'EXEC dbo.BuildBouquetDiskANNIndex;']);
  console.log(JSON.stringify(status(sql, config.target, config.sqlDatabase), null, 2));
}
export function refinementSql(previous, previousVectors, studies, vectors) {
  if ([previous, previousVectors, studies, vectors].some(rows => rows.length !== 300) ||
      JSON.stringify(previous.slice(0, 100)) !== JSON.stringify(studies.slice(0, 100)) ||
      JSON.stringify(previousVectors.slice(0, 100)) !== JSON.stringify(vectors.slice(0, 100))) {
    throw new Error('Refinement must preserve the original hundred descriptions and vectors.');
  }
  const checksum = (study, vector) => hash(JSON.stringify({ study, vector: JSON.stringify(vector), model }));
  const checks = [];
  const updates = [];
  studies.forEach((study, index) => {
    const old = previous[index];
    if (study.id !== index + 1 || JSON.stringify({ ...study, description: old.description }) !== JSON.stringify(old)) {
      throw new Error('Only the approved descriptions and paired embeddings may change.');
    }
    validateQuery(study.description);
    validateEmbedding(previousVectors[index]); validateEmbedding(vectors[index]);
    const oldHash = checksum(old, previousVectors[index]);
    const newHash = checksum(study, vectors[index]);
    const oldState = `SeedChecksum COLLATE Latin1_General_100_BIN2=${literal(oldHash)}
AND Description COLLATE Latin1_General_100_BIN2=${literal(old.description)}
AND VECTOR_DISTANCE('euclidean',Embedding,CAST(${longLiteral(JSON.stringify(previousVectors[index]))} AS VECTOR(1536)))=0`;
    const newState = `SeedChecksum COLLATE Latin1_General_100_BIN2=${literal(newHash)}
AND Description COLLATE Latin1_General_100_BIN2=${literal(study.description)}
AND VECTOR_DISTANCE('euclidean',Embedding,CAST(${longLiteral(JSON.stringify(vectors[index]))} AS VECTOR(1536)))=0`;
    checks.push(`IF NOT EXISTS (SELECT 1 FROM dbo.vamahtani_embeddings WHERE Id=${study.id}
AND Name COLLATE Latin1_General_100_BIN2=${literal(study.name)}
AND ImagePath COLLATE Latin1_General_100_BIN2=${literal(study.image)}
AND IllustrativePriceUsd=${study.priceUsd} AND IsSample=1
AND EmbeddingModel COLLATE Latin1_General_100_BIN2=${literal(model)}
AND ((${oldState}) OR (${newState})))
THROW 51901,'Composition differs from both approved revisions; preserve it and review.',1;`);
    if (index >= 100) updates.push(`UPDATE dbo.vamahtani_embeddings
SET Description=${literal(study.description)},SeedChecksum=${literal(newHash)},
Embedding=CAST(${longLiteral(JSON.stringify(vectors[index]))} AS VECTOR(1536))
WHERE Id=${study.id} AND SeedChecksum COLLATE Latin1_General_100_BIN2=${literal(oldHash)};`);
  });
  return `SET NOCOUNT ON; SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON;
SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock=sys.sp_getapplock @Resource=N'Gulnara.VectorDemoSeed',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
IF @lock<0 THROW 51901,'Composition refinement is busy.',1;
IF (SELECT COUNT(*) FROM dbo.vamahtani_embeddings)<>300 THROW 51901,'Expected the complete 300-composition catalog.',1;
${checks.join('\n')}
${updates.join('\n')}
COMMIT TRANSACTION;
GO\n`;
}
export async function refineCatalog(sql, config) {
  if (config.target !== 'local') throw new Error('This refinement is approved for the local container only; no cloud writes or inference sent.');
  const studies = loadRefinedANNStudies();
  const sourceHash = hash(JSON.stringify(studies));
  const approval = readBudget().catalogRefinementApproval;
  if (!approval || approval.sourceHash !== sourceHash) throw new Error('Record explicit approval for this exact local description revision first.');
  const previous = loadExpandedANNStudies();
  const original = JSON.parse(readFileSync(resolve(root, '.local/ann-experiment-embeddings.json'), 'utf8'));
  if (original.model !== model || original.sourceHash !== hash(JSON.stringify(previous)) || original.vectors?.length !== 300) {
    throw new Error('The complete original embedding cache must be preserved.');
  }
  original.vectors.forEach(validateEmbedding);
  const file = resolve(root, '.local/refined-composition-embeddings.json');
  let cache;
  if (existsSync(file)) {
    cache = JSON.parse(readFileSync(file, 'utf8'));
    if (cache.model !== model || cache.sourceHash !== sourceHash || cache.vectors?.length !== 300 ||
        JSON.stringify(cache.vectors.slice(0, 100)) !== JSON.stringify(original.vectors.slice(0, 100))) {
      throw new Error('Refinement cache differs; preserve it, do not regenerate or overwrite.');
    }
  } else {
    sql('appdb', [], expandedANNSeedSql(previous, original.vectors));
    const response = await requestEmbeddings(config, studies.slice(100).map(study => study.description), 'catalog-refinement');
    cache = { model, sourceHash, generatedAt: new Date().toISOString(), reusedVectors: 100,
      newVectors: 200, tokens: response.tokens, vectors: [...original.vectors.slice(0, 100), ...response.vectors] };
    writeFileSync(file, JSON.stringify(cache), { mode: 0o600, flag: 'wx' });
  }
  cache.vectors.forEach(validateEmbedding);
  if (new Set(cache.vectors.map(vector => hash(JSON.stringify(vector)))).size !== 300) throw new Error('Duplicate vector padding is forbidden.');
  sql('appdb', [], refinementSql(previous, original.vectors, studies, cache.vectors));
  console.log(JSON.stringify(status(sql, 'local'), null, 2));
  console.log('Local refined catalog verified: 200 paired descriptions/vectors; original100, old caches, prices, migrations and business data preserved.');
}
export function validateResults(rows, maxId = 40) {
  if (![40, 100, 300].includes(maxId)) throw new Error('Unexpected native SQL corpus size.');
  if (!Array.isArray(rows) || rows.length !== 3 ||
    rows.some(row => !Number.isInteger(row.Id) || row.Id < 1 || row.Id > maxId || typeof row.Name !== 'string' ||
      typeof row.Description !== 'string' || !['/maison-blush.svg', '/maison-calla.svg', '/maison-wine.svg'].includes(row.ImagePath) ||
      typeof row.IllustrativePriceUsd !== 'number' || !Number.isFinite(row.IllustrativePriceUsd) || row.IllustrativePriceUsd <= 0 || row.IllustrativePriceUsd > 10000 ||
      typeof row.Distance !== 'number' || !Number.isFinite(row.Distance) || row.Distance < 0 || row.Distance > 2 ||
      row.IsSample !== true) || new Set(rows.map(row => row.Id)).size !== 3 ||
    rows.some((row, index) => index > 0 && row.Distance < rows[index - 1].Distance)) throw new Error('Unexpected native SQL ranking.');
  return rows;
}
function verifyDiskANN(sql) {
  const verified = status(sql, 'local');
  if (verified.searchMethod !== 'diskann') throw new Error('Native indexed readiness is required for DiskANN acceptance.');
  const usageBefore = JSON.stringify(readBudget());
  const output = sql('appdb', ['-y', '0'], readFileSync(resolve(root, 'tests/diskann-native.sql'), 'utf8'));
  writeFileSync(resolve(root, '.local/diskann-native-output.txt'), output, { mode: 0o600 });
  if (!/Vector[\s_]*Index[\s_]*Seek/i.test(output)) throw new Error('The real execution plan did not prove a Vector Index Seek. Inspect the saved native output; no DiskANN completion can be claimed.');
  if (JSON.stringify(readBudget()) !== usageBefore) throw new Error('Native verification unexpectedly changed the AI usage ledger.');
  const receipt = { at: new Date().toISOString(), ...verified, nativeResults: 3, invalidInputDenials: 3,
    runtimeAdminDenial: 1, executionPlan: 'Vector Index Seek', nativeOutputSha256: hash(output),
    modelRequests: 0, cloudWrites: 0 };
  writeFileSync(resolve(root, '.local/diskann-native-proof.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}
async function search(sql, config, query) {
  const verified = status(sql, config.target, config.sqlDatabase);
  const { vectors } = await requestEmbeddings(config, [validateQuery(query)], 'search');
  return validateResults(jsonSql(sql, searchSql(vectors[0])), verified.sampleCount);
}
export function searchSql(vector) {
  // INSERT EXEC captures the procedure's real ranking before emitting one JSON result.
  return `DECLARE @q nvarchar(max)=${longLiteral(JSON.stringify(validateEmbedding(vector)))};
DECLARE @r TABLE(Id int, Name nvarchar(120), Description nvarchar(1000), ImagePath nvarchar(120), IllustrativePriceUsd decimal(10,2), IsSample bit, Distance float);
INSERT @r EXEC api.SearchBouquetStudies @QueryEmbedding=@q, @EmbeddingModel=${literal(model)}, @Top=3;
SELECT Id,Name,Description,ImagePath,IllustrativePriceUsd,IsSample,Distance FROM @r ORDER BY Distance,Id FOR JSON PATH;`;
}
export function status(sql, target, cloudDatabase = 'appdb') {
  if (!['appdb', 'gulnara_db', 'gulnara_db_demo'].includes(cloudDatabase)) throw new Error('Unexpected cloud database configuration.');
  const database = target === 'cloud' ? cloudDatabase : 'appdb';
  const value = jsonSql(sql, `IF (SELECT COUNT(*) FROM dbo.vamahtani_embeddings) IN (100,300)
BEGIN
 DECLARE @probe nvarchar(max)=(SELECT CONVERT(nvarchar(max),Embedding) FROM dbo.vamahtani_embeddings WHERE Id=11);
 DECLARE @matches TABLE(Id int,Name nvarchar(120),Description nvarchar(1000),ImagePath nvarchar(120),IllustrativePriceUsd decimal(10,2),IsSample bit,Distance float);
 INSERT @matches EXEC api.SearchBouquetStudies @QueryEmbedding=@probe,@EmbeddingModel=${literal(model)},@Top=3;
 IF (SELECT COUNT(*) FROM @matches)<>3 THROW 51801,'Native ANN graph readiness is not verified.',1;
END;
SELECT CONVERT(int,SERVERPROPERTY('EngineEdition')) AS engineEdition, DB_NAME() AS [database],
(SELECT COUNT(*) FROM dbo.vamahtani_embeddings WHERE EmbeddingModel=${literal(model)}) AS sampleCount,
(SELECT COUNT(*) FROM dbo.SchemaVersions) AS migrationCount,
(SELECT MAX(TRY_CONVERT(int,JSON_VALUE(v.build_parameters,'$.Version')))
 FROM sys.vector_indexes AS v
 INNER JOIN sys.index_columns AS c ON c.object_id=v.object_id AND c.index_id=v.index_id
 WHERE v.object_id=OBJECT_ID(N'dbo.vamahtani_embeddings') AND v.name=N'IX_vamahtani_embeddings_DiskANN'
 AND c.column_id=COLUMNPROPERTY(v.object_id,N'Embedding','ColumnId')
 AND v.vector_index_type=N'DiskANN' AND v.distance_metric=N'cosine'
 AND v.is_disabled=0 AND v.is_hypothetical=0) AS vectorIndexVersion,
(SELECT COUNT(*) FROM dbo.vamahtani WHERE Id=1 AND DemoName=N'Gulnara') AS signatureRows
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;`);
  const exact = value.sampleCount === 40 && [4, 5].includes(value.migrationCount);
  const diskann = ((value.sampleCount === 100 && [6, 7, 8].includes(value.migrationCount)) ||
    (value.sampleCount === 300 && value.migrationCount === 9)) &&
    Number.isInteger(value.vectorIndexVersion) && value.vectorIndexVersion >= 3;
  if (value.engineEdition !== 5 || value.database !== database || (!exact && !diskann) || value.signatureRows !== 1) {
    throw new Error('The selected Azure SQL target does not have the verified corpus, schema and search index. Complete the approved seed/index steps; no fallback is enabled.');
  }
  return { target, engineEdition: 5, database: value.database, table: 'dbo.vamahtani_embeddings', model, dimensions: 1536,
    sampleCount: value.sampleCount, searchMethod: diskann ? 'diskann' : 'exact',
    vectorIndexVersion: diskann ? value.vectorIndexVersion : 0, remainingRequests: remainingRequests() };
}
export function createDemoServer({ sql, config, target, port, assets = resolve(root, 'packages/frontend/dist'), searchOperation = search, statusOperation = status }) {
  const origin = `http://127.0.0.1:${port}`;
  let searching = false;
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' };
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.host !== `127.0.0.1:${port}`) return send(403, { error: 'Only the configured loopback host is allowed.' });
      if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Origin not allowed.' });
      const url = new URL(req.url || '/', origin);
      if (url.pathname === '/demo-api/status' && req.method === 'GET') return send(200, statusOperation(sql, target, config.sqlDatabase));
      if (url.pathname === '/demo-api/search') {
        if (req.method !== 'POST') return send(405, { error: 'Use POST for semantic search.' });
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return send(403, { error: 'A same-origin JSON request is required.' });
        if (searching) return send(429, { error: 'One demo search is already in progress.' });
        let bytes = 0; const chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4096) return send(413, { error: 'Demo request exceeds four KiB.' });
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); validateQuery(body?.query); }
        catch { return send(400, { error: 'Enter one to 500 characters of demo bouquet preferences.' }); }
        if (searching) return send(429, { error: 'One demo search is already in progress.' });
        searching = true;
        try {
          statusOperation(sql, target, config.sqlDatabase);
          const results = await searchOperation(sql, config, body.query);
          return send(200, { results, remainingRequests: remainingRequests() });
        } catch (error) {
          console.error('Semantic demo failed:', error.message);
          return send(503, { error: error.message, remainingRequests: remainingRequests() });
        } finally { searching = false; }
      }
      if (url.pathname.startsWith('/api/') || url.pathname === '/config.json') return send(404, { error: 'Customer API and identity are not configured in the operator demo.' });
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'Method not allowed.' });
      const file = resolve(assets, url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(`${resolve(assets)}${sep}`)) return send(403, { error: 'Path not allowed.' });
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch (error) {
        if (['ENOENT', 'EISDIR'].includes(error.code)) return send(404, { error: 'Not found.' });
        throw error;
      }
    } catch (error) {
      console.error('Operator demo request failed:', error.message);
      if (!res.headersSent) send(500, { error: 'Operator demo unavailable. Check its terminal; no match is confirmed.' });
      else res.destroy();
    }
  });
}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  if (args.includes('--auth') && !option('--auth')) throw new Error('--auth requires entra or api-key; no credential fallback is supported.');
  const target = option('--target');
  if (!['migrate', 'approve-catalog-refinement', 'refine-catalog', 'approve-ann-corpus-expansion', 'expand-ann-corpus', 'approve-seed-retry', 'approve-catalog-expansion', 'approve-diskann-expansion', 'approve-search-renewal', 'rollout-diskann', 'enable-diskann', 'verify-diskann', 'seed', 'seed-catalog', 'search', 'serve', 'status'].includes(command) || !['local', 'cloud'].includes(target)) throw new Error('Use a supported vector-demo command with --target local|cloud.');
  if (['approve-catalog-refinement', 'refine-catalog'].includes(command) && target !== 'local') throw new Error('Description refinement is approved only for the local container.');
  if (command === 'approve-ann-corpus-expansion' && target !== 'local') throw new Error('Record the experiment approval locally; cloud uses cached vectors only.');
  if (command === 'expand-ann-corpus' && !args.includes('--approved-ann-experiment')) throw new Error('The 300-record experiment requires explicit user approval.');
  if (command === 'rollout-diskann' && (target !== 'cloud' || !args.includes('--approved-cloud-rollout'))) throw new Error('The cached cloud rollout requires explicit deployment and public allowance approval, recorded with --approved-cloud-rollout.');
  if (command === 'approve-search-renewal' && target !== 'local') throw new Error('Record private allowance approval locally; this command never changes the public SQL budget.');
  if (['approve-diskann-expansion', 'enable-diskann', 'verify-diskann'].includes(command) && target !== 'local') throw new Error('The DiskANN expansion is approved only for the local container. Cloud application requires a separate approval.');
  const file = resolve(root, '.env.demo');
  const env = { ...readEnvironment(), ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...process.env };
  const config = { ...validateConfiguration({ ...env, DEMO_OPENAI_AUTH: option('--auth') || 'entra' }), target };
  const sql = sqlAdapter(target, config, env);
  const identity = sql('appdb', ['-Q', "SET NOCOUNT ON; SELECT CONCAT(CONVERT(int,SERVERPROPERTY('EngineEdition')),'|',DB_NAME(),'|',CONVERT(nvarchar(128),DATABASEPROPERTYEX(DB_NAME(),'Collation')));"]);
  const database = target === 'cloud' ? config.sqlDatabase : 'appdb';
  if (identity.trim() !== `5|${database}|SQL_Latin1_General_CP1_CI_AS`) throw new Error('Unexpected SQL target/engine/collation; no writes authorized.');
  if (command === 'migrate') {
    if (target === 'cloud') throw new Error('Migration 006 is approved only locally. Cloud migration/publication requires a separate rollout approval; no cloud writes were sent.');
    applyMigrations(sql, target === 'cloud' ? file => resolve(root, 'packages/data/migrations', file) : undefined);
    console.log('Forward-only checksummed migrations verified on', target);
  } else if (command === 'approve-ann-corpus-expansion') {
    if (!existsSync(resolve(root, '.local/diskann-study-embeddings.json')) || existsSync(resolve(root, '.local/ann-experiment-embeddings.json'))) throw new Error('Preserve the original cache; do not replay the experiment approval.');
    updateBudget(approveANNCorpusExpansion);
    console.log('One 200-description batch, at most 50,000 input tokens, approved. Active search caps and prior usage retained.');
  } else if (command === 'approve-catalog-refinement') {
    if (target !== 'local' || !existsSync(resolve(root, '.local/ann-experiment-embeddings.json')) ||
        existsSync(resolve(root, '.local/refined-composition-embeddings.json'))) throw new Error('Approval requires the complete original local cache and no existing refinement cache.');
    updateBudget(approveCatalogRefinement);
    console.log('One local-only 200-description refresh approved, capped at 50,000 input tokens. All prior usage and search caps retained.');
  } else if (command === 'refine-catalog') await refineCatalog(sql, config);
  else if (command === 'expand-ann-corpus') await expandANNCorpus(sql, config, { cachedOnly: target === 'cloud' });
  else if (command === 'approve-seed-retry') {
    if (existsSync(resolve(root, '.local/vector-demo-embeddings.json'))) throw new Error('A seed cache already exists; reuse it, do not renew inference.');
    updateBudget(value => {
      if (value.seedAttempts !== 1 || value.authorizedSeedAttempts === 2) throw new Error('Only one explicit renewal of the first attempted seed is supported.');
      value.authorizedSeedAttempts = 2;
      value.seedRetryApproval = { at: new Date().toISOString(), priorSeedAttempts: value.seedAttempts, scope: 'One user-authorized six-description retry; previous attempts and the 20-search cap preserved.' };
    });
    console.log('One seed retry authorized explicitly; existing attempt history and search budget retained. No model request sent.');
  } else if (command === 'approve-catalog-expansion') {
    if (!existsSync(resolve(root, '.local/vector-demo-embeddings.json')) || existsSync(resolve(root, '.local/bouquet-study-embeddings.json'))) throw new Error('Expansion requires the existing six-vector cache and no regenerated forty-vector cache.');
    updateBudget(approveCatalogExpansion);
    console.log('Explicit 34-description expansion and 20 additional searches recorded; all prior attempts/tokens retained. No inference sent.');
  } else if (command === 'approve-diskann-expansion') {
    if (!existsSync(resolve(root, '.local/bouquet-study-embeddings.json')) ||
        existsSync(resolve(root, '.local/diskann-study-embeddings.json'))) throw new Error('DiskANN approval requires the existing forty-vector cache and no regenerated hundred-vector cache.');
    updateBudget(approveDiskANNExpansion);
    console.log('One user-approved 60-description local batch recorded. Prior attempts/tokens and the existing search cap are unchanged.');
  } else if (command === 'approve-search-renewal') {
    updateBudget(value => approvePrivateSearchRenewal(value, Number(option('--additional'))));
    console.log(JSON.stringify(status(sql, target, config.sqlDatabase), null, 2));
    console.log('Explicit private search renewal recorded. Past attempts/tokens and seed allowance retained; no automatic refresh or public-budget change.');
  } else if (command === 'rollout-diskann') await enableDiskANN(sql, config, { cachedOnly: true });
  else if (command === 'enable-diskann') await enableDiskANN(sql, config);
  else if (command === 'verify-diskann') verifyDiskANN(sql);
  else if (command === 'seed') await seed(sql, config);
  else if (command === 'seed-catalog') await seedCatalog(sql, config);
  else if (command === 'status') console.log(JSON.stringify(status(sql, target, config.sqlDatabase), null, 2));
  else if (command === 'search') {
    status(sql, target, config.sqlDatabase);
    console.log(JSON.stringify(await search(sql, config, option('--query')), null, 2));
  } else {
    status(sql, target, config.sqlDatabase);
    const port = args.includes('--port') ? Number(option('--port')) : 5191;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback demo port.');
    const server = createDemoServer({ sql, config, target, port });
    server.listen(port, '127.0.0.1', () => console.log(`Operator demo: http://127.0.0.1:${port}/?demo=ai (${target}); AI requests are metered and capped. Customer booking remains disconnected.`));
    server.on('error', error => { console.error('Operator demo startup failed:', error.message); process.exitCode = 1; });
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
