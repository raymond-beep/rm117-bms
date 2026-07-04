// Vision analysis of one sheet against CHECKS.md. Ported from Checksets
// api/analyze-pdf. POST { setId, page, sheetLabel?, imageBase64, mediaType, allItems? }
//   -> persists + returns { results, model, sheet, applicable_ids, advisory, label_issue }
//
// Cost controls: on-demand per sheet (never auto-fired across a set). The
// checklist system block is byte-identical across a set's pages and carries a
// prompt-cache breakpoint, so pages 2..N read the cache instead of re-paying it.
import { requireStaff } from '../_lib/require-staff.js';
import { getDb } from '../_lib/db.js';
import { anthropic, analysisModel } from '../_lib/checksets/anthropic.js';
import { SHEET_TYPES, loadChecklist, checklistPromptText, applicableIdsForType } from '../_lib/checksets/checklist.js';
import { labelMismatch } from '../_lib/checksets/naming.js';

export const maxDuration = 300; // vision + 90 checklist items can take a while

const STATIC_INSTRUCTIONS = `You are a QA/QC reviewer for Room 117 Architecture & Design, checking residential permit drawing sheets against the firm's drawing checklist.

You will be shown ONE sheet (one page) of a drawing set.

FIRST decide what kind of sheet this is (site plan, floor plan, elevation, section, electrical, framing, general notes, etc.) from the drawing title and content.

THEN evaluate it against ONLY the checklist items whose "applies to" list includes that sheet type. Return one result per APPLICABLE item.

Rules:
- Evaluate only the checklist items that apply to this sheet type. Never invent or merge items. Use the exact item ids.
- DO NOT return a result for an item that doesn't apply to this sheet type — skip it entirely. Do not emit "N/A" results.
- If NO checklist items apply to this sheet (e.g. a general-notes sheet, cover sheet, or a sheet that is only schedules), return an empty "results" array.
- status "pass": the item applies and the sheet clearly satisfies the pass criteria.
- status "fail": the item applies and the criteria are clearly not met — say concretely what to add or fix in the note.
- status "needs_review": the item applies but you cannot tell from this image, or it's only partially satisfied.
- Keep notes brief (one sentence) and specific enough for a drafter to act on.

Also identify the sheet itself and return it as "sheet":
- "sheet.label": the sheet number from the title block, e.g. "A.100", "EX.101", "S-2". Use the exact text. Empty string if there is no sheet number.
- "sheet.type": the single best-fit type from the allowed list, judged from the DRAWN CONTENT (not the sheet number). Use "existing_plan"/"proposed_plan" and "existing_elevation"/"proposed_elevation" to distinguish existing vs proposed floor plans / elevations. Use "general_notes" for a sheet that is primarily general notes, specifications, and/or schedules (no plan/elevation/section drawing to check). Use "other" only for cover sheets, roof plans, or anything that fits none of the types.
- "sheet.advisory": a short note (one or two sentences) ONLY when the sheet warrants a manual verification rather than a checklist:
    * If the sheet is general_notes: advise the reviewer to verify the notes and diagrams match the proposed work.
    * If the sheet contains SCHEDULES (door/window/finish/etc.), whatever its type: advise verifying and double-checking those schedules against the proposed work.
    * Combine both if both apply. Otherwise return an empty string.
- "sheet.index": if this sheet contains a DRAWING INDEX / SHEET INDEX / sheet list (usually on the cover sheet), return every sheet listed in it as an array of { "number": <sheet number exactly as written>, "title": <sheet title> }. Return an empty array if the sheet has no such index. Include every row, even ones you don't see elsewhere.

RM117 sheet-numbering convention (for your awareness — still judge type from content, not the number):
- A.100 = site plan; A.1XX = proposed plans; A.2XX = proposed elevations; A.21X = proposed sections
- EX.1XX = existing plans; EX.2XX = existing elevations
- S.XXX = framing plans; E.XXX = electric/lighting plans`;

// Escape-hatch variant: force a full review of a sheet whose type was mis-detected
// (so the normal applicable-only scoping leaves it with zero checks). Kept as a
// separate block so the normal path's cached prompt prefix stays byte-identical.
const FORCE_ALL_INSTRUCTIONS = `You are a QA/QC reviewer for Room 117 Architecture & Design, checking residential permit drawing sheets against the firm's drawing checklist.

You will be shown ONE sheet (one page) of a drawing set. The reviewer has asked for a FULL review of every checklist item on this sheet — the usual per-sheet-type scoping does NOT apply here.

Evaluate this sheet against EVERY checklist item provided and return exactly one result per item. Do not skip any item and do not decide items are out of scope based on the sheet type.

Rules:
- Return one result for every checklist item, using the exact item ids. Never invent or merge items.
- status "pass": the sheet clearly satisfies the item's criteria.
- status "fail": the criteria clearly are not met — say concretely what to add or fix in the note.
- status "needs_review": you cannot tell from this image, it is only partially satisfied, or the item does not obviously apply to this kind of sheet (say so briefly in the note).
- Keep notes brief (one sentence) and specific enough for a drafter to act on.

Also identify the sheet itself and return it as "sheet":
- "sheet.label": the sheet number from the title block, e.g. "A.100", "EX.101", "S-2". Use the exact text. Empty string if there is no sheet number.
- "sheet.type": the single best-fit type from the allowed list, judged from the drawn content (used for display only).
- "sheet.advisory": return an empty string.
- "sheet.index": if this sheet contains a DRAWING INDEX / SHEET INDEX / sheet list, return every listed sheet as { "number", "title" }. Empty array if there is none.`;

const ALLOWED_MEDIA = ['image/png', 'image/jpeg', 'image/webp'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!(await requireStaff(req, res))) return;
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not configured' });

  try {
    const body = req.body || {};
    const setId = String(body.setId ?? '');
    const page = Number(body.page);
    const sheetLabel = body.sheetLabel ? String(body.sheetLabel) : null;
    const imageBase64 = String(body.imageBase64 ?? '');
    const mediaType = String(body.mediaType ?? 'image/png');
    const forceAll = body.allItems === true;

    if (!setId || !Number.isInteger(page) || page < 1 || !imageBase64) {
      return res.status(400).json({ error: 'setId, page and imageBase64 are required' });
    }
    if (!ALLOWED_MEDIA.includes(mediaType)) {
      return res.status(400).json({ error: `mediaType must be one of ${ALLOWED_MEDIA.join(', ')}` });
    }

    const items = loadChecklist();
    const model = analysisModel();

    const schema = {
      type: 'object',
      properties: {
        sheet: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            type: { type: 'string', enum: SHEET_TYPES },
            advisory: { type: 'string' },
            index: {
              type: 'array',
              items: {
                type: 'object',
                properties: { number: { type: 'string' }, title: { type: 'string' } },
                required: ['number', 'title'],
                additionalProperties: false,
              },
            },
          },
          required: ['label', 'type', 'advisory', 'index'],
          additionalProperties: false,
        },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', enum: items.map((i) => i.id) },
              status: { type: 'string', enum: ['pass', 'fail', 'needs_review'] },
              note: { type: 'string' },
            },
            required: ['id', 'status', 'note'],
            additionalProperties: false,
          },
        },
      },
      required: ['sheet', 'results'],
      additionalProperties: false,
    };

    const callModel = async () => {
      const response = await anthropic().messages.create({
        model,
        max_tokens: 16000,
        // Adaptive thinking ON: the reasoning pass is what makes the model
        // carefully scan the sheet for small symbols (north arrows, callouts).
        thinking: { type: 'adaptive' },
        system: [
          { type: 'text', text: forceAll ? FORCE_ALL_INSTRUCTIONS : STATIC_INSTRUCTIONS },
          {
            type: 'text',
            text: checklistPromptText(),
            // Prompt-cache hook: identical across all pages of a set. (A forced
            // full review changes the block above it, so it takes a cache miss.)
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              {
                type: 'text',
                text: forceAll
                  ? `This is page ${page} of the drawing set${sheetLabel ? `, sheet label "${sheetLabel}"` : ''}. Evaluate it against EVERY checklist item and return one result per item — do not scope by sheet type.`
                  : `This is page ${page} of the drawing set${sheetLabel ? `, sheet label "${sheetLabel}"` : ''}. Determine the sheet type, then evaluate it against only the checklist items that apply to that type and return one result per applicable item.`,
              },
            ],
          },
        ],
        output_config: { format: { type: 'json_schema', schema } },
      });
      const text = response.content.find((b) => b.type === 'text')?.text ?? '';
      return JSON.parse(text);
    };

    // Parse defensively; on malformed JSON retry once, then error.
    let parsed;
    try {
      parsed = await callModel();
    } catch (first) {
      if (first instanceof SyntaxError) parsed = await callModel();
      else throw first;
    }

    const detectedLabel = parsed.sheet?.label?.trim() || null;
    const detectedType =
      parsed.sheet?.type && SHEET_TYPES.includes(parsed.sheet.type) ? parsed.sheet.type : null;
    const resolvedLabel = detectedLabel ?? sheetLabel;
    // A forced full review is stored as "unknown type" (sheet_type = null) so the
    // whole app treats it via the already-tested null-type (all-items) path.
    const storedType = forceAll ? null : detectedType;
    const advisory = forceAll ? null : parsed.sheet?.advisory?.trim() || null;
    const labelIssue = labelMismatch(resolvedLabel, storedType);
    const sheetIndex = (parsed.sheet?.index ?? [])
      .map((e) => ({ number: String(e.number ?? '').trim(), title: String(e.title ?? '').trim() }))
      .filter((e) => e.number);

    // Score only the items that apply to this sheet type (the model returned just
    // those). A forced review, or an unknown type, scores all items.
    const scoredItems =
      forceAll || !detectedType
        ? items
        : items.filter((i) => new Set(applicableIdsForType(detectedType)).has(i.id));
    const byId = new Map(parsed.results.map((r) => [r.id, r]));
    const results = scoredItems.map((item) => {
      const r = byId.get(item.id);
      const status = r && ['pass', 'fail', 'needs_review'].includes(r.status) ? r.status : 'needs_review';
      return {
        id: item.id,
        label: item.label,
        status,
        note: r?.note ?? 'No result returned for this item — re-run analysis.',
        page,
      };
    });

    const { error } = await db.from('checklist_results').upsert(
      {
        drawing_set_id: setId,
        page_number: page,
        sheet_label: resolvedLabel,
        sheet_type: storedType,
        results,
        model,
        advisory,
        sheet_index: sheetIndex.length ? sheetIndex : null,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'drawing_set_id,page_number' },
    );
    if (error) throw new Error(error.message);

    return res.status(200).json({
      results,
      model,
      sheet: { label: resolvedLabel, type: storedType },
      applicable_ids: storedType ? applicableIdsForType(storedType) : null,
      advisory,
      label_issue: labelIssue,
    });
  } catch (err) {
    console.error('[checksets/analyze]', err);
    return res.status(500).json({ error: err.message });
  }
}
