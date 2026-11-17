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
  const wps = nav.waypoints.map((w, i) => {
    const r = rows[i] || {};
    const mgrs = prettyMgrs(r.mgrs || '');
    const ll = mgrsToLatLon(mgrs);
    let minFuel = null;
    if (i > 0 && burn != null && w.legTimeMin != null) {
      minFuel = Math.round((burn * w.legTimeMin) / 60);
      if (tank != null) tank = tank - minFuel;
    }
    return {
      wp: r.wp || '',
      dtd: r.dtd || '',
      mc: i > 0 && w.mc ? String(w.mc).padStart(3, '0') : '',
      alt: w.alt || '',
      tca: i > 0 && w.hdg ? String(w.hdg).padStart(3, '0') : '',
      tank: tank != null ? String(tank) : '',
      minFuel: minFuel != null ? String(minFuel) : '',
      ete: i > 0 ? fmtTime(w.legTimeMin) : '',
      elapsed: i > 0 ? fmtTime(w.cumTimeMin) : '',
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
