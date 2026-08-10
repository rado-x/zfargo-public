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
 *   Coast.fog(when?)      → the marine layer ("Karl"), the coast's weather:
 *     { density 0..1, name ('clear'…'socked in'), burning, onshore, season, live }
 *     At *now*, real SF (Ocean Beach) conditions when a fresh bake exists
 *     (rado-coast-weather, live:true); otherwise a deterministic model — season
 *     (summer peak) × diurnal (burns off midday) × wind (onshore carries it in).
 *     Pass a Date or hour 0..24 to preview a moment (always the seeded model).
 *   Coast.glow(when?)     → bioluminescence, "the sea sparkle": the bay blooming
 *     cold blue-green at the surf on a warm, dark, moonless late-summer night.
 *     { intensity 0..1, potential, visible, stir, active, name ('dark water'…
 *     'a blaze of sea-fire') }. Rare and seeded — a bloom you have to catch.
 *   Coast.meteors(when?)  → the annual meteor showers, in their real radiants:
 *     { active, visible, rate (meteors/hr now), perMin, showers:[{code,name,ra,
 *     dec,zhr,alt,az,up,rate}], best, strongest, name ('the Perseids are
 *     falling'…'no shower tonight') }. Fixed catalog (Quadrantids…Ursids) — a
 *     Gaussian around each peak, cut by daylight, moonlight and radiant altitude.
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

  // the real baked table itself — extremes (epoch s, feet MLLW), station, and
  // the fill datums — for anything that wants to *read* the tide, not just its
  // 0..1 level: the tide clock at /tide/ draws its curve straight off this.
  // Returns null when no real bake is present (offline node / rotted marker),
  // so a caller can honestly say "no real water, only the model".
  function tideTable() {
    const ext = TIDE && TIDE.ext;
    if (!ext || ext.length < 2) return null;
    return { station: TIDE.station, updated: TIDE.updated, ext,
             lo: TIDE_LO, hi: TIDE_HI };
  }

  // the exact predicted height in feet (MLLW) at an instant, cosine-interpolated
  // between the bracketing extremes; null outside the baked window.
  function tideFeet(ms) {
    const ext = TIDE && TIDE.ext;
    if (!ext || ext.length < 2) return null;
    const s = ms / 1000;
    if (s < ext[0][0] || s > ext[ext.length - 1][0]) return null;
    let i = 1;
    while (i < ext.length && ext[i][0] < s) i++;
    const e0 = ext[i - 1], e1 = ext[i];
    const span = e1[0] - e0[0];
    const frac = span > 0 ? (s - e0[0]) / span : 0;
    const ease = (1 - Math.cos(Math.PI * frac)) / 2;
    return e0[1] + (e1[1] - e0[1]) * ease;
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

  // day-of-year 1..366 (local) — feeds the fog's season.
  function doy(d) {
    return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  }

  // FOG — the marine layer, "Karl" in the local tongue. San Francisco's whole
  // signature, and the one weather the coast never modelled: the summer fog that
  // pours through the Golden Gate at evening and burns off by noon. Like the moon
  // and wind — and unlike the baked NOAA tide — it needs no server: a deterministic
  // model of three real behaviours multiplied, plus a seeded day-to-day modifier.
  //   · season  — the marine layer peaks in high summer (~mid-July, day 196) and
  //               thins to the occasional winter fog. A cosine on the day of year.
  //   · diurnal — thickest overnight (peak ~3am), burns off through the late
  //               morning, clearest mid-afternoon, then rolls back in by evening.
  //   · wind    — an onshore (west) wind carries the marine air in; an offshore
  //               (east) wind — the hot, clear Diablo days — scours it out.
  // fog(when): when = a Date (full info), an hour 0..24 (today, that hour), or
  // nothing (now). Returns { density 0..1, name, burning, onshore, season, live }.
  //
  // …but the coast can also just LOOK. The live marine layer — real SF (Ocean
  // Beach, 37.79/-122.48) conditions baked below by rado-coast-weather
  // (coast-weather.timer, ~30min): visibility, low cloud, humidity, WMO code
  // → one density. Same "real when we can measure it, seeded when we can't"
  // contract as the NOAA tide and the machine's breath-wind. It overrides the
  // model ONLY at the present moment; any other instant (a ?t= preview, a past
  // date), an empty/stale block, or an offline node → the deterministic Karl
  // above stands, so the coast still fogs with no server. When it IS live, the
  // fog you see is the fog outside, and the bridge foghorns sound for real
  // weather.
  // FOG-BEGIN
  var FOG = {station: "SF/Ocean Beach", updated: 1786360788, density: 0.9889, vis: 100, rh: 99, cloudLow: 100, code: 45, name: 'socked in'};
  // FOG-END
  const FOG_TTL = 5400;      // s (90min) — an older bake falls back to the model
  const FOG_NOW = 2700000;   // ms (45min) — only an instant this close to now is "live"
  function liveFog(targetMs) {
    if (!FOG || !FOG.updated || typeof FOG.density !== 'number') return null;
    if (Math.abs(Date.now() - targetMs) > FOG_NOW) return null;             // not ~now
    if (Math.abs(Date.now() / 1000 - FOG.updated) > FOG_TTL) return null;   // stale bake
    return Math.max(0, Math.min(1, FOG.density));
  }
  function fog(when) {
    const now = new Date();
    let d, h;
    if (typeof when === 'number') { d = now; h = ((when % 24) + 24) % 24; }
    else { d = when instanceof Date ? when : now; h = d.getHours() + d.getMinutes() / 60; }
    const dstr = fmt(d);
    const season = 0.32 + 0.68 * (0.5 + 0.5 * Math.cos(TAU * (doy(d) - 196) / 365.25));
    const diurnal = 0.5 + 0.5 * Math.cos(TAU * (h - 3) / 24);  // 1 at 3am → 0 at 3pm
    const c = day(dstr);
    const onshore = c.wind.dir > 0;                           // west = marine air
    const windFactor = onshore ? 1 : 0.22;                   // offshore Diablo → clear
    const dayMod = 0.55 + 0.75 * c.rng('fog')();             // 0.55..1.30, seeded to the date
    let density = season * diurnal * windFactor * dayMod;
    density = Math.max(0, Math.min(1, density));
    // real conditions override the seeded model at the present moment, when we
    // have a fresh bake; the target instant is this call's own time (today+h for
    // an hour arg), so previews and past dates keep the deterministic Karl.
    const targetMs = (typeof when === 'number')
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + h * 3600000
      : d.getTime();
    const lf = liveFog(targetMs);
    const live = lf !== null;
    if (live) density = lf;
    const burning = h > 8.5 && h < 15 && density > 0.12;     // the late-morning burn-off
    const name = density < 0.07 ? 'clear'
      : density < 0.24 ? 'a high haze'
      : density < 0.48 ? 'thin fog'
      : density < 0.74 ? 'low fog'
      : 'socked in';
    return { density, name, burning, onshore, season, live };
  }

  // BIOLUMINESCENCE — "the sea sparkle". On warm late-summer nights the bay can
  // bloom with dinoflagellates (Noctiluca) and every breaking wave lights a cold
  // blue-green. Rare, and gone by dawn or by moonrise — you have to be there.
  // Like the fog it needs no server: a bloom that comes and goes over a few
  // nights, only ever visible in the dark, and only where the water is stirred.
  //   · season  — blooms cluster in the warm water of late summer / early autumn
  //               (~early September, day 250), almost never in winter.
  //   · bloom   — a slow seeded envelope over ~3-night windows: most windows are
  //               dark water, a few light up. The "is the bay glowing at all
  //               tonight" term, fixed for the date.
  //   · visible — only in the dark, and a bright moon washes it out.
  //   · stir    — it flashes where the water breaks: wind chop and a moving tide.
  // glow(when): Date | hour 0..24 | nothing (now).
  // Returns { intensity 0..1, potential, visible, stir, active, name }.
  function glow(when) {
    const now = new Date();
    let d;
    if (typeof when === 'number') { d = now; }
    else { d = when instanceof Date ? when : now; }
    const dstr = fmt(d);
    const c = day(dstr);
    // season: warm-water peak ~day 250 (early Sept), sharpened so winter ≈ 0
    const season = Math.max(0, Math.cos(TAU * (doy(d) - 250) / 365.25));
    const seasonN = Math.pow(season, 1.5);
    // bloom envelope — seeded per ~3-night window; most windows stay dark water
    const win = Math.floor(doy(d) / 3);
    const bloom = Math.max(0, (c.rng('bloom:' + win)() - 0.62) / 0.38);
    const potential = seasonN * bloom;                 // does the bay bloom, this date
    // visibility — needs darkness, killed by a bright moon
    const s = sky(when);
    const moonWash = 1 - 0.75 * c.moon.illum;
    const visible = Math.max(0, s.dark) * Math.max(0.1, moonWash);
    // stir — where the water breaks: wind chop × a moving (non-slack) tide
    const td = tide(when);
    const moving = 1 - Math.abs(td.level - 0.5) * 0.6; // strongest mid-tide
    const stir = Math.min(1, 0.4 + 0.6 * c.wind.speed) * (0.6 + 0.4 * moving);
    const intensity = Math.max(0, Math.min(1, potential * visible));
    const active = intensity > 0.06;
    const name = !active ? 'dark water'
      : intensity < 0.22 ? 'a faint sparkle'
      : intensity < 0.5 ? 'the sea sparks'
      : intensity < 0.75 ? 'the surf alight'
      : 'a blaze of sea-fire';
    return { intensity, potential, visible, stir, active, name };
  }

  // where to put the shadow disc so the lit part matches illum.
  // draw: dark circle of ~0.98r at (x + off*r, y). waxing lights the right edge.
  function crescent(moon) {
    return (moon.waxing ? -1 : 1) * moon.illum * 2.05;
  }

  // METEORS — the sky's one honest annual rhythm the coast never kept. Unlike
  // the tide (a NOAA table that can rot) these need no server: the major showers
  // return at the same solar longitude every year — fixed radiants, fixed active
  // windows, fixed peak rates. A shower's strength on a date is a Gaussian around
  // its peak; what you'd actually SEE is that idealised rate cut three ways —
  // by daylight, by a bright moon, and by how high the radiant has climbed
  // (nothing falls from a radiant below the horizon). Deterministic, offline,
  // the same on every page — kin to the fog and the sea-sparkle.
  //   Perseids peak ~Aug 12–13 (ZHR ~100); through early August they share the
  //   sky with the fading Delta Aquariids — so the coast should show BOTH.
  // Radiants are J2000 equatorial (deg); altitude is computed for the coast's
  // own latitude, real sidereal time, no precession (arcmin-scale, plenty for
  // "is it up and how high"). meteors(when): Date | hour 0..24 | nothing (now).
  const LAT = 37.77, LON = -122.42;   // the coast's own spot (SF), as the tide is
  // [code, name, radiant RA°, Dec°, peak {mo,dy}, peak ZHR, sigma days, window ±days]
  const SHOWERS = [
    ['QUA', 'the Quadrantids',      230, +49.5, [1, 3],   110, 0.6, 7],
    ['LYR', 'the Lyrids',           271, +34,   [4, 22],  18,  1.4, 5],
    ['ETA', 'the Eta Aquariids',    338, -1,    [5, 6],   50,  4.5, 21],
    ['SDA', 'the Delta Aquariids',  340, -16.5, [7, 30],  25,  6,   22],
    ['PER', 'the Perseids',         48,  +58,   [8, 12.5],100, 3,   19],
    ['ORI', 'the Orionids',         95,  +16,   [10, 21], 20,  4,   18],
    ['LEO', 'the Leonids',          152, +22,   [11, 17], 15,  1.6, 12],
    ['GEM', 'the Geminids',         112, +33,   [12, 14], 120, 2.4, 8],
    ['URS', 'the Ursids',           217, +76,   [12, 22], 10,  1,   6],
  ];
  // Greenwich mean sidereal time (deg) — standard IAU low-precision formula.
  function gmstDeg(ms) {
    const d = (ms - Date.UTC(2000, 0, 1, 12)) / 86400000;   // days from J2000.0
    return ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360;
  }
  // radiant altitude & azimuth (deg, az from north) at the coast, for an instant
  function radiantAltAz(ra, dec, ms) {
    const rad = Math.PI / 180;
    const lst = (gmstDeg(ms) + LON) % 360;
    const H = (lst - ra) * rad;                              // hour angle
    const dc = dec * rad, la = LAT * rad;
    const alt = Math.asin(Math.sin(dc) * Math.sin(la) + Math.cos(dc) * Math.cos(la) * Math.cos(H));
    let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(la) - Math.tan(dc) * Math.cos(la));
    az = (az / rad + 180) % 360;
    return { alt: alt / rad, az };
  }
  // signed day-difference from a {mo,dy} peak to date d, wrapping the year end
  function daysToPeak(d, peak) {
    const yr = d.getFullYear();
    let pk = (new Date(yr, peak[0] - 1, 1).getTime()) / 86400000 + (peak[1] - 1);
    const dd = d.getTime() / 86400000;
    let diff = dd - pk;
    if (diff > 182.6) diff -= 365.25;                        // Dec date vs Jan peak
    if (diff < -182.6) diff += 365.25;                       // Jan date vs Dec peak
    return diff;
  }
  function meteors(when) {
    const now = new Date();
    let d, ms;
    if (typeof when === 'number') { d = now; ms = new Date(now).setHours(Math.floor(when), (when % 1) * 60, 0, 0); }
    else { d = when instanceof Date ? when : now; ms = d.getTime(); }
    const c = day(fmt(d));
    const s = sky(when);
    const moonWash = 1 - 0.6 * c.moon.illum;                 // a full moon cuts ~60%
    const dark = Math.max(0, s.dark);                        // 0 by day, 1 deep night
    const active = [];
    for (const sh of SHOWERS) {
      const [code, name, ra, dec, peak, zhrPk, sigma, win] = sh;
      const dp = daysToPeak(d, peak);
      if (Math.abs(dp) > win) continue;                      // outside the active window
      const zhr = zhrPk * Math.exp(-0.5 * (dp / sigma) * (dp / sigma));
      if (zhr < 0.5) continue;
      const aa = radiantAltAz(ra, dec, ms);
      // observed hourly rate: idealised ZHR scaled by radiant height, darkness, moon
      const up = aa.alt > 0 ? Math.sin(aa.alt * Math.PI / 180) : 0;
      const rate = zhr * up * dark * moonWash;
      active.push({
        code, name, ra, dec, peak, zhrPeak: zhrPk,
        zhr,                                                 // today's peak-shaped ZHR
        daysToPeak: dp,
        alt: aa.alt, az: aa.az, up: aa.alt > 0,
        rate,                                                // meteors/hour you might catch, now
      });
    }
    active.sort((a, b) => (b.rate - a.rate) || (b.zhr - a.zhr));
    const totalRate = active.reduce((s, m) => s + m.rate, 0);
    const anyActive = active.length > 0;                     // a shower is running (may be daytime/low)
    const best = active[0] || null;
    // strongest by ZHR regardless of sky — for "the Perseids are active (by day)"
    const strongest = active.slice().sort((a, b) => b.zhr - a.zhr)[0] || null;
    const visible = totalRate > 0.6;                         // worth looking up
    let name;
    if (!anyActive) name = 'no shower tonight';
    else if (!visible) {
      name = dark < 0.05 ? strongest.name + ' — active, but it is daylight'
        : (best && best.up) ? strongest.name + ' — radiant still low'
        : strongest.name + ' — radiant below the horizon';
    } else {
      const r = totalRate;
      const lead = best.name;
      name = r > 40 ? lead + ' in full fall'
        : r > 12 ? lead + ' are falling'
        : r > 4 ? 'a scatter of ' + lead.replace(/^the /, '')
        : 'a few ' + lead.replace(/^the /, '');
    }
    return {
      active: anyActive, visible, showers: active, best, strongest,
      rate: totalRate, perMin: totalRate / 60,
      dark, moonWash, name,
    };
  }

  function line(dstr) {
    const c = day(dstr);
    const parts = [c.moon.name];
    parts.push(c.wind.name + (c.wind.speed < 0.06 ? '' : ' off the ' + c.wind.from));
    if (!dstr || dstr === fmt(new Date())) {
      parts.push(tide().state);
      const f = fog();
      if (f.density > 0.4) parts.push(f.burning ? f.name + ', burning off' : f.name);
      const gl = glow();
      if (gl.intensity > 0.25) parts.push(gl.name);
      const mt = meteors();
      if (mt.visible && mt.rate > 8) parts.push(mt.name);
    }
    if (c.spring > 0.85) parts.push('spring tide');
    return parts.join(' · ');
  }

  const Coast = { day, tide, tideTable, tideFeet, sky, fog, glow, meteors, line, moonPhase, crescent, version: 7 };
  if (typeof window !== 'undefined') window.Coast = Coast;
  // let node verify this file too: `node -e "const C=require('/…/coast.js'); …"`
  if (typeof module !== 'undefined' && module.exports) module.exports = Coast;
})();
