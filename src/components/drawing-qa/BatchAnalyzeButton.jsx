// Set-level "Analyze all sheets" action. Ported from Checksets. User-initiated
// with an explicit confirm — never fires on upload, per the on-demand cost rule.
//
// Speed: the first sheet runs alone to prime the prompt cache (the checklist
// system block is byte-identical across pages), then the rest fan out through a
// small bounded worker pool so the fanned-out calls read the warm cache and we
// don't trip the model's rate limits.
import { useCallback, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { renderPageForAnalysis, splitDataUrl } from './pdf.js';

// How many sheets to analyze concurrently after the cache-priming first sheet.
const CONCURRENCY = 3;

export default function BatchAnalyzeButton({ setId, doc, pageCount, onDone }) {
  const [mode, setMode] = useState('idle');
  const [todo, setTodo] = useState([]); // pages to analyze this run
  const [reanalyzeAll, setReanalyzeAll] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const cancelRef = useRef(false);

  const ready = !!doc && !!pageCount;

  // Work out which sheets still need analyzing (from the overview), then confirm.
  const openConfirm = useCallback(async () => {
    if (!pageCount) return;
    let analyzed = new Set();
    try {
      const res = await apiFetch(`/api/checksets/overview?setId=${setId}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.sheets)) {
        analyzed = new Set(data.sheets.map((s) => s.page));
      }
    } catch {
      // fall through with an empty set — worst case we offer to analyze all
    }
    const all = Array.from({ length: pageCount }, (_, i) => i + 1);
    const remaining = all.filter((p) => !analyzed.has(p));
    setReanalyzeAll(remaining.length === 0);
    setTodo(remaining.length === 0 ? all : remaining);
    setMode('confirm');
  }, [setId, pageCount]);

  const run = useCallback(async () => {
    if (!doc) return;
    cancelRef.current = false;
    setDone(0);
    setFailed(0);
    setMode('running');

    const analyzeOne = async (page) => {
      try {
        const rendered = await renderPageForAnalysis(doc, page);
        const { mediaType, base64 } = splitDataUrl(rendered.dataUrl);
        const res = await apiFetch('/api/checksets/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setId, page, imageBase64: base64, mediaType }),
        });
        if (!res.ok) throw new Error('analyze failed');
        setDone((d) => d + 1);
      } catch {
        setFailed((f) => f + 1);
      }
    };

    const queue = [...todo];

    // Prime the prompt cache with the first sheet alone, so the fanned-out rest
    // read the cached checklist block instead of each paying it cold.
    if (queue.length > 1 && !cancelRef.current) {
      await analyzeOne(queue.shift());
    }

    // Drain the remaining pages through a bounded pool.
    const worker = async () => {
      for (let page = queue.shift(); page !== undefined; page = queue.shift()) {
        if (cancelRef.current) break;
        await analyzeOne(page);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    setMode('done');
    onDone();
    setTimeout(() => setMode('idle'), 4000);
  }, [doc, todo, setId, onDone]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  if (mode === 'idle') {
    return (
      <button
        onClick={openConfirm}
        disabled={!ready}
        className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-40"
      >
        Analyze all
      </button>
    );
  }

  if (mode === 'confirm') {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-gray-600">
          {reanalyzeAll
            ? `All ${todo.length} sheets already analyzed — re-analyze all?`
            : `Analyze ${todo.length} sheet${todo.length > 1 ? 's' : ''}? (one AI call each)`}
        </span>
        <button onClick={run} className="rounded border bg-gray-900 px-2 py-0.5 text-white hover:bg-gray-700">
          {reanalyzeAll ? 'Re-analyze all' : 'Analyze'}
        </button>
        <button onClick={() => setMode('idle')} className="rounded border px-2 py-0.5 hover:bg-gray-50">
          Cancel
        </button>
      </span>
    );
  }

  if (mode === 'running') {
    const total = todo.length;
    const pct = total ? Math.round(((done + failed) / total) * 100) : 0;
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-gray-600">Analyzing… {done + failed} of {total} done</span>
        <span className="h-1.5 w-24 overflow-hidden rounded bg-gray-200">
          <span className="block h-full bg-gray-800" style={{ width: `${pct}%` }} />
        </span>
        <button onClick={cancel} className="rounded border px-2 py-0.5 hover:bg-gray-50">
          Stop
        </button>
      </span>
    );
  }

  // done
  return (
    <span className="text-xs text-gray-600">
      Analyzed {done} sheet{done === 1 ? '' : 's'}
      {failed > 0 && <span className="text-red-600"> · {failed} failed</span>}
    </span>
  );
}
