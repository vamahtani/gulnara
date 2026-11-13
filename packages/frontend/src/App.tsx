import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Flower2, Leaf, Minus, Moon, Plus, Sun, UserRound } from 'lucide-react';
import type { UserManager } from 'oidc-client-ts';
import { completeSignin, loadIdentity } from './auth';
import { AuthenticationRequiredError } from './api';
import { bookBouquet, getBookings, getCatalog } from './florist-api';
import { Collection } from './Collection';
import { Logo } from './Logo';
import { SemanticFinder } from './SemanticFinder';
import { PhotographyCredits } from './FlowerPhotography';
import type { SearchResult } from './useSemanticSearch';
import { dateWindow, initialPreferences, inspiration, recommend, type Booking, type BookingInput, type BouquetSize, type Design, type Preferences } from './bouquets';

const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const palettes = [{ value: '', label: 'Surprise me' }, { value: 'pink', label: 'Blush' }, { value: 'cream', label: 'Cream' }, { value: 'white', label: 'White' }, { value: 'burgundy', label: 'Wine' }, { value: 'green', label: 'Green' }];
const sizeLabels = { petite: 'A little gesture', signature: 'The lovely in-between', grand: 'Make a statement' };
const emptyDetails = { CustomerName: '', Email: '', RecipientName: '', DeliveryAddress: '', DeliveryDate: '', CardMessage: '' };
type Details = typeof emptyDetails;

export function App() {
  const [theme, setTheme] = useState('system');
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences);
  const [submitted, setSubmitted] = useState<Preferences>();
  const [identity, setIdentity] = useState<UserManager>();
  const [token, setToken] = useState('');
  const [authStatus, setAuthStatus] = useState('Connecting to booking services…');
  const [catalog, setCatalog] = useState<Design[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Design>();
  const [details, setDetails] = useState<Details>(emptyDetails);
  const [confirmed, setConfirmed] = useState<Booking>();
  const [attempt, setAttempt] = useState<{ fingerprint: string; id: string }>();
  const [uncertain, setUncertain] = useState(false);
  const [showBookings, setShowBookings] = useState(false);
  const [collectionChoice, setCollectionChoice] = useState('');
  const resultsRef = useRef<HTMLDivElement>(null);
  const bookingRef = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const dateRange = dateWindow();
  const live = Boolean(token && catalogReady);
  const recommendations = submitted ? recommend(live ? catalog : inspiration, submitted, !live) : [];
  const report = (cause: unknown) => {
    if (cause instanceof AuthenticationRequiredError) {
      setToken(''); setCatalog([]); setBookings([]); setCatalogReady(false); setSelected(undefined); setConfirmed(undefined); setShowBookings(false);
      setUncertain(false);
      setAuthStatus('Sign in again to view availability and private requests.');
    }
    setError(message(cause));
  };
  useEffect(() => {
    const stored = localStorage.getItem('gulnara-theme');
    if (stored && ['system', 'light', 'dark'].includes(stored)) setTheme(stored);
    let active = true;
    void (async () => {
      try {
        const manager = await loadIdentity();
        if (!active) return;
        setIdentity(manager);
        await completeSignin(manager);
        const user = await manager.getUser();
        if (!active) return;
        if (user && !user.expired) {
          setToken(user.access_token);
          setAuthStatus('Signed in. Your bouquet requests are private.');
          try {
            const [designs, saved] = await Promise.all([getCatalog(user.access_token), getBookings(user.access_token)]);
            if (active) { setCatalog(designs); setBookings(saved); setCatalogReady(true); }
          } catch (cause) { if (active) report(cause); }
        } else setAuthStatus('Sign in to see current availability and request a bouquet.');
      } catch (cause) {
        if (active) {
          setAuthStatus('Design preview · Live availability and booking are not connected. Azure SQL and identity setup are required.');
          setError(message(cause));
        }
      }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!identity) return;
    return identity.events.addAccessTokenExpired(() => {
      setToken(''); setCatalog([]); setBookings([]); setSelected(undefined); setCatalogReady(false); setConfirmed(undefined); setShowBookings(false);
      setError('Your session expired. Sign in again; your unsent delivery details are still on this page.');
    });
  }, [identity]);
  function changeTheme(value: string) {
    setTheme(value); localStorage.setItem('gulnara-theme', value);
  }
  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences(previous => ({ ...previous, [key]: value }));
  }
  async function signIn() {
    if (!identity) { document.getElementById('service-status')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    setError('');
    try { await identity.signinRedirect(); } catch (cause) { report(cause); }
  }
  function openBookings() {
    setShowBookings(true);
    setTimeout(() => {
      const section = document.getElementById('my-bouquets');
      section?.focus(); section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }
  async function reload() {
    setBusy(true); setError('');
    try {
      const [designs, saved] = await Promise.all([getCatalog(token), getBookings(token)]);
      setCatalog(designs); setBookings(saved); setCatalogReady(true);
    } catch (cause) { report(cause); }
    finally { setBusy(false); }
  }
  function findBouquet(event: FormEvent) {
    event.preventDefault(); setSubmitted({ ...preferences }); setSelected(undefined); setConfirmed(undefined); setError('');
    setTimeout(() => { resultsRef.current?.focus(); resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 0);
  }
  function personalizeStudy(design: Design, size: BouquetSize) {
    setPreferences(previous => ({ ...previous, color: design.Colors.split(',')[0], mood: design.Moods.split(',')[0], size, text: previous.text || `Inspired by ${design.Name.toLowerCase()}.` }));
    beginPersonalization(design.Name);
  }
  function personalizeSearch(study: SearchResult) {
    setPreferences(previous => ({ ...previous, text: previous.text || `Inspired by ${study.Name}. ${study.Description}` }));
    beginPersonalization(study.Name);
  }
  function beginPersonalization(name: string) {
    setCollectionChoice(name);
    setSubmitted(undefined); setSelected(undefined); setConfirmed(undefined); setAttempt(undefined);
    setTimeout(() => {
      document.getElementById('story')?.focus({ preventScroll: true });
      document.getElementById('create')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }
  function selectDesign(design: Design) {
    setSelected(design); setConfirmed(undefined); setAttempt(undefined); setUncertain(false); setError('');
    setTimeout(() => { bookingRef.current?.focus(); bookingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 0);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || !submitted || !token || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    const payload = {
      ...details, DesignId: selected.Id, Size: submitted.size,
      Preferences: JSON.stringify(submitted),
    };
    const fingerprint = JSON.stringify(payload);
    const id = attempt?.fingerprint === fingerprint ? attempt.id : crypto.randomUUID();
    setAttempt({ fingerprint, id });
    const body: BookingInput = { ...payload, RequestId: id };
    try {
      const saved = await bookBouquet(token, body);
      if (saved.length !== 1) throw new Error('The service did not return one saved request. Retry to check the same request safely.');
      setConfirmed(saved[0]); setUncertain(false); setSelected(undefined); setDetails(emptyDetails);
      setBookings(previous => [saved[0], ...previous.filter(booking => booking.Id !== saved[0].Id)]);
      setShowBookings(true);
      // Saving and refreshing are separate outcomes: a failed refresh cannot undo a saved request.
      try { setCatalog(await getCatalog(token)); }
      catch (cause) { setCatalogReady(false); report(cause); }
    } catch (cause) { setUncertain(true); report(cause); }
    finally { saving.current = false; setBusy(false); }
  }

  return <div className="site" data-theme={theme}>
    <a className="skip" href="#main">Skip to content</a>
    <div className="announcement"><span>Rooted in Redmond, Washington.</span><span>Made for your kind of beautiful.</span></div>
    <header className="header wrap">
      <Logo/>
      <nav aria-label="Main navigation"><a href="#discover">Search</a><a href="#collection">The collection</a><a href="#atelier">Our approach</a><a href="#create">Create your bouquet <ArrowRight size={14} aria-hidden/></a></nav>
      <div className="header-actions">
        <button className="icon-button" aria-label="Change appearance" onClick={() => changeTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} aria-hidden/> : <Moon size={18} aria-hidden/>}</button>
        <button className="account-button" aria-label={token ? 'My bouquets' : identity ? 'Sign in' : 'Booking offline'} disabled={!token && !identity} title={!identity ? 'Verified identity and Azure SQL setup are required for booking.' : undefined} onClick={() => token ? openBookings() : void signIn()}><UserRound size={17} aria-hidden/><span>{token ? 'My bouquets' : identity ? 'Sign in' : 'Booking offline'}</span></button>
      </div>
    </header>
    <main id="main">
      <section className="hero wrap" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="eyebrow"><span className="tiny-rule"/> A NOTE, WITHOUT THE WORDS</div>
          <h1 id="hero-title">Some feelings<br/>are better<br/>said in <em>flowers.</em></h1>
          <p>For the grand moments. The quiet thank-yous.<br className="desktop-break"/> The just-because-you-crossed-my-mind.<br className="desktop-break"/> A bouquet as thoughtful as the feeling behind it.</p>
          <a className="button primary" href="#collection">Explore the collection <ArrowRight size={17} aria-hidden/></a>
          <a className="hero-bespoke" href="#discover">Begin with a feeling <ArrowRight size={13} aria-hidden/></a>
          <div className="hero-caption"><Flower2 size={19} strokeWidth={1.2} aria-hidden/><span>Thoughtful flowers. Unmistakably you.</span></div>
        </div>
        <div className="hero-visual"><figure className="hero-art">
          <img src="/luxury-bouquet.jpg" width={1024} height={1536} alt="Editorial floral artwork of blush roses, cream peonies and wine-colored calla lilies on a stone pedestal; not a photograph of available stock" fetchPriority="high"/>
        </figure><p className="image-caption">Editorial floral artwork · not live inventory</p></div>
      </section>
      <SemanticFinder disabled={busy || uncertain} onChoose={personalizeSearch}/>
      <div className="principles"><span><Leaf size={16} aria-hidden/> Inspired by the season</span><span className="separator" aria-hidden>✧</span><span>Composed with intention</span><span className="separator" aria-hidden>✧</span><span>Never one-size-fits-all</span></div>
      <Collection disabled={busy || uncertain} onChoose={personalizeStudy}/>

      <section id="create" className="atelier-section wrap" aria-labelledby="create-title">
        <div className="section-intro"><span className="eyebrow">02 / YOUR FLORAL ATELIER</span><h2 id="create-title">A little about them.<br/><em>A little about the feeling.</em></h2><p>No flower vocabulary needed. Tell us what you have in mind,<br className="desktop-break"/> and let’s find a beautiful place to start.</p></div>
        <form className="preferences" onSubmit={findBouquet}>
          <div className="form-topline"><span><Flower2 size={17} aria-hidden/> A bouquet, made personal.</span><span>BEGIN WITH YOUR STORY</span></div>
          {collectionChoice && <p className="collection-choice" role="status">Your starting point: <strong>{collectionChoice}</strong>. Shape the details below. This is inspiration, not a reservation or price quote.</p>}
          <label htmlFor="story">What would you like your flowers to say?</label>
          <textarea id="story" maxLength={1000} rows={3} placeholder="A birthday. Soft blush. Something a little unexpected…" value={preferences.text} onChange={event => update('text', event.target.value)}/>
          <div className="select-grid">
            <label>The occasion<select value={preferences.occasion} onChange={event => update('occasion', event.target.value)}><option value="">Just a beautiful gesture</option>{['birthday', 'anniversary', 'thank you', 'just because', 'celebration', 'sympathy'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>The feeling<select value={preferences.mood} onChange={event => update('mood', event.target.value)}><option value="">Let the flowers decide</option>{['romantic', 'gentle', 'joyful', 'natural', 'dramatic'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          </div>
          <fieldset><legend>Your palette</legend><div className="palette-options">{palettes.map(color => <label key={color.value} className={`palette ${preferences.color === color.value ? 'chosen' : ''}`}><input type="radio" name="palette" value={color.value} checked={preferences.color === color.value} onChange={() => update('color', color.value)}/><span className={`swatch swatch-${color.value || 'any'}`}>{preferences.color === color.value && <Check size={13} aria-hidden/>}</span>{color.label}</label>)}</div></fieldset>
          <fieldset><legend>A sense of scale</legend><div className="size-options">{(['petite', 'signature', 'grand'] as const).map((size, index) => <label key={size} className={`size-option ${preferences.size === size ? 'chosen' : ''}`}><input type="radio" name="size" value={size} checked={preferences.size === size} onChange={() => update('size', size)}/><Flower2 size={25 + index * 6} strokeWidth={1} aria-hidden/><span><strong>{size}</strong><small>{sizeLabels[size]}</small></span><span className="radio-dot"/></label>)}</div></fieldset>
          <div className="form-bottom"><p>Not a chatbot. A thoughtful match based on your<br className="desktop-break"/> words, selected details, and configured availability.</p><button className="button primary" type="submit" disabled={busy || uncertain}>Find my bouquet <ArrowRight size={17} aria-hidden/></button></div>
        </form>
        <div id="service-status" className="service-status" role="status"><span className={`status-dot ${live ? 'connected' : ''}`}/>{authStatus}{token && <button className="text-button" disabled={busy} onClick={() => void reload()}>{busy ? 'Refreshing…' : 'Refresh availability'}</button>}</div>
        {error && <p className="error" role="alert">{error}</p>}

        {submitted && <div ref={resultsRef} tabIndex={-1} className="results" aria-labelledby="results-title">
          <div className="results-heading"><div><span className="eyebrow">{live ? 'FROM CONFIGURED AVAILABILITY' : 'DESIGN INSPIRATION ONLY'}</span><h3 id="results-title">{live ? 'Your floral edit.' : 'A direction, just for you.'}</h3></div><span className="result-size">{submitted.size} / {recommendations.length} {recommendations.length === 1 ? 'match' : 'matches'}</span></div>
          {!live && <p className="notice">These are curated sample designs, not verified inventory. {token ? 'Live availability could not be loaded. Refresh before booking.' : 'Sign in once booking services are configured to see live availability.'} Samples cannot be reserved.</p>}
          {live && <p className="hint">Matches use up to 100 published designs. Stem availability is checked again when saving your request.</p>}
          {!recommendations.length && <div className="empty"><Flower2 size={28} aria-hidden/><h4>No matching bouquet right now.</h4><p>{live ? 'No configured recipe has enough stems for these choices. Try another palette or size, or check again later.' : 'No sample matches this palette or its exclusions. Try “Surprise me” or revise your description.'}</p></div>}
          <div className="recommendation-grid">{recommendations.map(({ design, reasons }, index) => <article className="recommendation" key={design.Id}><span className="eyebrow">{index === 0 ? 'YOUR CLOSEST MATCH' : 'ANOTHER BEAUTIFUL POSSIBILITY'}</span><h4>{design.Name}</h4><p>{design.Description}</p><ul>{reasons.map(reason => <li key={reason}><Check size={14} aria-hidden/>{reason}</li>)}</ul>{live ? <button className="text-button" disabled={busy || uncertain} onClick={() => selectDesign(design)}>Request this bouquet <ArrowRight size={16} aria-hidden/></button> : <span className="sample-label">Design study · not available to book</span>}</article>)}</div>
        </div>}

        {selected && submitted && <div ref={bookingRef} tabIndex={-1} className="booking-panel">
          <span className="eyebrow">THE DETAILS THAT MAKE IT PERSONAL</span><h3>For {selected.Name.toLowerCase()}.</h3>
          <p>A {submitted.size} bouquet request. Pricing, delivery area, date and final composition require florist confirmation. No payment is collected.</p>
          <form onSubmit={event => void save(event)}>
            <fieldset disabled={busy || uncertain}><legend className="sr-only">Delivery details</legend><div className="select-grid">
              <label>Your name<input autoComplete="name" required maxLength={120} value={details.CustomerName} onChange={event => setDetails({ ...details, CustomerName: event.target.value })}/></label>
              <label>Your email<input autoComplete="email" type="email" required maxLength={254} value={details.Email} onChange={event => setDetails({ ...details, Email: event.target.value })}/></label>
              <label>Recipient’s name<input autoComplete="section-recipient name" required maxLength={120} value={details.RecipientName} onChange={event => setDetails({ ...details, RecipientName: event.target.value })}/></label>
              <label>Requested delivery date<input type="date" min={dateRange.min} max={dateRange.max} required value={details.DeliveryDate} onChange={event => setDetails({ ...details, DeliveryDate: event.target.value })}/></label>
            </div><label>Full delivery address<textarea autoComplete="street-address" rows={2} maxLength={500} required value={details.DeliveryAddress} onChange={event => setDetails({ ...details, DeliveryAddress: event.target.value })}/></label>
            <label>A note for the card <span className="optional">(optional)</span><textarea rows={2} maxLength={500} value={details.CardMessage} onChange={event => setDetails({ ...details, CardMessage: event.target.value })}/></label></fieldset>
            <p className="hint">Your contact and delivery details will be saved privately for this request. Dates are interpreted in Redmond time. Do not include payment details or sensitive information.</p>
            {uncertain && <p className="notice">The previous request could not be confirmed. Retry checks the same reservation safely; keep these details unchanged to prevent an accidental second request.</p>}
            <button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving your request…' : uncertain ? 'Retry the same request' : 'Send bouquet request'}<ArrowRight size={16} aria-hidden/></button>
            {!uncertain && <button type="button" className="text-button" disabled={busy} onClick={() => setSelected(undefined)}>Back to my edit</button>}
          </form>
        </div>}
        {confirmed && <div className="confirmation" role="status"><Check size={26} aria-hidden/><div><h3>Your request is saved.</h3><p>Reference {confirmed.Id}. Stems have been reserved in configured inventory. This is not a paid order or confirmed delivery; florist confirmation is still required.</p></div></div>}
        {showBookings && token && <section id="my-bouquets" tabIndex={-1} className="my-bookings" aria-labelledby="bookings-title"><div className="results-heading"><h3 id="bookings-title">Your bouquet requests</h3><button className="text-button" disabled={busy} onClick={() => void reload()}>Reload from SQL</button></div><p className="hint">Latest 100 requests, visible only to your account.</p>{bookings.length ? <ul>{bookings.map(booking => <li key={booking.Id}><strong>{booking.DesignName}</strong><span>{booking.Size} · {booking.DeliveryDate.slice(0, 10)} · {booking.Status}</span><span>For {booking.RecipientName} · {booking.DeliveryAddress}</span><small>Reference {booking.Id}</small></li>)}</ul> : <p>No requests loaded. {catalogReady ? 'Your first bouquet story starts here.' : 'Refresh to load your private requests.'}</p>}<button className="text-button" disabled={busy} onClick={() => void identity?.signoutRedirect().catch(report)}>Sign out</button></section>}
      </section>

      <section id="atelier" className="story-section wrap" aria-labelledby="story-title"><div className="story-emblem"><img src="/gulnara-logo.svg" width={90} height={101} alt="Gulnara botanical G monogram"/><span>WITH FEELING,<br/>ALWAYS.</span></div><div><span className="eyebrow">03 / A THOUGHTFUL KIND OF FLORISTRY</span><h2 id="story-title">Less ordinary.<br/><em>More you.</em></h2><p>We believe the most beautiful flowers aren’t simply beautiful. They mean something. A favorite color. A shared memory. A feeling you can’t quite put into words.</p><p>Gulnara is a floral studio in Redmond, Washington, created around that very idea: flowers should feel personal.</p><a className="text-button" href="#create">Let’s start with your story <ArrowRight size={16} aria-hidden/></a></div></section>
      <section className="questions wrap" aria-label="Good to know"><h2>A few little details.</h2><div>{[
        ['Is this a confirmed order?', 'Not yet. A bouquet request reserves available configured stems, but pricing, final design and delivery must be confirmed by the florist. No payment is taken on this website.'],
        ['How do recommendations work?', 'We match your words and selected occasion, mood and palette to design tags, then check configured stem availability for your chosen size. It is rules-based matching, not a live AI service. Sample design studies never represent actual inventory.'],
        ['Are the collection prices final?', 'No. Collection prices are illustrative USD proposals for this design preview, not confirmed offers. Real inventory, pricing, tax and delivery charges must be configured and approved by Gulnara. Choosing a study only personalizes your preferences; it does not reserve stems or collect payment.'],
        ['Where and when do you deliver?', 'Gulnara is based in Redmond, Washington. Delivery coverage, fees and scheduling have not yet been configured. You may request a date tomorrow through 90 days ahead, but submitting does not guarantee delivery.'],
      ].map(([question, answer]) => <details key={question}><summary>{question}<Plus className="plus" size={17} aria-hidden/><Minus className="minus" size={17} aria-hidden/></summary><p>{answer}</p></details>)}</div></section>
    </main>
    <footer><div className="wrap footer-top"><Logo caption="FLOWERS, WITH FEELING."/><p>A floral studio.<br/>Redmond, Washington.</p><a href="#create">Make a beautiful gesture <ArrowRight size={17} aria-hidden/></a></div><div className="wrap footer-bottom"><span>© {new Date().getFullYear()} Gulnara</span><a className="comparison-link" href="/first-take/index.html">Compare the untouched original <ArrowRight size={12} aria-hidden/></a><a className="comparison-link" href="/?demo=ai">Azure SQL AI demo <ArrowRight size={12} aria-hidden/></a><PhotographyCredits/><label>Appearance <select value={theme} onChange={event => changeTheme(event.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div></footer>
  </div>;
}
