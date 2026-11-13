const flowers = [
  ['Garden roses and lisianthus', 'Closely layered petals create a rounded, generous silhouette.'],
  ['Peonies and eucalyptus', 'Open petals meet silver-green leaves in a loose garden silhouette.'],
  ['Calla lilies and orchids', 'Curved stems and smooth petals create a spare, architectural silhouette.'],
  ['Ranunculus and sweet peas', 'Small layered blooms and fluttering petals make a light, gathered posy.'],
  ['Dahlias and amaranthus', 'Full flower heads and trailing texture create an expressive, asymmetric shape.'],
  ['Tulips and anemones', 'Clean stems, cupped petals and open faces give this bouquet an easy, upright rhythm.'],
  ['Hydrangeas and delphinium', 'Cloudlike flower heads meet slender spires in a full bouquet with gentle height.'],
  ['Sunflowers and snapdragons', 'Broad flower faces and rising stems make a buoyant, open bouquet.'],
];
const palettes = [
  ['Ivory', 'A luminous white palette keeps the gesture composed.'],
  ['Blush', 'Soft pink brings tenderness and a lightly romantic mood.'],
  ['Garnet', 'Wine-red tones bring depth and an intimate, evening mood.'],
  ['Honey', 'Apricot and gold suggest warmth, welcome and optimism.'],
  ['Lilac', 'Lavender tones suggest reflection and quiet imagination.'],
];
const intentions = [
  [
    'For a hard-earned achievement and an exciting next chapter.',
    'A proud congratulations with the ease of a garden gathering.',
    'For a new beginning marked with confidence, not spectacle.',
    'A tender congratulations after a long season of effort.',
    'For a creative graduate ready to make their own mark.',
    'An uncomplicated congratulations for a fresh beginning.',
    'For a milestone that deserves a generous, graceful gesture.',
    'A bright congratulations for someone stepping into possibility.',
  ],
  [
    'For affection that has grown richer with time.',
    'For a shared memory of gardens and unhurried afternoons.',
    'For a couple who prefer considered design to grand declarations.',
    'A close, personal gesture for another year together.',
    'For a love story with character and a little theatricality.',
    'For the everyday affection behind a lasting partnership.',
    'A generous tribute to a life built together.',
    'For a partnership full of laughter and shared adventures.',
  ],
  [
    'For a wedding celebration with softness and quiet abundance.',
    'For a relaxed garden wedding and a naturally romantic mood.',
    'For a contemporary wedding with restrained, sculptural detail.',
    'For an intimate celebration with delicate, gathered flowers.',
    'For an artistic wedding with texture and movement.',
    'For a simple celebration with fresh, unfussy flowers.',
    'For a wedding gathering that feels welcoming and substantial.',
    'For a joyful, informal celebration of two people coming together.',
  ],
  [
    'For kindness that deserves more than a quick message.',
    'For a generous host who makes everyone feel at home.',
    'A considered thank-you for a mentor or thoughtful colleague.',
    'A modest, personal expression of gratitude.',
    'For someone whose imagination or generosity made a difference.',
    'An easy thank-you for an everyday act of kindness.',
    'For patient support that helped carry a difficult season.',
    'For someone who brings energy and encouragement to others.',
  ],
  [
    'For a birthday that calls for affection and a little abundance.',
    'For a garden lover happiest among open petals and fresh leaves.',
    'For a design lover who values clean lines and considered objects.',
    'For a quiet birthday celebrated with close friends.',
    'For a creative personality drawn to unexpected shapes.',
    'For someone who loves simple flowers and unhurried mornings.',
    'For a birthday gathering with a generous, welcoming spirit.',
    'For an outgoing friend who brings brightness into a room.',
  ],
];

export function refinedCompositions(original) {
  if (!Array.isArray(original) || original.length !== 300) throw new Error('Refinement requires the complete original 300-composition catalog.');
  return original.map((study, index) => {
    if (index < 100) return { ...study };
    const position = index - 100;
    const flower = position % 8;
    const palette = Math.floor(position / 8) % 5;
    const occasion = Math.floor(position / 40);
    const description = `${flowers[flower][0]}. ${flowers[flower][1]} ${palettes[palette][1]} ${intentions[occasion][flower]}`;
    return { ...study, description };
  });
}
