// Editions (Retail, Forever): the registry, each edition's data rules, Retail's data left byte for byte as
// it was, and the settings split that keeps one edition's choices out of another's. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Store = require('../js/store.js');
const Config = require('../js/config.js');
const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));

// Retail's data as released in v0.2.0 (71c5ab2). While its source is unchanged, its generated file must be too.
const RETAIL_SOURCE_V020 = '124196421ca52e5711281650a0eee96d617ddc6073dbc12f88ec334a4f08fd91';
const RETAIL_OUTPUT_V020 = '845ee44846dc6d1e5c91427acfadb397aea53941137c5b83c2c19090e030ff01';

export async function editionTests(test) {
  const { validate, pageData, render, EDITIONS, SITE_FILES } = { ...(await import('../tools/build-data.mjs')), ...(await import('../tools/build.mjs')) };
  const html = file('index.html');

  test('editions: Retail first (the default), then Forever; each has its own source, generated file and page global, loaded with ?r= and published', () => {
    assert.deepEqual(Config.editions.map((e) => e.id), ['retail', 'forever']);
    assert.equal(EDITIONS, Config.editions, 'the build reads the same list');
    assert.deepEqual(Config.editions.map((e) => [e.source, e.file, e.data]), [['events', 'events-data.js', 'WOW_DATA'], ['forever', 'forever-data.js', 'WOW_DATA_FOREVER']]);
    for (const e of Config.editions) {
      const data = require(`../${e.file}`);
      assert.ok(html.includes(`<script src="${e.file}?r=${data.meta.datasetRevision}"></script>`), e.file);
      assert.ok(SITE_FILES.includes(e.file), e.file);
      assert.ok(file(e.file).includes(`else root.${e.data} = DATA;`), e.data);
    }
    // Each data file comes before the page code that reads it.
    assert.ok(html.indexOf('forever-data.js') < html.indexOf('js/app.js') && html.indexOf('events-data.js') < html.indexOf('forever-data.js'));
  });

  test('Retail data is byte for byte as released in v0.2.0 while its source is unchanged; it names no edition', () => {
    if (sha(file('data/events.source.json')) === RETAIL_SOURCE_V020) assert.equal(sha(file('events-data.js')), RETAIL_OUTPUT_V020);
    const retail = require('../events-data.js');
    assert.equal(retail.meta.edition, undefined);
    assert.equal(render(JSON.parse(file('data/events.source.json'))), file('events-data.js'), 'the default edition renders the Retail file');
  });

  test('Forever data passes the rules as Forever: its own product and build, a server clock per region, resets that are not published have no rule', () => {
    const src = JSON.parse(file('data/forever.source.json'));
    assert.deepEqual(validate(src, 'forever'), []);
    assert.deepEqual([src.meta.edition, src.meta.product], ['forever', 'wowf']);
    for (const r of src.regions) assert.ok(r.serverZone && r.serverZone.status === 'predicted', r.id);
    const page = pageData(src);
    for (const r of ['us', 'eu']) for (const k of ['daily', 'weekly']) {
      assert.deepEqual(Object.keys(page.resets[r][k]).sort(), ['name', 'note', 'status']);
      assert.equal(page.resets[r][k].status, 'unknown');
    }
    assert.equal(page.regions.find((r) => r.id === 'us').serverZone.zone, 'America/Chicago');
  });

  test('data rules refuse an edition that misnames itself, a missing product or server clock, an unknown reset with a rule or no note, and a client source from another product', () => {
    const base = JSON.parse(file('data/forever.source.json'));
    const refused = (mutate, part) => { const s = clone(base); mutate(s); const errors = validate(s, 'forever'); assert.ok(errors.some((e) => e.includes(part)), `${part}: ${errors.join(' | ') || 'no error'}`); };
    refused((s) => { s.meta.edition = 'retail'; }, 'edition must be forever');
    refused((s) => { delete s.meta.product; }, 'product');
    refused((s) => { delete s.regions[0].serverZone; }, 'serverZone.zone');
    refused((s) => { s.regions[1].serverZone.zone = 'Mars/Olympus'; }, 'serverZone.zone');
    refused((s) => { s.regions[1].serverZone.basis = 'seen'; }, 'serverZone.basis');
    refused((s) => { s.resets.us.daily.rule = { type: 'daily', time: '15:00', zone: 'UTC' }; }, 'an unknown reset has no rule');
    refused((s) => { s.resets.eu.weekly.note = ''; }, 'needs a note');
    refused((s) => { s.resets.eu.weekly = { name: 'Weekly reset', rule: { type: 'weekly', weekday: 2, time: '15:00', zone: 'UTC' }, status: 'confirmed', lastVerified: '2026-11-08', sources: [{ url: 'https://wago.tools/db2/Holidays?build=12.1.5.70783', kind: 'client', publisher: 'Game calendar data', retrieved: '2026-11-08', quote: 'a Retail build quoted for Forever' }] }; }, 'must cite a 1.60.x build');
    // Retail's own file may not claim another edition, and a Forever file is not Retail.
    const retail = JSON.parse(file('data/events.source.json'));
    retail.meta.edition = 'forever';
    assert.ok(validate(retail).some((e) => e.includes('cannot name another edition')));
    assert.ok(validate(base).some((e) => e.includes('cannot name another edition')), 'a Forever file cannot pass as Retail');
  });

  // ---- Settings: shared, or one edition's ----

  test('every saved setting is either shared or one edition\'s, never both, and none is forgotten', () => {
    const all = Object.keys(Store.defaults(['a'], 'UTC')).sort();
    assert.deepEqual([...Store.SHARED_PREFS, ...Store.EDITION_PREFS].sort(), all);
    assert.equal(Store.SHARED_PREFS.filter((k) => Store.EDITION_PREFS.includes(k)).length, 0);
  });

  test('the shared and edition parts of a saved preference put together are what Retail has always read', () => {
    const ev = ['darkmoon-faire', 'hallows-end'], cats = ['holiday', 'darkmoon'];
    for (const raw of [null, 'junk', [], {}, { region: 'eu', theme: 'light', starred: ['hallows-end', 'gone'], hidden: ['darkmoon-faire'], categories: ['holiday', 'nope'], filter: 'starred', checklistOpen: true, timeMode: 'both', aheadHours: 24, compact: true, newsCollapsed: true }]) {
      const merged = { ...Store.sanitizeShared(raw, 'Europe/Paris'), ...Store.sanitizeEditionPrefs(raw, ev, cats) };
      assert.deepEqual(Object.fromEntries(Object.entries(merged).sort()), Object.fromEntries(Object.entries(Store.sanitizePrefs(raw, ev, cats, 'Europe/Paris')).sort()), JSON.stringify(raw));
    }
  });

  test('another edition writes back only the shared settings into "prefs": Retail\'s stars, hidden events, categories, filter and checklist choice stay exactly as stored', () => {
    const stored = { region: 'us', filter: 'starred', categories: ['holiday'], starred: ['hallows-end'], hidden: ['moonkin-festival'], aheadHours: 168, compact: false, timeMode: 'local', theme: 'dark', newsCollapsed: false, newsAll: false, newsShop: false, checklistOpen: true, legacy: 'kept' };
    const forever = { region: 'eu', theme: 'light', timeMode: 'utc', aheadHours: 24, compact: true, newsCollapsed: true, newsAll: true, newsShop: true, filter: 'all', categories: ['minor'], starred: ['fishing'], hidden: [], checklistOpen: false };
    const out = Store.mergeShared(stored, forever);
    for (const k of Store.EDITION_PREFS) assert.deepEqual(out[k], stored[k], k);
    for (const k of Store.SHARED_PREFS) assert.deepEqual(out[k], forever[k], k);
    assert.equal(out.legacy, 'kept', 'unknown stored fields are left alone');
    assert.deepEqual(Object.keys(out), Object.keys(stored), 'same keys, same order: an unchanged value writes the same text');
    assert.deepEqual(stored.starred, ['hallows-end'], 'the stored object itself is not changed');
    assert.equal(JSON.stringify(Store.mergeShared(stored, { ...stored, ...forever, ...Object.fromEntries(Store.SHARED_PREFS.map((k) => [k, stored[k]])) })), JSON.stringify(stored), 'nothing shared changed: byte for byte the same');
    for (const junk of [null, 'x', [1]]) assert.deepEqual(Object.keys(Store.mergeShared(junk, forever)).sort(), [...Store.SHARED_PREFS].sort());
    assert.deepEqual(Object.keys(Store.editionPrefs(forever)).sort(), [...Store.EDITION_PREFS].sort());
  });

  test('the edition shown: a #forever link first, then the saved choice, then Retail; anything else is ignored', () => {
    const ids = ['retail', 'forever'];
    assert.equal(Store.pickEdition('', null, ids), 'retail');
    assert.equal(Store.pickEdition('', 'forever', ids), 'forever');
    assert.equal(Store.pickEdition('#forever', 'retail', ids), 'forever');
    assert.equal(Store.pickEdition('#retail', 'forever', ids), 'retail');
    assert.equal(Store.pickEdition('#coming-title', 'forever', ids), 'forever', 'the skip link is not an edition');
    assert.equal(Store.pickEdition('#classic', null, ids), 'retail');
    assert.equal(Store.pickEdition('#forever', null, ['retail']), 'retail', 'an edition this page does not have');
    assert.equal(Store.pickEdition(undefined, { edition: 'forever' }, ids), 'retail', 'a damaged saved value');
    assert.equal(Store.editionKey('prefs', 'retail'), 'prefs');
    assert.equal(Store.editionKey('prefs', 'forever'), 'forever:prefs');
  });
}
