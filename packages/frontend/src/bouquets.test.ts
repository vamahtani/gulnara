import { expect, test } from 'vitest';
import { dateWindow, initialPreferences, inspiration, isBooking, isDesign, recommend } from './bouquets';

const designs = inspiration.map((design, index) => ({ ...design, AvailableUnits: index + 1 }));
test('natural language ranks a matching occasion, mood and colors with explanations', () => {
  const result = recommend(designs, { ...initialPreferences, text: 'a romantic anniversary in wine and burgundy', size: 'petite' });
  expect(result[0].design.Name).toBe('After hours');
  expect(result[0].reasons.join(' ')).toContain('anniversary');
  expect(result[0].reasons.join(' ')).toContain('burgundy');
});
test('availability is checked against every size, never supplemented by samples', () => {
  expect(recommend(designs, initialPreferences).map(result => result.design.AvailableUnits)).toEqual(expect.arrayContaining([2, 3]));
  expect(recommend(designs, { ...initialPreferences, size: 'grand' })).toHaveLength(1);
  expect(recommend(inspiration, initialPreferences)).toHaveLength(0);
  expect(recommend([], initialPreferences)).toHaveLength(0);
  expect(recommend(inspiration, initialPreferences, true)).toHaveLength(3);
});
test('explicit palette and textual exclusions filter rather than just change ranking', () => {
  const result = recommend(designs, { ...initialPreferences, color: 'pink', size: 'petite' });
  expect(result).toHaveLength(2);
  expect(recommend(designs, { ...initialPreferences, text: 'without pink', color: 'pink', size: 'petite' })).toHaveLength(0);
  expect(recommend(designs, { ...initialPreferences, text: 'no red, please', size: 'petite' }).some(result => result.design.Colors.includes('burgundy'))).toBe(false);
});
test('fallback directions are described honestly and ties are stable', () => {
  expect(recommend(designs, { ...initialPreferences, size: 'petite' })[0].reasons[0]).toContain('open-ended');
  expect(recommend(designs, { ...initialPreferences, size: 'petite' })).toEqual(recommend(designs, { ...initialPreferences, size: 'petite' }));
});
test('date request window uses Redmond calendar rather than UTC date', () => {
  expect(dateWindow(new Date('2026-11-05T01:00:00Z'))).toEqual({ min: '2026-11-05', max: '2027-02-02' });
  expect(dateWindow(new Date('2026-03-08T09:30:00Z')).min).toBe('2026-03-09');
});
test('response guards reject invalid shapes and nonintegral availability', () => {
  expect(isDesign(designs[0])).toBe(true);
  expect(isDesign({ ...designs[0], AvailableUnits: -1 })).toBe(false);
  expect(isDesign({ ...designs[0], AvailableUnits: 1.5 })).toBe(false);
  expect(isDesign({ Id: 'only-id' })).toBe(false);
  expect(isBooking({ Id: 'only-id', Size: 'huge' })).toBe(false);
});
