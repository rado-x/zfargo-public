/* coast.js — the one sky over crabland.
 *
 * Every page on the coast used to roll its own moon (shore and lanterns even
 * disagreed on the synodic month). This is the single source: date-seeded,
 * deterministic, no server, no cron to rot. Same date → same sky on every
 * page, forever. The wind that drives the lanterns is the wind the shore
 * names in its caption.
 *
 * API (window.Coast):
 *   Coast.day(dstr?)      → tonight's (or any date's) conditions:
 *     { date, moon: {phase, illum, waxing, name, shadow},
 *       wind: {speed, dir, gust, drift, name, from}, spring, rng(tag) }
 *   Coast.tide(when?)     → { level 0..1, rising, state } — live semidiurnal tide
 *   Coast.line(dstr?)     → keeper's-log one-liner: "waxing gibbous · a light
 *                            breeze off the west · tide flooding"
 *   Coast.moonPhase(dstr) → 0 new … 0.5 full … (shore's beaches seed off this)
 *   Coast.crescent(moon)  → terminator offset in moon-radii for drawing the
 *                            phase: shadow disc at (x + off*r). 0 = new moon
 *                            (shadow centered), ±2.05 = full (shadow clear).
 */
(function () {
  'use strict';
  const TAU = Math.PI * 2;

  // seeded PRNG pair — same xmur3+mulberry32 the shore and lanterns already use
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmt(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  // canonical moon: epoch 2000-01-06 18:14 UTC, synodic 29.530588853 d,
  // evaluated at local noon so a date's phase never shifts during the day
  const EPOCH = Date.UTC(2000, 0, 6, 18, 14);
  const SYNODIC = 29.530588853;
  function moonPhase(dstr) {
    const days = (new Date(dstr + 'T12:00:00') - EPOCH) / 86400000;
    return ((days % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
  }

  const PHASE_NAMES = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous',
    'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];

  // Beaufort, in the keeper's voice
  const WIND_NAMES = [
    [0.06, 'dead calm'],
    [0.22, 'a light air'],
    [0.42, 'a light breeze'],
    [0.62, 'a steady breeze'],
    [0.82, 'a fresh wind'],
    [1.01, 'a near gale'],
  ];

  function day(dstr) {
    dstr = dstr || fmt(new Date());
    const phase = moonPhase(dstr);
    const illum = 0.5 - 0.5 * Math.cos(TAU * phase);   // 0 new … 1 full
    const waxing = phase < 0.5;
    const spring = Math.abs(Math.cos(phase * TAU));    // 1 at new+full → spring tides
    const moon = {
      phase, illum, waxing, spring,
      name: PHASE_NAMES[Math.round(phase * 8) % 8],
    };

    const wr = mulberry32(xmur3('coast~' + dstr + '~wind')());
    const speed = Math.pow(wr(), 1.6);                 // most nights gentle, the odd gale
    const dir = wr() < 0.5 ? -1 : 1;                   // -1 off the east, +1 off the west
    const gust = 0.3 + wr() * 0.7;                     // gustiness, fraction of speed
    const wind = {
      speed, dir, gust,
      drift: dir * speed,                              // signed, -1..1 — feed animations
      from: dir < 0 ? 'east' : 'west',
      name: WIND_NAMES.find(w => speed < w[0])[1],
    };

    return {
      date: dstr, moon, wind, spring,
      // page-local seeded randomness that still keys off the shared date
      rng: tag => mulberry32(xmur3('coast~' + dstr + '~' + (tag || ''))()),
    };
  }

  // one semidiurnal lunar tide (M2, 12h25m), anchored to the moon's own epoch —
  // a fiction, but a consistent one, and it never needs a server
  function tide(when) {
    const t = (when instanceof Date ? when : new Date()).getTime();
    const M2 = 12.4206012 * 3600000;
    const x = (((t - EPOCH) % M2) + M2) % M2 / M2;     // 0 = high water
    const level = 0.5 + 0.5 * Math.cos(TAU * x);
    const rising = x > 0.5;
    const state = level > 0.94 ? 'high water' : level < 0.06 ? 'low water'
      : rising ? 'tide flooding' : 'tide ebbing';
    return { level, rising, state };
  }

  // where to put the shadow disc so the lit part matches illum.
  // draw: dark circle of ~0.98r at (x + off*r, y). waxing lights the right edge.
  function crescent(moon) {
    return (moon.waxing ? -1 : 1) * moon.illum * 2.05;
  }

  function line(dstr) {
    const c = day(dstr);
    const parts = [c.moon.name];
    parts.push(c.wind.name + (c.wind.speed < 0.06 ? '' : ' off the ' + c.wind.from));
    if (!dstr || dstr === fmt(new Date())) parts.push(tide().state);
    if (c.spring > 0.85) parts.push('spring tide');
    return parts.join(' · ');
  }

  const Coast = { day, tide, line, moonPhase, crescent, version: 1 };
  if (typeof window !== 'undefined') window.Coast = Coast;
  // let node verify this file too: `node -e "const C=require('/…/coast.js'); …"`
  if (typeof module !== 'undefined' && module.exports) module.exports = Coast;
})();
