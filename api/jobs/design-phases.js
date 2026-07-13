// GET /api/jobs/design-phases?jobId=… — read the job's signed proposal and SUGGEST how many
// design phases it bought (DPI/DPII/DPIII). Staff-gated, read-only.
//
// ⚠️ This endpoint deliberately does NOT write `design_phase_count`. It returns a suggestion
// the JobEditor pre-fills, and staff confirm it with the normal Save. See proposal-extract.js
// for why: a silently-wrong count truncates a client's design ladder invisibly.
//
// The proposal is the same signed PDF the Payments tab already shows (Drive "Proposal"
// folder, PDFs only, signed contract ranked first — the UX2-01 helper).
import { requireStaff } from '../_lib/require-staff.js';
import { hasDrive, resolveProposalFolderId, listFolderFiles, downloadFileBytes } from '../_lib/google-drive.js';
import { rankProposals } from '../_lib/drive-docs.js';
import { extractDesignPhases } from '../_lib/proposal-extract.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return undefined;

  const jobId = new URL(req.url, 'http://localhost').searchParams.get('jobId');
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Proposal reading is not configured.' });
  }
  if (!hasDrive()) return res.status(503).json({ error: 'Google Drive is not configured.' });

  try {
    const folderId = await resolveProposalFolderId(jobId);
    if (!folderId) {
      return res.status(404).json({ error: 'This job has no Proposal folder in Drive.' });
    }

    // PDFs only, signed contract first — the same ranking the proposal viewer uses.
    const [proposal] = rankProposals(await listFolderFiles(folderId));
    if (!proposal) {
      return res.status(404).json({ error: 'No proposal PDF on file for this job.' });
    }

    const bytes = await downloadFileBytes(proposal.id);
    const result = await extractDesignPhases(bytes);

    return res.status(200).json({
      ...result,
      source: { id: proposal.id, name: proposal.name },
    });
  } catch (err) {
    console.error('[design-phases]', err);
    return res.status(502).json({ error: err.message || 'Could not read the proposal.' });
  }
}
