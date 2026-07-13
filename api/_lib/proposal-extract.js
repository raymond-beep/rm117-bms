// Read a signed proposal PDF and work out how many DESIGN PHASES it bought.
//
// Angelena asked for this: the number varies per job (the proposal's scope/fee schedule
// says whether the client is getting one design iteration or three), and typing it in for
// every job is exactly the kind of data entry the app is supposed to remove.
//
// ⚠️ THIS SUGGESTS — IT DOES NOT DECIDE. The endpoint that calls this never writes
// `design_phase_count`; staff confirm the number with one click. A wrong count silently
// truncates a client's design ladder and nobody would ever notice, which is precisely the
// failure a "just trust the model" design would produce. If the extraction proves reliable
// over a few dozen real jobs, loosen it then — not before.
//
// The PDF goes to Claude as a native `document` block (no OCR, no rasterising) and the
// answer comes back through a JSON schema, so a malformed reply is impossible by
// construction — we get a validated object or an error, never prose to regex.
import { anthropic, analysisModel } from './checksets/anthropic.js';

// Anthropic's structured-output schema. Note the deliberate `null` branch: "I couldn't
// tell" must be a first-class answer, or the model will invent a number to satisfy the
// schema — which is the whole risk we're guarding against.
const SCHEMA = {
  type: 'object',
  properties: {
    design_phase_count: {
      anyOf: [
        { type: 'integer', enum: [1, 2, 3] },
        { type: 'null' },
      ],
      description:
        'How many DESIGN phases/iterations the proposal includes (1-3). null if the proposal does not say.',
    },
    evidence: {
      type: 'string',
      description:
        'The exact wording from the proposal that shows the count. Empty string if none found.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'high = the proposal states it plainly; low = inferred or ambiguous.',
    },
  },
  required: ['design_phase_count', 'evidence', 'confidence'],
  additionalProperties: false,
};

const PROMPT = `This is a signed architectural proposal from Room 117 Architecture & Design.

Find how many DESIGN PHASES (design iterations / design meetings, sometimes written DP1/DPI,
DP2/DPII, DP3/DPIII) the client is buying. The answer is usually in the SCOPE OF SERVICES or
the FEE SCHEDULE — count the distinct design phases listed there.

Rules:
- Count only DESIGN phases. Survey/Zoning, Construction Documents (CDs), Permitting and
  Construction Administration are separate phases and must NOT be counted.
- The answer is between 1 and 3.
- If the proposal does not clearly state how many design phases are included, return null.
  Do NOT guess: a wrong number silently corrupts the job record, and "unknown" is a useful
  answer here. Guessing is worse than abstaining.
- Quote the exact wording you relied on as evidence.`;

// The model a refusal falls back to. A safety classifier false-positived on one of the
// firm's own proposals — a house renovation came back `category: "bio"` — so a decline is
// not necessarily about the document. Benign work does occasionally trip these classifiers;
// retrying once on a different model clears it. (The server-side `fallbacks` parameter would
// be tidier but Sonnet doesn't accept it, so the retry lives here.)
const FALLBACK_MODEL = 'claude-opus-4-8';

async function ask(model, data) {
  return anthropic().messages.create({
    model,
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });
}

// Extract from raw PDF bytes. Returns { design_phase_count, evidence, confidence }.
export async function extractDesignPhases(pdfBytes) {
  const data = Buffer.from(pdfBytes).toString('base64');

  const primary = analysisModel();
  let res = await ask(primary, data);

  // A refusal costs nothing (a decline before any output isn't billed), so retry it.
  if (res.stop_reason === 'refusal' && primary !== FALLBACK_MODEL) {
    console.warn(`[proposal-extract] ${primary} declined; retrying on ${FALLBACK_MODEL}`);
    res = await ask(FALLBACK_MODEL, data);
  }

  // Both models declined — real, and worth surfacing rather than hiding behind a bland
  // "couldn't tell", which staff would read as "the proposal doesn't say".
  if (res.stop_reason === 'refusal') throw new Error('The model declined to read this proposal.');

  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No answer came back from the model.');

  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error('The model returned an unreadable answer.');
  }
  return normalize(out);
}

// Defensive: the schema constrains the model, but this function is the boundary between an
// LLM and a DB column with a CHECK constraint — validate rather than trust.
export function normalize(out) {
  const n = out?.design_phase_count;
  const count = n === 1 || n === 2 || n === 3 ? n : null;
  return {
    design_phase_count: count,
    evidence: typeof out?.evidence === 'string' ? out.evidence.slice(0, 500) : '',
    confidence: ['high', 'medium', 'low'].includes(out?.confidence) ? out.confidence : 'low',
  };
}
