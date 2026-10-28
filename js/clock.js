// Clock check, carried over from D4 Tracker and GW2 Timer. Countdowns are only as good as the device clock, so the
// page compares it with the Date header of two requests to its own address, a few seconds apart.
// Nothing third-party is asked. GitHub Pages' CDN stamps the current time in Date and adds Age; a
// standard cache keeps an old Date and adds Age; a misbehaving one keeps an old Date and no Age. Only
// a header that moves with real time across both readings is trusted, and a correction is applied
// only when it is large enough to matter. An unreliable answer never moves the countdowns.
(function (root) {
  'use strict';

  const MIN_CORRECTION_MS = 1500;
  const MAX_ROUND_TRIP_MS = 1500;
  const MIN_SAMPLE_GAP_MS = 4000;
  const SAMPLE_GAP_MS = 5000;
  const MAX_PLAUSIBLE_OFFSET_MS = 24 * 3600 * 1000;
  const CLOCK_JUMP_MS = 2000;
  const LONG_GAP_MS = 5 * 60 * 1000;

  function read(s) {
    if (!s || !s.date) return null;
    const date = Date.parse(s.date);
    if (!Number.isFinite(date)) return null;
    const rt = s.receivedMs - s.sentMs;
    if (!(rt >= 0 && rt <= MAX_ROUND_TRIP_MS)) return null;
    let age = 0;
    if (s.age !== null && s.age !== undefined) {
      if (!/^\d+$/.test(String(s.age).trim())) return null;
      age = Number(String(s.age).trim());
    }
    return { local: s.sentMs + rt / 2, slack: rt / 2, date, age, hasAge: s.age !== null && s.age !== undefined };
  }

  function fit(rs, window) {
    let lo = -Infinity, hi = Infinity;
    for (const r of rs) {
      const [a, b] = window(r);
      lo = Math.max(lo, a - r.local - r.slack);
      hi = Math.min(hi, b - r.local + r.slack);
    }
    return lo <= hi ? [lo, hi] : null;
  }

  /** The device clock's error from two or more readings ({ sentMs, receivedMs, date, age }), or null. */
  function estimateClock(samples) {
    if (!samples || samples.length < 2) return null;
    const rs = samples.map(read);
    if (rs.some((r) => r === null)) return null;
    if (rs[rs.length - 1].local - rs[0].local < MIN_SAMPLE_GAP_MS) return null;
    let basis = 'date';
    let range = fit(rs, (r) => [r.date, r.date + 1000]);
    if (!range && rs.some((r) => r.hasAge)) {
      basis = 'date+age';
      range = fit(rs, (r) => [r.date + r.age * 1000, r.date + r.age * 1000 + 2000]);
    }
    if (!range) return null;
    const [lo, hi] = range;
    const measuredMs = lo > 0 ? Math.round(lo) : hi < 0 ? Math.round(hi) : 0;
    if (Math.abs(measuredMs) > MAX_PLAUSIBLE_OFFSET_MS) return null;
    const applied = Math.abs(measuredMs) >= MIN_CORRECTION_MS;
    return { offsetMs: applied ? measuredMs : 0, measuredMs, uncertaintyMs: Math.round((hi - lo) / 2), applied, basis };
  }

  /** 'clock-jump' when the wall clock moved differently from elapsed time, 'long-gap' after sleep, else null. */
  function detectResume(prevWall, prevSteady, wall, steady) {
    if (Math.abs((wall - prevWall) - (steady - prevSteady)) > CLOCK_JUMP_MS) return 'clock-jump';
    if (wall - prevWall > LONG_GAP_MS) return 'long-gap';
    return null;
  }

  const Clock = { MIN_CORRECTION_MS, SAMPLE_GAP_MS, CLOCK_JUMP_MS, LONG_GAP_MS, estimateClock, detectResume };
  if (typeof module === 'object' && module.exports) module.exports = Clock;
  else root.WoWClock = Clock;
})(typeof globalThis !== 'undefined' ? globalThis : this);
