import { AuthenticationRequiredError } from './api';
import { isBooking, isDesign, type BookingInput } from './bouquets';

async function request<T>(token: string, path: string, guard: (value: unknown) => value is T, body?: BookingInput): Promise<T[]> {
  const response = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new AuthenticationRequiredError('Your session expired or was not accepted. Sign in again.');
    if (response.status === 403) throw new Error('Your account does not have permission for this action.');
    throw new Error(`The floral service could not complete this request (${response.status}). Nothing is confirmed. Your details are kept here; retry with the same request, or reload availability.`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('value' in data) || !Array.isArray(data.value) || !data.value.every(guard)) {
    throw new Error('The floral service returned an unexpected response. No confirmation can be shown.');
  }
  return data.value;
}
export const getCatalog = (token: string) => request(token, 'Catalog?$first=100&$orderby=Name', isDesign);
export const getBookings = (token: string) => request(token, 'Bookings?$first=100&$orderby=CreatedAt desc', isBooking);
export const bookBouquet = (token: string, body: BookingInput) => request(token, 'BookBouquet', isBooking, body);
