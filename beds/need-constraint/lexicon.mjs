// Word material for the need-constraint bed. All entities are fictional or generic: coined names come from
// syllable tables (no real people, brands or benchmark data), sentence words are everyday English words.

export const ONSETS = ['b', 'br', 'c', 'cl', 'd', 'dr', 'f', 'fl', 'g', 'gr', 'h', 'j', 'k', 'kr', 'l', 'm', 'n', 'p', 'pl', 'r', 's', 'sk', 'sl', 'st', 't', 'tr', 'v', 'w', 'z', 'sh', 'th', 'ch'];
export const VOWEL_CLUSTERS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'i', 'o', 'u', 'ai', 'ea', 'io', 'ou'];
export const CODAS = ['', '', '', 'n', 'r', 'l', 's', 'm', 'x', 'th', 'k', 'nd', 'rn'];
export const CONSONANTS = 'bcdfghjklmnprstvwz'.split('');
export const VOWELS = 'aeiou'.split('');
// Letters a coined name can start with (first letters of ONSETS).
export const INITIALS = [...new Set(ONSETS.map(o => o[0]))].sort();

export const PRODUCT_LINES = ['pocket telescopes', 'garden lamps', 'insulated lunch tins', 'wool trail socks', 'desk succulents', 'bicycle bells', 'paper kites', 'ceramic teapots'];
export const CATALOGUES = ['Brindle & Co.', 'the Tamsford Workshop', 'Orrin Street Traders', 'the Velmoor Guild', 'Pellwick Supply', 'the Harrowgate Co-op'];
export const POSTCARD_TOWNS = ['Kavrey', 'Dunmarrow', 'Silvermere Cross', 'Tolliver Bay', 'Oxlow', 'Pennick Hollow'];
export const ORDER_SETTINGS = [
  { noun: 'exhibit cases', frame: 'The Orrin Museum is setting out {n} exhibit cases along one wall' },
  { noun: 'stalls', frame: 'The Velmoor night market is laying out {n} stalls along one lane' },
  { noun: 'pieces', frame: 'The Tamsford Chamber Society is fixing the running order of {n} pieces for one concert' },
  { noun: 'banners', frame: 'The Harrowgate fair committee is hanging {n} banners along one street' },
];
export const ROTA_PLACES = ['Marrow Street Bakery', 'the Pellwick tidepool kiosk', 'the Dunmarrow Tea Room', 'the Kavrey ferry cafe'];

// Words that may be required in the sentence task (ordinary concrete words, 4-9 letters, none in FILLER/ANCHOR pools).
export const REQUIRED_POOL = ['lantern', 'harbor', 'orchard', 'copper', 'whistle', 'meadow', 'compass', 'thimble', 'glacier', 'blanket', 'ladder', 'canyon',
  'pebble', 'saddle', 'ribbon', 'anchor', 'cobweb', 'drizzle', 'ember', 'feather', 'garnet', 'hammock', 'island', 'kettle', 'lagoon', 'marble', 'nutmeg',
  'oyster', 'pepper', 'quilt', 'rooftop', 'saffron', 'tundra', 'umbrella', 'velvet', 'walnut', 'yarrow', 'bonfire', 'cabinet', 'dragon', 'engine',
  'fountain', 'gravel', 'icicle', 'jasmine', 'kitchen', 'lemon', 'mantle', 'needle', 'otter', 'parcel', 'quarry', 'rabbit', 'sparrow', 'teacup', 'violin',
  'wagon', 'bucket', 'candle', 'dolphin', 'easel', 'falcon', 'goblet', 'hornet', 'inkwell', 'jacket', 'lacquer', 'mitten', 'noodle',
  'oatmeal', 'puddle', 'radish', 'scarf', 'tulip', 'urchin', 'vessel', 'willow', 'yogurt', 'zipper', 'acorn', 'beacon', 'clover', 'daisy', 'embroider'];

export const FUNCTION_WORDS = ['the', 'a', 'an', 'and', 'of', 'to', 'in', 'is', 'was', 'with', 'that', 'this', 'it', 'for', 'on', 'at', 'but', 'as', 'very', 'just',
  'really', 'so', 'not', 'by', 'from', 'or'];
const ADVERBS_PREPS = ['beside', 'under', 'over', 'through', 'around', 'near', 'behind', 'across', 'toward', 'beyond', 'within', 'along', 'against', 'among',
  'during', 'after', 'before', 'while', 'then', 'still', 'often', 'never', 'always', 'softly', 'slowly', 'quickly', 'quietly', 'gently', 'boldly', 'nearly',
  'barely', 'mostly', 'sadly', 'warmly', 'calmly', 'once', 'twice'];
const ADJECTIVES = ['old', 'quiet', 'bright', 'cold', 'narrow', 'heavy', 'golden', 'silver', 'crooked', 'hollow', 'gentle', 'brisk', 'dusty', 'tiny', 'wide', 'shy',
  'plain', 'steady', 'sharp', 'sleepy', 'proud', 'warm', 'dim', 'rough', 'smooth', 'late', 'early', 'distant', 'hidden', 'faint'];
const NOUNS = ['morning', 'evening', 'river', 'window', 'garden', 'bridge', 'stone', 'mirror', 'cloud', 'shadow', 'market', 'corner', 'pocket', 'harvest', 'winter',
  'summer', 'letter', 'story', 'signal', 'pattern', 'journey', 'rumor', 'secret', 'season', 'village', 'tower', 'valley', 'forest', 'basket'];
const VERBS = ['carried', 'followed', 'watched', 'measured', 'painted', 'borrowed', 'gathered', 'counted', 'remembered', 'traded', 'mended', 'wandered', 'hummed',
  'balanced', 'guarded', 'collected', 'lifted', 'opened', 'folded', 'shared'];
export const FILLER_POOL = [...new Set([...FUNCTION_WORDS, ...ADVERBS_PREPS, ...ADJECTIVES, ...NOUNS, ...VERBS])];
// Content words that can be forbidden in addition to function words (tempting, ordinary).
export const FORBID_CONTENT = ['quietly', 'slowly', 'old', 'bright', 'morning', 'river', 'window', 'garden', 'stone', 'cloud', 'shadow', 'always', 'never', 'gently', 'golden'];

export const LONG_WORDS = ['lighthouse', 'marketplace', 'thunderstorm', 'blackberry', 'watercolor', 'moonlight', 'afternoon', 'breakwater', 'clockwork', 'cornerstone',
  'evergreen', 'farmhouse', 'gingerbread', 'hailstorm', 'lamplighter', 'midwinter', 'nightingale', 'orchestra', 'peppermint', 'quicksilver', 'riverbank',
  'shipwright', 'sunflower', 'threshold', 'underbrush', 'woodpecker'];
export const START_ANCHORS = ['meanwhile', 'yesterday', 'somehow', 'eventually', 'suddenly', 'afterward', 'earlier', 'finally'];
export const END_ANCHORS = ['forever', 'alone', 'outside', 'together', 'nearby', 'anyway', 'again', 'tonight'];
export const RARE_LETTERS = ['z', 'x', 'q', 'j', 'k', 'v', 'w'];

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
