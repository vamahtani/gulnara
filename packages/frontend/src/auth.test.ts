// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { UserManager } from 'oidc-client-ts';
import { completeSignin, loadIdentity, loadPublicConfiguration } from './auth';

const config = { authority: 'https://identity.example.test', clientId: 'fixture-client', scope: 'openid api-access', redirectUri: `${location.origin}/` };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });
test('real configuration constructs a PKCE access-token client without a browser secret', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(config)));
  const manager = await loadIdentity();
  expect(manager.settings.response_type).toBe('code');
  expect(manager.settings.client_id).toBe(config.clientId);
  expect(manager.settings.client_secret).toBeUndefined();
  expect(manager.settings.disablePKCE).toBe(false);
});
test('only a missing static endpoint tries the Functions configuration endpoint', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(Response.json(config));
  vi.stubGlobal('fetch', fetcher);
  expect(await loadPublicConfiguration()).toEqual(config);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/config.json', '/api/config']);
});
test('a configuration outage is not hidden with an alternative or empty identity', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(loadIdentity()).rejects.toThrow('Public identity configuration is unavailable.');
  expect(fetcher).toHaveBeenCalledOnce();
});
test('SPA HTML in a disconnected preview produces an actionable configuration error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Preview</html>', { headers: { 'Content-Type': 'text/html' } })));
  await expect(loadIdentity()).rejects.toThrow(/preview cannot save requests/);
});
test('malformed public configuration cannot create an identity client', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ clientId: 'incomplete' })));
  await expect(loadIdentity()).rejects.toThrow(/unexpected shape/);
});
test('a denied provider callback removes query parameters without faking a session', async () => {
  history.replaceState(null, '', '/?state=synthetic&error=access_denied');
  const manager = new UserManager({ authority: config.authority, client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: config.scope });
  vi.spyOn(manager, 'signinRedirectCallback').mockRejectedValue(new Error('access_denied'));
  await expect(completeSignin(manager)).rejects.toThrow('access_denied');
  expect(location.search).toBe('');
});
