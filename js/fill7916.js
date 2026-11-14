// Fills the official fillable DA 7916 with pdf-lib.
// Up to 22 waypoints fit on the 2-page form (10 + 12) and stay editable.
// Longer routes add continuation pages (copies of page 2); those cards are flattened.
import { HEADER, BLOCKS } from './fieldmap.js';

const P1 = BLOCKS[0].length; // 10
const P2 = BLOCKS[1].length; // 12

const COLS = {
  WP: 'wp', DTD_ID: 'dtd', MC: 'mc', ALT: 'alt', TCA: 'tca', Tank_Fuel: 'tank',
  Minimum_Fuel: 'minFuel', ETE: 'ete', Elasped: 'elapsed', Leg_Dist: 'legDist', REM: 'rem',
  IAS: 'ias', GS: 'gs', MGRS: 'mgrs', Lat_Long: 'latlong', Description_Remarks: 'remarks', Clock: 'clock',
};

function setFit(form, font, name, text, { max = 9, min = 5, multiline = false } = {}) {
  let field;
  try { field = form.getTextField(name); } catch { return; }
  const value = text == null ? '' : String(text);
  const widget = field.acroField.getWidgets()[0];
  const rect = widget.getRectangle();
  if (multiline) field.enableMultiline(); else field.disableMultiline();
  let size = max;
  if (value) {
    if (multiline) {
      // shrink until the text wraps into the available lines
      while (size > min) {
        const lineH = size * 1.15;
        const lines = Math.max(1, Math.floor((rect.height - 2) / lineH));
        const w = font.widthOfTextAtSize(value, size);
        if (w <= (rect.width - 4) * lines * 0.92) break;
        size -= 0.5;
      }
    } else {
      const w1 = font.widthOfTextAtSize(value, 1);
      size = Math.max(min, Math.min(max, (rect.width - 4) / w1, rect.height - 1.5));
    }
  }
  field.setText(value);
  field.setFontSize(size);
}

function fillHeader(form, font, card) {
  const H = HEADER.page1;
  setFit(form, font, H.Operation[0], card.operation, { max: 9, multiline: true });
  setFit(form, font, H.RTE[0], card.route, { max: 9, multiline: true });
  setFit(form, font, H.Aircraft_Fuel[0], card.aircraftFuel);
  setFit(form, font, H.REQ[0], card.req);
  setFit(form, font, H.BURN[0], card.burn);
  setFit(form, font, H.BINGO[0], card.bingo);
  setFit(form, font, H.From[0], card.from);
  setFit(form, font, H.To[0], card.to);
  setFit(form, font, H.Time_Enroute[0], card.timeEnroute);
  setFit(form, font, H.Total_Distance[0], card.totalDistance);
}

function fillFooter(form, font, pageKey, card, n, of) {
  const H = HEADER[pageKey];
  setFit(form, font, H.Route[0], card.footerRoute);
  setFit(form, font, H.V[0], card.footerV);
  setFit(form, font, H.Number[0], String(n));
  setFit(form, font, H.OF[0], String(of));
}

function fillBlocks(form, font, blocks, wps) {
  blocks.forEach((b, i) => {
    const w = wps[i] || {};
    for (const [col, key] of Object.entries(COLS)) {
      const opt = col === 'Description_Remarks' ? { max: 9 } : {};
      setFit(form, font, b[col], w[key] || '', opt);
    }
  });
}

function stripXfa(PDFLib, pdf, form) {
  try { form.deleteXFA(); } catch { /* not present */ }
  // Usage-rights signature becomes invalid once we edit; remove it so readers don't complain.
  try { pdf.catalog.delete(PDFLib.PDFName.of('Perms')); } catch { /* ignore */ }
}

async function loadFilled(PDFLib, templateBytes, card, page1Wps, page2Wps, pageNos, total) {
  const pdf = await PDFLib.PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  stripXfa(PDFLib, pdf, form);
  const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  fillHeader(form, font, card);
  fillBlocks(form, font, BLOCKS[0], page1Wps);
  fillBlocks(form, font, BLOCKS[1], page2Wps);
  fillFooter(form, font, 'page1', card, pageNos[0], total);
  fillFooter(form, font, 'page2', card, pageNos[1], total);
  form.updateFieldAppearances(font);
  return { pdf, form };
}

export async function build7916(PDFLib, templateBytes, card, { flatten = false } = {}) {
  const wps = card.waypoints;
  const p1 = wps.slice(0, P1);
  const rest = wps.slice(P1);
  const contChunks = [];
  for (let i = 0; i < Math.max(rest.length, 1); i += P2) contChunks.push(rest.slice(i, i + P2));
  const totalPages = 1 + contChunks.length;

  if (contChunks.length === 1) {
    const { pdf, form } = await loadFilled(PDFLib, templateBytes, card, p1, contChunks[0], [1, 2], 2);
    if (flatten) form.flatten();
    return { bytes: await pdf.save(), pages: 2, flattened: flatten };
  }

  // Overflow: flatten each filled copy and stitch pages together.
  const out = await PDFLib.PDFDocument.create();
  for (let c = 0; c < contChunks.length; c++) {
    const { pdf, form } = await loadFilled(
      PDFLib, templateBytes, card, p1, contChunks[c], [1, c + 2], totalPages);
    form.flatten();
    const idx = c === 0 ? [0, 1] : [1];
    const pages = await out.copyPages(pdf, idx);
    pages.forEach((p) => out.addPage(p));
  }
  return { bytes: await out.save(), pages: totalPages, flattened: true };
}
