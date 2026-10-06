// Domain: text tokenizer (fictional text-preparation library).
import { New, Call, Fn, Get, Case } from './dsl.mjs';

const WORDS = ['amber', 'quill', 'harbour', 'lantern', 'meadow', 'cobalt', 'ferry', 'orchard', 'pebble', 'thistle', 'velvet',
  'willow', 'beacon', 'cinder', 'drift', 'ember', 'fable', 'garnet', 'hollow', 'juniper'];
const SMALL = ['the', 'a', 'of', 'and', 'to', 'in', 'is', 'was', 'we', 'they', 'it'];
const JOINED = ["don't", "isn't", "we'll", "it's", 'well-known', 'state-of-the-art', 're-run', 'x-ray'];
const NAMES = ['Ines', 'Bram', 'Okafor', 'Lindqvist', 'Marisol', 'Quill'];
const cap = w => w[0].toUpperCase() + w.slice(1);

function sentence(r, p, { withAbbrev = false } = {}) {
  const n = r.int(4, 8); const words = [];
  for (let k = 0; k < n; k++) {
    const roll = r.int(0, 9);
    words.push(roll < 4 ? r.pick(WORDS) : roll < 7 ? r.pick(SMALL) : roll < 9 ? r.pick(JOINED) : String(r.int(2, 999)));
  }
  if (withAbbrev) words.splice(r.int(1, n - 1), 0, `${cap(r.pick(p.abbrevs))}.`, r.pick(NAMES));
  if (r.chance(0.4)) words[r.int(1, words.length - 1)] += ',';
  words[0] = cap(words[0]);
  return words.join(' ') + r.pick(['.', '.', '!', '?']);
}

export default {
  id: 'tokenizer',
  domain: 'text tokenization',
  params(r) {
    return {
      mod: r.pick(['tokenkit', 'wordsplit', 'lexis_tools', 'textprep']),
      product: r.pick(['the Larkspur search index', 'the Velloso support bot', 'the Pemberton archive OCR pipeline', 'the Quayside subtitle aligner']),
      abbrevs: r.sample(['dr', 'mr', 'mrs', 'prof', 'etc', 'approx', 'dept', 'vs', 'st', 'jr', 'inc', 'est'], 5).sort(),
      mc: r.pick([2, 3]),
    };
  },
  context: p => `${p.mod} prepares text for ${p.product}; every document goes through it before indexing.`,
  sections: [
    { id: 'core', label: 'word tokenizer, n-grams and counts' },
    { id: 'sentences', label: 'sentence splitter' },
    { id: 'vocab', label: 'vocabulary and id encoding' },
    { id: 'windows', label: 'padding, windows and truncation' },
    { id: 'detok', label: 'detokenization and wrapping' },
  ],

  sites: {
    join_end: {
      section: 'core', op: 'missing-edge-case', fnKey: 'tokenize', fn: () => 'tokenize()',
      title: () => 'tokenize() crashes on text ending in a hyphen or apostrophe',
      symptom: [
        () => `tokenize() raises IndexError when the text ends right after a word followed by "-" or "'" (for example a line ending in "re-"). Our OCR output often has those.`,
        () => `IndexError: string index out of range from tokenize() on some documents. It seems to be the ones whose last character is a hyphen.`,
      ],
      decoy: () => 'NOTE(perf): the j + 1 < n bound check is redundant; isalnum() fails at the end anyway',
      killers: (p, r) => [Case('test_tokenize_trailing_joiner', [Fn('tokenize', [`${cap(r.pick(WORDS))} ${r.pick(WORDS)}-`]), Fn('tokenize', [`${r.pick(WORDS)}' x`]), Fn('tokenize', ["don't stop-over"])])],
    },
    lower_default: {
      section: 'core', op: 'wrong-default', fnKey: 'tokenize', fn: () => 'tokenize()',
      title: () => 'tokenize() lower-cases by default',
      symptom: [
        () => `tokenize() now lower-cases everything even when we do not ask for it, which breaks our named-entity step. The docstring says lowercase defaults to False.`,
      ],
      herring: [
        () => `tokenize() keeps capital letters unless lowercase=True is passed. Everything downstream lower-cases anyway, so lower-casing should be the default.`,
      ],
      killers: (p, r) => [Case('test_tokenize_keeps_case_by_default', [Fn('tokenize', [`${r.pick(NAMES)} met ${r.pick(NAMES)} at the ${cap(r.pick(WORDS))} Inn.`]), Fn('tokenize', ['Mixed CASE'], { lowercase: true })])],
    },
    ngram_off: {
      section: 'core', op: 'off-by-one', fnKey: 'ngrams', fn: () => 'ngrams()',
      title: () => 'ngrams() drops the last n-gram',
      symptom: [
        () => `ngrams() always misses the final n-gram: ngrams(["a", "b", "c"], 3) returns an empty list.`,
      ],
      decoy: () => 'FIXME: range(len(tokens) - n) would avoid the + 1 here?',
      killers: (p, r) => { const t = r.sample(WORDS, 4); return [Case('test_ngrams_include_last', [Fn('ngrams', [t.slice(0, 3), 3]), Fn('ngrams', [t]), Fn('ngrams', [t.slice(0, 1), 2])])]; },
    },
    top_order: {
      section: 'core', op: 'swapped-arguments', fnKey: 'top_tokens', fn: () => 'top_tokens()',
      title: () => 'top_tokens() is sorted alphabetically',
      symptom: [
        () => `top_tokens() returns tokens in alphabetical order instead of most frequent first, so the "top" list starts with rare words beginning with "a".`,
      ],
      killers: (p, r) => { const [x, y, z] = r.sample(WORDS, 3).sort(); return [Case('test_top_tokens_by_frequency', [Fn('top_tokens', [[z, y, z, x, y, z, ',', ',', ',', ','], 2])])]; },
    },
    abbr_case: {
      section: 'sentences', op: 'missing-edge-case', fnKey: 'split_sentences', fn: () => 'split_sentences()',
      title: () => 'Capitalised abbreviations end sentences',
      symptom: [
        p => `split_sentences() breaks after "${cap(p.abbrevs[0])}." at the start of a sentence, e.g. "${cap(p.abbrevs[0])}. Okafor arrived." becomes two sentences. The lower-case form works.`,
      ],
      herring: [
        p => `split_sentences() never splits after "${cap(p.abbrevs[0])}.", even when the next word is capitalised. Shouldn't a full stop followed by a capital always start a new sentence?`,
      ],
      killers: (p, r) => [Case('test_capitalised_abbreviation', [Fn('split_sentences', [`${cap(p.abbrevs[0])}. ${r.pick(NAMES)} arrived late. Then we left.`]),
        Fn('split_sentences', [`We met ${p.abbrevs[1]}. ${r.pick(NAMES)} there.`])])],
    },
    sent_tail: {
      section: 'sentences', op: 'missing-edge-case', fnKey: 'split_sentences', fn: () => 'split_sentences()',
      title: () => 'Last sentence without punctuation disappears',
      symptom: [
        () => `If a text does not end with ".", "!" or "?", split_sentences() silently drops the last sentence. Chat messages rarely end with a full stop.`,
      ],
      killers: (p, r) => [Case('test_unterminated_last_sentence', [Fn('split_sentences', [`${cap(r.pick(WORDS))} first. Then ${r.pick(WORDS)} without end  `]), Fn('split_sentences', ['no punctuation at all'])])],
    },
    sent_start: {
      section: 'sentences', op: 'stale-variable', fnKey: 'split_sentences', fn: () => 'split_sentences()',
      title: () => 'Sentences repeat earlier sentences',
      symptom: [
        () => `From the second sentence on, every sentence returned by split_sentences() also contains all the previous sentences.`,
      ],
      killers: (p, r) => [Case('test_sentences_do_not_accumulate', [Fn('split_sentences', [`${cap(r.pick(WORDS))} one. ${cap(r.pick(WORDS))} two! ${cap(r.pick(WORDS))} three?`])])],
    },
    initial_len: {
      section: 'sentences', op: 'off-by-one', fnKey: 'split_sentences._is_abbreviation', fn: () => 'split_sentences()',
      title: () => 'Sentences ending in a two-letter word are not split',
      symptom: [
        () => `"Look it up. Then go." comes back from split_sentences() as one sentence. It seems to happen whenever the word before the full stop has two letters.`,
      ],
      killers: (p, r) => [Case('test_two_letter_word_ends_sentence', [Fn('split_sentences', ['Look it up. Then go.']), Fn('split_sentences', [`J. ${r.pick(NAMES)} said so. We agree.`])])],
    },
    vocab_min: {
      section: 'vocab', op: 'wrong-comparator', fnKey: 'Vocabulary.__init__', fn: () => 'Vocabulary()',
      title: () => 'Vocabulary drops tokens seen exactly min_count times',
      symptom: [
        () => `Tokens that occur exactly min_count times are missing from the Vocabulary and encode as <unk>.`,
      ],
      herring: [
        () => `Vocabulary keeps tokens that appear exactly min_count times. I read "min_count" as "must appear more often than this", so those should be dropped.`,
      ],
      killers: (p, r) => { const [a, b, c] = r.sample(WORDS, 3); return [Case('test_min_count_inclusive', [New('v', 'Vocabulary', [[a, b, a, c, c, c]], { min_count: 2 }), Get('v', 'itos'), Call('v', 'encode', [[b, a]])])]; },
    },
    mc_default: {
      section: 'vocab', op: 'wrong-default', fnKey: 'Vocabulary.__init__', fn: () => 'Vocabulary()',
      title: () => 'Vocabulary default min_count is wrong',
      symptom: [
        p => `With the default min_count, Vocabulary leaves out tokens that occur ${p.mc} times; the docstring says the default is ${p.mc}.`,
      ],
      killers: (p, r) => { const [a, b, c] = r.sample(WORDS, 3); const toks = [...Array(p.mc).fill(a), ...Array(p.mc + 1).fill(b), ...Array(p.mc - 1).fill(c)];
        return [Case('test_default_min_count', [New('v', 'Vocabulary', [r.shuffle(toks)]), Get('v', 'itos')])]; },
    },
    unk_id: {
      section: 'vocab', op: 'wrong-default', fnKey: 'Vocabulary.encode', fn: () => 'Vocabulary.encode()',
      title: () => 'Unknown tokens are encoded as padding',
      symptom: [
        () => `encode() maps unknown words to id 0 (<pad>) instead of 1 (<unk>), so the model ignores them as padding.`,
      ],
      killers: (p, r) => { const [a, b] = r.sample(WORDS, 2); return [Case('test_unknown_tokens_encode_as_unk', [New('v', 'Vocabulary', [[a, a, a]], { min_count: 1 }), Call('v', 'encode', [[a, b, 'zzz']]),
        Call('v', 'decode', [[2, 1, 0, 2]])])]; },
    },
    decode_neg: {
      section: 'vocab', op: 'missing-edge-case', fnKey: 'Vocabulary.decode', fn: () => 'Vocabulary.decode()',
      title: () => 'decode() accepts negative ids',
      symptom: [
        () => `decode([-1]) returns the last word of the vocabulary instead of raising IndexError, which hid a bug in our model output for weeks.`,
      ],
      killers: (p, r) => { const [a, b] = r.sample(WORDS, 2); return [Case('test_decode_rejects_negative_ids', [New('v', 'Vocabulary', [[a, a, b, b, b]], { min_count: 1 }), Call('v', 'decode', [[-1]]),
        Call('v', 'decode', [[3, 2]]), Call('v', 'decode', [[4]])])]; },
    },
    win_stop: {
      section: 'windows', op: 'wrong-comparator', fnKey: 'windows', fn: () => 'windows()',
      title: () => 'windows() adds a redundant last window',
      symptom: [
        () => `When the last full window ends exactly at the end of the input, windows() still adds one more, mostly padding, window.`,
      ],
      decoy: () => 'TODO: use > here? stopping at == looks like it drops the last stride',
      killers: () => [Case('test_windows_stop_at_end', [Fn('windows', [[1, 2, 3, 4, 5, 6, 7, 8], 4, 2]), Fn('windows', [[1, 2, 3, 4, 5], 4, 2]), Fn('windows', [[], 3, 1])])],
    },
    trunc_tie: {
      section: 'windows', op: 'wrong-comparator', fnKey: 'truncate_pair', fn: () => 'truncate_pair()',
      title: () => 'truncate_pair() trims the wrong list on ties',
      symptom: [
        () => `When both lists are the same length, truncate_pair() trims the second one; the docstring says the first one goes first on ties.`,
      ],
      herring: [
        () => `truncate_pair() trims the first list when both are equally long. The second list is the answer span, so it should be the one trimmed on ties.`,
      ],
      killers: () => [Case('test_truncate_pair_ties', [Fn('truncate_pair', [[1, 2, 3], [4, 5, 6], 5]), Fn('truncate_pair', [[1, 2], [3, 4, 5, 6, 7], 4])])],
    },
    pad_default: {
      section: 'windows', op: 'wrong-default', fnKey: 'pad_to', fn: () => 'pad_to()',
      title: () => 'Padding uses the <unk> id',
      symptom: [
        () => `pad_to() and windows() pad with 1 (<unk>) instead of 0 (<pad>), so padded positions are treated as unknown words.`,
      ],
      killers: () => [Case('test_padding_uses_zero', [Fn('pad_to', [[7, 8], 4]), Fn('pad_to', [[7, 8, 9], 2]), Fn('windows', [[5, 6, 7], 2, 2])])],
    },
    detok_stale: {
      section: 'detok', op: 'stale-variable', fnKey: 'detokenize', fn: () => 'detokenize()',
      title: () => 'detokenize() puts a space after opening brackets',
      symptom: [
        () => `detokenize(["a", "(", "b", ")"]) gives "a ( b)" instead of "a (b)". Only brackets that are not the first token are affected.`,
      ],
      killers: (p, r) => [Case('test_detokenize_brackets', [Fn('detokenize', [[r.pick(WORDS), '(', r.pick(WORDS), ')', r.pick(WORDS), '$', '5']]), Fn('detokenize', [['(', 'x', ')']])])],
    },
    detok_clitic: {
      section: 'detok', op: 'missing-edge-case', fnKey: 'detokenize', fn: () => 'detokenize()',
      title: () => `detokenize() separates "'s" and "n't"`,
      symptom: [
        () => `detokenize() produces "it 's fine" and "is n't" instead of "it's" and "isn't".`,
      ],
      killers: () => [Case('test_detokenize_clitics', [Fn('detokenize', [['it', "'s", 'fine', ',', 'is', "n't", 'it', '?']])])],
    },
    wrap_cmp: {
      section: 'detok', op: 'off-by-one', fnKey: 'wrap_words', fn: () => 'wrap_words()',
      title: () => 'wrap_words() wraps lines that would fit exactly',
      symptom: [
        () => `wrap_words() never produces a line of exactly width characters; lines that would fit exactly are wrapped one word early.`,
      ],
      herring: [
        () => `wrap_words() produces lines of exactly width characters. Our terminal wraps at width, so lines should be strictly shorter than width.`,
      ],
      killers: () => [Case('test_wrap_exact_width', [Fn('wrap_words', [['abc', 'de', 'fgh'], 6]), Fn('wrap_words', [['abcdefgh', 'ij'], 4])])],
    },
  },

  randoms: {
    core(p, r, i) {
      const text = sentence(r, p) + ' ' + sentence(r, p);
      return Case(`test_tokenize_text_${i}`, [Fn('tokenize', [text], {}, 'toks'), Fn('ngrams', [{ $ref: 'toks' }, r.int(1, 3)]), Fn('count_tokens', [{ $ref: 'toks' }]),
        Fn('normalize_space', [`  ${text.replace(/ /g, r.pick(['  ', ' \t ', ' ']))} `]), Fn('char_ngrams', [r.pick(WORDS), r.int(2, 4)]),
        Fn('top_tokens', [{ $ref: 'toks' }, 3]), Fn('tokenize', [text], { lowercase: true })]);
    },
    sentences(p, r, i) {
      const text = [sentence(r, p, { withAbbrev: r.chance(0.6) }), sentence(r, p), sentence(r, p, { withAbbrev: r.chance(0.3) })].join(' ');
      return Case(`test_split_paragraph_${i}`, [Fn('split_sentences', [text])]);
    },
    vocab(p, r, i) {
      const toks = Array.from({ length: 14 }, () => r.pick(WORDS.slice(0, 8)));
      return Case(`test_vocabulary_roundtrip_${i}`, [New('v', 'Vocabulary', [toks], { min_count: r.int(1, 3) }), Get('v', 'itos'),
        Call('v', 'encode', [r.sample(WORDS.slice(0, 10), 4)]), Call('v', 'decode', [[0, 1, 2, 3].slice(0, r.int(1, 4))]),
        Call('v', 'coverage', [r.sample(WORDS, 5)])]);
    },
    windows(p, r, i) {
      const ids = Array.from({ length: r.int(3, 11) }, () => r.int(2, 50));
      return Case(`test_window_values_${i}`, [Fn('windows', [ids, r.int(2, 5), r.int(1, 4)]), Fn('pad_to', [ids, r.int(1, 12)]),
        Fn('truncate_pair', [ids, ids.slice(0, r.int(1, ids.length)), r.int(2, 12)]), Fn('chunk', [ids, r.int(1, 4)])]);
    },
    detok(p, r, i) {
      const toks = [cap(r.pick(WORDS)), r.pick(SMALL), ',', r.pick(WORDS), r.pick(['(', '[']), r.pick(WORDS), r.pick([')', ']']), r.pick(['.', '!', '%'])];
      return Case(`test_detokenize_values_${i}`, [Fn('detokenize', [toks]), Fn('wrap_words', [r.sample(WORDS, 6), r.int(8, 20)]),
        Fn('shorten', [r.sample(WORDS, 5).join(' '), r.int(6, 30)])]);
    },
  },

  render(p, { m, d, inc }) {
    const out = [];
    out.push(`"""${p.mod}: tokenization helpers for ${p.product}.

A token is either a word or a single punctuation character.  Words are runs
of letters and digits; an apostrophe or a hyphen joins two such runs
("don't", "state-of-the-art") but is a separate token anywhere else.
Whitespace separates tokens and is never part of one.
"""

JOINERS = "'-"


def tokenize(text, lowercase=${m('lower_default', 'False', 'True')}):
    """Split text into word and punctuation tokens (see the module docstring).

    With lowercase=True every token is lower-cased; lowercase defaults to
    False.
    """
    tokens = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch.isspace():
            i += 1
        elif ch.isalnum():
            j = i + 1
${d('join_end', 12)}            while j < n and (text[j].isalnum() or (text[j] in JOINERS and ${m('join_end', 'j + 1 < n and ', '')}text[j + 1].isalnum())):
                j += 1
            tokens.append(text[i:j])
            i = j
        else:
            tokens.append(ch)
            i += 1
    if lowercase:
        tokens = [tok.lower() for tok in tokens]
    return tokens


def normalize_space(text):
    """Collapse every run of whitespace into a single space and strip both ends."""
    return " ".join(text.split())


def char_ngrams(word, n=3):
    """Character n-grams of word padded with "<" and ">" boundary markers:
    char_ngrams("cat", 3) == ["<ca", "cat", "at>"].  Words shorter than n - 2
    characters still give the single padded string."""
    padded = "<" + word + ">"
    if len(padded) <= n:
        return [padded]
    return [padded[i:i + n] for i in range(len(padded) - n + 1)]


def ngrams(tokens, n=2):
    """All runs of n consecutive tokens, as tuples, in order.

    A sequence shorter than n has no n-grams.  n must be at least 1.
    """
    if n < 1:
        raise ValueError("n must be at least 1")
${d('ngram_off', 4)}    return [tuple(tokens[i:i + n]) for i in range(${m('ngram_off', 'len(tokens) - n + 1', 'len(tokens) - n')})]


def count_tokens(tokens):
    """Map token -> count, ignoring tokens without any letter or digit."""
    counts = {}
    for tok in tokens:
        if not any(ch.isalnum() for ch in tok):
            continue
        counts[tok] = counts.get(tok, 0) + 1
    return counts


def top_tokens(tokens, k):
    """The k most frequent word tokens as [token, count] pairs, highest count
    first and ties in alphabetical order."""
    counts = count_tokens(tokens)
    ranked = sorted(counts.items(), key=lambda kv: (${m('top_order', '-kv[1], kv[0]', 'kv[0], -kv[1]')}))
    return [[tok, count] for tok, count in ranked[:k]]
`);
    if (inc('sentences')) out.push(`

ABBREVIATIONS = frozenset(${'{'}${p.abbrevs.map(a => `"${a}"`).join(', ')}${'}'})


def _is_abbreviation(text, start, dot, abbreviations):
    """True when the word just before text[dot] is an abbreviation or an initial."""
    k = dot
    while k > start and text[k - 1].isalpha():
        k -= 1
    word = text[k:dot]
    return len(word) ${m('initial_len', '== 1', '<= 2')} or ${m('abbr_case', 'word.lower()', 'word')} in abbreviations


def split_sentences(text, abbreviations=ABBREVIATIONS):
    """Split text into sentences, keeping the terminating punctuation.

    A sentence ends at ".", "!" or "?" when the next non-space character is an
    upper-case letter or the end of the text.  A "." does not end a sentence
    when the word before it is a known abbreviation (compared
    case-insensitively, without the dot) or a single letter (an initial such
    as "J.").  Text after the last terminator still forms a final sentence.
    Surrounding whitespace is stripped and empty sentences are dropped.
    """
    sentences = []
    start = 0
    n = len(text)
    for i, ch in enumerate(text):
        if ch not in ".!?":
            continue
        j = i + 1
        while j < n and text[j].isspace():
            j += 1
        boundary = j == n or text[j].isupper()
        if boundary and ch == "." and _is_abbreviation(text, start, i, abbreviations):
            boundary = False
        if boundary:
            piece = text[start:i + 1].strip()
            if piece:
                sentences.append(piece)
${m('sent_start', `            start = i + 1
`, '')}    tail = text[start:].strip()
${m('sent_tail', `    if tail:
        sentences.append(tail)
`, '')}    return sentences
`);
    if (inc('vocab')) out.push(`

PAD, UNK = "<pad>", "<unk>"


class Vocabulary:
    """Token <-> id mapping.

    Id 0 is PAD and id 1 is UNK.  Other tokens get ids from 2 upwards in order
    of decreasing frequency, ties broken alphabetically.  Tokens seen fewer
    than min_count times (default ${p.mc}) are left out and encode as UNK.
    """

    def __init__(self, tokens, min_count=${m('mc_default', String(p.mc), String(p.mc + 1))}):
        counts = {}
        for tok in tokens:
            counts[tok] = counts.get(tok, 0) + 1
        kept = [tok for tok, count in counts.items() if count ${m('vocab_min', '>=', '>')} min_count]
        kept.sort(key=lambda tok: (-counts[tok], tok))
        self.itos = [PAD, UNK] + kept
        self.stoi = {tok: i for i, tok in enumerate(self.itos)}

    def __len__(self):
        return len(self.itos)

    def encode(self, tokens):
        """Ids for tokens; tokens outside the vocabulary map to the UNK id (1)."""
        return [self.stoi.get(tok, ${m('unk_id', '1', '0')}) for tok in tokens]

    def coverage(self, tokens):
        """Share of tokens (0.0 .. 1.0, rounded to 3 places) that the vocabulary
        knows; an empty token list has coverage 1.0."""
        if not tokens:
            return 1.0
        known = sum(1 for tok in tokens if tok in self.stoi and self.stoi[tok] > 1)
        return round(known / len(tokens), 3)

    def decode(self, ids, skip_pad=True):
        """Tokens for ids.  PAD ids are dropped when skip_pad is true (the
        default).  Ids outside 0 .. len(self) - 1 raise IndexError."""
        out = []
        for i in ids:
            if i == 0 and skip_pad:
                continue
            if ${m('decode_neg', 'i < 0 or ', '')}i >= len(self.itos):
                raise IndexError(i)
            out.append(self.itos[i])
        return out
`);
    if (inc('windows')) out.push(`

def pad_to(ids, length, pad_id=${m('pad_default', '0', '1')}):
    """ids truncated or right-padded with pad_id (default 0, the PAD id) to
    exactly length items."""
    return list(ids[:length]) + [pad_id] * max(0, length - len(ids))


def windows(ids, size, stride):
    """Overlapping windows of size ids, one starting every stride ids.

    The first window starts at 0.  Windows stop as soon as one reaches the end
    of ids; the last window may be short and is padded with 0 to size.  An
    empty input gives no windows.  size and stride must be positive.
    """
    if size <= 0 or stride <= 0:
        raise ValueError("size and stride must be positive")
    out = []
    for start in range(0, len(ids), stride):
        out.append(pad_to(ids[start:start + size], size))
${d('win_stop', 8)}        if start + size ${m('win_stop', '>=', '>')} len(ids):
            break
    return out


def chunk(ids, size):
    """Non-overlapping pieces of size ids (the last one may be shorter, it is
    not padded).  size must be positive."""
    if size <= 0:
        raise ValueError("size must be positive")
    return [list(ids[i:i + size]) for i in range(0, len(ids), size)]


def truncate_pair(first, second, max_total):
    """Trim two id lists until len(first) + len(second) <= max_total by
    repeatedly removing the last id of the longer list (first when both have
    the same length).  Returns [first, second] as new lists."""
    first, second = list(first), list(second)
    while len(first) + len(second) > max_total:
        if len(first) ${m('trunc_tie', '>=', '>')} len(second):
            first.pop()
        else:
            second.pop()
    return [first, second]
`);
    if (inc('detok')) out.push(`

NO_SPACE_BEFORE = set(",.;:!?)]}%")
NO_SPACE_AFTER = set("([{$")
CLITICS = ("'s", "n't")


def detokenize(tokens):
    """Join tokens back into text.

    Tokens are separated by one space, except that there is no space before
    , . ; : ! ? ) ] } %, no space after ( [ { $, and the clitics "'s" and
    "n't" are glued to the previous token.
    """
    out = ""
    prev = None
    for tok in tokens:
        if prev is None:
            out = tok
        elif tok in NO_SPACE_BEFORE or prev in NO_SPACE_AFTER${m('detok_clitic', ' or tok in CLITICS', '')}:
            out += tok
        else:
            out += " " + tok
        prev = ${m('detok_stale', 'tok', 'out')}
    return out


def shorten(text, max_chars, marker="..."):
    """text unchanged if it has at most max_chars characters; otherwise cut at
    the last space that keeps the result, including marker, within max_chars,
    and append marker.  Without a usable space the text is cut mid-word."""
    if len(text) <= max_chars:
        return text
    room = max_chars - len(marker)
    cut = text.rfind(" ", 0, room + 1)
    if cut <= 0:
        cut = room
    return text[:cut].rstrip() + marker


def wrap_words(words, width):
    """Greedily pack words into lines of at most width characters (words in a
    line are joined by single spaces).  A word longer than width gets a line
    of its own.  Returns the list of lines."""
    lines = []
    current = ""
    for word in words:
        if not current:
            current = word
        elif len(current) + 1 + len(word) ${m('wrap_cmp', '<=', '<')} width:
            current += " " + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines
`);
    return out.join('');
  },

  notes(p, inc) {
    const out = [`# ${p.mod} design notes

${p.mod} turns raw text into tokens and ids for ${p.product}. It is deliberately dependency-free and
character-based (no regular expressions), so its behaviour is easy to reason about.

## Tokens
- Words are letters/digits; "'" and "-" join two word runs and are separate tokens otherwise, including
  at the very end of the text.
- Case is preserved unless lowercase=True is passed.
- ngrams(tokens, n) yields len(tokens) - n + 1 tuples (none if the input is shorter than n).
- top_tokens() ranks by count (highest first), then alphabetically.`];
    if (inc('sentences')) out.push(`
## Sentences
- Terminators are . ! ? followed by a capital letter or the end of the text.
- Abbreviations (${p.abbrevs.join(', ')}) are matched case-insensitively; single-letter initials never end a
  sentence. Two-letter words are ordinary words.
- Trailing text without a terminator is still a sentence.`);
    if (inc('vocab')) out.push(`
## Vocabulary
- 0 = <pad>, 1 = <unk>; real tokens start at 2, most frequent first, alphabetical on ties.
- min_count is inclusive (default ${p.mc}).
- Unknown tokens encode as 1. Out-of-range ids, including negative ids, raise IndexError when decoding.`);
    if (inc('windows')) out.push(`
## Windows
- Padding always uses id 0.
- windows() stops after the first window that reaches the end of the input, so no window is pure padding.
- truncate_pair() trims the longer list first and the first list on ties.`);
    if (inc('detok')) out.push(`
## Detokenization
- No space before closing punctuation, none after opening brackets or "$", and the clitics 's / n't attach
  to the previous word.
- wrap_words() lines may be exactly width characters long.`);
    return out.join('\n') + '\n';
  },
};
