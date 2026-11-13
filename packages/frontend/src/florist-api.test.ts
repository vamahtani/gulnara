import { afterEach, expect, test, vi } from 'vitest';
import { getBookings, getCatalog } from './florist-api';
import { AuthenticationRequiredError } from './api';
import { inspiration } from './bouquets';

afterEach(() => vi.unstubAllGlobals());
test('catalog requests send a bearer token without putting it in the URL', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ value: inspiration }));
  vi.stubGlobal('fetch', fetcher);
  expect(await getCatalog('test-only')).toHaveLength(3);
  expect(fetcher.mock.calls[0][0]).toBe('/api/Catalog?$first=100&$orderby=Name');
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-only');
});
test.each([401, 403, 500, 503])('service %s never masquerades as an empty result or success', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private diagnostics', { status })));
  if (status === 401) await expect(getBookings('test')).rejects.toBeInstanceOf(AuthenticationRequiredError);
  else await expect(getBookings('test')).rejects.toThrow(status === 403 ? /permission/ : /Nothing is confirmed/);
});
test('malformed success response is rejected', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ value: [{ unexpected: 'shape' }] })));
  await expect(getCatalog('test')).rejects.toThrow(/unexpected response/);
});
