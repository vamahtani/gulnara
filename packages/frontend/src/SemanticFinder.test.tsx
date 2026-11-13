// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SemanticFinder } from './SemanticFinder';
import { bouquetPhotos, flowerPhotoPath } from './FlowerPhotography';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const headers = new Headers({ 'content-type': 'application/json' });
const status = { target: 'local', engineEdition: 5, database: 'appdb', table: 'dbo.vamahtani_embeddings', model: 'text-embedding-3-small:1:1536', dimensions: 1536, sampleCount: 40, remainingRequests: 20 };
const results = [8, 11, 36].map((Id, index) => ({ Id, Name: `Sample ${Id}`, Description: 'Synthetic bouquet', ImagePath: '/maison-blush.svg', IllustrativePriceUsd: 125, IsSample: true, Distance: .2 + index / 10 }));
test('customer finder accepts verified Hyperscale database metadata and submits through the existing API', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', 'https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  const request = vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => ({
    ...status, target: 'cloud', database: 'gulnara_db_demo', sampleCount: 300,
    searchMethod: 'diskann', vectorIndexVersion: 3, searchLimit: 120, remainingRequests: 83,
  }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ results, remainingRequests: 82 }) });
  vi.stubGlobal('fetch', request);
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/Search connected/);
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'), { target: { value: 'warm sample flowers' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find my floral edit' }));
  await screen.findByText('Sample 8');
  expect(request).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});
test('renewed private allowance enables submission and correctly displays counts above twenty', async () => {
  const renewed = { ...status, sampleCount: 100, searchMethod: 'diskann', vectorIndexVersion: 3, remainingRequests: 100 };
  const request = vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => renewed })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results, remainingRequests: 99 }) });
  vi.stubGlobal('fetch', request);
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/100 approved searches remain/);
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'), { target: { value: 'warm garden flowers' } });
  expect((screen.getByRole('button', { name: 'Find my floral edit' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Find my floral edit' }));
  await screen.findByText('Sample 8');
  await screen.findByText(/99 approved searches remain/);
  expect(screen.getByText(/does not refresh automatically/)).toBeTruthy();
  const cards = document.querySelectorAll('.semantic-results .boutique-card');
  expect([...cards].map(card => card.querySelector('.semantic-distance strong')?.textContent)).toEqual(['0.2000', '0.3000', '0.4000']);
  cards.forEach(card => {
    const metric = card.querySelector('.semantic-distance')!;
    expect(metric.textContent).toContain('Lower distance means closer meaning, not a confidence percentage.');
    expect(metric.compareDocumentPosition(card.querySelector('.bouquet-description')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
test('private renewal does not relax the public twenty-attempt contract', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', 'https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  const request = vi.fn().mockResolvedValue({ ok: true, headers, json: async () => ({ ...status, remainingRequests: 100 }) });
  vi.stubGlobal('fetch', request);
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/did not verify native SQL embeddings/);
  expect(request).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: 'Find my floral edit' }) as HTMLButtonElement).disabled).toBe(true);
});
test('public renewal requires explicit native allowance metadata and preserves the existing fifteen searches', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', 'https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  const renewed = { ...status, sampleCount: 100, searchMethod: 'diskann', vectorIndexVersion: 3, searchLimit: 120, remainingRequests: 115 };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => renewed })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results, remainingRequests: 114 }) }));
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/115 approved searches remain/);
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'), { target: { value: 'public warm flowers' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find my floral edit' }));
  await screen.findByText('Sample 8');
  await screen.findByText(/114 approved searches remain/);
});
test('invalid successful allowance is an error rather than a stale success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => status })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results, remainingRequests: 101 }) }));
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/Search connected/);
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'), { target: { value: 'warm garden flowers' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find my floral edit' }));
  await screen.findByText(/unexpected search allowance/);
  expect(screen.queryByText('Sample 8')).toBeNull();
});
test('native ANN graph unavailability is explicit, not an idle-wake success', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', 'https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, headers, json: async () => ({ reason: 'ann-graph-not-ready' }) }));
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/ANN graph is not ready/);
  expect((screen.getByRole('button', { name: 'Find my floral edit' }) as HTMLButtonElement).disabled).toBe(true);
});
test('short demo phrases fill the prominent finder without automatically spending a search', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, headers, json: async () => status });
  vi.stubGlobal('fetch', request);
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/Search connected/);
  expect(screen.queryByText(/40 sample|forty synthetic/i)).toBeNull();
  for (const phrase of ['graduation flowers', 'lush and warm']) {
    fireEvent.click(screen.getByRole('button', { name: phrase }));
    expect((screen.getByLabelText('Describe your ideal bouquet') as HTMLTextAreaElement).value).toBe(phrase);
  }
  expect(request).toHaveBeenCalledOnce();
  expect(screen.getByText('Vector search / powered by Azure SQL')).toBeTruthy();
  expect(screen.getByLabelText('Describe your ideal bouquet').getAttribute('rows')).toBe('1');
  expect(document.querySelector('.semantic-stage')).toBeNull();
});
test('fresh finder is empty with a neutral entry hint and no automatic search', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, headers, json: async () => status });
  vi.stubGlobal('fetch', request);
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/Search connected/);
  const input = screen.getByLabelText('Describe your ideal bouquet') as HTMLTextAreaElement;
  expect(input.value).toBe('');
  expect(input.placeholder).toBe('Describe an occasion, a mood, or your favorite colors…');
  expect((screen.getByRole('button', { name: 'Find my floral edit' }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).toHaveBeenCalledOnce();
});
test('DiskANN readiness admits the expanded corpus and discloses the actual indexed query', async () => {
  const expanded = { ...status, sampleCount: 100, searchMethod: 'diskann', vectorIndexVersion: 3 };
  const ranks = [43, 94, 100].map((Id, index) => ({ ...results[index], Id, Name: `Sample ${Id}` }));
  const request = vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => expanded })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: ranks, remainingRequests: 19 }) });
  vi.stubGlobal('fetch', request);
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/Search connected.*DiskANN/);
  expect(document.querySelector('.semantic-proof pre code')?.textContent).toContain('WITH APPROXIMATE');
  expect(document.querySelector('.semantic-proof pre code')?.textContent).toContain('FORCE_ANN_ONLY');
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'), { target: { value: 'graduation flowers' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find my floral edit' }));
  await screen.findByText('Sample 100');
});
test('expanded corpus without proven current DiskANN metadata is not ready', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers,
    json: async () => ({ ...status, sampleCount: 100, searchMethod: 'diskann', vectorIndexVersion: 2 }) }));
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/did not verify native SQL embeddings/);
  expect((screen.getByRole('button', { name: 'Find my floral edit' }) as HTMLButtonElement).disabled).toBe(true);
});
test('300-record public corpus serves new IDs without relaxing allowance or input guards', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', 'https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  const expanded = { ...status, target: 'cloud', sampleCount: 300, searchMethod: 'diskann',
    vectorIndexVersion: 4, searchLimit: 120, remainingRequests: 115 };
  const ranks = results.map((row, index) => ({ ...row, Id: index + 298, Name: `Sample ${index + 298}` }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => expanded })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: ranks, remainingRequests: 114 }) }));
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/Search connected.*DiskANN/);
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'), { target: { value: 'lush and warm' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find my floral edit' }));
  await screen.findByText('Sample 300');
  await screen.findByText(/114 approved searches remain/);
});
test('customer finder requires real forty-row readiness and explicit submission', async () => {
  const request = vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => status }).mockResolvedValueOnce({ ok: true, json: async () => ({ results, remainingRequests: 19 }) });
  vi.stubGlobal('fetch', request); const onChoose = vi.fn();
  render(<SemanticFinder disabled={false} onChoose={onChoose}/>);
  await screen.findByText(/Search connected/);
  expect(request).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'), { target: { value: 'A fragrant purple garden posy' } });
  expect(request).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Find my floral edit' }));
  await screen.findByText('Sample 8');
  expect(screen.getAllByText('Sample design · not available to book')).toHaveLength(3);
  expect(screen.getAllByText('Illustrative USD / Signature')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Personalize sample Sample 8' }));
  expect(onChoose).toHaveBeenCalledWith(results[0]);
  expect(screen.queryByRole('button', { name: /reserve|book/i })).toBeNull();
});
test('legacy six-row or HTML fallback is unavailable, never a simulated ranking', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers, json: async () => ({ ...status, sampleCount: 6 }) }));
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/did not verify native SQL embeddings/);
  expect((screen.getByRole('button', { name: 'Find my floral edit' }) as HTMLButtonElement).disabled).toBe(true);
});
test('invalid priced results are rejected and exhausted budgets prevent more inference', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => status }).mockResolvedValueOnce({ ok: true, json: async () => ({ results: results.map(r => ({ ...r, IllustrativePriceUsd: -1 })), remainingRequests: 0 }) }));
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/Search connected/);
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'), { target: { value: 'White and green flowers' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find my floral edit' }));
  await screen.findByRole('alert');
  await waitFor(() => expect((screen.getByRole('button', { name: 'Find my floral edit' }) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.queryByText('Sample 8')).toBeNull();
});
test('public finder submits in one action after displaying processing notice, without a checkbox', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN','https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  const request=vi.fn().mockResolvedValueOnce({ok:true,headers,json:async()=>status}).mockResolvedValueOnce({ok:true,json:async()=>({results,remainingRequests:19})});
  vi.stubGlobal('fetch',request);
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/Search connected/);
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'),{target:{value:'Public flower preferences'}});
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText(/By selecting "Find my floral edit" or pressing Enter to search, you agree to Azure OpenAI processing/)).toBeTruthy();
  expect((screen.getByRole('button',{name:'Find my floral edit'}) as HTMLButtonElement).disabled).toBe(false);
  expect(request).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'Find my floral edit'}));
  await screen.findByText('Sample 8');
  const images = document.querySelectorAll('.semantic-results img');
  expect([...images].map(image => image.getAttribute('src'))).toEqual(bouquetPhotos(results).map(flowerPhotoPath));
  expect([...images].every(image => image.getAttribute('src')?.startsWith('/flowers/'))).toBe(true);
  expect(request.mock.calls[1][0]).toBe('https://gulnara-vector-demo-61868ab8.azurewebsites.net/demo-api/search');
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({query:'Public flower preferences',consent:true});
});
test('public outage is explained without localhost operator instructions or inference', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', 'https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  const request = vi.fn().mockResolvedValue({ ok: false, headers, json: async () => ({ error: 'Temporarily unavailable' }) });
  vi.stubGlobal('fetch', request);
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/free demo may be waking up/);
  expect(screen.queryByText(/localhost operator/)).toBeNull();
  expect((screen.getByRole('button', { name: 'Find my floral edit' }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).toHaveBeenCalledOnce();
});

test('new-job demo displays three distinct composition photos without changing native ranks or distances', async () => {
  const ready = { ...status, sampleCount: 300, searchMethod: 'diskann', vectorIndexVersion: 4 };
  const demo = [
    { ...results[0], Id: 5, Name: 'Golden hour', Distance: .4557 },
    { ...results[1], Id: 84, Name: 'A Summer Congratulations', Distance: .4662 },
    { ...results[2], Id: 53, Name: 'New Keys', Distance: .4670 },
  ];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => ready })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: demo, remainingRequests: 19 }) }));
  render(<SemanticFinder disabled={false} onChoose={vi.fn()}/>);
  await screen.findByText(/Search connected/);
  fireEvent.change(screen.getByLabelText('Describe your ideal bouquet'), {
    target: { value: "Something joyful to celebrate a friend's new job. Warm colors, uplifting, and a little unexpected." },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Find my floral edit' }));
  await screen.findByText('New Keys');
  const cards = [...document.querySelectorAll('.semantic-results .boutique-card')];
  expect(cards.map(card => card.querySelector('h3')?.textContent)).toEqual(demo.map(row => row.Name));
  expect(cards.map(card => card.querySelector('.semantic-distance strong')?.textContent))
    .toEqual(['0.4557', '0.4662', '0.4670']);
  expect(cards.map(card => card.querySelector('img')?.getAttribute('src')))
    .toEqual(['/flowers/pexels-29157388.jpg', '/flowers/pexels-36828999.jpg', '/flowers/pexels-13304091.jpg']);
});
