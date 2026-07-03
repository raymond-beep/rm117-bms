// Set-level overview: a per-sheet roll-up for the whole set. Ported from
// Checksets api/sets/[setId]/overview. Counts computed server-side so the client
// never downloads every sheet's full results just to show totals.
//   GET ?setId= -> { pageCount, analyzedCount, sheets, index, extraSheets, allAnalyzed }
import { requireStaff } from '../_lib/require-staff.js';
import { getDb } from '../_lib/db.js';
import { SHEET_TYPES, applicableIdsForType } from '../_lib/checksets/checklist.js';
import { labelMismatch } from '../_lib/checksets/naming.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!(await requireStaff(req, res))) return;
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not configured' });

  const setId = req.query?.setId;
  if (!setId) return res.status(400).json({ error: 'setId is required' });

  try {
    const { data: set, error: setError } = await db
      .from('drawing_sets')
      .select('page_count')
      .eq('id', setId)
      .single();
    if (setError || !set) return res.status(404).json({ error: 'Set not found' });

    const { data: rows, error } = await db
      .from('checklist_results')
      .select('page_number, sheet_label, sheet_type, results, reviewed_ids, overrides, sheet_index')
      .eq('drawing_set_id', setId)
      .order('page_number', { ascending: true });
    if (error) throw new Error(error.message);

    const sheets = (rows ?? []).map((row) => {
      const results = row.results ?? [];
      const reviewedIds = Array.isArray(row.reviewed_ids) ? row.reviewed_ids : [];
      const type = SHEET_TYPES.includes(row.sheet_type) ? row.sheet_type : null;

      // Count only items applicable to this sheet's type (matches the sidebar's
      // default scope). A known no-checklist type counts zero; an UNKNOWN type
      // (null) falls back to all analyzed items.
      const applicable = type ? new Set(applicableIdsForType(type)) : null;
      const inScope = applicable ? results.filter((r) => applicable.has(r.id)) : results;

      // Counts reflect the reviewer's final verdict: an override wins over the AI.
      const overrides = row.overrides ?? {};
      const counts = { pass: 0, fail: 0, needs_review: 0 };
      for (const r of inScope) {
        const status = overrides[r.id] ?? r.status;
        if (status in counts) counts[status]++;
      }
      const reviewedInScope = applicable
        ? reviewedIds.filter((id) => applicable.has(id)).length
        : reviewedIds.length;

      return {
        page: row.page_number,
        label: row.sheet_label ?? null,
        type,
        counts,
        reviewed: reviewedInScope,
        total: inScope.length,
        labelIssue: labelMismatch(row.sheet_label, type),
        duplicateLabel: false, // filled in below once all labels are known
      };
    });

    // Set-level mislabel check: a sheet number that appears on more than one sheet.
    const labelCounts = new Map();
    for (const s of sheets) if (s.label) labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1);
    for (const s of sheets) s.duplicateLabel = !!s.label && (labelCounts.get(s.label) ?? 0) > 1;

    // Drawing-index reconciliation: gather the sheet list from any cover/index
    // sheet, dedupe by normalized number, mark which called-for sheets are present.
    const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const presentLabels = new Set(sheets.map((s) => (s.label ? norm(s.label) : '')).filter(Boolean));
    const indexMap = new Map();
    for (const row of rows ?? []) {
      const idx = Array.isArray(row.sheet_index) ? row.sheet_index : [];
      for (const e of idx) {
        const number = String(e?.number ?? '').trim();
        if (!number) continue;
        const key = norm(number);
        if (!indexMap.has(key)) indexMap.set(key, { number, title: String(e?.title ?? '').trim() });
      }
    }
    const index = [...indexMap.entries()].map(([key, e]) => ({ ...e, present: presentLabels.has(key) }));

    // Analyzed sheets the index doesn't list (only meaningful when there IS an index).
    const indexKeys = new Set(indexMap.keys());
    const extraSheets = index.length
      ? sheets.filter((s) => s.label && !indexKeys.has(norm(s.label))).map((s) => ({ page: s.page, label: s.label }))
      : [];

    // Missing-sheet detection is only definitive once every sheet is analyzed.
    const allAnalyzed = !!set.page_count && sheets.length >= set.page_count;

    return res.status(200).json({
      pageCount: set.page_count ?? null,
      analyzedCount: sheets.length,
      sheets,
      index,
      extraSheets,
      allAnalyzed,
    });
  } catch (err) {
    console.error('[checksets/overview]', err);
    return res.status(500).json({ error: err.message });
  }
}
