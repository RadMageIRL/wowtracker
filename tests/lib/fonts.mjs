// Font profiles for the browser checks on Linux. A profile shows Chrome only the fonts of one kind of
// device, through a private fontconfig setup, so the layout checks run with that device's real fonts and
// widths instead of whatever the machine has. Linux only (fontconfig); Windows checks run with Windows' fonts.
//
//   android: Roboto for the page's sans-serif text, Noto Serif for its headings (what an Android phone
//   has, since it has none of the serif stack's named fonts). Ubuntu and Debian packages:
//   fonts-roboto-unhinted, fonts-noto-core; monospace from fonts-dejavu-core.
//
// Fonts are looked for under /usr/share/fonts, /usr/local/share/fonts, ~/.local/share/fonts and any
// folder in WOWTRACKER_FONT_DIRS (separated by ":").
import { existsSync, mkdtempSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, basename } from 'node:path';

export const PROFILES = {
  android: {
    label: 'Android-like fonts (Roboto, Noto Serif)',
    families: [
      { family: 'Roboto', files: /^Roboto-(Regular|Italic|Medium|MediumItalic|Bold|BoldItalic|Light|LightItalic)\.ttf$/, need: 'fonts-roboto-unhinted' },
      { family: 'Noto Serif', files: /^NotoSerif-(Regular|Italic|Bold|BoldItalic)\.ttf$/, need: 'fonts-noto-core' },
      { family: 'DejaVu Sans Mono', files: /^DejaVuSansMono(-Bold)?\.ttf$/, need: 'fonts-dejavu-core' },
      { family: 'Noto Color Emoji', files: /^NotoColorEmoji\.ttf$/, need: 'fonts-noto-color-emoji', optional: true },
    ],
    // Chrome on Linux asks fontconfig for "sans" for its own default font (system-ui), so that is aliased
    // too; anything else unmatched falls back to the first of these, never to the first file found.
    generic: { sans: 'Roboto', 'sans-serif': 'Roboto', 'system-ui': 'Roboto', serif: 'Noto Serif', monospace: 'DejaVu Sans Mono', mono: 'DejaVu Sans Mono' },
    // What the page's text must really be drawn with under this profile.
    expect: { sans: ['Roboto'], serif: ['Noto Serif'] },
  },
};

function fontDirs() {
  const extra = (process.env.WOWTRACKER_FONT_DIRS || '').split(':').filter(Boolean);
  return [...extra, '/usr/share/fonts', '/usr/local/share/fonts', join(homedir(), '.local/share/fonts')].filter((d) => existsSync(d));
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) yield* walk(p); else yield p;
  }
}

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Makes a private font folder and fontconfig file for a profile and returns the environment that points
 * Chrome at it. Refuses, naming the package, when a family the profile needs is not installed.
 */
export function fontProfileEnv(name) {
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown font profile "${name}" (known: ${Object.keys(PROFILES).join(', ')})`);
  if (process.platform !== 'linux') throw new Error(`font profiles need fontconfig (Linux); this is ${process.platform}`);
  const files = [...new Set(fontDirs().flatMap((d) => [...walk(d)]))];
  const dir = mkdtempSync(join(tmpdir(), `wowtracker-fonts-${name}-`));
  const used = new Set();
  for (const f of p.families) {
    const found = files.filter((x) => f.files.test(basename(x)));
    if (!found.length) {
      if (f.optional) continue;
      throw new Error(`font profile "${name}" needs ${f.family} (install ${f.need}, or name its folder in WOWTRACKER_FONT_DIRS)`);
    }
    for (const x of found) if (!used.has(basename(x))) { used.add(basename(x)); symlinkSync(x, join(dir, basename(x))); }
  }
  const aliases = Object.entries(p.generic).map(([g, fam]) => `  <alias binding="same"><family>${xml(g)}</family><prefer><family>${xml(fam)}</family></prefer></alias>`);
  const fallback = `  <match target="pattern"><edit name="family" mode="append_last"><string>${xml(Object.values(p.generic)[0])}</string></edit></match>`;
  const conf = join(dir, 'fonts.conf');
  writeFileSync(conf, ['<?xml version="1.0"?>', '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">', '<fontconfig>',
    `  <dir>${xml(dir)}</dir>`, `  <cachedir>${xml(join(dir, 'cache'))}</cachedir>`, ...aliases, fallback, '</fontconfig>', ''].join('\n'));
  return { env: { FONTCONFIG_FILE: conf, FONTCONFIG_PATH: dir }, files: [...used].sort(), label: p.label, expect: p.expect };
}

/**
 * Font sets applied inside the page (any platform): the page's font stacks replaced by wider ones, as the
 * news head check has done since v0.3.1. "page" leaves the page's own stacks.
 */
export const SETS = {
  page: null,
  'arial-georgia': { label: 'Arial + Georgia (about Android widths)', sans: 'Arial, "Liberation Sans", Arimo, sans-serif', serif: 'Georgia, "DejaVu Serif", serif', expect: { sans: ['Arial', 'Liberation Sans', 'Arimo'], serif: ['Georgia', 'DejaVu Serif'] } },
  'verdana-georgia': { label: 'Verdana + Georgia (about Linux widths)', sans: 'Verdana, "DejaVu Sans", sans-serif', serif: 'Georgia, "DejaVu Serif", serif', expect: { sans: ['Verdana', 'DejaVu Sans'], serif: ['Georgia', 'DejaVu Serif'] } },
};

/** A script for Page.addScriptToEvaluateOnNewDocument that puts a set's stacks in place before the first paint. */
export const setScript = (set) => `document.addEventListener('readystatechange', () => { const r = document.documentElement; r.style.setProperty('--sans', ${JSON.stringify(set.sans)}); r.style.setProperty('--serif', ${JSON.stringify(set.serif)}); }, { once: true });`;
