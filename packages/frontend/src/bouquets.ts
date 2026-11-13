export type BouquetSize = 'petite' | 'signature' | 'grand';
export interface Design {
  Id: string;
  Name: string;
  Description: string;
  Colors: string;
  Occasions: string;
  Moods: string;
  AvailableUnits: number;
}
export interface Preferences {
  text: string;
  occasion: string;
  mood: string;
  color: string;
  size: BouquetSize;
}
export interface Recommendation { design: Design; reasons: string[]; score: number }
export const sizeUnits: Record<BouquetSize, number> = { petite: 1, signature: 2, grand: 3 };
export const initialPreferences: Preferences = { text: '', occasion: '', mood: '', color: '', size: 'signature' };

// These are design directions, not stock records, prices or bookable products.
export const inspiration: Design[] = [
  { Id: 'sample-blush', Name: 'The quiet romantic', Description: 'Blush roses and creamy petals gather into a soft, rounded silhouette. Gentle layers and a little garden greenery suggest affection without grand declarations. A tender starting point for an anniversary or a quiet birthday gesture.', Colors: 'pink,cream', Occasions: 'anniversary,love,birthday', Moods: 'romantic,gentle', AvailableUnits: 0 },
  { Id: 'sample-meadow', Name: 'A little untamed', Description: 'Sculptural orchids, loose garden blooms and expressive foliage leave room for movement and light. Fresh whites and greens suggest an unhurried afternoon in a garden. An open, naturally joyful direction for a thoughtful thank-you or a welcoming celebration.', Colors: 'white,green', Occasions: 'thank you,just because,celebration', Moods: 'joyful,natural', AvailableUnits: 0 },
  { Id: 'sample-wine', Name: 'After hours', Description: 'Wine-red roses meet soft blush layers in a composition with depth and gentle contrast. Rich petals and sculptural stems suggest candlelit conversation rather than formal ceremony. A quietly dramatic direction for an intimate anniversary or an evening celebration.', Colors: 'burgundy,pink', Occasions: 'anniversary,celebration,birthday', Moods: 'dramatic,romantic', AvailableUnits: 0 },
];
const aliases: Record<string, string[]> = {
  pink: ['blush', 'rose', 'pink'], white: ['white', 'ivory'], cream: ['cream', 'creamy'],
  burgundy: ['wine', 'burgundy', 'red'], green: ['green', 'greenery'],
  romantic: ['romantic', 'romance', 'love'], gentle: ['soft', 'gentle', 'calm', 'sympathy'],
  joyful: ['happy', 'joyful', 'bright', 'cheerful'], natural: ['wild', 'natural', 'meadow'],
  dramatic: ['bold', 'dramatic', 'moody'], anniversary: ['anniversary'], birthday: ['birthday'],
  'thank you': ['thank you', 'thanks', 'gratitude'], 'just because': ['just because'],
  celebration: ['celebration', 'congratulations', 'graduation'],
};
const tags = (text: string) => text.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
const phrase = (text: string, value: string) => new RegExp(`\\b${value}\\b`, 'i').test(text);
export function recommend(designs: Design[], preferences: Preferences, sampleOnly = false): Recommendation[] {
  const text = preferences.text.toLowerCase();
  return designs.filter(design => sampleOnly || design.AvailableUnits >= sizeUnits[preferences.size])
    .filter(design => !preferences.color || tags(design.Colors).includes(preferences.color))
    .filter(design => !tags(design.Colors).some(color =>
      (aliases[color] || [color]).some(word => new RegExp(`\\b(?:no|avoid|without|not)\\s+(?:any\\s+)?${word}\\b`, 'i').test(text))))
    .map(design => {
      let score = 0;
      const reasons: string[] = [];
      for (const [field, selected, title] of [
        [design.Occasions, preferences.occasion, 'occasion'],
        [design.Moods, preferences.mood, 'mood'],
        [design.Colors, preferences.color, 'palette'],
      ]) {
        if (selected && tags(field).includes(selected)) { score += 4; reasons.push(`A ${selected} ${title} match`); }
      }
      const matched = [...new Set([...tags(design.Occasions), ...tags(design.Moods), ...tags(design.Colors)])]
        .filter(tag => (aliases[tag] || [tag]).some(word => phrase(text, word)));
      score += matched.length;
      if (matched.length) reasons.push(`Your words suggest ${matched.join(', ')}`);
      if (!reasons.length) reasons.push('An open-ended floral direction to start your conversation');
      if (!sampleOnly) reasons.push(`Configured stems cover the ${preferences.size} size`);
      return { design, score, reasons };
    }).sort((a, b) => b.score - a.score || a.design.Name.localeCompare(b.design.Name));
}
export interface Booking {
  Id: string; DesignName: string; Size: BouquetSize; DeliveryDate: string;
  RecipientName: string; DeliveryAddress: string; Status: string; CreatedAt: string;
}
export interface BookingInput {
  RequestId: string; DesignId: string; Size: BouquetSize; Preferences: string;
  CustomerName: string; Email: string; RecipientName: string; DeliveryAddress: string;
  DeliveryDate: string; CardMessage: string;
}
export function isDesign(value: unknown): value is Design {
  if (!value || typeof value !== 'object') return false;
  return ['Id', 'Name', 'Description', 'Colors', 'Occasions', 'Moods'].every(key => key in value && typeof Reflect.get(value, key) === 'string') &&
    'AvailableUnits' in value && Number.isInteger(value.AvailableUnits) && Number(value.AvailableUnits) >= 0;
}
export function isBooking(value: unknown): value is Booking {
  if (!value || typeof value !== 'object') return false;
  return ['Id', 'DesignName', 'DeliveryDate', 'RecipientName', 'DeliveryAddress', 'Status', 'CreatedAt'].every(key => key in value && typeof Reflect.get(value, key) === 'string') &&
    'Size' in value && ['petite', 'signature', 'grand'].includes(String(value.Size));
}
export function dateWindow(now = new Date()): { min: string; max: string } {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const base = new Date(`${local}T12:00:00Z`);
  const offset = (days: number) => new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return { min: offset(1), max: offset(90) };
}
