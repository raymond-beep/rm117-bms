// Composing the client update email. Pure — no network, no db — so the wording can be
// tested and reviewed without sending anything to a real person.
//
// This email IS the portal. Nobody logs into a portal out of habit; they click a link in an
// email. So the email carries the update AND the way in (a magic link), and the portal is
// simply where the link lands. The goal Ray picked is "kill 'any update?' emails" — which
// means this has to read like a person wrote it, not like a system notification.
//
// Deliberately NOT in this email: money, sub-phases (Prep/Outgoing, DPI/II/III), job IDs,
// phase jargon. A client who reads "your CDs are 90% complete" replies "so where's my set?"

// The client-facing name for each phase — plain English, matching the portal's ladder.
// "CD" reads as a compact disc to a homeowner; "Outgoing" means nothing at all.
const CLIENT_PHASE = {
  lead: 'getting started',
  potential: 'proposal stage',
  survey_zoning: 'survey and zoning',
  design_phase: 'design',
  cd_prep: 'construction drawings',
  cd_outgoing: 'construction drawings',
  permitting: 'permitting',
  construction: 'construction',
  completed: 'complete',
  on_hold: 'on hold',
};

// A one-line, human description of where the job is. This is the sentence the client
// actually reads, so it's written as a status, not a label.
export function phaseSentence(phase) {
  switch (phase) {
    case 'survey_zoning': return 'We’re working through the survey and zoning analysis.';
    case 'design_phase': return 'We’re in the design phase.';
    case 'cd_prep':
    case 'cd_outgoing': return 'We’re preparing your construction drawings.';
    case 'permitting': return 'Your drawings are with the town for permitting.';
    case 'construction': return 'Your project is under construction.';
    case 'completed': return 'Your project is complete.';
    case 'on_hold': return 'Your project is currently on hold.';
    default: return `Your project is in ${CLIENT_PHASE[phase] || 'progress'}.`;
  }
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// A job's street line — clients think in addresses, not Job IDs.
export function projectLabel(job) {
  const line1 = String(job?.address || '').split('\n')[0].split(',')[0].trim();
  return line1 || job?.client_name || job?.job_id || 'your project';
}

const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
};

// Build the email a client receives. `link` is the magic link — it is both the notification
// and the way in, which is the whole design.
export function buildUpdateEmail({ job, client, link, senderName, note }) {
  const label = projectLabel(job);
  const hi = firstName(client?.name);

  const lines = [];
  lines.push(hi ? `Hi ${hi},` : 'Hi,');
  lines.push('');
  lines.push(`A quick update on ${label}. ${phaseSentence(job?.phase)}`);

  // Staff can add a sentence of their own — the single most useful thing in the email, and
  // the reason this is a button a person presses rather than an automatic trigger.
  if (note && note.trim()) {
    lines.push('');
    lines.push(note.trim());
  }

  if (job?.next_milestone_label) {
    const when = fmtDate(job.next_milestone_date);
    lines.push('');
    lines.push(when ? `Next up: ${job.next_milestone_label} — ${when}.` : `Next up: ${job.next_milestone_label}.`);
  }

  lines.push('');
  lines.push('You can see where everything stands, and get to your documents, here:');
  lines.push(link);
  lines.push('');
  lines.push('No password needed — the link signs you in. Just reply to this email if you have any questions.');
  lines.push('');
  lines.push(senderName || 'Room 117 Architecture & Design');

  return {
    to: client?.email,
    subject: `Update on ${label}`,
    text: lines.join('\n'),
  };
}
