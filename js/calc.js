// Coordinate formatting and the 7916 math. No DOM in here.
import { forward, toPoint } from '../lib/mgrs.esm.js';

// digits: 6, 8 or 10 (total numeric digits in the grid)
export function toMgrs(lat, lon, digits = 8) {
  const raw = forward([lon, lat], digits / 2);
  return prettyMgrs(raw);
}

export function prettyMgrs(s) {
  const c = String(s || '').toUpperCase().replace(/\s+/g, '');
  const m = c.match(/^(\d{1,2}[C-X])([A-Z]{2})(\d*)$/);
  if (!m || m[3].length % 2) return String(s || '').toUpperCase().trim();
  const h = m[3].length / 2;
  return [m[1], m[2], m[3].slice(0, h), m[3].slice(h)].filter(Boolean).join(' ');
}

// Returns {lat, lon} at the center of the grid square, or null if invalid.
export function mgrsToLatLon(s) {
  const c = String(s || '').toUpperCase().replace(/\s+/g, '');
  if (!/^\d{1,2}[C-X][A-Z]{2}(\d\d)*$/.test(c)) return null;
  try {
    const [lon, lat] = toPoint(c);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

// N39°40.00' W104°37.00'
export function fmtLatLon(lat, lon) {
  const part = (v, pos, neg, degW) => {
    const h = v >= 0 ? pos : neg;
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = (a - d) * 60;
    if (+m.toFixed(2) >= 60) { d += 1; m = 0; }
    return `${h}${String(d).padStart(degW, '0')}°${m.toFixed(2).padStart(5, '0')}'`;
  };
  return `${part(lat, 'N', 'S', 2)} ${part(lon, 'E', 'W', 3)}`;
}

// 4+01 for leg/elapsed times; 1+02+30 past an hour
export function fmtPlus(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}+${String(m).padStart(2, '0')}+${ss}` : `${m}+${ss}`;
}

export function reserveMinutes(rules) {
  return rules === 'IFR' ? 30 : 20;
}

// ---------- performance: IAS -> TAS -> GS with the NavLog winds ----------
const toRad = Math.PI / 180;
const norm360 = (a) => ((a % 360) + 360) % 360;
const norm180 = (a) => ((a + 540) % 360) - 180;

// Great-circle distance (NM) and initial true bearing between two {lat, lon}
export function legGeometry(a, b) {
  const φ1 = a.lat * toRad, φ2 = b.lat * toRad, dλ = (b.lon - a.lon) * toRad;
  const h = Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const nm = (2 * 6371.0088 * Math.asin(Math.sqrt(h))) / 1.852;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return { nm, trueBrg: norm360(Math.atan2(y, x) / toRad) };
}

// IAS treated as CAS (no position-error correction). Standard atmosphere, ISA deviation in °C.
export function tasFromIas(ias, pressureAltFt, isaDevC) {
  const ratioP = Math.pow(1 - 6.8756e-6 * pressureAltFt, 5.2559);
  const tIsa = 288.15 - 0.0019812 * pressureAltFt;
  const t = tIsa + (isaDevC || 0);
  const sigma = ratioP * (288.15 / t);
  return ias / Math.sqrt(sigma);
}

export function densityAltitude(pressureAltFt, isaDevC) {
  return pressureAltFt + 118.8 * (isaDevC || 0);
}

// Wind triangle. wind dir is "from", true. Returns ground speed (kt) or null if wind exceeds TAS crosswise.
export function groundSpeed(tas, trueCourse, wind) {
  if (!wind || !wind.spd) return tas;
  const θ = (wind.dir - trueCourse) * toRad;
  const cross = (wind.spd * Math.sin(θ)) / tas;
  if (Math.abs(cross) >= 1) return null;
  const wca = Math.asin(cross);
  return tas * Math.cos(wca) - wind.spd * Math.cos(θ);
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const kmNm = (km, nm) => (km == null || nm == null ? '' : `${Math.round(km)}km/${Math.round(nm)}nm`);

// Build every value that goes on the card.
// nav: parsed navlog (+ Mobile NavLog data); inp: user inputs; rows: per-point user inputs
export function computeCard(nav, inp, rows) {
  const burn = num(inp.burn);
  const acFuel = num(inp.aircraftFuel);
  const altFuel = num(inp.altFuel) ?? 0;
  const taxiFuel = num(inp.taxiFuel) ?? 0;
  const altimeter = num(inp.altimeter) ?? 29.92;
  const spClock = !!inp.spClock && nav.waypoints.length > 2;
  const resMin = reserveMinutes(inp.rules);
  const reserve = burn != null ? Math.round((burn * resMin) / 60) : null;
  const N = nav.waypoints.length;

  // positions: entered grid, else the NavLog's (rounded) coordinate name
  const pos = nav.waypoints.map((w, i) => {
    const g = mgrsToLatLon(prettyMgrs((rows[i] || {}).mgrs || ''));
    return g ? { ...g, exact: true } : w.coord ? { ...w.coord, exact: false } : null;
  });

  // magnetic variation: median of (true bearing - MC) over legs with positions
  const varSamples = [];
  for (let i = 1; i < N; i++) {
    const w = nav.waypoints[i];
    if (!pos[i - 1] || !pos[i] || !w.mc) continue;
    const g = legGeometry(pos[i - 1], pos[i]);
    if (g.nm < 2) continue;
    varSamples.push(norm180(g.trueBrg - +w.mc));
  }
  const magVar = median(varSamples) ?? 0;

  // per-leg timing
  const legs = nav.waypoints.map((w, i) => {
    if (i === 0) return {};
    const r = rows[i] || {};
    const ffSec = w.legSec ?? (w.legTimeMin != null ? w.legTimeMin * 60 : null);
    const ffGs = w.gs || '';
    const ias = num(r.ias);
    let distNm = null, exactDist = false;
    if (pos[i - 1] && pos[i] && pos[i - 1].exact && pos[i].exact) { distNm = legGeometry(pos[i - 1], pos[i]).nm; exactDist = true; }
    else if (w.legKm != null) distNm = w.legKm / 1.852;
    else if (w.legDist !== '' && w.legDist != null) distNm = +w.legDist;
    const altFt = num(w.calcAlt ?? w.alt);
    let tas = null, gs = null, sec = null, da = null;
    if (ias && altFt != null && w.mc) {
      const pa = altFt + (29.92 - altimeter) * 1000;
      tas = tasFromIas(ias, pa, w.isa);
      da = densityAltitude(pa, w.isa);
      gs = groundSpeed(tas, norm360(+w.mc + magVar), w.wind);
      if (gs && gs > 0 && distNm != null) sec = (distNm / gs) * 3600;
    }
    const computed = sec != null;
    return { ffSec, ffGs, tas, da, gs, sec: computed ? sec : ffSec, computed, exactDist, distNm };
  });

  // elapsed / running time (optionally starting the clock at the SP = second point)
  let cum = 0;
  const elapsed = legs.map((l, i) => {
    if (i === 0) return null;
    if (l.sec == null) return null;
    if (spClock && i === 1) return 0;
    cum += l.sec;
    return cum;
  });
  const flightSec = legs.slice(1).reduce((a, l) => (l.sec == null || a == null ? null : a + l.sec), 0);
  const enrouteSec = spClock ? (flightSec == null || legs[1].sec == null ? null : flightSec - legs[1].sec) : flightSec;

  // Req from your burn over the whole flight (+ start/taxi)
  const req = burn != null && flightSec != null ? Math.round((burn * flightSec) / 3600 + taxiFuel) : null;
  const bingo = req != null && reserve != null ? req + altFuel + reserve : null;

  // distances: NM from NavLog, km from Mobile NavLog (else converted)
  const totKmFinal = nav.waypoints[N - 1]?.totKm ?? (nav.totalDistanceNm != null ? nav.totalDistanceNm * 1.852 : null);
  let tank = acFuel;
  const wps = nav.waypoints.map((w, i) => {
    const r = rows[i] || {};
    const l = legs[i];
    const mgrs = prettyMgrs(r.mgrs || '');
    const ll = mgrsToLatLon(mgrs);
    let minFuel = null;
    if (i > 0 && burn != null && l.sec != null) {
      minFuel = Math.round((burn * l.sec) / 3600);
      if (tank != null) tank = tank - minFuel;
    }
    const legNm = w.legDist === '' || w.legDist == null ? null : +w.legDist;
    const remNm = w.remDist === '' || w.remDist == null ? (i === N - 1 ? 0 : null) : +w.remDist;
    const legKm = w.legKm ?? (legNm != null ? legNm * 1.852 : null);
    const remKm = w.totKm != null && totKmFinal != null ? totKmFinal - w.totKm
      : i === 0 && totKmFinal != null ? totKmFinal
        : remNm != null ? remNm * 1.852 : null;
    return {
      wp: r.wp || '',
      dtd: r.dtd || '',
      mc: i > 0 && w.mc ? `${String(w.mc).padStart(3, '0')}°M` : '',
      alt: w.alt || '',
      tca: r.tca || '',
      tank: tank != null ? String(tank) : '',
      minFuel: minFuel != null ? String(minFuel) : '',
      ete: i > 0 ? fmtPlus(l.sec) : '',
      elapsed: i > 0 ? fmtPlus(elapsed[i]) : '',
      legDist: i > 0 ? kmNm(legKm, legNm) : '',
      rem: i === N - 1 ? '' : kmNm(remKm, remNm),
      ias: r.ias || '',
      gs: i > 0 ? (l.computed ? String(Math.round(l.gs)) : String(l.ffGs || '')) : '',
      mgrs,
      latlong: ll ? fmtLatLon(ll.lat, ll.lon) : '',
      remarks: r.remarks || '',
      clock: '',
      _valid: !!ll,
      _leg: l,
    };
  });

  const routeMgrs = wps.slice(1, -1).map((w) => w.mgrs).filter(Boolean);

  return {
    operation: inp.operation || '',
    route: inp.routeText != null ? inp.routeText : routeMgrs.join(' - '),
    aircraftFuel: acFuel != null ? String(acFuel) : '',
    req: req != null ? String(req) : '',
    reqForeFlight: nav.flightFuel,
    taxiFuel,
    flightSec,
    burn: burn != null ? String(burn) : '',
    bingo: bingo != null ? String(bingo) : '',
    reserve,
    reserveMin: resMin,
    magVar,
    allComputed: legs.slice(1).every((l) => l.computed),
    from: wps[0] ? wps[0].mgrs : '',
    to: wps.length ? wps[wps.length - 1].mgrs : '',
    timeEnroute: fmtPlus(enrouteSec),
    totalDistance: kmNm(totKmFinal, nav.totalDistanceNm),
    footerRoute: inp.footerRoute || '',
    footerV: inp.footerV || '',
    waypoints: wps,
  };
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}
