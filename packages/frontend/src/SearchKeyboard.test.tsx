// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiDemo } from './AiDemo';
import { SemanticFinder } from './SemanticFinder';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const origin = 'https://gulnara-vector-demo-61868ab8.azurewebsites.net';
const headers = new Headers({ 'content-type': 'application/json' });
const ready = {
  target: 'local', engineEdition: 5, database: 'appdb', table: 'dbo.vamahtani_embeddings',
  model: 'text-embedding-3-small:1:1536', dimensions: 1536, sampleCount: 300,
  searchMethod: 'diskann', vectorIndexVersion: 3, remainingRequests: 20,
};
const results = [5, 84, 53].map((Id, index) => ({
  Id, Name: `Study ${Id}`, Description: 'Sample flowers', ImagePath: '/maison-blush.svg',
  IllustrativePriceUsd: 125, Distance: .2 + index / 10, IsSample: true,
}));
const views = [
  { view: 'finder', label: 'Describe your ideal bouquet', button: 'Find my floral edit' },
  { view: 'lab', label: 'Describe a bouquet for the demo', button: 'Find a semantic match' },
];
const cases = views.flatMap(view => ['local', 'public'].map(target => ({ ...view, target })));
function setup(view: string, target: string, overrides = {}, pending = false) {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', target === 'public' ? origin : '');
  const status = { ...ready, ...(target === 'public' ? { target: 'cloud', database: 'gulnara_db', searchLimit: 120 } : {}), ...overrides };
  const request = vi.fn().mockResolvedValueOnce({ ok: true, headers, json: async () => status });
  if (pending) request.mockImplementationOnce(() => new Promise(() => {}));
  else request.mockResolvedValueOnce({ ok: true, json: async () => ({ results, remainingRequests: 19 }) });
  vi.stubGlobal('fetch', request);
  render(view === 'finder' ? <SemanticFinder disabled={false} onChoose={vi.fn()}/> : <AiDemo/>);
  return request;
}

test.each(cases)('$target $view submits Enter once through the existing form and preserves consent', async ({ view, target, label, button }) => {
  const request = setup(view, target);
  await screen.findByText(/20 approved searches remain/);
  const input = screen.getByLabelText(label);
  expect(input.getAttribute('enterkeyhint')).toBe('search');
  expect(screen.getByText('Press Enter to search. Shift+Enter adds a new line.')).toBeTruthy();
  fireEvent.change(input, { target: { value: '  joyful flowers  ' } });
  for (const modifiers of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 },
    { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    fireEvent.keyDown(input, { key: 'Enter', ...modifiers });
    expect(request).toHaveBeenCalledOnce();
  }
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByText('Study 5');
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0]).toBe(`${target === 'public' ? origin : ''}/demo-api/search`);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
    query: 'joyful flowers', ...(target === 'public' ? { consent: true } : {}),
  });
  expect((screen.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(false);
});

test.each(cases)('$target $view Enter respects empty, native-invalid and in-flight states', async ({ view, target, label }) => {
  const request = setup(view, target, {}, true);
  await screen.findByText(/20 approved searches remain/);
  const input = screen.getByLabelText(label) as HTMLTextAreaElement;
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(request).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { value: 'joyful flowers' } });
  input.setCustomValidity('Invalid sample');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(request).toHaveBeenCalledOnce();
  input.setCustomValidity('');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(request).toHaveBeenCalledTimes(2);
  expect(input.disabled).toBe(true);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(request).toHaveBeenCalledTimes(2);
});

test.each(cases)('$target $view Enter cannot bypass an exhausted allowance', async ({ view, target, label }) => {
  const request = setup(view, target, { remainingRequests: 0 });
  await screen.findByText(/0 approved searches remain/);
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: 'joyful flowers' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(request).toHaveBeenCalledOnce();
});

test.each(cases)('$target $view Enter cannot bypass unavailable SQL', async ({ view, target, label }) => {
  const request = setup(view, target, { engineEdition: 3 });
  await screen.findByText(/did not verify native SQL embeddings/);
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: 'joyful flowers' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(request).toHaveBeenCalledOnce();
});

test('finder Enter respects the parent disabled state', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, headers, json: async () => ready });
  vi.stubGlobal('fetch', request);
  render(<SemanticFinder disabled onChoose={vi.fn()}/>);
  await screen.findByText(/20 approved searches remain/);
  const input = screen.getByLabelText('Describe your ideal bouquet');
  fireEvent.change(input, { target: { value: 'joyful flowers' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(request).toHaveBeenCalledOnce();
});

test.each(cases)('$target $view reconnects after an initial failure without losing text or spending a search', async ({ view, target, label, button }) => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', target === 'public' ? origin : '');
  const status = { ...ready, ...(target === 'public' ? { target: 'cloud', database: 'gulnara_db', searchLimit: 120 } : {}) };
  const request = vi.fn()
    .mockResolvedValueOnce({ ok: false, headers, json: async () => ({ error: 'Waking up' }) })
    .mockResolvedValueOnce({ ok: true, headers, json: async () => status })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results, remainingRequests: 19 }) });
  vi.stubGlobal('fetch', request);
  render(view === 'finder' ? <SemanticFinder disabled={false} onChoose={vi.fn()}/> : <AiDemo/>);
  const input = screen.getByLabelText(label) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'joyful flowers' } });
  await screen.findByRole('button', { name: 'Reconnect search' });
  expect((screen.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect search' }));
  await screen.findByText(/20 approved searches remain/);
  expect(input.value).toBe('joyful flowers');
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.map(call => call[0])).toEqual(Array(2).fill(`${target === 'public' ? origin : ''}/demo-api/status`));
  expect(screen.queryByRole('button', { name: 'Reconnect search' })).toBeNull();
  expect((screen.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByText('Study 5');
  expect(request).toHaveBeenCalledTimes(3);
});

test.each(cases)('$target $view reconnect cannot bypass invalid metadata and is disabled during a check', async ({ view, target, label, button }) => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', target === 'public' ? origin : '');
  const request = vi.fn()
    .mockResolvedValueOnce({ ok: true, headers, json: async () => ({ ...ready, engineEdition: 3 }) })
    .mockResolvedValueOnce({ ok: true, headers, json: async () => ({ ...ready, engineEdition: 3 }) });
  vi.stubGlobal('fetch', request);
  render(view === 'finder' ? <SemanticFinder disabled={false} onChoose={vi.fn()}/> : <AiDemo/>);
  expect((screen.getByRole('button', { name: 'Checking connection…' }) as HTMLButtonElement).disabled).toBe(true);
  await screen.findByText(/did not verify native SQL embeddings/);
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect search' }));
  await screen.findByText(/did not verify native SQL embeddings/);
  fireEvent.change(screen.getByLabelText(label), { target: { value: 'joyful flowers' } });
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
  expect((screen.getByRole('button', { name: button }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
});

test.each(cases)('$target $view exposes a retry after a timed-out readiness check', async ({ view, target }) => {
  vi.stubEnv('VITE_PUBLIC_VECTOR_ORIGIN', target === 'public' ? origin : '');
  const request = vi.fn().mockRejectedValue(new DOMException('Connection timed out', 'TimeoutError'));
  vi.stubGlobal('fetch', request);
  render(view === 'finder' ? <SemanticFinder disabled={false} onChoose={vi.fn()}/> : <AiDemo/>);
  await screen.findByText(/search connection check timed out/);
  expect((screen.getByRole('button', { name: 'Reconnect search' }) as HTMLButtonElement).disabled).toBe(false);
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
