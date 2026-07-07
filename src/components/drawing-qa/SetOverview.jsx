// Set-level overview panel: one row per sheet, showing analyzed state + its
// pass/fail/review + reviewed-progress counts. Click a row to jump to that sheet.
// Presentational — data is fetched by ReviewClient. Ported from Checksets.
import { useMemo } from 'react';

function prettyType(type) {
  return type.replace(/_/g, ' ');
}

export default function SetOverview({ data, loading, currentPage, onJump }) {
  const byPage = useMemo(() => {
    const m = new Map();
    for (const s of data?.sheets ?? []) m.set(s.page, s);
    return m;
  }, [data]);

  // Render every page when we know the count, else just the analyzed sheets —
  // lets the panel show "not analyzed yet" gaps.
  const pages = useMemo(() => {
    const count = data?.pageCount ?? 0;
    if (count > 0) return Array.from({ length: count }, (_, i) => i + 1);
    return (data?.sheets ?? []).map((s) => s.page);
  }, [data]);

  return (
    <div className="absolute left-0 top-full z-20 mt-1 max-h-[70vh] w-96 overflow-y-auto rounded border bg-white shadow-lg">
      <div className="sticky top-0 border-b bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
        {loading
          ? 'Loading overview…'
          : data
            ? `${data.analyzedCount} of ${data.pageCount ?? data.sheets.length} sheets checked`
            : 'No overview'}
      </div>

      {!loading && data && data.index.length > 0 && (
        <div className="border-b bg-white">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Drawing index ({data.index.length}) — coordination
          </div>
          {(() => {
            const missing = data.index.filter((e) => !e.present);
            const extra = data.extraSheets;
            if (missing.length === 0 && extra.length === 0) {
              return <p className="px-3 pb-1.5 text-xs text-green-700">Index and set match ✓</p>;
            }
            return (
              <p className="px-3 pb-1.5 text-xs text-amber-800">
                ⚠ Index and set don’t fully match — verify the set is coordinated
                {!data.allAnalyzed && ' (some sheets not analyzed yet)'}
              </p>
            );
          })()}
          <ul className="pb-1">
            {data.index.map((e) => (
              <li key={e.number} className="flex items-center gap-2 px-3 py-1 text-sm">
                <span className="font-mono text-gray-700">{e.number}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{e.title}</span>
                {e.present ? (
                  <span className="shrink-0 text-xs text-green-700">present ✓</span>
                ) : (
                  <span className="shrink-0 text-xs font-medium text-amber-700">not in set</span>
                )}
              </li>
            ))}
          </ul>
          {data.extraSheets.length > 0 && (
            <p className="border-t px-3 py-1.5 text-xs text-amber-800">
              In the set but not in the index:{' '}
              <span className="font-mono">{data.extraSheets.map((s) => s.label).join(', ')}</span>
            </p>
          )}
        </div>
      )}

      {!loading && data && (
        <ul>
          {pages.map((page) => {
            const s = byPage.get(page);
            const isCurrent = page === currentPage;
            return (
              <li key={page} className="border-b last:border-b-0">
                <button
                  onClick={() => onJump(page)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 ${isCurrent ? 'bg-blue-50' : ''}`}
                >
                  <span className="w-8 shrink-0 text-xs text-gray-400">p{page}</span>

                  {s ? (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="font-mono font-medium text-gray-700">{s.label || '—'}</span>
                        {(s.duplicateLabel || s.labelIssue) && (
                          <span
                            className="ml-1 text-amber-600"
                            title={s.duplicateLabel ? `Duplicate sheet number "${s.label}"` : s.labelIssue ?? ''}
                          >
                            ⚠
                          </span>
                        )}
                        {s.type && <span className="ml-1.5 text-xs text-gray-400">{prettyType(s.type)}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs">
                        {s.counts.fail > 0 && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">{s.counts.fail}</span>
                        )}
                        {s.counts.needs_review > 0 && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                            {s.counts.needs_review}
                          </span>
                        )}
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ${s.reviewed >= s.total ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}
                          title="fail / review items signed off"
                        >
                          {s.total === 0 ? 'clear' : `${s.reviewed}/${s.total}`} ✓
                        </span>
                      </span>
                    </>
                  ) : (
                    <span className="flex-1 text-xs italic text-gray-400">Not analyzed yet</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
