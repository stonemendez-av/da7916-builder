// Coordinate formatting and the 7916 math. No DOM in here.
import { forward, toPoint } from '../lib/mgrs.esm.js';
import { fmtTime } from './navlog.js';

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

// Build every value that goes on the card.
// nav: parsed navlog; inp: user inputs; rows: per-waypoint user inputs (same length as nav.waypoints)
export function computeCard(nav, inp, rows) {
  const burn = num(inp.burn);
  const acFuel = num(inp.aircraftFuel);
  const altFuel = num(inp.altFuel) ?? 0;
  const req = num(inp.req ?? nav.flightFuel);
  const resMin = reserveMinutes(inp.rules);
  const reserve = burn != null ? Math.round((burn * resMin) / 60) : null;
  const bingo = req != null && reserve != null ? req + altFuel + reserve : null;

  let tank = acFuel;
  let cumSec = 0;
  const wps = nav.waypoints.map((w, i) => {
    const r = rows[i] || {};
    const mgrs = prettyMgrs(r.mgrs || '');
    const ll = mgrsToLatLon(mgrs);
    // leg time: seconds from the Mobile NavLog when loaded, else NavLog minutes
    const legSec = i === 0 ? null : (w.legSec ?? (w.legTimeMin != null ? w.legTimeMin * 60 : null));
    let elapsedSec = null;
    if (i > 0) {
      // ForeFlight's running total when it still shows seconds, else add up leg seconds
      if (nav.hasMobile && w.totExact) { cumSec = w.totSec; elapsedSec = cumSec; }
      else if (nav.hasMobile && legSec != null) { cumSec += legSec; elapsedSec = cumSec; }
      else elapsedSec = w.cumTimeMin != null ? w.cumTimeMin * 60 : null;
    }
    let minFuel = null;
    if (i > 0 && burn != null && legSec != null) {
      minFuel = Math.round((burn * legSec) / 3600);
      if (tank != null) tank = tank - minFuel;
    }
    return {
      wp: r.wp || '',
      dtd: r.dtd || '',
      mc: i > 0 && w.mc ? `${String(w.mc).padStart(3, '0')}°M` : '',
      alt: w.alt || '',
      tca: r.tca || '',
      tank: tank != null ? String(tank) : '',
      minFuel: minFuel != null ? String(minFuel) : '',
      ete: i > 0 ? fmtPlus(legSec) : '',
      elapsed: i > 0 ? fmtPlus(elapsedSec) : '',
      legDist: w.legDist || '',
      rem: w.remDist || '',
      ias: r.ias || '',
      gs: w.gs || '',
      mgrs,
      latlong: ll ? fmtLatLon(ll.lat, ll.lon) : '',
      remarks: r.remarks || '',
      clock: '',
      _valid: !!ll,
    };
  });

  const routeMgrs = wps.slice(1, -1).map((w) => w.mgrs).filter(Boolean);

  return {
    operation: inp.operation || '',
    route: inp.routeText != null ? inp.routeText : routeMgrs.join(' - '),
    aircraftFuel: acFuel != null ? String(acFuel) : '',
    req: req != null ? String(req) : '',
    burn: burn != null ? String(burn) : '',
    bingo: bingo != null ? String(bingo) : '',
    reserve,
    reserveMin: resMin,
    from: wps[0] ? wps[0].mgrs : '',
    to: wps.length ? wps[wps.length - 1].mgrs : '',
    timeEnroute: fmtTime(nav.totalEteMin),
    totalDistance: nav.totalDistanceNm != null ? `${nav.totalDistanceNm} NM` : '',
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
