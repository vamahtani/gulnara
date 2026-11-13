// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Collection } from './Collection';
import { inspiration } from './bouquets';

afterEach(cleanup);
const names = () => screen.getAllByRole('article').map(card => within(card).getByRole('heading', { level: 3 }).textContent);
const prices = () => screen.getAllByRole('article').map(card => card.querySelector('dd')?.textContent);

test('uses distinct photographs while disclosing sample stock and illustrative USD prices', () => {
  render(<Collection disabled={false} onChoose={vi.fn()}/>);
  expect(screen.getByText(/Sample designs and illustrative USD prices, not live stock/)).toBeTruthy();
  expect(prices()).toEqual(['$145 USD / signature', '$115 USD / signature', '$165 USD / signature']);
  expect(screen.getAllByText('Design study · availability unverified')).toHaveLength(3);
  const images = screen.getAllByRole('img');
  expect(images.every(image => image.getAttribute('alt')?.includes('not verified inventory'))).toBe(true);
  expect(images.every(image => image.getAttribute('src')?.startsWith('/flowers/'))).toBe(true);
  expect(new Set(images.map(image => image.getAttribute('src'))).size).toBe(3);
});
test('all three size tiers update exact prices without changing sample availability', () => {
  render(<Collection disabled={false} onChoose={vi.fn()}/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Petite' }));
  expect(prices()).toEqual(['$95 USD / petite', '$75 USD / petite', '$110 USD / petite']);
  fireEvent.click(screen.getByRole('radio', { name: 'Grand' }));
  expect(prices()).toEqual(['$225 USD / grand', '$175 USD / grand', '$245 USD / grand']);
  expect(inspiration.every(design => design.AvailableUnits === 0)).toBe(true);
});
test('palette filtering preserves scale and restoring all restores every design', () => {
  render(<Collection disabled={false} onChoose={vi.fn()}/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Grand' }));
  fireEvent.click(screen.getByRole('button', { name: 'White & green' }));
  expect(names()).toEqual(['A little untamed']);
  expect(prices()).toEqual(['$175 USD / grand']);
  expect(screen.getByRole('button', { name: 'White & green' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'All compositions' }));
  expect(names()).toHaveLength(3);
  expect((screen.getByRole('radio', { name: 'Grand' }) as HTMLInputElement).checked).toBe(true);
});
test('prices sort numerically in both directions and the studio edit restores curated order', () => {
  render(<Collection disabled={false} onChoose={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Arrange by'), { target: { value: 'low' } });
  expect(names()).toEqual(['A little untamed', 'The quiet romantic', 'After hours']);
  fireEvent.change(screen.getByLabelText('Arrange by'), { target: { value: 'high' } });
  expect(names()).toEqual(['After hours', 'The quiet romantic', 'A little untamed']);
  fireEvent.change(screen.getByLabelText('Arrange by'), { target: { value: 'curated' } });
  expect(names()).toEqual(inspiration.map(design => design.Name));
});
test('personalizing passes only an unbookable design and chosen scale, never a quote or stock reservation', () => {
  const choose = vi.fn();
  render(<Collection disabled={false} onChoose={choose}/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Grand' }));
  fireEvent.click(screen.getByRole('button', { name: 'Personalize After hours' }));
  expect(choose).toHaveBeenCalledExactlyOnceWith(inspiration[2], 'grand');
});
test('a pending or uncertain booking disables every personalization action', () => {
  const choose = vi.fn();
  render(<Collection disabled onChoose={choose}/>);
  for (const button of screen.getAllByRole('button', { name: /Personalize/ })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(choose).not.toHaveBeenCalled();
});
