// @vitest-environment jsdom
// Fixture-only UI checks; live SQL/provider evidence is recorded separately.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiDemo } from './AiDemo';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const status = { target: 'local', engineEdition: 5, database: 'appdb', table: 'dbo.vamahtani_embeddings', model: 'text-embedding-3-small:1:1536', dimensions: 1536, sampleCount: 40, remainingRequests: 20 };
const headers = new Headers({ 'content-type': 'application/json' });
test('unavailable demo service never claims live SQL or enables model requests', async () => {
  const request = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal('fetch', request); render(<AiDemo/>);
  await screen.findByRole('alert');
  expect(screen.getByText('Connection not yet verified')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Find a semantic match' }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).toHaveBeenCalledOnce();
});
test('verified status requires explicit submission and discloses cost and sample-only results', async () => {
  const results = [1, 2, 3].map(Id => ({ Id, Name: `Study ${Id}`, Description: 'Sample flowers', ImagePath: '/maison-blush.svg', IllustrativePriceUsd: 145, Distance: Id / 10, IsSample: true }));
  const request = vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => status }).mockResolvedValueOnce({ ok: true, json: async () => ({ results, remainingRequests: 19 }) });
  vi.stubGlobal('fetch', request); render(<AiDemo/>);
  await screen.findByText(/Azure SQL container \/ appdb/);
  expect(request).toHaveBeenCalledOnce();
  expect((screen.getByLabelText('Describe a bouquet for the demo') as HTMLTextAreaElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Describe a bouquet for the demo'), { target: { value: 'graduation flowers' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find a semantic match' }));
  await screen.findByRole('heading', { name: 'The closest compositions.' });
  expect(screen.getAllByText('Sample study · not available to book')).toHaveLength(3);
  expect([...document.querySelectorAll('.demo-results .semantic-distance strong')].map(element => element.textContent)).toEqual(['0.1000', '0.2000', '0.3000']);
  expect(screen.getAllByText('Lower distance means closer meaning, not a confidence percentage.')).toHaveLength(3);
  expect(screen.getByText(/19 approved searches remain/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /book|reserve/i })).toBeNull();
});
test('invalid model results are explicit errors, not a successful match', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => status }).mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ Name: 'fake' }], remainingRequests: 19 }) }));
  render(<AiDemo/>); await screen.findByText(/Azure SQL container \/ appdb/);
  fireEvent.change(screen.getByLabelText('Describe a bouquet for the demo'), { target: { value: 'lush and warm' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find a semantic match' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: 'The closest compositions.' })).toBeNull();
});
test('approved budget exhaustion disables further calls', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, headers, json: async () => ({ ...status, remainingRequests: 0 }) });
  vi.stubGlobal('fetch', request); render(<AiDemo/>);
  await waitFor(() => expect(screen.getByText(/approved AI request budget is exhausted/)).toBeTruthy());
  expect((screen.getByRole('button', { name: 'Find a semantic match' }) as HTMLButtonElement).disabled).toBe(true);
});
test('public Studio Lab discloses the current allowance and enables single-action search without a checkbox', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', 'https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  const request = vi.fn().mockResolvedValue({ ok: true, headers, json: async () => ({
    ...status, target: 'cloud', sampleCount: 300, searchMethod: 'diskann',
    vectorIndexVersion: 3, searchLimit: 120, remainingRequests: 113,
  }) });
  vi.stubGlobal('fetch', request); render(<AiDemo/>);
  await screen.findByText(/Azure SQL cloud database \/ appdb/);
  expect(screen.getByText(/113 approved searches remain/)).toBeTruthy();
  expect(screen.getByText(/A cumulative allowance is shared by all visitors/)).toBeTruthy();
  expect(screen.queryByText(/20 attempts are shared/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Describe a bouquet for the demo'), { target: { value: 'lush and warm' } });
  const button = screen.getByRole('button', { name: 'Find a semantic match' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(button.getAttribute('aria-describedby')).toBe('semantic-search-notice');
  expect(screen.getByText(/By selecting "Find a semantic match" or pressing Enter to search, you agree/)).toBeTruthy();
  expect(request).toHaveBeenCalledOnce();
});
test('Studio Lab displays the verified renamed cloud database', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', 'https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  const request = vi.fn().mockResolvedValue({ ok: true, headers, json: async () => ({
    ...status, target: 'cloud', database: 'gulnara_db', sampleCount: 300,
    searchMethod: 'diskann', vectorIndexVersion: 3, searchLimit: 120, remainingRequests: 108,
  }) });
  vi.stubGlobal('fetch', request); render(<AiDemo/>);
  await screen.findByText(/Azure SQL cloud database \/ gulnara_db \/ EngineEdition 5/);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(request).toHaveBeenCalledOnce();
});
test('Studio Lab accepts the approved Hyperscale database without asserting a free tier', async () => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', 'https://gulnara-vector-demo-61868ab8.azurewebsites.net');
  const request = vi.fn().mockResolvedValue({ ok: true, headers, json: async () => ({
    ...status, target: 'cloud', database: 'gulnara_db_demo', sampleCount: 300,
    searchMethod: 'diskann', vectorIndexVersion: 3, searchLimit: 120, remainingRequests: 83,
  }) });
  vi.stubGlobal('fetch', request); render(<AiDemo/>);
  await screen.findByText(/Azure SQL cloud database \/ gulnara_db_demo \/ EngineEdition 5/);
  expect(screen.queryByText(/free-tier/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Describe a bouquet for the demo'), { target: { value: 'warm sample flowers' } });
  expect((screen.getByRole('button', { name: 'Find a semantic match' }) as HTMLButtonElement).disabled).toBe(false);
  expect(request).toHaveBeenCalledOnce();
});
test.each([
  { target: 'local', database: 'gulnara_db' },
  { target: 'local', database: 'gulnara_db_demo' },
  { target: 'cloud', database: 'other_db' },
])('Studio Lab rejects an unapproved $target database $database', async identity => {
  const request = vi.fn().mockResolvedValue({ ok: true, headers, json: async () => ({ ...status, ...identity }) });
  vi.stubGlobal('fetch', request); render(<AiDemo/>);
  await screen.findByRole('alert');
  expect(screen.getByText('Connection not yet verified')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Find a semantic match' }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).toHaveBeenCalledOnce();
});
