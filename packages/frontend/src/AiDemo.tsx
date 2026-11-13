import { ArrowLeft, ArrowRight, Database, Search, Sparkles } from 'lucide-react';
import { Logo } from './Logo';
import { searchSqlExample, semanticPrompts as prompts, submitSearchOnEnter, useSemanticSearch } from './useSemanticSearch';
import { bouquetPhotos, flowerPhotoPath, PhotographyCredits } from './FlowerPhotography';

export function AiDemo() {
  const { status, query, setQuery, results, searched, busy, error, search, publicDemo, connectionChecking, reconnect } = useSemanticSearch();
  const diskann = status?.searchMethod === 'diskann';
  const photos = bouquetPhotos(results ?? []);
  return <div className="site demo-site" data-theme="light">
    <a className="skip" href="#demo-main">Skip to content</a>
    <header className="header wrap"><Logo caption="THE STUDIO LAB"/><a className="text-button" href="/"><ArrowLeft size={15} aria-hidden/>Back to Gulnara</a></header>
    <main id="demo-main" className="wrap demo-main">
      <div className="demo-heading"><span className="eyebrow">GULNARA / AN AZURE SQL AI DEMONSTRATION</span><h1>A feeling.<br/><em>A closer match.</em></h1><p>A small study in finding flowers by meaning, not just matching words.</p></div>
      <div className="demo-pipeline" aria-label="How the live demo works">
        <div><span>01</span><Sparkles size={20} aria-hidden/><h2>Words into vectors.</h2><p>Azure OpenAI turns a bouquet description into a real 1,536-dimensional embedding.</p></div>
        <div><span>02</span><Database size={20} aria-hidden/><h2>Stored in Azure SQL.</h2><p>Synthetic compositions in dbo.vamahtani_embeddings use native VECTOR(1536). They are not live inventory.</p></div>
        <div><span>03</span><Search size={20} aria-hidden/><h2>Meaning, measured.</h2><p>{diskann ? 'SQL uses a cosine DiskANN index with VECTOR_SEARCH and FORCE_ANN_ONLY. Results are approximate; lower distance is closer.' : 'The earlier demo calculates exact cosine distance with VECTOR_DISTANCE. Lower is closer.'}</p></div>
      </div>
      <section className="demo-search" aria-labelledby="demo-search-title">
        <div className="demo-search-heading"><div><span className="eyebrow">TRY THE SEMANTIC EDIT</span><h2 id="demo-search-title">What is the feeling?</h2></div><span className="demo-connection" role="status">{status ? `${status.target === 'local' ? 'Azure SQL container' : 'Azure SQL cloud database'} / ${status.database} / EngineEdition 5` : connectionChecking ? 'Checking search connection…' : 'Connection not yet verified'}</span></div>
        <form onSubmit={event => void search(event)}>
          <label htmlFor="semantic-query">Describe a bouquet for the demo</label>
          <textarea id="semantic-query" value={query} aria-describedby="semantic-search-keyboard semantic-search-notice" enterKeyHint="search" placeholder="Describe an occasion, a mood, or your favorite colors…" maxLength={500} rows={3} required disabled={busy} onChange={event => setQuery(event.target.value)} onKeyDown={submitSearchOnEnter}/>
          <p id="semantic-search-keyboard" className="hint">Press Enter to search. Shift+Enter adds a new line.</p>
          <p id="semantic-search-notice" className="search-processing-notice">By selecting "Find a semantic match" or pressing Enter to search, you agree to Azure OpenAI processing of sample flower preferences. Token charges apply. Do not include personal details. Query text is not stored by this demo.{publicDemo && <> A cumulative allowance is shared by all visitors.</>}</p>
          <div className="demo-prompts" aria-label="Example descriptions">{prompts.map(prompt => <button type="button" key={prompt} disabled={busy} onClick={() => setQuery(prompt)}>{prompt}</button>)}</div>
          <div className="form-bottom"><p>This sends your description to Azure OpenAI and has token charges.<br/>Use only demo bouquet preferences, never customer or sensitive details.<br/>{status ? `${status.remainingRequests} approved searches remain.` : 'SQL connection not yet verified.'}</p><button className="button primary" aria-describedby="semantic-search-notice" disabled={!status || !query.trim() || busy || status.remainingRequests === 0} type="submit">{busy ? 'Embedding & searching…' : 'Find a semantic match'}<ArrowRight size={16} aria-hidden/></button></div>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {!status && <button className="text-button" type="button" disabled={connectionChecking} onClick={reconnect}>{connectionChecking ? 'Checking connection…' : 'Reconnect search'}</button>}
        {status?.remainingRequests === 0 && <p className="notice">The approved AI request budget is exhausted. It does not refresh automatically. No further model requests will be sent.</p>}
      </section>
      {results && <section className="demo-results" aria-labelledby="demo-results-title">
        <span className="eyebrow">ACTUAL SQL RESULTS / SAMPLE STUDIES ONLY</span><h2 id="demo-results-title">The closest compositions.</h2><p className="hint">For “{searched}”. Model: {status?.model}. Distance is not a confidence percentage. Photographs are floral inspiration, not exact recipes or live stock. These designs cannot be booked.</p>
        <div className="boutique-grid">{results.map((result, index) => <article className="boutique-card" key={result.Id}>
          <div className="boutique-art photographic"><img src={flowerPhotoPath(photos[index])} alt={`${photos[index].subject}; photographic inspiration for sample ${result.Name}, not verified inventory`} width={1000} height={1500} loading="lazy"/><span>{index === 0 ? 'Closest in meaning' : `Match ${index + 1}`}</span></div>
          <div className="boutique-card-heading"><h3>{result.Name}</h3></div>
          <div className="semantic-distance"><p>Cosine distance <strong>{result.Distance.toFixed(4)}</strong></p><span>Lower distance means closer meaning, not a confidence percentage.</span></div>
          <p className="bouquet-description">{result.Description}</p><p className="bouquet-availability">Sample study · not available to book</p>
        </article>)}</div>
      </section>}
      <section className="demo-sql" aria-labelledby="demo-sql-title"><div><span className="eyebrow">THE DATABASE STORY</span><h2 id="demo-sql-title">Build locally.<br/><em>Bring the SQL with you.</em></h2><p>Azure OpenAI generates real embeddings; Azure SQL stores them and runs the search. {diskann ? `Developed and tested in the Azure SQL Database container, this connection verifies a native cosine DiskANN index and forced approximate nearest-neighbor retrieval in the ${status?.target === 'cloud' ? 'Azure SQL cloud database' : 'local container'}.` : 'This connection uses the earlier container-to-cloud revision with exact cosine ranking.'}</p><p>This demo does not enable production sign-in or bookings. The separate booking recommender remains rules-based.</p></div><pre tabIndex={0} aria-label="SQL demonstration queries"><code>{`SELECT COUNT(*) AS SampleCount FROM dbo.vamahtani_embeddings;
SELECT * FROM dbo.vamahtani;

SELECT Id, Name, EmbeddingModel,
       DATALENGTH(Embedding) AS VectorBytes
FROM dbo.vamahtani_embeddings;

DECLARE @q VECTOR(1536) = (
  SELECT Embedding
  FROM dbo.vamahtani_embeddings
  WHERE Id = 3
);
${searchSqlExample(status?.searchMethod)}`}</code></pre></section>
    </main>
    <footer><div className="wrap footer-top"><Logo caption="COMPOSED WITH INTENTION."/><p>Azure OpenAI embeddings.<br/>Native Azure SQL vector search.</p><a href="/">Return to the collection <ArrowRight size={16} aria-hidden/></a></div><div className="wrap footer-bottom"><PhotographyCredits/></div></footer>
  </div>;
}
