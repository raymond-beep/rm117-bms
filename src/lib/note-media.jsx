// Shared rendering for a field note's media: photo thumbnails (open a swipeable
// full-screen viewer), voice players, and a location map link. Used by both the
// mobile capture sheet and the desktop JobEditor Progress tab.
import React, { useEffect, useRef, useState } from 'react';

// Full-screen photo viewer. Swipe (touch) or arrow keys/buttons to move between
// photos; tap outside the image or the ✕ to close.
function Lightbox({ photos, startIndex = 0, onClose }) {
  const [i, setI] = useState(startIndex);
  const touchX = useRef(null);
  const go = (d) => setI((p) => (p + d + photos.length) % photos.length);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photos.length]);

  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40 && photos.length > 1) go(dx < 0 ? 1 : -1);
    touchX.current = null;
  };

  const multi = photos.length > 1;
  return (
    <div className="lb-overlay" onClick={onClose} role="dialog" aria-label="Photo viewer">
      <button className="lb-close" onClick={onClose} aria-label="Close">✕</button>
      {multi && <div className="lb-count">{i + 1} / {photos.length}</div>}
      <div className="lb-stage" onClick={(e) => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {multi && <button className="lb-nav prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>}
        <img className="lb-img" src={photos[i]} alt={`Photo ${i + 1} of ${photos.length}`} />
        {multi && <button className="lb-nav next" onClick={() => go(1)} aria-label="Next photo">›</button>}
      </div>
    </div>
  );
}

export function NoteMedia({ attachments, location }) {
  const list = attachments || [];
  const photos = list.filter((a) => a.type === 'photo' && a.url).map((a) => a.url);
  const [lbIndex, setLbIndex] = useState(null);
  if (list.length === 0 && !location) return null;

  let photoSeen = -1; // running index into `photos` as we walk the attachment list
  return (
    <div className="fn-media">
      {list.map((a, i) => {
        if (a.type === 'photo') {
          if (!a.url) return null;
          const idx = (photoSeen += 1);
          return (
            <button key={i} className="fn-media-thumbbtn" onClick={() => setLbIndex(idx)} aria-label="View photo">
              <img className="fn-media-thumb" src={a.url} alt="Field photo" />
            </button>
          );
        }
        return a.url ? <audio key={i} className="fn-media-audio" controls src={a.url} /> : null;
      })}
      {location && (
        <a className="fn-media-loc" href={`https://www.google.com/maps?q=${location.lat},${location.lng}`} target="_blank" rel="noreferrer">
          📍 {Number(location.lat).toFixed(5)}, {Number(location.lng).toFixed(5)}
        </a>
      )}
      {lbIndex !== null && photos.length > 0 && (
        <Lightbox photos={photos} startIndex={lbIndex} onClose={() => setLbIndex(null)} />
      )}
    </div>
  );
}
