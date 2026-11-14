// Parses a ForeFlight NavLog PDF into structured data using pdf.js text positions.
// Pure module: pass in the pdf.js library so it runs in the browser and in Node tests.

const LINE_TOL = 2.5; // points; items closer than this vertically share a line

async function pageLines(pdf, pageNo) {
  const page = await pdf.getPage(pageNo);
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({
      str: it.str.trim(),
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      cx: it.transform[4] + it.width / 2,
      page: pageNo,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= LINE_TOL) last.items.push(it);
    else lines.push({ y: it.y, page: pageNo, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str).join(' ');
  }
  return lines;
}

const clean = (s) => (s == null || s === '-' || s === '' ? '' : String(s).trim());

export function parseTime(s) {
  // "0:24", "1:05", "0h50m", "1h05m"
  s = clean(s);
  if (!s) return null;
  let m = s.match(/^(\d+):(\d{2})$/);
  if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?$/i);
  if (m && (m[1] || m[2])) return (+m[1] || 0) * 60 + (+m[2] || 0);
  return null;
}

export function fmtTime(min) {
  if (min == null || isNaN(min)) return '';
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

// ForeFlight coordinate waypoint names, e.g. 3940N10437W (DDMM), 394012N1043712W (DDMMSS),
// also tolerates decimal minutes like 3940.5N10437.2W.
export function coordFromName(name) {
  const s = String(name).toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{2})(\d{2}(?:\.\d+)?)(\d{2}(?:\.\d+)?)?([NS])\/?(\d{3})(\d{2}(?:\.\d+)?)(\d{2}(?:\.\d+)?)?([EW])$/);
  if (!m) return null;
  let lat = +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
  let lon = +m[5] + +m[6] / 60 + (m[7] ? +m[7] / 3600 : 0);
  if (m[4] === 'S') lat = -lat;
  if (m[8] === 'W') lon = -lon;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function findHeader(lines) {
  // Returns {index, columns:[{key,cx,x}]} for the nav table header line.
  for (let i = 0; i < lines.length; i++) {
    const strs = lines[i].items.map((it) => it.str.toUpperCase());
    if (!strs.includes('WAYPOINT') || !strs.includes('CRS')) continue;
    // group headers sit on the line just above (MAG, WIND, SPD KT, DIST NM, TIME, FUEL ...)
    const groups = i > 0 && lines[i - 1].y - lines[i].y < 20 ? lines[i - 1].items : [];
    const columns = lines[i].items.map((it) => {
      let key = it.str.toUpperCase();
      if (key === 'LEG' || key === 'REM') {
        let best = null;
        for (const g of groups) {
          const d = Math.abs(g.cx - it.cx);
          if (!best || d < best.d) best = { d, g };
        }
        const prefix = best ? best.g.str.toUpperCase().split(/\s+/)[0] : 'DIST';
        key = `${prefix}_${key}`;
      }
      return { key, cx: it.cx, x: it.x };
    });
    return { index: i, columns };
  }
  return null;
}

function parseTable(lines, header) {
  const cols = header.columns;
  const airway = cols.find((c) => c.key === 'AIRWAY') || cols[1];
  const wpCol = cols.find((c) => c.key === 'WAYPOINT');
  const rows = [];
  for (let i = header.index + 1; i < lines.length; i++) {
    const line = lines[i];
    const first = line.items[0];
    if (/WINDS ALOFT|SUMMARY|^FL \d/i.test(line.text)) break;
    if (Math.abs(first.x - wpCol.x) > 6 || line.items.length < 6) {
      if (rows.length) break;
      continue;
    }
    const row = { _raw: line.text };
    const nameParts = [];
    for (const it of line.items) {
      if (it.x < airway.x - 2) { nameParts.push(it.str); continue; }
      let best = null;
      for (const c of cols) {
        if (c.key === 'WAYPOINT') continue;
        const d = Math.abs(c.cx - it.cx);
        if (!best || d < best.d) best = { d, c };
      }
      const k = best.c.key;
      row[k] = row[k] ? row[k] + ' ' + it.str : it.str;
    }
    row.WAYPOINT = nameParts.join(' ');
    rows.push(row);
  }
  return rows;
}

function valueRightOf(lines, label, startIdx = 0) {
  for (let i = startIdx; i < lines.length; i++) {
    const it = lines[i].items;
    if (it[0].str.toUpperCase() === label.toUpperCase() && it.length > 1) {
      return it.slice(1).map((x) => x.str).join(' ');
    }
  }
  return null;
}

function valueBelow(lines, label) {
  for (let i = 0; i < lines.length - 1; i++) {
    const hit = lines[i].items.find((it) => it.str.toLowerCase() === label.toLowerCase());
    if (!hit) continue;
    const next = lines[i + 1];
    let best = null;
    for (const it of next.items) {
      const d = Math.abs(it.x - hit.x);
      if (!best || d < best.d) best = { d, it };
    }
    if (best && best.d < 15) return best.it.str;
  }
  return null;
}

export async function parseNavlog(pdfjsLib, data) {
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  let all = [];
  for (let p = 1; p <= pdf.numPages; p++) all = all.concat(await pageLines(pdf, p));

  const title = all[0] ? all[0].items[0].str : '';
  const rulesMatch = title.match(/\b(IFR|VFR)\b/i) || (all[0] ? all[0].text.match(/\b(IFR|VFR)\b/i) : null);

  // Nav table: may continue across pages with a repeated header
  let legs = [];
  let start = 0;
  while (true) {
    const rest = all.slice(start);
    const h = findHeader(rest);
    if (!h) break;
    const rows = parseTable(rest, h);
    legs = legs.concat(rows);
    start += h.index + 1 + Math.max(rows.length, 1);
  }
  if (!legs.length) throw new Error('Could not find the waypoint table. Is this a ForeFlight NavLog PDF?');

  // Summary & Times section (fallback: top summary strip)
  const sIdx = all.findIndex((l) => /SUMMARY\s*&\s*TIMES/i.test(l.text));
  const sumDist = sIdx >= 0 ? valueRightOf(all, 'Distance', sIdx) : null;
  const sumEte = sIdx >= 0 ? valueRightOf(all, 'ETE', sIdx) : null;
  const dist = sumDist || valueBelow(all, 'Distance');
  const ete = sumEte || valueBelow(all, 'ETE');
  const flightFuel = valueBelow(all, 'Flight Fuel');
  const routeLineIdx = all.findIndex((l) => l.items.length === 1 && l.items[0].str === 'Route');
  const route = routeLineIdx >= 0 && all[routeLineIdx + 1] ? all[routeLineIdx + 1].text : '';
  const asMatch = title.match(/\bas\s+(\S+)/i);

  const num = (s) => {
    const m = String(s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? +m[0] : null;
  };

  return {
    title,
    callsign: asMatch ? asMatch[1] : '',
    flightRules: rulesMatch ? rulesMatch[1].toUpperCase() : null,
    totalDistanceNm: num(dist),
    totalEteMin: parseTime(ete),
    flightFuel: num(flightFuel),
    flightFuelUnits: /kg/i.test(flightFuel || '') ? 'kg' : /gal/i.test(flightFuel || '') ? 'gal' : 'lbs',
    routeNames: route ? route.split(/\s+/) : [],
    waypoints: legs.map((r) => ({
      name: r.WAYPOINT,
      coord: coordFromName(r.WAYPOINT),
      mc: clean(r.CRS),
      hdg: clean(r.HDG),
      alt: clean(r.ALT),
      gs: clean(r.GS),
      legDist: clean(r.DIST_LEG),
      remDist: clean(r.DIST_REM),
      legTimeMin: parseTime(r.TIME_LEG),
      cumTimeMin: parseTime(r.ETE),
      raw: r,
    })),
  };
}
