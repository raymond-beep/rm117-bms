// Review screen: left = PDF page inside the tldraw markup surface, right =
// checklist sidebar. Everything keyed by (setId, pageNumber). Ported from the
// standalone Checksets app; rewired to the BMS: all calls go through apiFetch
// (Clerk auth) to /api/checksets/*, and the PDF bytes are streamed from the job's
// Drive "Checksets" folder (staff-gated) rather than Supabase Storage.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import MarkupOverlay from './MarkupOverlay.jsx';
import MarkupExporter from './MarkupExporter.jsx';
import ChecklistSidebar from './ChecklistSidebar.jsx';
import SetOverview from './SetOverview.jsx';
import BatchAnalyzeButton from './BatchAnalyzeButton.jsx';
import { loadPdf, renderPageForAnalysis, renderPageForDisplay, splitDataUrl } from './pdf.js';
import './tailwind.css';

// "proposed_elevation" -> "Proposed elevation"
function prettySheetType(type) {
  const s = type.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SET_STATUSES = [
  { value: 'uploaded', label: 'Uploaded', style: 'bg-gray-100 text-gray-600' },
  { value: 'in_review', label: 'In review', style: 'bg-amber-100 text-amber-800' },
  { value: 'reviewed', label: 'Reviewed', style: 'bg-green-100 text-green-800' },
];

const EMPTY_PAGE_DATA = {
  results: null, model: null, sheet: null, applicableIds: null,
  reviewedIds: [], overrides: {}, advisory: null, labelIssue: null,
};

function toPageData(d) {
  return {
    results: d.results ?? null,
    // The original flow only surfaced the model when there were results.
    model: d.results ? d.model ?? null : null,
    sheet: d.sheet_label || d.sheet_type ? { label: d.sheet_label ?? null, type: d.sheet_type ?? null } : null,
    applicableIds: d.applicable_ids ?? null,
    reviewedIds: d.reviewed_ids ?? [],
    overrides: d.overrides ?? {},
    advisory: d.advisory ?? null,
    labelIssue: d.label_issue ?? null,
  };
}

export default function ReviewClient({ setId, onBack }) {
  const [pageNumber, setPageNumber] = useState(1);

  const [set, setSet] = useState(null);
  const [pageCount, setPageCount] = useState(null);
  // The loaded PDF lives in state so the render path (which passes it to
  // <BatchAnalyzeButton>) reads a real value, not a ref during render.
  const [pdfDoc, setPdfDoc] = useState(null);
  const [docReady, setDocReady] = useState(false);
  const [display, setDisplay] = useState(null);
  const [initialMarkup, setInitialMarkup] = useState(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [results, setResults] = useState(null);
  const [model, setModel] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [applicableIds, setApplicableIds] = useState(null);
  const [reviewedIds, setReviewedIds] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [advisory, setAdvisory] = useState(null);
  const [labelIssue, setLabelIssue] = useState(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // bump to reload the current page
  const [analyzing, setAnalyzing] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [error, setError] = useState(null);
  // Drive export: 'idle' | 'preparing' | 'rendering' | 'uploading' | 'done' | 'error'.
  // exportPages (when set) mounts the off-screen MarkupExporter to rasterize marks.
  const [exportState, setExportState] = useState('idle');
  const [exportPages, setExportPages] = useState(null);
  const [exportResult, setExportResult] = useState(null);
  const [exportError, setExportError] = useState(null);

  // Per-page caches so navigating back to a visited sheet is instant. Rasters are
  // immutable (the PDF is static); page data + markup are written through on
  // edits/re-analyze and cleared wholesale after a batch run.
  const rasterCache = useRef(new Map());
  const pageCache = useRef(new Map());

  // Load set metadata + the PDF document once per set. The PDF comes from the
  // job's Drive "Checksets" folder — streamed through the staff-gated backend, so
  // we fetch the bytes with auth and hand them to pdf.js (a plain URL wouldn't
  // carry the Clerk token).
  useEffect(() => {
    let cancelled = false;
    rasterCache.current.clear();
    pageCache.current.clear();
    (async () => {
      setDocReady(false);
      try {
        const res = await apiFetch(`/api/checksets/sets?id=${setId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to load set');
        if (cancelled) return;
        setSet(data.set);

        const streamUrl =
          `/api/jobs/checkset-files?jobId=${encodeURIComponent(data.set.job_number)}` +
          `&fileId=${encodeURIComponent(data.set.drive_file_id)}`;
        const bytes = await apiFetch(streamUrl).then((r) => {
          if (!r.ok) throw new Error('Could not load the drawing PDF from Drive');
          return r.arrayBuffer();
        });
        const doc = await loadPdf({ data: bytes });
        if (cancelled) return;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        if (data.set.page_count !== doc.numPages) {
          apiFetch(`/api/checksets/sets?id=${setId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageCount: doc.numPages }),
          }).catch(() => {});
        }
        setDocReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      }
    })();

    return () => { cancelled = true; };
  }, [setId]);

  // Per page: render the raster and load that page's saved markup + results.
  useEffect(() => {
    if (!docReady || !pdfDoc) return;
    const doc = pdfDoc;
    let cancelled = false;

    const applyPageData = (pd) => {
      setResults(pd.results);
      setModel(pd.model);
      setSheet(pd.sheet);
      setApplicableIds(pd.applicableIds);
      setReviewedIds(pd.reviewedIds);
      setOverrides(pd.overrides);
      setAdvisory(pd.advisory);
      setLabelIssue(pd.labelIssue);
    };

    const cachedRaster = rasterCache.current.get(pageNumber) ?? null;
    const cachedPage = pageCache.current.get(pageNumber);

    // Seed synchronously from cache when we have it (instant), else clear the
    // previous sheet's UI so stale results/markup don't flash during load.
    setSaveState('idle');
    setDisplay(cachedRaster);
    if (cachedPage) {
      setInitialMarkup(cachedPage.markup);
      applyPageData(cachedPage.data);
      setPageLoaded(true);
    } else {
      setInitialMarkup(null);
      applyPageData(EMPTY_PAGE_DATA);
      setPageLoaded(false);
    }

    // Render the raster only if it isn't already cached (it never changes).
    if (!cachedRaster) {
      (async () => {
        try {
          const rendered = await renderPageForDisplay(doc, pageNumber);
          if (cancelled) return;
          rasterCache.current.set(pageNumber, rendered);
          setDisplay(rendered);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render page');
        }
      })();
    }

    // Fetch markup + results only if this page isn't already cached.
    if (!cachedPage) {
      (async () => {
        try {
          const [markupRes, resultsRes] = await Promise.all([
            apiFetch(`/api/checksets/markup?setId=${setId}&page=${pageNumber}`),
            apiFetch(`/api/checksets/results?setId=${setId}&page=${pageNumber}`),
          ]);
          const markupData = await markupRes.json();
          const resultsData = await resultsRes.json();
          if (cancelled) return;
          const markup = markupRes.ok ? markupData.shapes ?? null : null;
          const data = resultsRes.ok ? toPageData(resultsData) : EMPTY_PAGE_DATA;
          pageCache.current.set(pageNumber, { markup, data });
          setInitialMarkup(markup);
          applyPageData(data);
        } finally {
          if (!cancelled) setPageLoaded(true);
        }
      })();
    }

    return () => { cancelled = true; };
  }, [setId, pageNumber, docReady, refreshKey, pdfDoc]);

  // Prefetch the NEXT page's raster in the background so forward navigation is
  // instant on first visit too. Deferred ~600ms so it never competes with the
  // current page's render; renders one page ahead; cancels if the user moves on.
  useEffect(() => {
    if (!docReady || !pdfDoc || !pageCount) return;
    const next = pageNumber + 1;
    if (next > pageCount || rasterCache.current.has(next)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        const rendered = await renderPageForDisplay(pdfDoc, next);
        if (!cancelled) rasterCache.current.set(next, rendered);
      } catch {
        // Prefetch is best-effort; a failure just means the page renders on demand.
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pageNumber, pageCount, docReady, pdfDoc]);

  const goToPage = useCallback(
    (n) => {
      if (!Number.isFinite(n)) return;
      const max = pageCount ?? n;
      setPageNumber(Math.min(Math.max(1, Math.round(n)), max));
    },
    [pageCount],
  );

  // Overview panel: fetch fresh on each open so counts/check-offs are current.
  const toggleOverview = useCallback(() => {
    setOverviewOpen((open) => {
      const next = !open;
      if (next) {
        setOverviewLoading(true);
        apiFetch(`/api/checksets/overview?setId=${setId}`)
          .then((r) => r.json())
          .then((d) => { if (!d.error) setOverview(d); })
          .catch(() => {})
          .finally(() => setOverviewLoading(false));
      }
      return next;
    });
  }, [setId]);

  const jumpFromOverview = useCallback(
    (n) => { goToPage(n); setOverviewOpen(false); },
    [goToPage],
  );

  // Write-through helpers so the per-page cache stays in sync with edits.
  const writePageData = useCallback((page, patch) => {
    const prev = pageCache.current.get(page);
    if (!prev) return; // not cached yet — the effect will fetch it fresh
    pageCache.current.set(page, { ...prev, data: { ...prev.data, ...patch } });
  }, []);
  const writePageMarkup = useCallback((page, markup) => {
    const prev = pageCache.current.get(page);
    pageCache.current.set(page, { markup, data: prev?.data ?? EMPTY_PAGE_DATA });
  }, []);

  const handleSaveMarkup = useCallback(
    async (payload) => {
      setSaveState('saving');
      try {
        const res = await apiFetch('/api/checksets/markup', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setId, page: pageNumber, shapes: payload }),
        });
        if (!res.ok) throw new Error('save failed');
        writePageMarkup(pageNumber, payload);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    },
    [setId, pageNumber, writePageMarkup],
  );

  // Toggle a checklist item's "reviewed" check-off. Optimistic; roll back on fail.
  const handleToggleReviewed = useCallback(
    (id) => {
      setReviewedIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        writePageData(pageNumber, { reviewedIds: next });
        apiFetch('/api/checksets/results', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setId, page: pageNumber, reviewedIds: next }),
        })
          .then((res) => { if (!res.ok) throw new Error('save failed'); })
          .catch(() => {
            setReviewedIds(prev);
            writePageData(pageNumber, { reviewedIds: prev });
          });
        return next;
      });
    },
    [setId, pageNumber, writePageData],
  );

  // Reviewer overrides the AI's verdict (or reverts with status = null).
  const handleOverride = useCallback(
    (id, status) => {
      setOverrides((prev) => {
        const next = { ...prev };
        if (status === null) delete next[id];
        else next[id] = status;
        writePageData(pageNumber, { overrides: next });
        apiFetch('/api/checksets/results', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setId, page: pageNumber, overrides: next }),
        })
          .then((res) => { if (!res.ok) throw new Error('save failed'); })
          .catch(() => {
            setOverrides(prev);
            writePageData(pageNumber, { overrides: prev });
          });
        return next;
      });
    },
    [setId, pageNumber, writePageData],
  );

  // Set-level review status (uploaded | in_review | reviewed). Optimistic.
  const handleSetStatus = useCallback(
    (status) => {
      setSet((prev) => {
        if (!prev) return prev;
        const rolledBack = prev;
        apiFetch(`/api/checksets/sets?id=${setId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        })
          .then((res) => { if (!res.ok) throw new Error('save failed'); })
          .catch(() => setSet(rolledBack));
        return { ...prev, status };
      });
    },
    [setId],
  );

  // opts.allItems forces a full 90-item review (escape hatch for a mis-typed sheet).
  const handleAnalyze = useCallback(
    async (opts) => {
      const doc = pdfDoc;
      if (!doc || analyzing) return;
      setAnalyzing(true);
      setError(null);
      try {
        const rendered = await renderPageForAnalysis(doc, pageNumber);
        const { mediaType, base64 } = splitDataUrl(rendered.dataUrl);
        const res = await apiFetch('/api/checksets/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setId, page: pageNumber, imageBase64: base64, mediaType, allItems: opts?.allItems === true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Analysis failed');
        setResults(data.results);
        setModel(data.model);
        if (data.sheet) setSheet(data.sheet);
        setApplicableIds(data.applicable_ids ?? null);
        setAdvisory(data.advisory ?? null);
        setLabelIssue(data.label_issue ?? null);
        // Refresh the cache, preserving this page's reviewed/override state.
        const patch = {
          results: data.results,
          model: data.model,
          applicableIds: data.applicable_ids ?? null,
          advisory: data.advisory ?? null,
          labelIssue: data.label_issue ?? null,
        };
        if (data.sheet) patch.sheet = data.sheet;
        writePageData(pageNumber, patch);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Analysis failed');
      } finally {
        setAnalyzing(false);
      }
    },
    [setId, pageNumber, analyzing, pdfDoc, writePageData],
  );

  // Export: gather every page's saved markup, rasterize the marked ones (via the
  // off-screen MarkupExporter), then POST to flatten them onto the original PDF
  // and save the reviewed copy into the job's Drive "Checksets" folder.
  const handleExport = useCallback(async () => {
    if (!pdfDoc || exportState === 'preparing' || exportState === 'rendering' || exportState === 'uploading') return;
    setExportError(null);
    setExportResult(null);
    setExportState('preparing');
    try {
      const res = await apiFetch(`/api/checksets/markup?setId=${setId}&all=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load markup');

      // Keep only pages that actually have strokes, and attach each page's aspect
      // (rotation-applied, matching the tldraw page-units box) from the PDF.
      const marked = (data.pages ?? []).filter((p) => {
        const shapes = p.shapes?.shapes ?? [];
        return Array.isArray(shapes) && shapes.length > 0;
      });
      if (marked.length === 0) {
        setExportState('error');
        setExportError('Add some markup before exporting — nothing to save yet.');
        return;
      }
      const withAspect = [];
      for (const p of marked) {
        const page = await pdfDoc.getPage(p.page);
        const vp = page.getViewport({ scale: 1 });
        withAspect.push({ page: p.page, shapes: p.shapes, aspect: vp.width / vp.height });
      }
      setExportPages(withAspect); // mounts MarkupExporter
      setExportState('rendering');
    } catch (err) {
      setExportState('error');
      setExportError(err instanceof Error ? err.message : 'Export failed');
    }
  }, [pdfDoc, setId, exportState]);

  const handleMarksRendered = useCallback(
    async (pngs) => {
      setExportPages(null); // unmount the exporter
      setExportState('uploading');
      try {
        const res = await apiFetch('/api/checksets/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setId, pages: pngs }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Export failed');
        setExportResult(data);
        setExportState('done');
      } catch (err) {
        setExportState('error');
        setExportError(err instanceof Error ? err.message : 'Export failed');
      }
    },
    [setId],
  );

  const handleMarksError = useCallback((err) => {
    setExportPages(null);
    setExportState('error');
    setExportError(err instanceof Error ? err.message : 'Could not render markup');
  }, []);

  const exportBusy = exportState === 'preparing' || exportState === 'rendering' || exportState === 'uploading';

  const canPrev = docReady && pageNumber > 1;
  const canNext = docReady && !!pageCount && pageNumber < pageCount;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-1.5 text-sm">
        {onBack && (
          <button onClick={onBack} className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50" aria-label="Back to files">
            ← Files
          </button>
        )}
        <span className="font-mono font-medium">{set?.job_number ?? '…'}</span>

        <select
          value={set?.status ?? 'uploaded'}
          onChange={(e) => handleSetStatus(e.target.value)}
          disabled={!set}
          aria-label="Set review status"
          className={`rounded px-1.5 py-0.5 text-xs font-medium disabled:opacity-40 ${
            SET_STATUSES.find((s) => s.value === set?.status)?.style ?? 'bg-gray-100 text-gray-600'
          }`}
        >
          {SET_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <div className="relative">
          <button
            onClick={toggleOverview}
            className={`rounded border px-2 py-0.5 text-xs hover:bg-gray-50 ${overviewOpen ? 'bg-gray-900 text-white' : ''}`}
            aria-expanded={overviewOpen}
          >
            Sheets{overview ? ` ${overview.analyzedCount}/${overview.pageCount ?? pageCount ?? '?'}` : ''}
          </button>
          {overviewOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOverviewOpen(false)} />
              <SetOverview data={overview} loading={overviewLoading} currentPage={pageNumber} onJump={jumpFromOverview} />
            </>
          )}
        </div>

        <BatchAnalyzeButton
          setId={setId}
          doc={pdfDoc}
          pageCount={pageCount}
          onDone={() => {
            pageCache.current.clear();
            setRefreshKey((k) => k + 1);
            setOverview(null);
          }}
        />

        <button
          onClick={handleExport}
          disabled={!docReady || exportBusy}
          className="rounded border border-gray-900 bg-gray-900 px-2 py-0.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          title="Flatten markup onto the PDF and save it to this job's Drive Checksets folder"
        >
          {exportState === 'preparing' && 'Preparing…'}
          {exportState === 'rendering' && 'Rendering marks…'}
          {exportState === 'uploading' && 'Saving to Drive…'}
          {(exportState === 'idle' || exportState === 'done' || exportState === 'error') && '⤓ Export to Drive'}
        </button>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => goToPage(pageNumber - 1)}
            disabled={!canPrev}
            className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-40"
            aria-label="Previous sheet"
          >
            ← Prev
          </button>
          <span className="text-gray-600">
            Page
            <input
              type="number"
              min={1}
              max={pageCount ?? undefined}
              value={pageNumber}
              onChange={(e) => goToPage(Number(e.target.value))}
              disabled={!docReady}
              className="mx-1 w-12 rounded border px-1 py-0.5 text-center"
            />
            {pageCount ? `of ${pageCount}` : ''}
          </span>
          <button
            onClick={() => goToPage(pageNumber + 1)}
            disabled={!canNext}
            className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-40"
            aria-label="Next sheet"
          >
            Next →
          </button>
        </div>

        {sheet?.label && <span className="font-mono font-medium text-gray-700">{sheet.label}</span>}
        {sheet?.type && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{prettySheetType(sheet.type)}</span>
        )}

        <span className="ml-auto text-xs text-gray-400">
          {saveState === 'saving' && 'Saving markup…'}
          {saveState === 'saved' && 'Markup saved'}
          {saveState === 'error' && <span className="text-red-500">Markup save failed</span>}
        </span>
      </div>

      {error && <p className="border-b bg-red-50 px-4 py-1.5 text-sm text-red-700">{error}</p>}

      {exportState === 'error' && exportError && (
        <p className="border-b bg-red-50 px-4 py-1.5 text-sm text-red-700">Export: {exportError}</p>
      )}
      {exportState === 'done' && exportResult && (
        <p className="border-b border-green-200 bg-green-50 px-4 py-1.5 text-sm text-green-800">
          Saved <span className="font-medium">{exportResult.name}</span> to Drive
          {exportResult.pagesStamped ? ` (${exportResult.pagesStamped} marked ${exportResult.pagesStamped === 1 ? 'sheet' : 'sheets'})` : ''}
          {exportResult.webViewLink && (
            <>
              {' — '}
              <a href={exportResult.webViewLink} target="_blank" rel="noreferrer" className="underline">
                open in Drive
              </a>
            </>
          )}
        </p>
      )}

      {exportPages && exportState === 'rendering' && (
        <MarkupExporter pages={exportPages} onComplete={handleMarksRendered} onError={handleMarksError} />
      )}

      {labelIssue && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-sm text-amber-900">
          ⚠ Possible mislabel — {labelIssue}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-gray-100">
          {display && pageLoaded ? (
            <MarkupOverlay
              key={pageNumber}
              pageImageUrl={display.dataUrl}
              imageWidth={display.width}
              imageHeight={display.height}
              aspect={display.aspect}
              initialMarkup={initialMarkup}
              onSave={handleSaveMarkup}
            />
          ) : error ? (
            <div className="dqa-loading">
              <p className="dqa-loading-text">Could not load the drawing.</p>
            </div>
          ) : (
            <div className="dqa-loading">
              <span className="dqa-spinner" aria-hidden="true" />
              {/* Streaming a set from Drive can take several seconds for a big
                  file; name the phase so a slow fetch reads as loading, not broken. */}
              <p className="dqa-loading-text">
                {docReady ? 'Rendering sheet…' : 'Loading drawing from Drive…'}
              </p>
            </div>
          )}
        </div>
        <ChecklistSidebar
          key={pageNumber}
          results={results}
          applicableIds={applicableIds}
          sheetType={sheet?.type ?? null}
          advisory={advisory}
          reviewedIds={reviewedIds}
          onToggleReviewed={handleToggleReviewed}
          overrides={overrides}
          onOverride={handleOverride}
          analyzing={analyzing}
          model={model}
          onAnalyze={handleAnalyze}
        />
      </div>
    </div>
  );
}
