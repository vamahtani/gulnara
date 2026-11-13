import { useState } from 'react';
import { ArrowRight, ChevronDown, Flower2 } from 'lucide-react';
import { inspiration, type BouquetSize, type Design } from './bouquets';
import { bouquetPhotos, flowerPhotoPath } from './FlowerPhotography';

// Editorial price proposals only. Never merge these into live stock or booking payloads.
const studies = [
  { design: inspiration[0], image: '/maison-blush.svg', note: 'Softly expressive', palette: 'Blush & cream', prices: { petite: 9500, signature: 14500, grand: 22500 }, composition: 'A blush-and-cream palette, layered petals and a soft, open silhouette. A romantic starting point for your own composition.' },
  { design: inspiration[1], image: '/maison-calla.svg', note: 'Naturally considered', palette: 'White & green', prices: { petite: 7500, signature: 11500, grand: 17500 }, composition: 'Fresh whites, expressive greens and a little breathing room. An airy direction for a quiet thank-you or a just-because gesture.' },
  { design: inspiration[2], image: '/maison-wine.svg', note: 'Quietly dramatic', palette: 'Wine & blush', prices: { petite: 11000, signature: 16500, grand: 24500 }, composition: 'Deep wine tones, sculptural lines and blush accents. A richer palette for a personal celebration or an evening-inspired arrangement.' },
] satisfies { design: Design; image: string; note: string; palette: string; prices: Record<BouquetSize, number>; composition: string }[];
const palettes = [{ value: '', label: 'All compositions' }, { value: 'pink', label: 'Blush & cream' }, { value: 'white', label: 'White & green' }, { value: 'burgundy', label: 'Wine & blush' }];
const sizes: BouquetSize[] = ['petite', 'signature', 'grand'];
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function Collection({ disabled, onChoose }: { disabled: boolean; onChoose: (design: Design, size: BouquetSize) => void }) {
  const [size, setSize] = useState<BouquetSize>('signature');
  const [palette, setPalette] = useState('');
  const [sort, setSort] = useState('curated');
  const visible = studies.filter(study => !palette || study.design.Colors.split(',')[0] === palette)
    .sort((a, b) => sort === 'low' ? a.prices[size] - b.prices[size] : sort === 'high' ? b.prices[size] - a.prices[size] : 0);
  const photos = bouquetPhotos(visible.map(study => ({ ...study.design, ImagePath: study.image })));

  return <section id="collection" className="boutique-section" aria-labelledby="collection-title" aria-describedby="catalog-disclosure">
    <div className="wrap">
      <div className="boutique-heading">
        <div><span className="eyebrow">01 / THE GULNARA COLLECTION</span><h2 id="collection-title">A beautiful place<br/>to <em>begin.</em></h2></div>
        <div className="boutique-intro"><span className="boutique-kicker">THREE DIRECTIONS. ENTIRELY YOURS.</span><p>Choose the composition that speaks to you.<br/>Then make it a little more personal.</p><a className="text-button" href="#create">Or start with your own story <ArrowRight size={14} aria-hidden/></a></div>
      </div>
      <div className="catalog-disclosure" id="catalog-disclosure"><Flower2 size={19} strokeWidth={1.2} aria-hidden/><p><strong>A proposed collection, for your consideration.</strong> Sample designs and illustrative USD prices, not live stock or confirmed offers. Photographs are floral inspiration, not exact recipes. Tax and delivery are not configured. No payment is collected.</p></div>
      <div className="boutique-controls">
        <div className="collection-filters" role="group" aria-label="Filter collection by palette">{palettes.map(option => <button key={option.value} type="button" aria-pressed={palette === option.value} onClick={() => setPalette(option.value)}>{option.label}</button>)}</div>
        <fieldset className="collection-sizes"><legend>Choose your scale</legend><div>{sizes.map(value => <label key={value} className={size === value ? 'selected' : ''}><input type="radio" name="collection-size" value={value} checked={size === value} onChange={() => setSize(value)}/>{value.charAt(0).toUpperCase() + value.slice(1)}</label>)}</div></fieldset>
      </div>
      <div className="collection-meta"><p role="status">{visible.length} {visible.length === 1 ? 'composition' : 'compositions'} <span aria-hidden>·</span> <span className="capitalized">{size}</span> size <span aria-hidden>·</span> Illustrative prices in USD</p><label>Arrange by <select value={sort} onChange={event => setSort(event.target.value)}><option value="curated">The studio edit</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option></select></label></div>
      <div className="boutique-grid">{visible.map((study, index) => <article className="boutique-card" key={study.design.Id} aria-labelledby={`collection-${study.design.Id}`}>
        <div className="boutique-art photographic"><img src={flowerPhotoPath(photos[index])} alt={`${photos[index].subject}; photographic inspiration for ${study.design.Name}, not verified inventory`} width={1000} height={1500} loading="lazy"/><span>{study.note}</span><span className="boutique-art-number" aria-hidden>G.</span></div>
        <div className="boutique-card-heading"><div><p className="bouquet-palette">{study.palette}</p><h3 id={`collection-${study.design.Id}`}>{study.design.Name}</h3></div><span className="collection-monogram" aria-hidden>✧</span></div>
        <p className="bouquet-description">{study.design.Description}</p>
        <details className="bouquet-details"><summary>Composition notes <ChevronDown size={15} aria-hidden/></summary><p>{study.composition} Final stems and availability require florist confirmation; the photograph is inspiration, not an exact recipe or the selected size.</p></details>
        <div className="bouquet-purchase"><dl><dt>Illustrative price</dt><dd>{usd.format(study.prices[size] / 100)} <span>USD / {size}</span></dd></dl><button type="button" className="bouquet-choose" aria-label={`Personalize ${study.design.Name}`} disabled={disabled} onClick={() => onChoose(study.design, size)}>Make it personal <ArrowRight size={15} aria-hidden/></button></div>
        <p className="bouquet-availability">Design study · availability unverified</p>
      </article>)}</div>
      <div className="bespoke-note"><span className="bespoke-number" aria-hidden>G.</span><div><h3>For a feeling all your own.</h3><p>A favorite shade. A particular occasion. Something that is simply them.<br/>Your story is always a beautiful starting point.</p></div><a className="text-button" href="#create">Create your composition <ArrowRight size={16} aria-hidden/></a></div>
    </div>
  </section>;
}
