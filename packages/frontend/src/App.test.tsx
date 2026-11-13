// @vitest-environment jsdom
// Fixture-only UI behavior. These tests do not prove identity or SQL persistence.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { User, UserManager } from 'oidc-client-ts';
import { App } from './App';
import { loadIdentity } from './auth';
import { AuthenticationRequiredError } from './api';
import { bookBouquet, getBookings, getCatalog } from './florist-api';
import { dateWindow, inspiration, type Booking } from './bouquets';

vi.mock('./auth', () => ({ loadIdentity: vi.fn(), completeSignin: vi.fn() }));
vi.mock('./florist-api', () => ({ bookBouquet: vi.fn(), getBookings: vi.fn(), getCatalog: vi.fn() }));
const design = { ...inspiration[0], Id: 'b6f8f104-6890-4d24-865a-65e6ec13e16f', AvailableUnits: 3 };
const saved: Booking = { Id: 'saved-request', DesignName: design.Name, Size: 'signature', DeliveryDate: '2026-12-01', RecipientName: 'Test recipient', DeliveryAddress: 'Synthetic test address', Status: 'requested', CreatedAt: '2026-11-05T00:00:00Z' };
let manager: UserManager;
beforeEach(() => {
  localStorage.clear();
  manager = new UserManager({ authority: 'https://identity.example.test', client_id: 'test', redirect_uri: location.origin, response_type: 'code', scope: 'openid api' });
  vi.spyOn(manager, 'getUser').mockResolvedValue(null);
  vi.mocked(loadIdentity).mockResolvedValue(manager);
  vi.mocked(getCatalog).mockResolvedValue([design]);
  vi.mocked(getBookings).mockResolvedValue([]);
  vi.mocked(bookBouquet).mockResolvedValue([saved]);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
function signedIn() {
  vi.mocked(manager.getUser).mockResolvedValue(new User({
    access_token: 'fixture-only', token_type: 'Bearer', expires_at: 9999999999,
    profile: { sub: 'synthetic', iss: 'https://identity.example.test', aud: 'test', exp: 9999999999, iat: 1 },
  }));
}
async function openBooking() {
  signedIn(); render(<App/>);
  await screen.findByText('Signed in. Your bouquet requests are private.');
  await waitFor(() => expect(getCatalog).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Find my bouquet' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Request this bouquet' }));
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Test customer' } });
  fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'test@example.test' } });
  fireEvent.change(screen.getByLabelText('Recipient’s name'), { target: { value: 'Test recipient' } });
  fireEvent.change(screen.getByLabelText('Requested delivery date'), { target: { value: dateWindow().min } });
  fireEvent.change(screen.getByLabelText('Full delivery address'), { target: { value: 'Synthetic test address' } });
}
test('visitors see the branded site and explicitly non-bookable sample recommendations', async () => {
  render(<App/>);
  await screen.findByText('Sign in to see current availability and request a bouquet.');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('said in flowers.');
  fireEvent.change(screen.getByLabelText('What would you like your flowers to say?'), { target: { value: 'Soft blush flowers for her birthday' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find my bouquet' }));
  expect(screen.getByText('DESIGN INSPIRATION ONLY')).toBeTruthy();
  expect(screen.getAllByText('Design study · not available to book').length).toBe(3);
  expect(screen.queryByRole('button', { name: 'Request this bouquet' })).toBeNull();
  expect(getCatalog).not.toHaveBeenCalled();
});
test('the premium collection preserves comparison, artwork provenance and booking rules', async () => {
  render(<App/>);
  await screen.findByText('Sign in to see current availability and request a bouquet.');
  expect(screen.getByRole('link', { name: 'Compare the untouched original' }).getAttribute('href')).toBe('/first-take/index.html');
  expect(screen.getByText('Editorial floral artwork · not live inventory')).toBeTruthy();
  const image = screen.getByRole('img', { name: /Editorial floral artwork of blush roses/ });
  expect(image.getAttribute('src')).toBe('/luxury-bouquet.jpg');
  expect(screen.getByRole('img', { name: 'Gulnara botanical G monogram' })).toBeTruthy();
  expect([...document.querySelectorAll('main > section[id]')].map(section => section.id)).toEqual(['discover', 'collection', 'create', 'atelier']);
  expect(document.querySelector('main > :first-child')?.classList.contains('hero')).toBe(true);
  expect(document.querySelector('.hero')?.nextElementSibling?.id).toBe('discover');
  expect(screen.getByRole('link', { name: 'Search' }).getAttribute('href')).toBe('#discover');
  expect(screen.getByRole('button', { name: 'Personalize The quiet romantic' })).toBeTruthy();
  expect(bookBouquet).not.toHaveBeenCalled();
});
test('a collection choice carries size and palette into personalization without losing the customer story', async () => {
  render(<App/>);
  await screen.findByText('Sign in to see current availability and request a bouquet.');
  fireEvent.change(screen.getByLabelText('What would you like your flowers to say?'), { target: { value: 'A personal birthday message.' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Grand' }));
  fireEvent.click(screen.getByRole('button', { name: 'Personalize After hours' }));
  expect((screen.getByLabelText('What would you like your flowers to say?') as HTMLTextAreaElement).value).toBe('A personal birthday message.');
  expect((screen.getByRole('radio', { name: 'Wine' }) as HTMLInputElement).checked).toBe(true);
  expect((document.querySelector('input[name="size"][value="grand"]') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText(/Your starting point:/).textContent).toContain('After hours');
  expect(screen.queryByRole('button', { name: 'Send bouquet request' })).toBeNull();
  expect(bookBouquet).not.toHaveBeenCalled();
});
test('missing configuration produces an honest preview status, not fake sign-in', async () => {
  vi.mocked(loadIdentity).mockRejectedValue(new Error('Public identity configuration is unavailable.'));
  render(<App/>);
  await screen.findByText(/Live availability and booking are not connected/);
  expect(screen.queryByText('Signed in. Your bouquet requests are private.')).toBeNull();
});
test('saves a live request, exposes the returned reference, and reloads private requests', async () => {
  await openBooking();
  fireEvent.click(screen.getByRole('button', { name: 'Send bouquet request' }));
  await screen.findByText('Your request is saved.');
  const [token, body] = vi.mocked(bookBouquet).mock.calls[0];
  expect(token).toBe('fixture-only');
  expect(body.DesignId).toBe(design.Id);
  expect(body.Size).toBe('signature');
  expect(body.RequestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(screen.getByText(/This is not a paid order or confirmed delivery/)).toBeTruthy();
  vi.mocked(getBookings).mockResolvedValue([saved]);
  fireEvent.click(screen.getByRole('button', { name: 'Reload from SQL' }));
  await waitFor(() => expect(getBookings).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Reference saved-request')).toBeTruthy();
});
test('retains failed values and retries with the same idempotency key and payload', async () => {
  await openBooking();
  vi.mocked(bookBouquet).mockRejectedValueOnce(new Error('Service unavailable.'));
  fireEvent.click(screen.getByRole('button', { name: 'Send bouquet request' }));
  await screen.findByText('Service unavailable.');
  expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Test customer');
  expect(screen.queryByText('Your request is saved.')).toBeNull();
  expect(screen.getByLabelText('Your name').closest('fieldset')?.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry the same request' }));
  await screen.findByText('Your request is saved.');
  expect(vi.mocked(bookBouquet).mock.calls[1]).toEqual(vi.mocked(bookBouquet).mock.calls[0]);
});
test('does not reclassify a successful save as failure if refreshing availability fails', async () => {
  await openBooking();
  vi.mocked(getCatalog).mockRejectedValueOnce(new Error('Refresh unavailable.'));
  fireEvent.click(screen.getByRole('button', { name: 'Send bouquet request' }));
  await screen.findByText('Your request is saved.');
  await screen.findByText('Refresh unavailable.');
  expect(screen.queryByRole('button', { name: 'Request this bouquet' })).toBeNull();
});
test('unknown save response never creates a success confirmation', async () => {
  await openBooking();
  vi.mocked(bookBouquet).mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: 'Send bouquet request' }));
  await screen.findByText(/did not return one saved request/);
  expect(screen.queryByText('Your request is saved.')).toBeNull();
});
test('empty configured inventory does not fall back to bookable samples', async () => {
  signedIn(); vi.mocked(getCatalog).mockResolvedValue([]);
  render(<App/>);
  await screen.findByText('Signed in. Your bouquet requests are private.');
  await waitFor(() => expect(getCatalog).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Find my bouquet' }));
  expect(await screen.findByText('No matching bouquet right now.')).toBeTruthy();
  expect(screen.getByText('FROM CONFIGURED AVAILABILITY')).toBeTruthy();
  expect(screen.queryByText('DESIGN INSPIRATION ONLY')).toBeNull();
});
test('API auth rejection removes private data and returns to real sign-in', async () => {
  signedIn(); vi.mocked(getCatalog).mockRejectedValue(new AuthenticationRequiredError('Sign in again.'));
  const signin = vi.spyOn(manager, 'signinRedirect').mockResolvedValue();
  render(<App/>);
  await screen.findByText('Sign in again.');
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(signin).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'My bouquets' })).toBeNull();
});
test('appearance override persists and the control remains accessible', async () => {
  render(<App/>);
  await screen.findByText('Sign in to see current availability and request a bouquet.');
  fireEvent.change(screen.getByLabelText('Appearance'), { target: { value: 'dark' } });
  expect(localStorage.getItem('gulnara-theme')).toBe('dark');
  expect(document.querySelector('.site')?.getAttribute('data-theme')).toBe('dark');
});
test('the account action opens and focuses the customer request section', async () => {
  signedIn(); render(<App/>);
  fireEvent.click(await screen.findByRole('button', { name: 'My bouquets' }));
  await waitFor(() => expect(document.activeElement?.id).toBe('my-bouquets'));
  expect(screen.getByRole('heading', { name: 'Your bouquet requests' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reload from SQL' })).toBeTruthy();
});
