import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import { deletePhoto, listPhotos, localDay, photoUrl, uploadPhoto, type Photo } from '../../services/trainer';
import { shrinkPhoto } from './photos';
import { problemText } from './problems';

function dateOf(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function daysBetween(first: string, last: string): number {
  const start = new Date(`${first}T12:00:00`).getTime();
  const end = new Date(`${last}T12:00:00`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function apart(days: number): string {
  if (days === 0) {
    return 'Taken on the same day. Add one in a week or two to see the change.';
  }
  return days === 1 ? '1 day apart' : `${days} days apart`;
}

export default function ProgressPhotos() {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [open, setOpen] = useState<Photo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPhotos(await listPhotos('body'));
    } catch (error) {
      setProblem(problemText(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      await uploadPhoto(await shrinkPhoto(file), localDay(), 'body');
      await refresh();
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(photo: Photo): Promise<void> {
    try {
      await deletePhoto(photo.id);
      setOpen(null);
      setDeleting(false);
      await refresh();
    } catch (error) {
      setProblem(problemText(error));
    }
  }

  const newest = photos?.[0] ?? null;
  const oldest = photos && photos.length > 1 ? photos[photos.length - 1]! : null;

  return (
    <section className="trainer-card progress-photos" aria-labelledby="progress-photos-title">
      <header className="progress-photos-head">
        <div>
          <h3 id="progress-photos-title">Progress photos</h3>
          <p className="form-help">Take one every week or two in the same spot and light. They stay in your account only and are never sent to the AI.</p>
        </div>
        <input ref={picker} className="visually-hidden" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(event) => void add(event)} />
        <button className="button button-primary button-small" type="button" disabled={busy} onClick={() => picker.current?.click()}>
          {busy ? 'Saving the photo' : 'Add a photo'}
        </button>
      </header>
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
      {photos && photos.length === 0 && <p className="meeting-empty">No photos yet. Your first one is the start line.</p>}
      {newest && oldest && (
        <div className="photo-compare" aria-label="First and latest photo">
          {[oldest, newest].map((photo, index) => (
            <figure key={photo.id}>
              <img src={photoUrl(photo.id)} alt={`${index === 0 ? 'First' : 'Latest'} progress photo, ${dateOf(photo.day)}`} loading="lazy" />
              <figcaption>{index === 0 ? 'First' : 'Latest'} · {dateOf(photo.day)}</figcaption>
            </figure>
          ))}
          <p className="form-help photo-compare-gap">{apart(daysBetween(oldest.day, newest.day))}</p>
        </div>
      )}
      {photos && photos.length > 0 && (
        <ul className="photo-strip" aria-label="All progress photos">
          {photos.map((photo) => (
            <li key={photo.id}>
              <button type="button" className="photo-thumb" onClick={() => { setOpen(photo); setDeleting(false); }} aria-label={`Open the photo from ${dateOf(photo.day)}`}>
                <img src={photoUrl(photo.id)} alt="" loading="lazy" />
                <span>{dateOf(photo.day)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="photo-open">
          <img src={photoUrl(open.id)} alt={`Progress photo, ${dateOf(open.day)}`} />
          <div className="meeting-actions">
            <a className="button button-secondary button-small" href={photoUrl(open.id)} target="_blank" rel="noreferrer">Open full size</a>
            {deleting ? (
              <>
                <button className="button button-small meeting-cancel" type="button" onClick={() => void remove(open)}>Yes, delete it</button>
                <button className="button button-link" type="button" onClick={() => setDeleting(false)}>Keep it</button>
              </>
            ) : (
              <button className="button button-link" type="button" onClick={() => setDeleting(true)}>Delete…</button>
            )}
            <button className="button button-link" type="button" onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
