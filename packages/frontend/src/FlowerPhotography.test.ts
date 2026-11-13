import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { bouquetPhotos, flowerPhotoPath, flowerPhotos } from './FlowerPhotography';

test('all curated photographs are real locally hosted JPEGs with source credits', () => {
  expect(new Set(flowerPhotos.map(photo => photo.id)).size).toBe(14);
  for (const photo of flowerPhotos) {
    const image = readFileSync(new URL(`../public${flowerPhotoPath(photo)}`, import.meta.url));
    expect([...image.subarray(0, 3)]).toEqual([255, 216, 255]);
    expect(image.length).toBeGreaterThan(1000);
    expect(photo.source).toMatch(/^https:\/\/www\.pexels\.com\/photo\//);
    expect(photo.source).toContain(String(photo.id));
    expect(photo.photographer).toBeTruthy();
  }
});

test('tulip matches retain palette-appropriate inspiration without altering SQL results', () => {
  const studies = ['Lilac', 'Ivory', 'Blush'].map(color => ({
    Name: `${color} Tulip - Graduation`, Description: 'Sample graduation bouquet of tulips.',
  }));
  const before = JSON.stringify(studies);
  const photos = bouquetPhotos(studies);
  expect(photos.every(photo => photo.flowers.includes('tulip'))).toBe(true);
  expect(photos.map(photo => photo.palette)).toEqual(['blush', 'ivory', 'blush']);
  expect(JSON.stringify(studies)).toBe(before);
  expect(bouquetPhotos(studies)).toEqual(photos);
});
test('a composition keeps the same photograph alone, reordered, filtered and with different neighbors', () => {
  const studies = [
    { Name: 'Blush Rose - Graduation', Description: 'Lush and warm roses for a graduation.' },
    { Name: 'Blush Rose - Anniversary', Description: 'Lush and warm roses for an anniversary.' },
    { Name: 'Ivory Tulip - Graduation', Description: 'Lush and warm tulips for a graduation.' },
  ];
  const original = bouquetPhotos(studies);
  studies.forEach((study, index) => {
    expect(bouquetPhotos([study])[0]).toEqual(original[index]);
    expect(bouquetPhotos([studies[(index + 1) % studies.length], study])[1]).toEqual(original[index]);
  });
  expect(bouquetPhotos([...studies].reverse())).toEqual([...original].reverse());
});
test('named palette overrides incidental mood words and signature photos remain stable', () => {
  const [ivory] = bouquetPhotos([{ Name: 'Ivory Rose - Graduation', Description: 'A lush and warm pink rose bouquet.' }]);
  expect(ivory.palette).toBe('ivory');
  const [signature] = bouquetPhotos([{ Name: 'Warm Abundance', Description: 'Revised composition notes.' }]);
  expect(signature.id).toBe(29157388);
});
test('a composition without a primary-flower photograph uses a represented companion flower', () => {
  const [photo] = bouquetPhotos([{ Name: 'Freesia Letter', Description: 'Freesia and ivory roses in a spare silhouette.' }]);
  expect(photo.flowers).toContain('rose');
  expect(photo.palette).toBe('ivory');
});
test('calla compositions have fixed botanically related inspiration, independent of neighbors', () => {
  const studies = ['Ivory', 'Lilac', 'Blush'].map(color => ({
    Name: `${color} Calla - Thank You`, Description: 'Calla lilies and orchids.',
  }));
  const photos = bouquetPhotos(studies);
  expect(photos[0].flowers).toContain('calla');
  expect(new Set(photos.map(photo => photo.id)).size).toBe(3);
  studies.forEach((study, index) => expect(bouquetPhotos([study])[0]).toEqual(photos[index]));
  expect(photos.every(photo => photo.flowers.includes('calla') || photo.flowers.includes('orchid'))).toBe(true);
});

test('warm and dramatic rose matches use appropriate distinct photographic inspiration', () => {
  const photos = bouquetPhotos([
    { Name: 'Warm Abundance', Description: 'Lush peach garden roses with amber chrysanthemums.' },
    { Name: 'Velvet Rose', Description: 'Plum roses, dusty mauve flowers and soft blush layers.' },
    { Name: 'Honey Garden', Description: 'Buttery-yellow roses and apricot sweet peas.' },
  ]);
  expect(photos.map(photo => photo.palette)).toEqual(['honey', 'wine', 'honey']);
  expect(new Set(photos.map(flowerPhotoPath)).size).toBe(3);
  expect(photos.every(photo => photo.flowers.includes('rose'))).toBe(true);
});

test('new-job demo results have distinct fixed photographs across every result order', () => {
  const catalog = ['demo-studies.json', 'diskann-studies.json'].flatMap(file =>
    JSON.parse(readFileSync(new URL(`../../data/${file}`, import.meta.url), 'utf8')) as
      { name: string; description: string; image: string }[]);
  const studies = ['Golden hour', 'A Summer Congratulations', 'New Keys'].map(name => {
    const row = catalog.find(study => study.name === name);
    if (!row) throw new Error(`Missing demo composition: ${name}`);
    return { Name: row.name, Description: row.description, ImagePath: row.image };
  });
  const before = JSON.stringify(studies);
  const photos = bouquetPhotos(studies);
  expect(photos.map(photo => photo.id)).toEqual([29157388, 36828999, 13304091]);
  expect(new Set(photos.map(flowerPhotoPath)).size).toBe(3);
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    expect(bouquetPhotos(order.map(index => studies[index]))).toEqual(order.map(index => photos[index]));
  }
  studies.forEach((study, index) => expect(bouquetPhotos([study])[0]).toEqual(photos[index]));
  expect(JSON.stringify(studies)).toBe(before);
});
