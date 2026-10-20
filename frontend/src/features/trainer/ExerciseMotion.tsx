import { useState } from 'react';

interface ExerciseMotionProps {
  name: string;
  images: readonly string[];
  small?: boolean;
}

export default function ExerciseMotion({ name, images, small = false }: ExerciseMotionProps) {
  const [paused, setPaused] = useState(false);
  const [broken, setBroken] = useState(false);
  const [start, finish] = images;

  if (!start || broken) {
    return (
      <div className="motion motion-missing" data-small={small} role="img" aria-label={`No pictures for ${name}`}>
        <span>No pictures for this one yet</span>
      </div>
    );
  }

  return (
    <div className="motion" data-small={small} data-paused={paused}>
      <div className="motion-frames" role="img" aria-label={`${name}: moving between the start and the end position`}>
        <img src={start} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        {finish && <img className="motion-end" src={finish} alt="" loading="lazy" decoding="async" />}
      </div>
      {finish && !small && (
        <button className="motion-toggle" type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
          {paused ? 'Play' : 'Pause'}
        </button>
      )}
    </div>
  );
}
