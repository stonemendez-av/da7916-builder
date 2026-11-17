// Parses ForeFlight's "Mobile - NavLog" PDF and pairs it with the full NavLog.
// From this file we take the exact MGRS of each point and leg times with seconds.
import { coordFromName, isTocTod } from './navlog.js';
import { mgrsToLatLon, prettyMgrs } from './calc.js';

export function isMobileNavlogText(firstText) {
  return /ForeFlight\s+Mobile\s*-\s*NavLog/i.test(firstText || '');
}

export function parseDuration(s) {
  // "4m01s", "0h11m", "1h02m", "45s", "1h02m30s"
  const m = String(s || '').trim().match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

const MGRS_RE = /^\d{1,2}[C-X][A-Z]{2}\d{2,10}$/i;

export async function parseMobileNavlog(pdfjsLib, data) {
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  let dep = null;
  const legs = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({
      str: i.str.trim(), x: i.transform[4], y: i.transform[5],
    }));
    const hdrHdg = items.find((i) => i.str.toUpperCase() === 'HDG');
    const hdrTot = items.find((i) => i.str.toUpperCase() === 'TOTALS');
    if (!hdrHdg) continue;
    // departure is shown on the header line as "KBKF (DEP)"
    const depTag = items.find((i) => /^\(DEP\)$/i.test(i.str));
    if (depTag && !dep) {
      const name = items.filter((i) => Math.abs(i.y - depTag.y) < 3 && i.x < depTag.x).map((i) => i.str).join('');
      dep = { name, mgrs: MGRS_RE.test(name) ? prettyMgrs(name) : null };
    }
    // each leg row is anchored by its heading (e.g. 186°M)
    const rowAnchors = items.filter((i) => /^\d{1,3}°\s*[MT]$/i.test(i.str) && Math.abs(i.x - hdrHdg.x) < 15 && i.y < hdrHdg.y - 2);
    rowAnchors.sort((a, b) => b.y - a.y);
    for (const a of rowAnchors) {
      const nameParts = items
        .filter((i) => i.x < a.x - 2 && Math.abs(i.y - a.y) <= 12)
        .sort((m, n) => n.y - m.y || m.x - n.x)
        .map((i) => i.str);
      const rawName = nameParts.join('');
      const name = rawName.split('/')[0].trim();
      const legLimit = hdrTot ? hdrTot.x - 2 : Infinity;
      const timeItem = items
        .filter((i) => Math.abs(i.y - a.y) < 3 && i.x > a.x && i.x < legLimit && parseDuration(i.str) != null)
        .sort((m, n) => m.x - n.x)[0];
      const totItem = hdrTot ? items
        .filter((i) => Math.abs(i.y - a.y) < 3 && i.x >= hdrTot.x - 2 && parseDuration(i.str) != null)
        .sort((m, n) => m.x - n.x)[0] : null;
      legs.push({
        totSec: totItem ? parseDuration(totItem.str) : null,
        totExact: !!totItem && /s$/i.test(totItem.str),
        name,
        mgrs: MGRS_RE.test(name) ? prettyMgrs(name) : null,
        hdg: a.str,
        legSec: timeItem ? parseDuration(timeItem.str) : null,
        timeText: timeItem ? timeItem.str : '',
      });
    }
  }
  if (!legs.length) throw new Error('No legs found. Is this a ForeFlight Mobile NavLog PDF?');
  return { dep, legs };
}

function distKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Does a NavLog point name and a Mobile NavLog point name refer to the same place?
function samePoint(navName, mob) {
  const c = coordFromName(navName);
  if (c && mob.mgrs) {
    const m = mgrsToLatLon(mob.mgrs);
    // NavLog names are rounded to the minute: allow up to ~2.5 km
    return !!m && distKm(c, m) < 2.5;
  }
  return String(navName).toUpperCase() === String(mob.name).toUpperCase();
}

// Returns {ok, error, points:[{mgrs, legSec}]} aligned with nav.waypoints
export function pairWithNavlog(nav, mobile) {
  const wps = nav.waypoints;
  const legs = mobile.legs.filter((l) => !isTocTod(l.name));
  if (legs.length !== wps.length - 1) {
    return { ok: false, error: `The Mobile NavLog has ${legs.length} legs but the NavLog has ${wps.length - 1} (after removing TOC/TOD). Make sure both are from the same route.` };
  }
  const bad = [];
  if (mobile.dep && !samePoint(wps[0].name, mobile.dep)) bad.push(`departure (${wps[0].name} vs ${mobile.dep.name})`);
  legs.forEach((l, k) => {
    if (!samePoint(wps[k + 1].name, l)) bad.push(`point ${k + 2} (${wps[k + 1].name} vs ${l.name})`);
  });
  if (bad.length) {
    return { ok: false, error: `The two files don't match at ${bad.join(', ')}. Export both from the same route.` };
  }
  const points = wps.map((w, i) => {
    if (i === 0) return { mgrs: mobile.dep ? mobile.dep.mgrs : null, legSec: null };
    const l = legs[i - 1];
    return { mgrs: l.mgrs, legSec: l.legSec, totSec: l.totSec, totExact: l.totExact };
  });
  return { ok: true, points };
}
