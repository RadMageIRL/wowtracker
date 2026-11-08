// Event search: the matcher on its own and on the real dataset. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Search = require('../js/search.js');
const DATA = require('../events-data.js');

// The same words the page indexes for each event (js/app.js SEARCH_INDEX).
const CATEGORY = new Map(DATA.categories.map((c) => [c.id, c]));
const indexOf = (e) => Search.index([e.name, ...(e.aliases || []),
  ...Object.values(e.schedules).flatMap((s) => (s.windows || []).map((w) => w.name).filter(Boolean)),
  e.zone, CATEGORY.get(e.category).name, CATEGORY.get(e.category).short || '']);
const find = (q) => DATA.events.filter((e) => Search.matches(indexOf(e), q)).map((e) => e.id).sort();

export function searchTests(test) {
  test('search ignores case, accents, apostrophes and punctuation', () => {
    assert.equal(Search.normalize("Lu'ashal"), 'luashal');
    assert.equal(Search.normalize('Thorm’belan'), 'thormbelan');
    assert.equal(Search.normalize('Día de los Muertos!'), 'dia de los muertos');
    assert.equal(Search.normalize('  Un\'Goro   Madness '), 'ungoro madness');
    assert.equal(Search.normalize(null), '');
  });

  test('a word typed in part matches, and in words of four letters or more one letter may be wrong, missing, extra or swapped', () => {
    const i = Search.index(['Cragpine', 'The Stump, Zul\'Aman']);
    for (const q of ['crag', 'cragpine', 'cragpien', 'crapgine', 'cragine', 'craggpine', 'zulaman', 'zul aman', 'stump']) assert.ok(Search.matches(i, q), q);
    for (const q of ['cxagpxne', 'pine', 'cr44pine', 'xyz']) assert.equal(Search.matches(i, q), false, q);
    assert.equal(Search.matches(Search.index(['Tw']), 'tx'), false, 'no typo allowance under four letters');
  });

  test('every word of the query has to match, words typed together or apart both work, and an empty query matches everything', () => {
    const i = Search.index(['Feast of Winter Veil']);
    assert.ok(Search.matches(i, 'winter veil'));
    assert.ok(Search.matches(i, 'winterveil'));
    assert.ok(Search.matches(i, 'feast winter'));
    assert.equal(Search.matches(i, 'winter moon'), false);
    assert.ok(Search.matches(i, ''));
    assert.ok(Search.matches(i, '  !! '));
  });

  test('on the real data: names, aliases, window names, zones and categories find the right events', () => {
    assert.deepEqual(find('dmf'), ['darkmoon-faire']);
    assert.deepEqual(find('halloween'), ['hallows-end']);
    assert.deepEqual(find('hallows end'), ['hallows-end']);
    assert.deepEqual(find('legion'), ['timewalking']);
    assert.deepEqual(find('luashal'), ['world-boss-luashal']);
    assert.deepEqual(find('world boss'), ['world-boss-cragpine', 'world-boss-luashal', 'world-boss-predaxas', 'world-boss-thormbelan']);
    assert.deepEqual(find('zulaman'), ['aqir-invasion', 'world-boss-cragpine']);
    assert.deepEqual(find('christmas'), ['feast-of-winter-veil']);
    assert.deepEqual(find('nothing like this'), []);
    for (const e of DATA.events) assert.ok(find(e.name).includes(e.id), `${e.name} finds itself`);
  });
}
