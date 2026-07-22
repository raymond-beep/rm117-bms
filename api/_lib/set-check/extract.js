// Set Check Phase 2 — read the three documents and return structured JSON.
//
// What gets compared (settled with Ray 2026-07-21): a brochure is a product CATALOG,
// not a record of a purchase, so the check is "can this window line meet our set?" —
// for each tag on our schedule, does the chosen line offer that size, and is that
// unit's U-factor within what our REScheck was based on. That is a check we can run
// BEFORE the developer buys, on documents the firm already has.
//
// Three extractors, one per document. Each returns plain JSON; none of them decides
// anything — the comparison is Phase 3 and a staffer confirms every finding.
//
// ⭐ ABSTAINING IS A FIRST-CLASS ANSWER. Every field is nullable and the prompts say
// so explicitly. A guessed U-factor is worse than a blank one: blank asks a person to
// look, whereas a wrong number gets confirmed and ends up telling a contractor their
// windows pass when they don't. Same rule as api/_lib/proposal-extract.js.
import { toFile } from '@anthropic-ai/sdk';
import { anthropic } from '../checksets/anthropic.js';

// Set Check defaults to Opus rather than the Drawing QA tier. Drawing QA flags a sheet
// for a human to look at; Set Check reads small numbers off dense tables (a U-factor of
// 0.29 vs 0.39, a size of 2'10" vs 2'8") where a misread is the whole failure mode.
// Override with SET_CHECK_MODEL if the cost/accuracy trade changes.
const MODEL = () => process.env.SET_CHECK_MODEL || 'claude-opus-4-8';

// A safety classifier occasionally false-positives on ordinary firm documents (a house
// renovation once came back `category: "bio"` — see proposal-extract.js). A decline
// before any output isn't billed, so retrying once on another model costs nothing.
const FALLBACK_MODEL = 'claude-opus-4-7';

// Inline base64 is capped by a 32MB REQUEST limit, and base64 inflates bytes by ~33%.
// The firm's brochures are right at that edge — `Andersen Windows 400 Series
// Brochure.pdf` is 31MB, which cannot be sent inline at all. Anything over this
// threshold is uploaded via the Files API instead.
const INLINE_MAX_BYTES = 20 * 1024 * 1024;
const FILES_BETA = 'files-api-2025-04-14';

// A document block for the model, plus whether it needs the Files API beta.
// Uploaded files are NOT deleted here: a library brochure is the same file on every
// job, so leaving it uploaded is the point (Phase 3 will cache the id per Drive file).
async function documentSource(bytes, filename) {
  const buf = Buffer.from(bytes);
  if (buf.byteLength <= INLINE_MAX_BYTES) {
    return {
      beta: false,
      block: {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
      },
    };
  }
  const uploaded = await anthropic().beta.files.upload({
    file: await toFile(buf, filename || 'document.pdf', { type: 'application/pdf' }),
    betas: [FILES_BETA],
  });
  return {
    beta: true,
    block: { type: 'document', source: { type: 'file', file_id: uploaded.id } },
  };
}

async function ask({ model, schema, prompt, doc, maxTokens = 8000 }) {
  const params = {
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: [doc.block, { type: 'text', text: prompt }] }],
  };
  // Always stream. A 300-page catalog takes minutes and a big schedule needs a large
  // token budget; a non-streaming request at that size hits the SDK's HTTP timeout and
  // fails after we've already paid to read the document.
  // A file-sourced document needs the Files beta on the message too, not just the upload.
  const stream = doc.beta
    ? anthropic().beta.messages.stream({ ...params, betas: [FILES_BETA] })
    : anthropic().messages.stream(params);
  return stream.finalMessage();
}

// Run one extraction, with the refusal retry and the JSON parsing both handled once.
async function extract({ label, schema, prompt, bytes, filename, maxTokens }) {
  const doc = await documentSource(bytes, filename);

  const primary = MODEL();
  let res = await ask({ model: primary, schema, prompt, doc, maxTokens });
  if (res.stop_reason === 'refusal' && primary !== FALLBACK_MODEL) {
    console.warn(`[set-check] ${primary} declined the ${label}; retrying on ${FALLBACK_MODEL}`);
    res = await ask({ model: FALLBACK_MODEL, schema, prompt, doc, maxTokens });
  }
  if (res.stop_reason === 'refusal') throw new Error(`The model declined to read the ${label}.`);

  // A truncated answer is a half-read table, which would silently look like a short
  // schedule. Say so instead — Phase 3 must never compare against a partial list.
  if (res.stop_reason === 'max_tokens') {
    throw new Error(`The ${label} was too long to read in one pass.`);
  }

  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error(`No answer came back for the ${label}.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The model returned an unreadable answer for the ${label}.`);
  }
}

// ── 1. Our window schedule ────────────────────────────────────────────────────
// The tag → size table on our drawings. The schedule sometimes names the
// manufacturer and series and sometimes doesn't (Ray: "varies by job"), so both are
// nullable — when present, Phase 3 can flag a set drawn for one line but checked
// against another, which is a mistake worth catching.
const SCHEDULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['manufacturer', 'series', 'units', 'notes'],
  properties: {
    manufacturer: { type: ['string', 'null'] },
    series: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    units: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tag', 'size_text', 'width_inches', 'height_inches', 'quantity', 'operation'],
        properties: {
          tag: { type: ['string', 'null'] },
          size_text: { type: ['string', 'null'] },
          width_inches: { type: ['number', 'null'] },
          height_inches: { type: ['number', 'null'] },
          quantity: { type: ['integer', 'null'] },
          operation: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const SCHEDULE_PROMPT = `This is a set of architectural drawings by Room 117 Architecture & Design.
Find the WINDOW SCHEDULE — the table listing each window by tag/mark with its size.

For every row in that schedule return:
- tag: the mark exactly as drawn (e.g. "A", "W1", "101").
- size_text: the size exactly as written, unchanged (e.g. "2'-10\\" x 4'-2\\"", "2842").
- width_inches / height_inches: that size converted to inches. If the schedule gives a
  manufacturer call number instead of dimensions (e.g. Andersen "TW2842" encodes
  28" x 42"), you may decode it — but if you are not certain of the encoding, return null.
- quantity: how many of that unit, if the schedule states it.
- operation: double-hung, casement, awning, fixed, etc., if stated. This is recorded for
  context only and is NOT something we check a purchase against.

Also return the manufacturer and series IF the drawings state them, else null.
Put anything a reviewer should know in notes (e.g. "sizes are rough opening").

Rules:
- Transcribe. Do not infer a size that is not on the drawings, and never invent a tag.
- Any field you cannot read with confidence must be null. A null asks a person to look;
  a guessed dimension gets confirmed by mistake and we check the wrong window.
- If there is no window schedule in this document at all, return an empty units array.`;

export function extractWindowSchedule(pdfBytes, filename) {
  return extract({
    label: 'window schedule',
    schema: SCHEDULE_SCHEMA,
    prompt: SCHEDULE_PROMPT,
    bytes: pdfBytes,
    filename,
  });
}

// ── 2. Our REScheck ───────────────────────────────────────────────────────────
// The envelope model the permit was based on. We want the window (fenestration)
// U-factor the compliance run assumed — the ceiling a purchased unit must come in under.
const RESCHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['max_u_factor', 'code_required_u_factor', 'max_shgc', 'climate_zone', 'evidence', 'notes'],
  properties: {
    max_u_factor: { type: ['number', 'null'] },
    code_required_u_factor: { type: ['number', 'null'] },
    max_shgc: { type: ['number', 'null'] },
    climate_zone: { type: ['string', 'null'] },
    evidence: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
};

const RESCHECK_PROMPT = `This is a REScheck energy-code compliance report for a house.

REScheck lists windows in the envelope assemblies table with TWO different U-factors, and
they mean different things. Return both, separately:
- max_u_factor: the PROPOSED U-factor — the value this compliance run was actually based
  on (the "U-Factor" column for the window assemblies). A purchased window worse than
  this invalidates the run we submitted, even if it still passes code.
- code_required_u_factor: the code MAXIMUM for this climate zone (the "Req. U-Factor"
  column), if stated.

If several window assemblies list different proposed U-factors, return the HIGHEST
(the loosest value the run assumed) and say so in notes.

Also return the SHGC and the climate zone if stated, and quote the exact line you read
the U-factors from in evidence.

Rules:
- U-factor is a small decimal (typically 0.20–0.40). Do not confuse it with R-value,
  which is a larger whole-ish number and is its reciprocal — reporting an R-value as a
  U-factor would let every window "pass".
- If this document is not a REScheck, or does not state a window U-factor, return null
  for max_u_factor. Do not derive it from anything else. A guessed compliance number is
  exactly the kind of error nobody catches downstream.`;

export function extractRescheck(pdfBytes, filename) {
  return extract({
    label: 'REScheck',
    schema: RESCHECK_SCHEMA,
    prompt: RESCHECK_PROMPT,
    bytes: pdfBytes,
    filename,
    maxTokens: 4000,
  });
}

// ── 3. The window brochure — a TARGETED lookup, not a transcription ───────────
//
// ⭐ Shaped by what a real catalog turned out to look like. Probed against
// `Andersen Windows 400 Series Brochure.pdf` (31MB, 2019-20 Product Guide) 2026-07-21:
//
//   1. It does NOT publish a U-factor per unit size. The size tables carry model call
//      numbers and dimensions only; U-factors live in separate "NFRC Certified Total
//      Unit Performance" tables (pp. 201-206) organised by PRODUCT TYPE and GLAZING
//      PACKAGE. So "the U-factor of a TW2842" is not a question the document answers —
//      the answerable question is "the U-factor of a tilt-wash double-hung with this
//      glazing".
//   2. It lists HUNDREDS of sizes. Asking for all of them returns a "representative
//      sample" — and a sample is worse than useless here, because a size missing from
//      a partial list reads as "this line doesn't offer it" and flags a window that is
//      perfectly fine.
//
// So we don't transcribe the catalog. We pass in the tags OUR schedule actually uses
// and ask about only those, plus the performance table in full. That is a bounded
// question with a bounded answer, and it is the one Phase 3 needs.
const BROCHURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['manufacturer', 'series', 'performance', 'lookups', 'notes'],
  properties: {
    manufacturer: { type: ['string', 'null'] },
    series: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    // The NFRC table: worst-case U-factor per product type (and glazing, when split).
    performance: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['product_type', 'glazing_package', 'u_factor', 'shgc'],
        properties: {
          product_type: { type: ['string', 'null'] },
          glazing_package: { type: ['string', 'null'] },
          u_factor: { type: ['number', 'null'] },
          shgc: { type: ['number', 'null'] },
        },
      },
    },
    // One entry per tag we asked about — never more, never fewer.
    lookups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'tag', 'offered', 'model', 'size_text',
          'width_inches', 'height_inches', 'product_type', 'worst_case_u_factor', 'note',
        ],
        properties: {
          tag: { type: ['string', 'null'] },
          // null = couldn't determine. Only `false` means "this line does not offer it".
          offered: { type: ['boolean', 'null'] },
          model: { type: ['string', 'null'] },
          size_text: { type: ['string', 'null'] },
          width_inches: { type: ['number', 'null'] },
          height_inches: { type: ['number', 'null'] },
          product_type: { type: ['string', 'null'] },
          worst_case_u_factor: { type: ['number', 'null'] },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
};

function brochurePrompt(wanted) {
  return `This is a window manufacturer's product catalog or cut sheet.

We are checking whether this product line can supply the windows on our drawings. Return
the manufacturer and the product line/series, then two things.

FIRST — "performance": the NFRC certified performance table, but ONLY for the product
types the units below actually belong to. Catalogs publish U-factor by PRODUCT TYPE and
GLAZING PACKAGE rather than per unit size, so return one row per (product type, glazing
package) with its U-factor and SHGC. Do NOT return rows for product types we aren't
asking about — a full catalog table is thousands of rows and we only need these. Where a
product type is further split by grille or frame option, keep only the WORST (highest
U-factor) row for each glazing package. If the document instead gives one U-factor for
the whole line, return that as a single row with product_type null.

SECOND — "lookups": we need these specific units from our drawings looked up in this
catalog. Return EXACTLY ONE entry per tag below, in this order, and no others:

${wanted}

For each one:
- offered: true if this line offers a unit at that size, false if it demonstrably does
  not, and null if you cannot tell from this document. Only use false when you have
  actually seen the size table for that product type and the size is not in it.
- model / size_text / width_inches / height_inches: the matching unit in THIS catalog.
  Catalog sizes are often given as both a window (unit) dimension and a rough opening;
  say which you used in note.
- product_type: the catalog's own name for the product family this unit belongs to
  (e.g. "Tilt-Wash Double-Hung", "Casement"), so it can be matched to the table above.
- worst_case_u_factor: the HIGHEST U-factor offered for that product type across glazing
  packages — the worst a buyer could end up with. Never the best: quoting the best
  glazing tells a developer their windows comply when the ones they actually buy may not.

Rules:
- A size that is close but not equal is NOT a match. Report the nearest offered size in
  note and set offered false — a near-miss is exactly what this check exists to catch.
- Any value you cannot read with confidence must be null, and offered must be null rather
  than a guess. A wrong "offered: false" sends someone chasing a window that is fine; a
  wrong "offered: true" lets a real mismatch through.
- Ignore marketing, installation, warranty and colour/hardware sections entirely.`;
}

// `scheduleUnits` are the units from extractWindowSchedule — the check is always
// "our set vs this line", so the schedule is read first and drives this call.
export function lookupBrochure(pdfBytes, filename, scheduleUnits = []) {
  const wanted = scheduleUnits
    .filter((u) => u && (u.size_text || u.width_inches))
    .map((u) => {
      const size = u.size_text || `${u.width_inches}" x ${u.height_inches}"`;
      return `- tag "${u.tag ?? '?'}": ${size}${u.operation ? ` (${u.operation})` : ''}`;
    })
    .join('\n');

  if (!wanted) throw new Error('No window sizes from the schedule to look up.');

  return extract({
    label: 'window brochure',
    schema: BROCHURE_SCHEMA,
    prompt: brochurePrompt(wanted),
    bytes: pdfBytes,
    filename,
    maxTokens: 32000,
  });
}
