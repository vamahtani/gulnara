import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';

export function submitSearchOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ||
      event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  event.preventDefault();
  if (event.repeat) return;
  const form = event.currentTarget.form;
  const submitter = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitter && !submitter.disabled) form?.requestSubmit(submitter);
}

export type DemoStatus = {
  target: 'local' | 'cloud'; engineEdition: 5; database: 'appdb' | 'gulnara_db' | 'gulnara_db_demo';
  table: 'dbo.vamahtani_embeddings'; model: string; dimensions: 1536;
  sampleCount: 40 | 100 | 300; remainingRequests: number;
  searchMethod?: 'exact' | 'diskann'; vectorIndexVersion?: number; searchLimit?: 20 | 120;
};
export type SearchResult = {
  Id: number; Name: string; Description: string; ImagePath: string;
  IllustrativePriceUsd: number; Distance: number; IsSample: true;
};
export const semanticPrompts = [
  'graduation flowers',
  'lush and warm',
];
function isStatus(value: unknown, publicDemo: boolean): value is DemoStatus {
  if (!value || typeof value !== 'object') return false;
  const searchLimit = 'searchLimit' in value ? value.searchLimit : 20;
  if (searchLimit !== 20 && searchLimit !== 120) return false;
  if (publicDemo && searchLimit === 120 &&
      (!('sampleCount' in value) || (value.sampleCount !== 100 && value.sampleCount !== 300) ||
       !('searchMethod' in value) || value.searchMethod !== 'diskann')) return false;
  const maximumRemaining = publicDemo ? searchLimit : 100;
  return !!value && typeof value === 'object' && 'target' in value &&
    (value.target === 'local' || value.target === 'cloud') &&
    'engineEdition' in value && value.engineEdition === 5 &&
    'database' in value && (value.database === 'appdb' ||
      (value.target === 'cloud' && (value.database === 'gulnara_db' || value.database === 'gulnara_db_demo'))) &&
    'table' in value && value.table === 'dbo.vamahtani_embeddings' &&
    'model' in value && value.model === 'text-embedding-3-small:1:1536' &&
    'dimensions' in value && value.dimensions === 1536 &&
    'sampleCount' in value && (
      (value.sampleCount === 40 &&
        (!('searchMethod' in value) || value.searchMethod === 'exact') &&
        (!('vectorIndexVersion' in value) || value.vectorIndexVersion === 0)) ||
      ((value.sampleCount === 100 || value.sampleCount === 300) && 'searchMethod' in value && value.searchMethod === 'diskann' &&
        'vectorIndexVersion' in value && Number.isInteger(value.vectorIndexVersion) && Number(value.vectorIndexVersion) >= 3)
    ) &&
    'remainingRequests' in value && Number.isInteger(value.remainingRequests) &&
    Number(value.remainingRequests) >= 0 && Number(value.remainingRequests) <= maximumRemaining;
}
function isResult(value: unknown, maxId: number): value is SearchResult {
  return !!value && typeof value === 'object' &&
    'Id' in value && Number.isInteger(value.Id) && Number(value.Id) >= 1 && Number(value.Id) <= maxId &&
    'Name' in value && typeof value.Name === 'string' &&
    'Description' in value && typeof value.Description === 'string' &&
    'ImagePath' in value && ['/maison-blush.svg', '/maison-calla.svg', '/maison-wine.svg'].includes(String(value.ImagePath)) &&
    'IllustrativePriceUsd' in value && typeof value.IllustrativePriceUsd === 'number' &&
    Number.isFinite(value.IllustrativePriceUsd) && value.IllustrativePriceUsd > 0 && value.IllustrativePriceUsd <= 10000 &&
    'Distance' in value && typeof value.Distance === 'number' && Number.isFinite(value.Distance) && value.Distance >= 0 && value.Distance <= 2 &&
    'IsSample' in value && value.IsSample === true;
}
export function searchSqlExample(method: 'exact' | 'diskann' = 'exact') {
  return method === 'diskann'
    ? `SELECT TOP (3) WITH APPROXIMATE
  b.Id, b.Name, b.IllustrativePriceUsd,
  r.distance AS CosineDistance
FROM VECTOR_SEARCH(
  TABLE = dbo.vamahtani_embeddings AS b,
  COLUMN = Embedding, SIMILAR_TO = @q,
  METRIC = 'cosine'
) AS r WITH (FORCE_ANN_ONLY)
ORDER BY r.distance;`
    : `SELECT TOP (3) Id, Name, IllustrativePriceUsd,
  VECTOR_DISTANCE('cosine', Embedding, @q)
    AS CosineDistance
FROM dbo.vamahtani_embeddings
ORDER BY CosineDistance, Id;`;
}
export function useSemanticSearch(initialQuery = '') {
  const publicOrigin = import.meta.env.VITE_PUBLIC_VECTOR_ORIGIN || '';
  const publicDemo = !!publicOrigin;
  const [status, setStatus] = useState<DemoStatus>();
  const maximumRemaining = publicDemo ? (status?.searchLimit ?? 20) : 100;
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>();
  const [searched, setSearched] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connectionChecking, setConnectionChecking] = useState(true);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setConnectionChecking(true);
    setError('');
    void (async () => {
      try {
        if (publicOrigin && !/^https:\/\/gulnara-vector-demo-61868ab8\.azurewebsites\.net$/.test(publicOrigin)) throw new Error('Public API configuration is invalid.');
        const response = await fetch(`${publicOrigin}/demo-api/status`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        });
        if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const failure: unknown = await response.json();
          if (failure && typeof failure === 'object' && 'reason' in failure && failure.reason === 'ann-graph-not-ready') {
            throw new Error('The cloud DiskANN index exists, but its ANN graph is not ready. No AI request was sent.');
          }
        }
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error(publicDemo
          ? 'Meaning-based search is temporarily unavailable. The free demo may be waking up; select Reconnect search to check again. No AI request was sent.'
          : 'Meaning-based search is not connected here. Complete the approved migrate/seed-catalog steps and open the localhost operator app started with --auth api-key. No AI requests can be sent from this preview.');
        const value: unknown = await response.json();
        if (!isStatus(value, publicDemo)) throw new Error('The service did not verify native SQL embeddings. No connection can be claimed.');
        setStatus(value);
      } catch (cause) {
        if (!controller.signal.aborted) setError((cause instanceof Error || cause instanceof DOMException) && cause.name === 'TimeoutError'
          ? 'The search connection check timed out. Select Reconnect search to check again. No AI request was sent.'
          : cause instanceof Error ? cause.message : 'Could not verify semantic search.');
      } finally {
        if (!controller.signal.aborted) setConnectionChecking(false);
      }
    })();
    return () => controller.abort();
  }, [publicOrigin, publicDemo, connectionAttempt]);
  function reconnect() {
    if (connectionChecking || busy || status) return;
    setConnectionChecking(true);
    setConnectionAttempt(previous => previous + 1);
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!status || busy || status.remainingRequests === 0) return;
    if (!query.trim() || query.trim().length > 500) { setError('Describe your bouquet in one to 500 characters.'); return; }
    setBusy(true); setError(''); setResults(undefined);
    try {
      const response = await fetch(`${publicOrigin}/demo-api/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), ...(publicDemo ? { consent: true } : {}) }), signal: AbortSignal.timeout(65_000),
      });
      const value: unknown = await response.json();
      const validRemaining = value && typeof value === 'object' && 'remainingRequests' in value &&
        Number.isInteger(value.remainingRequests) && Number(value.remainingRequests) >= 0 && Number(value.remainingRequests) <= maximumRemaining;
      if (validRemaining) {
        setStatus(previous => previous ? { ...previous, remainingRequests: Number(value.remainingRequests) } : previous);
      }
      if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : `Search failed (${response.status}). No match can be confirmed.`);
      if (!validRemaining) throw new Error('SQL returned an unexpected search allowance. No matches can be shown.');
      if (!value || typeof value !== 'object' || !('results' in value) || !Array.isArray(value.results)) {
        throw new Error('SQL returned an unexpected ranking. No matches can be shown.');
      }
      const rows = value.results;
      if (rows.length !== 3 || !rows.every(row => isResult(row, status.sampleCount)) ||
        new Set(rows.map(result => result.Id)).size !== 3 ||
        rows.some((result, index) => index > 0 && result.Distance < rows[index - 1].Distance)) {
        throw new Error('SQL returned an unexpected ranking. No matches can be shown.');
      }
      setResults(rows); setSearched(query.trim());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Search failed. Please try again.'); }
    finally { setBusy(false); }
  }
  return { status, query, setQuery, results, searched, busy, error, search, publicDemo, connectionChecking, reconnect };
}
