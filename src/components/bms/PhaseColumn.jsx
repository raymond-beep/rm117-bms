// A phase section: a sortable list of its cards that also accepts drops into its
// empty area. Always rendered (even when empty) so every phase is a drop target,
// like the sections in Ang's Sheet.
import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { PHASE_LABELS } from '../../lib/format.js';
import { SortableJobCard } from './JobCard.jsx';

export default function PhaseColumn({ phase, ids, jobById, todayStr, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: phase });
  return (
    <div className={`phase-group${isOver ? ' drop-over' : ''}`}>
      <div className={`phase-group-header phase-header-${phase}`}>
        <span className="phase-group-name">{PHASE_LABELS[phase]}</span>
        <span className="phase-group-count">{ids.length}</span>
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="phase-group-jobs">
          {ids.length === 0 ? (
            <div className="phase-group-empty">Drop a job here</div>
          ) : (
            ids.map((id) => {
              const job = jobById.get(id);
              return job ? <SortableJobCard key={id} job={job} todayStr={todayStr} onOpen={onOpen} /> : null;
            })
          )}
        </div>
      </SortableContext>
    </div>
  );
}
