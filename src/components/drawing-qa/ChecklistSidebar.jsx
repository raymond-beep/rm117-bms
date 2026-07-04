// JSON-driven checklist sidebar. Renders persisted/returned AnalysisResult[]
// grouped by checklist group (id prefix). Ported from Checksets. Layout uses
// Tailwind utilities (see tailwind.css — Drawing QA only).
import { useMemo, useState } from 'react';

const STATUS_STYLE = {
  pass: 'bg-green-100 text-green-800',
  fail: 'bg-red-100 text-red-800',
  needs_review: 'bg-amber-100 text-amber-800',
};

const STATUS_LABEL = { pass: 'Pass', fail: 'Fail', needs_review: 'Review' };

// Human-readable name for each checklist group code (the id prefix).
const GROUP_TITLES = {
  SITE: 'Site plans',
  EXP: 'Floor plans, existing & proposed',
  ELV: 'Elevations, existing & proposed',
  PRE: 'Proposed elevations, additional',
  CDP: 'Proposed plans',
  CDE: 'Proposed elevations',
  SEC: 'Building sections',
  ELE: 'Electric / lighting plans',
  FRM: 'Framing plans',
};

// "proposed_elevation" -> "proposed elevation"
function prettyType(type) {
  return type.replace(/_/g, ' ');
}

export default function ChecklistSidebar({
  results,
  applicableIds,
  sheetType,
  advisory,
  reviewedIds,
  onToggleReviewed,
  overrides,
  onOverride,
  analyzing,
  model,
  onAnalyze,
}) {
  const reviewedSet = useMemo(() => new Set(reviewedIds), [reviewedIds]);
  // The reviewer's verdict wins over the AI's.
  const effStatus = (r) => overrides[r.id] ?? r.status;
  const [filter, setFilter] = useState('all');
  // null = follow the default (focus on applicable items when we know the sheet
  // type); a value = the user's explicit choice. Resets per page (keyed by page).
  const [scopeOverride, setScopeOverride] = useState(null);

  const applicableSet = useMemo(() => (applicableIds ? new Set(applicableIds) : null), [applicableIds]);
  // Only worth a scope toggle when the stored results include items outside the
  // applicable set (older analyses that scored all 90). New analyses are already
  // scoped to the sheet type, so the toggle self-hides.
  const canScope = applicableSet !== null && !!results && results.some((r) => !applicableSet.has(r.id));
  const scope = scopeOverride ?? (canScope ? 'applicable' : 'all');

  // Results after the scope filter (applicable-to-this-sheet vs all).
  const scoped = useMemo(() => {
    if (!results) return [];
    if (scope === 'all' || !applicableSet) return results;
    return results.filter((r) => applicableSet.has(r.id));
  }, [results, scope, applicableSet]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const r of scoped) {
      if (filter !== 'all' && (overrides[r.id] ?? r.status) !== filter) continue;
      const group = r.id.split('-')[0];
      if (!map.has(group)) map.set(group, []);
      map.get(group).push(r);
    }
    return [...map.entries()];
  }, [scoped, filter, overrides]);

  const counts = useMemo(() => {
    const c = { pass: 0, fail: 0, needs_review: 0 };
    for (const r of scoped) c[overrides[r.id] ?? r.status]++;
    return c;
  }, [scoped, overrides]);

  // How many of the items in view have been checked off.
  const doneCount = useMemo(
    () => scoped.reduce((n, r) => n + (reviewedSet.has(r.id) ? 1 : 0), 0),
    [scoped, reviewedSet],
  );

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l bg-white">
      <div className="border-b p-3">
        <button
          onClick={() => onAnalyze()}
          disabled={analyzing}
          className="w-full rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {analyzing ? 'Analyzing sheet…' : results ? 'Re-analyze this sheet' : 'Analyze this sheet'}
        </button>
        {model && <p className="mt-1 text-xs text-gray-400">model: {model}</p>}
      </div>

      {results && canScope && (
        <div className="flex items-center gap-1 border-b p-2 text-xs">
          <button
            onClick={() => setScopeOverride('applicable')}
            className={`rounded border px-2 py-1 ${scope === 'applicable' ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
          >
            This sheet ({applicableSet.size})
          </button>
          <button
            onClick={() => setScopeOverride('all')}
            className={`rounded border px-2 py-1 ${scope === 'all' ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
          >
            All items ({results.length})
          </button>
          {scope === 'applicable' && sheetType && (
            <span className="ml-auto text-gray-400">{prettyType(sheetType)}</span>
          )}
        </div>
      )}

      {results && (
        <div className="flex gap-1 border-b p-2 text-xs">
          {['all', 'fail', 'needs_review', 'pass'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded border px-2 py-1 ${filter === f ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
            >
              {f === 'all' ? `All (${scoped.length})` : `${STATUS_LABEL[f]} (${counts[f]})`}
            </button>
          ))}
        </div>
      )}

      {results && scoped.length > 0 && (
        <div className="border-b px-3 py-1.5 text-xs text-gray-500">
          Reviewed {doneCount} of {scoped.length}
          {doneCount === scoped.length && ' — all checked ✓'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!results && !analyzing && (
          <p className="p-4 text-sm text-gray-500">
            No analysis yet for this sheet. Click “Analyze this sheet” to check it against the firm checklist.
          </p>
        )}
        {advisory && (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-amber-700">Verify manually</p>
            {advisory}
          </div>
        )}
        {results && scoped.length === 0 && (
          <div className="p-4 text-sm text-gray-500">
            <p>
              No checklist items apply to this sheet type
              {sheetType ? ` (${prettyType(sheetType)})` : ''}. Verify it by hand — see the note above.
            </p>
            {/* Escape hatch: if the type was mis-detected, force a full review. */}
            <button
              onClick={() => onAnalyze({ allItems: true })}
              disabled={analyzing}
              className="mt-3 rounded border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {analyzing ? 'Analyzing…' : 'Wrong type? Check all 90 items'}
            </button>
          </div>
        )}
        {groups.map(([group, items]) => (
          <section key={group} className="border-b">
            <h3 className="sticky top-0 flex items-baseline gap-2 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600">
              <span className="font-mono uppercase tracking-wide text-gray-400">{group}</span>
              <span>{GROUP_TITLES[group] ?? 'Checks'}</span>
            </h3>
            <ul>
              {items.map((r) => {
                const done = reviewedSet.has(r.id);
                const eff = effStatus(r);
                const overridden = overrides[r.id] !== undefined;
                return (
                  <li key={r.id} className="flex items-start gap-2 border-t px-3 py-2 text-sm first:border-t-0">
                    {/* Check-off: label wraps only the checkbox + text, so the
                        verdict control beside it never toggles the checkbox. */}
                    <label className={`flex min-w-0 flex-1 cursor-pointer gap-2 hover:bg-gray-50 ${done ? 'opacity-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => onToggleReviewed(r.id)}
                        className="mt-1 shrink-0"
                        aria-label={`Mark ${r.id} reviewed`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={`block font-medium ${done ? 'line-through' : ''}`}>
                          <span className="font-mono text-xs text-gray-400">{r.id}</span> {r.label}
                        </span>
                        {r.note && <span className="mt-0.5 block text-xs text-gray-600">{r.note}</span>}
                      </span>
                    </label>

                    {/* Verdict: reviewer can override the AI. Selecting the AI's
                        own value reverts (clears) the override. */}
                    <span className="shrink-0 text-right">
                      <select
                        value={eff}
                        onChange={(e) => {
                          const v = e.target.value;
                          onOverride(r.id, v === r.status ? null : v);
                        }}
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[eff]} ${overridden ? 'ring-1 ring-gray-500' : ''}`}
                        aria-label={`Verdict for ${r.id}`}
                        title={overridden ? `You set this — AI said ${STATUS_LABEL[r.status]}` : 'AI verdict — change to override'}
                      >
                        <option value="pass">Pass</option>
                        <option value="fail">Fail</option>
                        <option value="needs_review">Review</option>
                      </select>
                      {overridden && (
                        <span className="mt-0.5 block text-[10px] text-gray-400">edited · AI: {STATUS_LABEL[r.status]}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
