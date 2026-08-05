// Turn a staffer's brief description of a job into a PROJECT SUMMARY in the firm's own voice.
//
// Tom and Angelena asked for this: the summary is the one genuinely free-text block in the
// proposal, and it gets retyped from scratch on every job even though the firm has written the
// same four shapes of sentence for years.
//
// ⚠️ THIS DRAFTS — IT DOES NOT DECIDE. The output lands in the editable textarea and a person
// reads it before the PDF is built. That is load-bearing: the project summary is part of a
// CONTRACT the client signs, so a scope item the model invented ("a new closet will be
// installed") is not a typo, it is work the firm has just promised for free. Hence the two
// hard rules below — state only what the brief states, and abstain rather than embellish.
//
// The house style was taken from three real signed proposals, not from a guess. It is blunter
// than model-default prose, and it comes in TWO forms (see EXAMPLES): a numbered list when the
// brief has discrete scope items, short prose when it is one overall transformation. Both
// render correctly — `wrapText` in doc-format.js splits on newlines, so numbered lines stay on
// their own lines in the PDF.
import { anthropic } from './checksets/anthropic.js';

// Opus for this one. It is a short generation a staffer waits on, but it is contract text in
// someone else's voice — the failure mode is bland AI prose that Tom then rewrites by hand,
// which costs more than the model does. Override per-deploy if that trade changes.
const SUMMARY_MODEL = process.env.ANTHROPIC_SUMMARY_MODEL || 'claude-opus-5';

// A refusal here would be a false positive (these are house renovations), but one of the firm's
// own proposals already tripped a classifier once — see proposal-extract.js — so keep the retry.
const FALLBACK_MODEL = 'claude-opus-4-8';

// `summary: null` is a first-class answer. Without it the model will always produce something,
// and "something" from a two-word brief is invented scope in a contract.
const SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'The PROJECT SUMMARY text, ready to paste. null if the brief is too vague to write one '
        + 'without inventing scope.',
    },
    missing: {
      type: 'string',
      description:
        'When summary is null, the specific thing the writer needs to add (e.g. "which floor the '
        + 'addition is on"). Empty string when a summary was written.',
    },
  },
  required: ['summary', 'missing'],
  additionalProperties: false,
};

// Real PROJECT SUMMARY blocks from three signed RM117 proposals. These carry the voice far
// better than any description of it, which is why they are quoted rather than paraphrased.
// None contains a client name or address — only the cadence matters here.
const EXAMPLES = `Example 1 — discrete scope items, so a numbered list:
1. There will be a dormer installed above the existing garage.
2. The dormer will be integrated with the existing bedroom.
3. The bedroom under renovation will have a new closet installed.
4. The existing opening between bedroom and kitchen below will be maintained.

Example 2 — one overall transformation, so short prose:
The existing split-level house will be demolished, and a new two-story home will be designed and installed. The house will have (6) beds, (5-1/2) baths, and various living spaces.

Example 3 — a small job, so fragments are fine:
Outdoor portico and kitchen.
Elevations and model included in services.`;

const PROMPT = `You write the PROJECT SUMMARY section of architectural proposals for Room 117
Architecture & Design, a residential architecture firm in New Jersey. Match the firm's existing
voice exactly.

${EXAMPLES}

The voice, from those examples:
- Future declarative. "There will be…", "The existing house will be…", "…will be maintained."
- Plain statements of fact. No selling, no adjectives of quality, no benefit language.
- Numerals in parentheses: (6) beds, (5-1/2) baths, (2) car garage.
- Short. Two to four numbered lines, or two to three sentences of prose. Never both forms at once.
- Refer to what is already there as "the existing [thing]".

Never write like this — it is not how this firm writes:
"This project encompasses a comprehensive two-story addition thoughtfully designed to enhance
and optimize the existing residential structure, seamlessly blending modern functionality with
timeless character."
Specifically, never use: comprehensive, thoughtfully, seamlessly, transform, enhance, optimize,
elevate, stunning, bespoke, modern living.

Choose the form from the brief: a numbered list when it names several distinct pieces of work,
prose when it is one overall change to the house.

TWO HARD RULES:
1. State only what the brief states. Do not add rooms, features, counts, materials, finishes or
   scope that the brief does not mention. This text becomes part of a signed contract, so an
   invented scope item is work the firm has accidentally promised. Where the brief is silent,
   say nothing — do not round it out to sound complete.
2. If the brief is too thin to write from without inventing something, return summary: null and
   name what is missing. That is a useful answer here, not a failure.

Output the summary text only — no heading (the template prints "PROJECT SUMMARY" itself), no
preamble, no closing line, no commentary about what you wrote.`;

// Context the form already holds. Included because it is free and grounding — but note it is
// NOT licence to write about it: the project type says "Addition / Renovation", it does not say
// the addition is at the rear. Rule 1 still governs.
function contextBlock({ projectType, projectAddress, title }) {
  const lines = [];
  if (title) lines.push(`Client/project name: ${title}`);
  if (projectAddress) lines.push(`Address: ${projectAddress}`);
  if (projectType) lines.push(`Project type: ${projectType}`);
  if (!lines.length) return '';
  return `\n\nFor context only (do not describe anything below that the brief does not mention):\n${lines.join('\n')}`;
}

async function ask(model, brief, context) {
  return anthropic().messages.create({
    model,
    max_tokens: 3000, // thinking is on by default on Opus 5 and shares this budget
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `${PROMPT}\n\nThe brief:\n${brief}${context}`,
      },
    ],
  });
}

// Draft a summary from a brief description. Returns { summary, missing }.
export async function draftProjectSummary(brief, form = {}) {
  const trimmed = String(brief || '').trim();
  if (!trimmed) throw new Error('Describe the project first.');

  const context = contextBlock(form);
  let res = await ask(SUMMARY_MODEL, trimmed, context);

  // A decline before any output is not billed, so the retry is free to attempt.
  if (res.stop_reason === 'refusal' && SUMMARY_MODEL !== FALLBACK_MODEL) {
    console.warn(`[proposal-summary] ${SUMMARY_MODEL} declined; retrying on ${FALLBACK_MODEL}`);
    res = await ask(FALLBACK_MODEL, trimmed, context);
  }
  if (res.stop_reason === 'refusal') {
    throw new Error('The model declined to write this summary.');
  }

  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No answer came back from the model.');

  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error('The model returned an unreadable answer.');
  }
  return normalizeSummary(out);
}

// Undo over-escaping. The Opus family occasionally double-escapes structured-output strings
// (the same quirk CLAUDE.md flags for tool-call inputs): an em dash comes back as the literal
// six characters `—`, and punctuation comes back backslash-prefixed — `\(like this\)`.
// It is INTERMITTENT: three runs of the identical prompt produced it once. Left alone it
// renders as visible garbage in the proposal.
//
// Safe to apply to the summary as well as the advisory text: a project summary describing a
// house renovation has no legitimate use for a backslash, so the only thing this can strip is
// the artifact itself. It never rewrites words, only removes escape characters.
function tidyEscapes(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\([^\w\s])/g, '$1');
}

// The boundary between the model and a contract document. The schema already constrains shape;
// this trims what would land wrong in the textarea — escape artifacts, a model-added "PROJECT
// SUMMARY" heading, and surrounding whitespace that shifts the PDF block.
export function normalizeSummary(out) {
  const raw = typeof out?.summary === 'string' ? out.summary : null;
  const cleaned = raw
    ? tidyEscapes(raw).replace(/^\s*project summary\s*:?\s*\n?/i, '').trim()
    : null;
  const missing = typeof out?.missing === 'string' ? tidyEscapes(out.missing).trim() : '';
  return {
    summary: cleaned || null,
    missing: missing.slice(0, 300),
  };
}
