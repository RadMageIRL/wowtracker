// Event search. Forgiving the way people type: case, accents, apostrophes and punctuation do not
// matter ("luashal" finds Lu'ashal), a word typed in part matches ("dark" finds Darkmoon Faire), and
// in a word of four letters or more one wrong, missing, extra or swapped letter is allowed ("cragpien"
// finds Cragpine). Every word of the query has to match. Pure, so the page and the Node tests share it.
(function (root) {
  'use strict';

  const MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
  const APOSTROPHES = new RegExp("['`\\u2018\\u2019]", 'g');

  /** Lower case, accents and apostrophes dropped, any other punctuation turned into a space. */
  function normalize(text) {
    return String(text === null || text === undefined ? '' : text).normalize('NFD').replace(MARKS, '')
      .toLowerCase().replace(APOSTROPHES, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  const words = (text) => normalize(text).split(' ').filter(Boolean);

  /** Edit distance where swapping two neighbouring letters counts once (optimal string alignment). */
  function distance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) d.push([i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  /** One typed word against one word of the event: a prefix, or close to one when it is long enough. */
  function wordMatches(typed, word) {
    if (word.startsWith(typed)) return true;
    if (typed.length < 4) return false;
    for (const n of [typed.length - 1, typed.length, typed.length + 1]) {
      if (n <= word.length && distance(typed, word.slice(0, n)) <= 1) return true;
    }
    return false;
  }

  /** The words an event can be found by, from any number of texts (name, aliases, zone, ...). */
  function index(texts) {
    const out = new Set();
    for (const t of texts) for (const w of words(t)) out.add(w);
    // Two words also match typed as one ("winterveil" finds Winter Veil), and a whole name as one word.
    for (const t of texts) {
      const ws = words(t);
      for (let i = 1; i < ws.length; i++) out.add(ws[i - 1] + ws[i]);
      if (ws.length > 2) out.add(ws.join(''));
    }
    return [...out];
  }

  /** True when every word of the query matches a word in the index. An empty query matches all. */
  function matches(indexed, query) {
    const typed = words(query);
    if (!typed.length) return true;
    const joined = typed.join('');
    if (typed.length > 1 && indexed.some((w) => wordMatches(joined, w))) return true;
    return typed.every((t) => indexed.some((w) => wordMatches(t, w)));
  }

  const Search = { normalize, words, distance, wordMatches, index, matches };
  if (typeof module === 'object' && module.exports) module.exports = Search;
  else root.WoWSearch = Search;
})(typeof globalThis !== 'undefined' ? globalThis : this);
