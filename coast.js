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
 *   Coast.tide(when?)     → { level 0..1, rising, state, real } — the tide.
 *     On *now*, real San Francisco high/low water (NOAA CO-OPS, baked by
 *     rado-coast-tide); outside that window a seeded semidiurnal fallback.
 *   Coast.sky(when?)      → the time of day, the coast's other live coordinate:
 *     { hour, phase ('deep night'…'midday'), light 0..1, dark, twilight,
 *       rising, sun: {up, alt, x 0..1 east→west, glow}, top, mid, horizon }
 *     Real-clock driven; pass a Date, or an hour 0..24, for previews (?t=).
 *   Coast.line(dstr?)     → keeper's-log one-liner: "waxing gibbous · a light
 *                            breeze off the west · tide flooding"
 *   Coast.moonPhase(dstr) → 0 new … 0.5 full … (shore's beaches seed off this)
 *   Coast.crescent(moon)  → terminator offset in moon-radii for drawing the
 *                            phase: shadow disc at (x + off*r). 0 = new moon
 *                            (shadow centered), ±2.05 = full (shadow clear).
 *
 * DERIVED — do not hand-edit. Generated from private/assets/coast.js by
 * rado-coast-sync (live BREATH/TIDE data stripped for the static host).
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

  // the machine's breath — on *today* the wind's STRENGTH is crabland working.
  // rado-coast-breath (run by zfargo-status, ~every 60s) atomically rewrites the
  // one line below (node --check gated) with {load, ncpu, ts}. Absent or stale →
  // liveSpeed() returns null and the seeded wind stands, so the coast still blows
  // offline, in node, and on every past ?d= date (the fireworks beach is safe).
  // The wind's *bearing* stays the day's seeded character; only its force is real.
  // BREATH-BEGIN
  var BREATH = null;   // no live machine breath on the static door → seeded wind stands
  // BREATH-END
  const BREATH_TTL = 1800;   // s — older than this, fall back to the seeded wind
  function liveSpeed() {
    if (!BREATH || !BREATH.ts || !BREATH.ncpu) return null;
    const age = Date.now() / 1000 - BREATH.ts;
    if (age < -60 || age > BREATH_TTL) return null;
    const frac = Math.max(0, BREATH.load) / BREATH.ncpu;   // machine utilisation 0..~1
    return Math.max(0, Math.min(1, Math.pow(frac, 0.6)));  // → wind speed 0..1
  }

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
    const seededSpeed = Math.pow(wr(), 1.6);           // the day's character, always deterministic
    const dir = wr() < 0.5 ? -1 : 1;                   // -1 off the east, +1 off the west
    const gust = 0.3 + wr() * 0.7;                     // gustiness, fraction of speed
    // on *today*, the wind's strength is the machine's real breath; any explicit
    // past/preview date keeps its seeded speed, so history never rewrites itself.
    let speed = seededSpeed, live = false;
    if (dstr === fmt(new Date())) {
      const ls = liveSpeed();
      if (ls !== null) { speed = ls; live = true; }
    }
    const wind = {
      speed, dir, gust, live,
      drift: dir * speed,                              // signed, -1..1 — feed animations
      from: dir < 0 ? 'east' : 'west',
      name: WIND_NAMES.find(w => speed < w[0])[1],
      seededName: WIND_NAMES.find(w => seededSpeed < w[0])[1],  // deterministic — the drift check compares this
    };

    return {
      date: dstr, moon, wind, spring,
      // page-local seeded randomness that still keys off the shared date
      rng: tag => mulberry32(xmur3('coast~' + dstr + '~' + (tag || ''))()),
    };
  }

  // the REAL tide — San Francisco high/low water (NOAA CO-OPS station 9414290),
  // ~8 days of extremes baked below by rado-coast-tide (run by coast-tide.timer,
  // node --check gated). Times are UTC epoch seconds so every viewer, in any
  // timezone, sees the same real tide phase; heights are feet on the MLLW datum,
  // mapped to the pool's 0..1 fill by a fixed SF range. Empty or stale (the job
  // rotted, an offline node, a past ?d= date beyond the window) → the seeded
  // semidiurnal fallback stands, so the coast still ebbs and floods with no
  // server. The tide pool's "tonight's real tide" is now literally true.
  // TIDE-BEGIN
  var TIDE = null;     // no live NOAA feed on the static door → synthetic tide stands
  // TIDE-END
  const TIDE_LO = -2.0, TIDE_HI = 7.0;   // SF MLLW feet → pool fill 0..1

  // interpolate a cosine tide between the two extremes bracketing `ms`; null if
  // the instant falls outside the baked window (→ caller uses synthTide).
  function realTideAt(ms) {
    const ext = TIDE && TIDE.ext;
    if (!ext || ext.length < 2) return null;
    const s = ms / 1000;
    if (s < ext[0][0] || s > ext[ext.length - 1][0]) return null;
    let i = 1;
    while (i < ext.length && ext[i][0] < s) i++;
    const e0 = ext[i - 1], e1 = ext[i];
    const span = e1[0] - e0[0];
    const frac = span > 0 ? (s - e0[0]) / span : 0;
    const ease = (1 - Math.cos(Math.PI * frac)) / 2;   // hi↔lo is ~sinusoidal
    const feet = e0[1] + (e1[1] - e0[1]) * ease;
    const level = Math.max(0, Math.min(1, (feet - TIDE_LO) / (TIDE_HI - TIDE_LO)));
    const rising = e1[1] > e0[1];
    const state = frac > 0.92 ? (rising ? 'high water' : 'low water')
      : frac < 0.08 ? (rising ? 'low water' : 'high water')
      : rising ? 'tide flooding' : 'tide ebbing';
    return { level, rising, state, real: true };
  }

  // one semidiurnal lunar tide (M2, 12h25m), anchored to the moon's own epoch —
  // a fiction, but a consistent one, and it never needs a server. The fallback
  // whenever real water isn't available: offline, in node, past the baked window.
  function synthTide(when) {
    const t = (when instanceof Date ? when : new Date()).getTime();
    const M2 = 12.4206012 * 3600000;
    const x = (((t - EPOCH) % M2) + M2) % M2 / M2;     // 0 = high water
    const level = 0.5 + 0.5 * Math.cos(TAU * x);
    const rising = x > 0.5;
    const state = level > 0.94 ? 'high water' : level < 0.06 ? 'low water'
      : rising ? 'tide flooding' : 'tide ebbing';
    return { level, rising, state, real: false };
  }

  function tide(when) {
    const d = when instanceof Date ? when : new Date();
    return realTideAt(d.getTime()) || synthTide(d);
  }

  // time of day — the coast's other live coordinate besides the tide.
  // real-clock driven; pass a Date, or an hour 0..24, to preview a moment.
  // rough summer-coast sun: noon peak, ~0 at sunrise 05:45 / sunset 20:15.
  function sky(when) {
    let h;
    if (typeof when === 'number') h = ((when % 24) + 24) % 24;
    else { const d = when instanceof Date ? when : new Date(); h = d.getHours() + d.getMinutes() / 60; }

    const SOLAR_NOON = 13.0, HALF = 7.25;
    const alt = Math.cos(((h - SOLAR_NOON) / HALF) * (Math.PI / 2)); // 1 noon, 0 at ±HALF, <0 night
    const light = Math.max(0, Math.min(1, alt));                     // daylight strength 0..1
    const dark = 1 - light;
    const up = alt > 0;                                             // sun above the horizon
    const rising = h < SOLAR_NOON;                                  // morning side vs evening side
    const tw = Math.max(0, 1 - Math.abs(alt) / 0.28);              // warm band as the sun sits low
    const twilight = tw * tw;

    let phase;
    if (alt < -0.22) phase = 'deep night';
    else if (alt < 0.02) phase = rising ? 'first light' : 'nightfall';
    else if (alt < 0.30) phase = rising ? 'dawn' : 'dusk';
    else if (alt < 0.72) phase = rising ? 'morning' : 'afternoon';
    else phase = 'midday';

    // palette: lerp night → a muted, foggy day, then wash the horizon warm at twilight.
    // never a bright cyan noon — this is a marine-layer coast, day stays soft and blue-grey.
    const lerp = (a, b, t) => a + (b - a) * t;
    const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
    const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    const NIGHT = { top: [5, 7, 15], mid: [10, 17, 40], hor: [16, 32, 74] };
    const DAY = { top: [58, 74, 99], mid: [91, 111, 134], hor: [142, 166, 184] };
    const warm = rising ? [214, 150, 96] : [200, 110, 80];         // dawn gold vs dusk ember
    let top = mix(NIGHT.top, DAY.top, light);
    let mid = mix(NIGHT.mid, DAY.mid, light);
    let hor = mix(NIGHT.hor, DAY.hor, light);
    hor = mix(hor, warm, twilight * 0.6);
    mid = mix(mid, warm, twilight * 0.25);

    return {
      hour: h, alt, light, dark, twilight, rising, phase,
      sun: { up, alt, x: Math.max(0, Math.min(1, (h - (SOLAR_NOON - HALF)) / (2 * HALF))), glow: hex(warm) },
      top: hex(top), mid: hex(mid), horizon: hex(hor),
    };
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

  const Coast = { day, tide, sky, line, moonPhase, crescent, version: 3 };
  if (typeof window !== 'undefined') window.Coast = Coast;
  // let node verify this file too: `node -e "const C=require('/…/coast.js'); …"`
  if (typeof module !== 'undefined' && module.exports) module.exports = Coast;
})();
