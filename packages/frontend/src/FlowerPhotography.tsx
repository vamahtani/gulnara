type FlowerPhoto = {
  id: number;
  subject: string;
  flowers: string[];
  palette: 'blush' | 'ivory' | 'wine' | 'honey';
  photographer: string;
  source: string;
};

export const flowerPhotos: FlowerPhoto[] = [
  { id: 35429395, subject: 'Blush roses in a sculptural ivory vase', flowers: ['rose'], palette: 'blush', photographer: 'Derya Nur', source: 'https://www.pexels.com/photo/elegant-pink-rose-bouquet-in-stylish-vase-35429395/' },
  { id: 35820263, subject: 'White roses in a softly lit vase arrangement', flowers: ['rose'], palette: 'ivory', photographer: 'Primitive Spaces', source: 'https://www.pexels.com/photo/elegant-bouquet-of-white-roses-in-vase-35820263/' },
  { id: 29904630, subject: 'Wine-red roses and soft pink flowers in a stone vase', flowers: ['rose', 'peony'], palette: 'wine', photographer: 'Tiarra Sorte', source: 'https://www.pexels.com/photo/elegant-floral-arrangement-with-red-roses-and-pink-peonies-29904630/' },
  { id: 29157388, subject: 'A generous peach-rose bouquet in a ribbed glass vase', flowers: ['rose'], palette: 'honey', photographer: 'Lara', source: 'https://www.pexels.com/photo/elegant-bouquet-of-fresh-peach-roses-in-vase-29157388/' },
  { id: 27090238, subject: 'Peach roses arranged on a wooden table', flowers: ['rose'], palette: 'honey', photographer: 'Nay Nyo', source: 'https://www.pexels.com/photo/peach-roses-in-vase-27090238/' },
  { id: 38408322, subject: 'Pink roses and trailing foliage against a dark backdrop', flowers: ['rose'], palette: 'blush', photographer: 'Andy Lee', source: 'https://www.pexels.com/photo/elegant-pink-rose-bouquet-in-decorative-vase-38408322/' },
  { id: 1324973, subject: 'Red roses and white flowers in an elegant table arrangement', flowers: ['rose'], palette: 'wine', photographer: 'Hassan OUAJBIR', source: 'https://www.pexels.com/photo/red-and-white-rose-flowers-in-vase-on-white-surface-1324973/' },
  { id: 32375858, subject: 'Pink peonies arranged in a glass vase', flowers: ['peony'], palette: 'blush', photographer: 'Andy Lee', source: 'https://www.pexels.com/photo/vibrant-pink-peony-bouquet-in-glass-vase-32375858/' },
  { id: 33359637, subject: 'An abundant garden arrangement of orchids, dahlias and foliage', flowers: ['orchid', 'dahlia'], palette: 'ivory', photographer: 'Andy Lee', source: 'https://www.pexels.com/photo/vibrant-floral-arrangement-with-orchids-and-dahlias-33359637/' },
  { id: 36828999, subject: 'A richly textured arrangement of orchids and hydrangeas', flowers: ['orchid', 'hydrangea'], palette: 'honey', photographer: 'Diana Nguyen', source: 'https://www.pexels.com/photo/vibrant-floral-arrangement-with-orchids-and-hydrangeas-36828999/' },
  { id: 20242459, subject: 'Soft pink tulips in a clear glass vase', flowers: ['tulip'], palette: 'blush', photographer: 'Anh Nguyen', source: 'https://www.pexels.com/photo/tulips-bouquet-in-vase-20242459/' },
  { id: 13304091, subject: 'Pink and white tulips beside a garden window', flowers: ['tulip'], palette: 'ivory', photographer: 'Fify Loewen', source: 'https://www.pexels.com/photo/pink-and-white-tulips-on-a-glass-vase-13304091/' },
  { id: 31428881, subject: 'A colorful tulip bouquet against a dark backdrop', flowers: ['tulip'], palette: 'honey', photographer: 'Aleksandr Fedorov', source: 'https://www.pexels.com/photo/vibrant-tulip-bouquet-in-glass-vase-31428881/' },
  { id: 30828846, subject: 'White calla lilies and foliage in a glass vase', flowers: ['calla'], palette: 'ivory', photographer: 'Kate Filatova', source: 'https://www.pexels.com/photo/elegant-calla-lily-bouquet-in-modern-interior-30828846/' },
];

const flowerWords = [
  ['rose', /\broses?\b/i], ['peony', /\b(?:peony|peonies)\b/i],
  ['calla', /\bcalla\b/i], ['tulip', /\btulips?\b/i],
  ['dahlia', /\bdahlias?\b/i], ['hydrangea', /\bhydrangeas?\b/i],
  ['orchid', /\borchids?\b/i],
] as const;
export const flowerPhotoPath = (photo: FlowerPhoto) => `/flowers/pexels-${photo.id}.jpg`;

const signaturePhotos: Record<string, number> = {
  'The quiet romantic': 35429395, 'A little untamed': 33359637, 'After hours': 29904630,
  'Warm Abundance': 29157388, 'Velvet Rose': 29904630, 'Honey Garden': 27090238,
  'Golden hour': 29157388, 'A Summer Congratulations': 36828999, 'New Keys': 13304091,
};
const paletteWords = [
  ['wine', /\b(?:wine|burgundy|garnet|red|plum|velvet)\b/i],
  ['honey', /\b(?:honey|peach|apricot|gold|golden|yellow|copper|amber)\b/i],
  ['blush', /\b(?:blush|pink|lilac|lavender)\b/i],
  ['ivory', /\b(?:white|whites|ivory|cream|creamy)\b/i],
] as const;
function primaryPalette(text: string) {
  return paletteWords.map(([palette, pattern]) => ({ palette, position: text.search(pattern) }))
    .filter(match => match.position >= 0).sort((a, b) => a.position - b.position)[0]?.palette;
}
// A composition keeps its photograph regardless of rank, neighbors or filtering.
export function bouquetPhotos(studies: readonly { Name: string; Description: string; ImagePath?: string }[]): FlowerPhoto[] {
  return studies.map(study => {
    const signature = signaturePhotos[study.Name];
    if (signature) {
      const photo = flowerPhotos.find(photo => photo.id === signature);
      if (!photo) throw new Error(`Missing curated photograph for ${study.Name}.`);
      return photo;
    }
    const callaInspiration = study.Name.startsWith('Ivory Calla -') ? 30828846
      : study.Name.startsWith('Lilac Calla -') ? 33359637
      : study.Name.startsWith('Blush Calla -') ? 36828999 : undefined;
    if (callaInspiration) {
      const photo = flowerPhotos.find(photo => photo.id === callaInspiration);
      if (!photo) throw new Error(`Missing calla/companion-orchid inspiration for ${study.Name}.`);
      return photo;
    }
    const representedFlower = (text: string) => flowerWords.find(([family, pattern]) =>
      pattern.test(text) && flowerPhotos.some(photo => photo.flowers.includes(family)))?.[0];
    const flower = representedFlower(study.Name) ?? representedFlower(study.Description);
    const palette = primaryPalette(study.Name) ?? primaryPalette(study.Description) ??
      (study.ImagePath === '/maison-calla.svg' ? 'ivory'
      : study.ImagePath === '/maison-wine.svg' ? 'wine' : 'blush');
    const score = (photo: FlowerPhoto) => (flower && photo.flowers.includes(flower) ? 8 : 0) + (photo.palette === palette ? 3 : 0);
    const best = Math.max(...flowerPhotos.map(score));
    const candidates = flowerPhotos.filter(photo => score(photo) === best);
    const identity = [...study.Name].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
    return candidates[identity % candidates.length];
  });
}

export function PhotographyCredits() {
  return <details className="photography-credits"><summary>Flower photography</summary>
    <p>Licensed stock photographs for floral inspiration, not photographs of Gulnara inventory or exact sample recipes. Images are hosted here; viewing them sends no request to a stock-photo service.</p>
    <p><a href="https://www.pexels.com/license/">Pexels license</a> permits personal and commercial use. Photographs have been resized for this website.</p>
    <ul>{flowerPhotos.map(photo => <li key={photo.id}><a href={photo.source}>{photo.subject}</a> / {photo.photographer}</li>)}</ul>
  </details>;
}
