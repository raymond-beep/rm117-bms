// Checkset checklist (CHECKS.md) parsing + prompt building. Ported from the
// standalone Checksets app (src/lib/checks.ts + the SHEET_TYPES vocab from
// types.ts). Server-only. CHECKS.md (this folder) is the source of truth — the
// model evaluates ONLY these items, keyed by their stable ids.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Sheet-type vocabulary: CHECKS.md `applies to` values, plus "general_notes"
// (no checklist — just a verify-by-hand note) and "other" (cover/roof/misc).
export const SHEET_TYPES = [
  'site',
  'existing_plan',
  'proposed_plan',
  'existing_elevation',
  'proposed_elevation',
  'section',
  'electrical',
  'framing',
  'general_notes',
  'other',
];

const CHECKS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'CHECKS.md');

const GROUP_RE = /^##\s+([A-Z]{2,5})\s+—\s+(.+)$/;
const ITEM_RE = /^###\s+([A-Z]{2,5}-\d{2})\s+—\s+(.+)$/;

let cache = null; // { items, mtimeMs }

export function loadChecklist() {
  const stat = fs.statSync(CHECKS_PATH);
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.items;

  const lines = fs.readFileSync(CHECKS_PATH, 'utf8').split('\n');
  const items = [];
  let group = '';
  let groupTitle = '';
  let current = null;
  let collecting = null;

  const flush = () => {
    if (current) items.push(current);
    current = null;
    collecting = null;
  };

  let inComment = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    // Skip HTML comment blocks (the add-an-item template at the bottom of
    // CHECKS.md has bullet lines that would otherwise leak into the last item).
    if (line.includes('<!--')) inComment = true;
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    const g = line.match(GROUP_RE);
    if (g) {
      flush();
      group = g[1];
      groupTitle = g[2].replace(/\*/g, '').trim();
      continue;
    }
    const it = line.match(ITEM_RE);
    if (it) {
      flush();
      current = { id: it[1], group, groupTitle, label: it[2].trim(), criteria: '', appliesTo: [] };
      continue;
    }
    if (!current) continue;

    const crit = line.match(/^-\s+\*\*Criteria:\*\*\s*(.*)$/);
    if (crit) {
      current.criteria = crit[1].trim();
      collecting = 'criteria';
      continue;
    }
    const applies = line.match(/^-\s+\*\*Applies to:\*\*\s*(.*)$/);
    if (applies) {
      current.appliesTo = applies[1].split(',').map((s) => s.trim()).filter(Boolean);
      collecting = null;
      continue;
    }
    if (collecting === 'criteria' && line.startsWith('  ') && line.trim()) {
      current.criteria += ' ' + line.trim();
    }
  }
  flush();

  if (items.length === 0) throw new Error('CHECKS.md parsed to zero items — check the file format');
  cache = { items, mtimeMs: stat.mtimeMs };
  return items;
}

// Item ids relevant to a sheet type (an item applies if appliesTo includes the
// type, or appliesTo is empty = always-on). Focuses the sidebar on what matters.
export function applicableIdsForType(sheetType) {
  return loadChecklist()
    .filter((i) => i.appliesTo.length === 0 || i.appliesTo.includes(sheetType))
    .map((i) => i.id);
}

// The checklist portion of the analyze system prompt — byte-identical across a
// set's pages so it sits behind a prompt-cache breakpoint (see the analyze route).
export function checklistPromptText() {
  const items = loadChecklist();
  const out = ['<checklist>'];
  let lastGroup = '';
  for (const item of items) {
    if (item.group !== lastGroup) {
      out.push(`\n## ${item.group} — ${item.groupTitle}`);
      lastGroup = item.group;
    }
    const applies = item.appliesTo.length ? ` (applies to: ${item.appliesTo.join(', ')})` : '';
    out.push(`- ${item.id} — ${item.label}${applies}\n  Pass criteria: ${item.criteria}`);
  }
  out.push('</checklist>');
  return out.join('\n');
}
