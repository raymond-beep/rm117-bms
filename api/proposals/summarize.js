// POST /api/proposals/summarize — draft a PROJECT SUMMARY from a brief description.
// Staff-gated. Reads nothing and writes nothing: the draft goes back to the generator's
// textarea for a person to edit before the PDF is built. See _lib/proposal-summary.js for why
// that human step is not optional (this text ends up in a signed contract).
import { requireStaff } from '../_lib/require-staff.js';
import { draftProjectSummary } from '../_lib/proposal-summary.js';

const MAX_BRIEF = 2000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return undefined;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI drafting is not configured.' });
  }

  const { brief, projectType, projectAddress, title } = req.body || {};
  const trimmed = String(brief || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'Describe the project first.' });
  if (trimmed.length > MAX_BRIEF) {
    return res.status(400).json({ error: `Keep the description under ${MAX_BRIEF} characters.` });
  }

  try {
    const result = await draftProjectSummary(trimmed, { projectType, projectAddress, title });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[proposals/summarize]', err);
    return res.status(502).json({ error: err.message || 'Could not draft a summary.' });
  }
}
