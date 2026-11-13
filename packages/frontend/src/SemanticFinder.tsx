import { ArrowRight, Database, Sparkles } from 'lucide-react';
import { searchSqlExample, semanticPrompts, submitSearchOnEnter, useSemanticSearch, type SearchResult } from './useSemanticSearch';
import { bouquetPhotos, flowerPhotoPath } from './FlowerPhotography';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export function SemanticFinder({ disabled, onChoose }: { disabled: boolean; onChoose: (study: SearchResult) => void }) {
  const { status, query, setQuery, results, searched, busy, error, search, publicDemo, connectionChecking, reconnect } = useSemanticSearch();
  const diskann = status?.searchMethod === 'diskann';
  const photos = bouquetPhotos(results ?? []);
  return <section id="discover" className="semantic-section wrap" aria-labelledby="discover-title">
    <div className="semantic-bar">
      <div className="semantic-search-title"><span className="eyebrow">THE FLORAL FINDER</span><h2 id="discover-title">Find by feeling.</h2><p>Vector search / powered by Azure SQL</p></div>
      <form onSubmit={event => void search(event)}>
        <div className="semantic-controls">
          <label className="sr-only" htmlFor="floral-search">Describe your ideal bouquet</label>
          <textarea id="floral-search" maxLength={500} rows={1} required aria-describedby="floral-search-keyboard floral-search-notice" enterKeyHint="search" placeholder="Describe an occasion, a mood, or your favorite colors…" value={query} disabled={disabled || busy} onChange={event => setQuery(event.target.value)} onKeyDown={submitSearchOnEnter}/>
          <button className="button primary" type="submit" aria-describedby="floral-search-notice" disabled={disabled || !status || busy || !query.trim() || status.remainingRequests === 0}>{busy ? 'Finding your floral edit…' : 'Find my floral edit'}<ArrowRight size={16} aria-hidden/></button>
        </div>
        <div className="demo-prompts">{semanticPrompts.map(prompt => <button type="button" key={prompt} disabled={disabled || busy} onClick={() => setQuery(prompt)}>{prompt}</button>)}</div>
        <p id="floral-search-keyboard" className="hint">Press Enter to search. Shift+Enter adds a new line.</p>
        <p id="floral-search-notice" className="search-processing-notice">By selecting "Find my floral edit" or pressing Enter to search, you agree to Azure OpenAI processing of sample flower preferences. Token charges apply. Do not include personal or customer details. Query text is not stored by this demo.{publicDemo && <> The cumulative allowance is shared by all visitors.</>}</p>
      </form>
    </div>
    <div className="semantic-meta">
      <div className="semantic-connection" role="status"><Sparkles size={14} aria-hidden/>{status ? `Search connected / ${status.target === 'local' ? 'Azure SQL container' : 'Azure SQL cloud database'}${diskann ? ' / DiskANN' : ''}` : connectionChecking ? 'Checking search connection…' : 'Meaning-based search is not connected'}</div>
      <p>Sample inventory, not live stock. Azure OpenAI embeddings; native SQL matches. Token charges apply. Use sample preferences only, never customer or sensitive details.{status && <> {status.remainingRequests} approved searches remain. This cumulative allowance does not refresh automatically.</>}</p>
    </div>
      {error && <p className="error" role={status ? 'alert' : 'status'}>{error}</p>}
      {!status && <button className="text-button" type="button" disabled={connectionChecking} onClick={reconnect}>{connectionChecking ? 'Checking connection…' : 'Reconnect search'}</button>}
      {status?.remainingRequests === 0 && <p className="notice">The approved AI search allowance is exhausted. It does not refresh automatically. No further requests will be sent.</p>}
    {results && <div className="semantic-results" aria-live="polite">
      <div className="results-heading"><div><span className="eyebrow">CLOSEST IN MEANING / FROM THE DEMO COLLECTION</span><h3>Your floral edit.</h3></div><span className="result-size">3 compositions</span></div>
      <p className="hint">For “{searched}”. Sample designs and illustrative Signature-size USD prices, not confirmed offers. Photographs are floral inspiration, not exact recipes or live stock. Tax and delivery are not configured. Similarity is not an availability or exact-budget guarantee.</p>
      <div className="boutique-grid">{results.map((result, index) => <article className="boutique-card" key={result.Id}>
        <div className="boutique-art photographic"><img src={flowerPhotoPath(photos[index])} alt={`${photos[index].subject}; photographic inspiration for sample ${result.Name}, not verified inventory`} width={1000} height={1500} loading="lazy"/><span>{index === 0 ? 'Closest in meaning' : `Another possibility / ${index + 1}`}</span></div>
        <div className="boutique-card-heading"><h3>{result.Name}</h3></div>
        <div className="semantic-distance"><p>Cosine distance <strong>{result.Distance.toFixed(4)}</strong></p><span>Lower distance means closer meaning, not a confidence percentage.</span></div>
        <p className="bouquet-description">{result.Description}</p>
        <p className="semantic-price">{usd.format(result.IllustrativePriceUsd)} <span>Illustrative USD / Signature</span></p>
        <button className="text-button" type="button" disabled={disabled || busy} onClick={() => onChoose(result)} aria-label={`Personalize sample ${result.Name}`}>Make it personal <ArrowRight size={15} aria-hidden/></button>
        <p className="bouquet-availability">Sample design · not available to book</p>
      </article>)}</div>
    </div>}
    <details className="semantic-proof"><summary><Database size={15} aria-hidden/> Behind the bouquet: native Azure SQL vector search</summary><p>Demo compositions are stored in <code>dbo.vamahtani_embeddings</code> as <code>VECTOR(1536)</code>. {diskann ? <>This connection uses a native cosine DiskANN index and <code>VECTOR_SEARCH</code> with <code>FORCE_ANN_ONLY</code>. Results are approximate nearest neighbors, not simulated matches; lower distance is closer. Developed and tested in the Azure SQL Database container; this connection verifies DiskANN in the {status?.target === 'cloud' ? 'Azure SQL cloud database' : 'local container'}.</> : <>This connection uses the earlier exact cosine <code>VECTOR_DISTANCE</code> revision, with no simulated ranking.</>}</p><pre><code>{`SELECT Id, Name, IllustrativePriceUsd,
       DATALENGTH(Embedding) AS VectorBytes
FROM dbo.vamahtani_embeddings ORDER BY Id;

DECLARE @q VECTOR(1536) = (
  SELECT Embedding FROM dbo.vamahtani_embeddings WHERE Id = 3
);
${searchSqlExample(status?.searchMethod)}`}</code></pre><a className="text-button" href="/?demo=ai">Explore the database story <ArrowRight size={14} aria-hidden/></a></details>
  </section>;
}
