// Build an RM117 proposal as an assembled PDF. Most of the document is fixed
// boilerplate (scope phases, exclusions, payment terms, binding clause) baked in
// here and verbatim from the firm's samples; the caller supplies only the
// variable bits (client, address, project summary, fee amounts, signers).
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { numericDate, dollarsToWords } from './doc-format.js';
import { money } from './format.js';
import { PAGE, ML, CONTENT_W, INK, GREY, embedLogo, drawLetterhead, appendAttachments, makeWriter } from './pdf-doc.js';

// ── Defaults the form seeds from (exported so the editor can pre-fill) ──
export const DEFAULT_RE = 'Proposal for Architectural Design and Construction Documents Services';
export const DEFAULT_INTRO =
  'Please see below for the scope of work and fees for your project. Should you have any questions or concerns, please let me know.';

export const STANDARD_PHASES = [
  { key: 'survey', title: 'Survey + Existing Conditions Investigation',
    desc: 'This phase will entail the first site visit, thorough hand-measurements of the existing structure, digital drafting of existing floor plans, and zoning analysis.',
    deliverables: ['Existing floor plans', 'Existing site plan'] },
  { key: 'design', title: 'Design Phase',
    desc: 'Utilizing the existing floor plans, the proposed layout will be shown and reviewed with the owner. This phase will include ({meetings}) design meetings, after which any additional meetings will incur hourly fees.',
    deliverables: ['Existing floor plans', 'Proposed floor plans', 'Existing site plan', 'Proposed site plan', 'Proposed elevations'] },
  { key: 'cd', title: 'Construction Documents',
    desc: 'Coordination of a full set of existing/proposed plans for bid and construction. Sets of signed/sealed drawings will be provided for the building department. Addressing building department questions/revisions is included.',
    deliverables: ['Existing + proposed floor plans', 'Existing + proposed elevations', '(3) electric/lighting plans', '(4) framing plans', 'Plumbing riser diagram', 'Building department notes', 'Construction notes'] },
  { key: 'ca', title: 'Construction Administration',
    desc: 'Provide support for the project through the construction phase and ensure that the work is executed in accordance with the approved drawings, specifications, and applicable codes.',
    deliverables: ['Construction Document review meeting with contractors and owner', 'Site visits at construction checkpoints'] },
];

export const DEFAULT_FEE_ITEMS = [
  { key: 'survey', label: 'Survey + Existing Conditions Investigation', amount: 1500, due: '. Retainer due upon acceptance of proposal which must be given on day of survey.' },
  { key: 'dp1', label: 'Design Phase I (DP1)', amount: 3500, due: ' is due at the end of Design Meeting #2.' },
  { key: 'dp2', label: 'Design Phase II (DPII)', amount: 3500, due: ' is due upon completion of Design Phase II, regardless of the number of meetings required.' },
  { key: 'cd', label: 'Construction Documents (CD)', amount: 3000, due: ' is due upon delivery of signed/sealed construction documents to Owner.' },
  { key: 'ca', label: 'Construction Administration (CA)', amount: 1500, due: ' is due upon the completion of the Construction Document review.' },
];

const MEETING_NOTE = '* A “Meeting” may either be in-person or digital (via Zoom or similar); this will be the Owner’s preference';
const PAYMENT_NOTE = '* Methods of payment include Check (payable to Room117, LLC), Cash, Venmo (@Angelena-Hreczny), Zelle (angelena@rm117.com), or Credit. Please note that if paying by credit, there will be an additional 3% charge.';
const BINDING = 'IF THE PROPOSED SCOPE OF SERVICES AND THE TERMS AND CONDITIONS OUTLINED IN THIS AGREEMENT ARE ACCEPTABLE, PLEASE SIGN AND RETURN A COPY TO ROOM 117. THIS AGREEMENT SHALL BECOME BINDING UPON EXECUTION BY BOTH PARTIES AND RECEIPT OF THE FULLY SIGNED DOCUMENT BY OUR FIRM.';
const VALID = 'THIS PROPOSAL IS VALID FOR 90 DAYS FROM THE DATE OF SIGNATURE.';

const EXCLUSIONS = [
  { title: 'Deliverables', body: 'The cost of six (6) printed sets of plans and one PDF is included in this proposal.' },
  { title: 'Additional Prints', body: 'Any additional printed sets beyond the six (6) included will be billed as a reimbursable expense, invoiced at project completion.', subs: ['24x36 sheets: $5 each', '11x17 sheets: $2 each'] },
  { title: 'Post-Sign-Off Design Revisions', body: "Any revisions requested after the Owner's formal design sign-off will incur additional charges.", subs: ['Minor changes will be billed at an hourly rate of $90/hour.', 'Major changes will require a separate change order with a defined scope and fee.'] },
  { title: 'Zoning Variance (if applicable)', body: 'This proposal does not include the cost for a zoning variance. If a variance is required, a lump sum fee of $1,200.00 (One Thousand Two Hundred Dollars) will apply for necessary prints, drawings, presentation materials, and attendance at zoning hearings.' },
  { title: 'Structural Engineering (if applicable)', body: 'This proposal does not include structural engineering services. If such services are required, fees will be provided by the engineer directly and may vary based on project complexity.' },
  { title: 'Design Changes (Detailed)', body: '', subs: [
    'The Owner will provide formal sign-off upon completion of the Design Phase. Revisions requested after this point will be billed at $90/hour.',
    'If design changes are requested during construction, the same hourly rate will apply for any required drawing updates.',
    'Note: Revisions required by the building department during permitting are included in the original fee and do not incur additional charges.'] },
  { title: 'Permitting and Filing', body: 'Application to and filing with the local building department is not included in this proposal and is expected to be performed by the Contractor. Room 117 will prioritize and promptly respond to any plan review comments. Any required corrections or revisions will be made at no additional cost, as they are included in the outlined fee schedule.' },
  { title: 'Meetings Definition', body: 'Any phone call exceeding 15 minutes may constitute a meeting. Additionally, any digital markups or design comments sent by the Owner (via email, text, or other means) and subsequently implemented may also constitute a meeting under the terms of this proposal.' },
  { title: 'Early Bid Release Consequences', body: 'If the Owner distributes design drawings to contractors for bidding prior to completion of the full design phase, Room 117 reserves the right to invoice the full amount for Design Phases I and II. Any drawing revisions requested after bidding will be billed at the hourly rate.' },
  { title: 'Communication Policy', body: 'Room 117 is committed to responsive communication and diligent project coordination. However, due to workload volume, real-time updates are not feasible, and there may be a response delay of up to 72 hours for emails, design inquiries, or phone calls. We appreciate your patience.' },
];

const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
const ALPHA = ['', 'a', 'b', 'c', 'd', 'e', 'f'];

export async function buildProposalPdf(data = {}) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const logoImg = await embedLogo(doc, data.logo);

  const footer = `${numericDate(data.date)} ${data.label || 'Proposal'}`.trim();
  // Repeat the letterhead + footer on every page (the firm's proposals carry the
  // letterhead on all pages). `top` starts content below the letterhead band.
  const decorate = (page) => {
    drawLetterhead(page, { times: regular, logoImg });
    const fw = italic.widthOfTextAtSize(footer, 8);
    page.drawText(footer, { x: (PAGE[0] - fw) / 2, y: 34, size: 8, font: italic, color: GREY });
  };

  const w = makeWriter(doc, { fonts: { regular, bold, italic }, decorate, top: PAGE[1] - 118, lineFactor: 1.3 });

  const section = (t) => { w.gap(13); w.text(t, { bold: true, size: 11 }); w.gap(3); };
  // Numbered item: marker at the left margin, text indented and wrapped.
  const numbered = (marker, text, { boldText = false, x = ML, indent = 18 } = {}) => {
    w.gap(4);
    const firstY = w.text(text, { bold: boldText, x, width: CONTENT_W - (x - ML), indent });
    w.page.drawText(marker, { x, y: firstY, size: 11, font: boldText ? bold : regular, color: INK });
  };

  // ── Title block ──
  w.text((data.title || '').toUpperCase(), { bold: true, size: 11 });
  if (data.projectType || data.projectAddress) w.text(`${data.projectType || ''}: ${data.projectAddress || ''}`, { bold: true, size: 11 });
  w.text(`Re: ${data.reSubject || DEFAULT_RE}`, { bold: true, size: 11 });
  if (data.attn) w.text(`Attn: ${data.attn}`, { bold: true, size: 11 });
  w.gap(10);
  w.text(`Dear ${data.greeting || ''},`, { size: 11 });
  w.gap(4);
  w.text(data.intro || DEFAULT_INTRO, { size: 11 });

  // ── Project summary ──
  if (data.projectSummary) {
    section('PROJECT SUMMARY');
    w.text(data.projectSummary, { italic: true, size: 11 });
  }

  // One deliverable: roman marker just left of its (italic) text column.
  const delivItem = (text, roman, colX, colW) => {
    const firstY = w.text(text, { italic: true, size: 10, x: colX, width: colW });
    w.page.drawText(`${ROMAN[roman] || roman}.`, { x: colX - 14, y: firstY, size: 10, font: italic, color: INK });
  };
  // Deliverables list: single column for ≤2 items, else two balanced columns
  // (numbering runs i… down the left, then continues down the right), matching
  // the firm's samples and keeping long lists from running an extra page.
  const drawDeliverables = (items = []) => {
    if (items.length <= 2) {
      items.forEach((d, j) => delivItem(d, j + 1, ML + 44, CONTENT_W - 44));
      return;
    }
    const mid = Math.ceil(items.length / 2);
    const colW = (CONTENT_W - 44) / 2 - 12;
    const leftX = ML + 44, rightX = leftX + colW + 24;
    const startY = w.y;
    items.slice(0, mid).forEach((d, j) => delivItem(d, j + 1, leftX, colW));
    const leftEndY = w.y;
    w.y = startY;
    items.slice(mid).forEach((d, j) => delivItem(d, mid + j + 1, rightX, colW));
    w.y = Math.min(leftEndY, w.y);
  };

  // ── Scope of services ──
  section('SCOPE OF SERVICES');
  w.text(MEETING_NOTE, { italic: true, size: 10 });
  (data.phases || []).forEach((p, i) => {
    const desc = (p.desc || '').replace('{meetings}', String(data.meetings || 3));
    numbered(`${i + 1}.`, p.title, { boldText: true });
    w.text(desc, { size: 11, indent: 18 });
    w.gap(2);
    w.text('Deliverables:', { italic: true, size: 10, indent: 28 });
    drawDeliverables(p.deliverables);
  });

  // ── Fee schedule ──
  const items = data.feeItems || [];
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  section('FEE SCHEDULE');
  w.text(`In this proposal, the total fee for services rendered is a lump sum fee of ${money(total, { cents: true })} (${dollarsToWords(total)}). The fee schedule is as follows:`, { size: 11 });
  items.forEach((it, i) => {
    w.gap(4);
    const firstY = w.richText([{ text: `${it.label}:`, underline: true }], { indent: 18 });
    w.page.drawText(`${i + 1}.`, { x: ML, y: firstY, size: 11, font: regular, color: INK });
    w.text(`A lump sum fee of ${money(it.amount, { cents: true })} (${dollarsToWords(it.amount)})${it.due || '.'}`, { size: 11, indent: 18 });
  });
  if ((data.additionalServices || []).length) {
    w.gap(8);
    w.text('Additional Services:', { bold: true, size: 11 });
    data.additionalServices.forEach((a, i) => {
      numbered(`${items.length + i + 1}.`, `${a.label}: An additional lump sum fee of ${money(a.amount, { cents: true })} (${dollarsToWords(a.amount)})`, {});
    });
  }
  w.gap(10);
  w.text(PAYMENT_NOTE, { italic: true, size: 10 });

  // ── Exclusions & limitations ──
  section('EXCLUSIONS AND LIMITATIONS');
  EXCLUSIONS.forEach((ex, i) => {
    w.gap(4);
    const segs = [{ text: `${ex.title}:`, bold: true }];
    if (ex.body) segs.push({ text: ` ${ex.body}` });
    const firstY = w.richText(segs, { indent: 18 });
    w.page.drawText(`${i + 1}.`, { x: ML, y: firstY, size: 11, font: regular, color: INK });
    (ex.subs || []).forEach((s, j) => {
      const fy = w.text(s, { size: 11, x: ML + 36, width: CONTENT_W - 36 });
      w.page.drawText(`${ALPHA[j + 1] || j + 1}.`, { x: ML + 22, y: fy, size: 11, font: regular, color: INK });
    });
  });

  // ── Binding clause + signatures ──
  // Keep the closing (binding clause + valid-for + every signature line) on one
  // page — never orphan signatures onto a page by themselves.
  const signers = data.signers || [];
  w.need(95 + signers.length * 64);
  w.gap(18);
  w.text(BINDING, { bold: true, size: 10 });
  w.gap(10);
  w.text(VALID, { bold: true, size: 10 });

  for (const name of signers) {
    w.gap(36);
    const ly = w.y;
    w.page.drawLine({ start: { x: ML, y: ly }, end: { x: ML + 250, y: ly }, thickness: 0.8, color: INK });
    w.page.drawLine({ start: { x: ML + 290, y: ly }, end: { x: ML + 380, y: ly }, thickness: 0.8, color: INK });
    w.gap(13);
    const ny = w.text(name, { size: 11 });
    w.page.drawText('Date', { x: ML + 290, y: ny, size: 11, font: regular, color: INK });
  }

  await appendAttachments(doc, data.attachments);
  return doc.save();
}
