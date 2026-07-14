// BMS job card — presentational body (shared by the in-list card and the drag
// overlay) + the sortable wrapper with its own drag handle (grip).
import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { money, fmtDateOnly, addressLine, subPhaseLabel, isStalled, daysInPhase, PHASE_AGE_LIMITS } from '../../lib/format.js';

// Presentational card contents — shared by the in-list card and the drag overlay.
export function JobCardBody({ job, todayStr }) {
  const sub = subPhaseLabel(job);            // Prep / Outgoing / DPI… — internal only
  const stalled = isStalled(job);            // overstayed its phase (Ang's 14/21-day rules)
  return (
    <>
      <div className="job-card-left">
        <div className="job-card-id">
          {job.job_id}
          {sub && <span className="badge badge-sub">{sub}</span>}
          {job.is_forefront && <span className="badge badge-ff">FF</span>}
          {job.is_fire_escape && <span className="badge badge-fe" title="Fire Escape job">FE</span>}
          {job.bill_flag && <span className="badge badge-bill">BILL</span>}
        </div>
        <div className="job-card-client">{job.client_name || <span className="muted">—</span>}</div>
        {job.address && <div className="job-card-sub">{addressLine(job.address)}</div>}
        {stalled && (
          <div className="job-card-stalled">
            ⚠ {daysInPhase(job)} days in this phase (limit {PHASE_AGE_LIMITS[job.phase]})
          </div>
        )}
        {job.next_milestone_date && (
          <div className={`job-card-milestone${String(job.next_milestone_date).slice(0, 10) < todayStr ? ' overdue' : ''}`}>
            ◆ {job.next_milestone_label || 'Next'} · {fmtDateOnly(job.next_milestone_date)}
          </div>
        )}
        {job.last_correspondence && <div className="job-card-corr">{job.last_correspondence}</div>}
      </div>
      <div className="job-card-right">
        <div className="job-card-total">{money(job.job_total)}</div>
        {Number(job.outstanding) > 0 && (
          <div className="job-card-outstanding">{money(job.outstanding)} left</div>
        )}
      </div>
    </>
  );
}

// A sortable job card with a dedicated drag handle (grip). Tapping the card
// opens the editor; dragging the grip reorders within / moves between phases.
// Separating the two keeps tap-to-open and scroll working cleanly on touch.
export function SortableJobCard({ job, todayStr, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.job_id });
  const style = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={`job-card${isDragging ? ' is-dragging' : ''}`} onClick={() => onOpen(job)}>
      <button
        className="job-card-grip"
        aria-label={`Reorder or move ${job.job_id}`}
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="3" r="1.5" /><circle cx="10" cy="3" r="1.5" />
          <circle cx="4" cy="9" r="1.5" /><circle cx="10" cy="9" r="1.5" />
          <circle cx="4" cy="15" r="1.5" /><circle cx="10" cy="15" r="1.5" />
        </svg>
      </button>
      <JobCardBody job={job} todayStr={todayStr} />
    </div>
  );
}
