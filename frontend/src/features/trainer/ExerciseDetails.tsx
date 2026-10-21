import { useEffect, useState } from 'react';

import { loadExercise, type Equipment, type Exercise, type ExerciseCard, type ExerciseDetail, type Level } from '../../services/trainer';
import { capital, equipmentName, muscleList } from './exercises';
import { problemText } from './problems';
import { alternatives, videoLink } from './progression';

interface ExerciseDetailsProps {
  exercise: Exercise;
  cards: readonly ExerciseCard[] | null;
  equipment: Equipment;
  level: Level;
  busy?: boolean;
  onSwap?: (card: ExerciseCard) => void;
  onOpen: (id: string) => void;
  onLookUp: (name: string) => void;
}

export default function ExerciseDetails({ exercise, cards, equipment, level, busy = false, onSwap, onOpen, onLookUp }: ExerciseDetailsProps) {
  const [detail, setDetail] = useState<ExerciseDetail | null>(null);
  const [problem, setProblem] = useState('');
  const id = exercise.library_id ?? '';

  useEffect(() => {
    let current = true;
    setDetail(null);
    setProblem('');
    if (!id) {
      return undefined;
    }
    loadExercise(id).then(
      (found) => current && setDetail(found),
      (error: unknown) => current && setProblem(problemText(error)),
    );
    return () => {
      current = false;
    };
  }, [id]);

  const card = cards?.find((item) => item.id === id) ?? null;
  const swaps = card && cards ? alternatives(card, cards, equipment, level) : [];
  const [start, finish] = detail?.images ?? [];

  return (
    <div className="exercise-inline">
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
      {id && !detail && !problem && <p className="form-help" role="status">Loading how to do it</p>}
      {detail && (
        <div className="exercise-inline-how">
          {start && (
            <div className="exercise-frames">
              <figure>
                <img src={start} alt={`${detail.name}, start position`} loading="lazy" />
                <figcaption>Start</figcaption>
              </figure>
              {finish && (
                <figure>
                  <img src={finish} alt={`${detail.name}, end position`} loading="lazy" />
                  <figcaption>Finish</figcaption>
                </figure>
              )}
            </div>
          )}
          <div className="exercise-inline-text">
            <p className="exercise-inline-muscles">
              Works <strong>{muscleList(detail.primary)}</strong>
              {detail.secondary.length > 0 && <>, and also {muscleList(detail.secondary).toLowerCase()}</>}. {equipmentName(detail.equipment)}, {detail.level}.
            </p>
            {detail.instructions.length > 0 && (
              <ol className="exercise-steps">
                {detail.instructions.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
            )}
          </div>
        </div>
      )}
      {!id && <p className="form-help">This exercise has no pictures in the library.</p>}
      <div className="exercise-inline-links">
        <a className="button button-secondary button-small" href={videoLink(exercise.name)} target="_blank" rel="noreferrer">
          Watch videos of it
        </a>
        {id ? (
          <button className="button button-link" type="button" onClick={() => onOpen(id)}>
            Bigger, with the steps read aloud
          </button>
        ) : (
          <button className="button button-link" type="button" onClick={() => onLookUp(exercise.name)}>
            Find it in Exercises
          </button>
        )}
      </div>
      {swaps.length > 0 && (
        <div className="exercise-swaps">
          <p className="exercise-swaps-title">Other ways to train the same muscles</p>
          <ul>
            {swaps.map((option) => (
              <li key={option.id}>
                {option.images[0] ? <img src={option.images[0]} alt="" loading="lazy" /> : <span className="exercise-swaps-blank" aria-hidden="true" />}
                <span className="exercise-swaps-name">
                  <strong>{option.name}</strong>
                  <small>{equipmentName(option.equipment)}, {capital(option.level)}</small>
                </span>
                {onSwap && (
                  <button className="button button-secondary button-small" type="button" disabled={busy} aria-label={`Swap ${exercise.name} for ${option.name}`} onClick={() => onSwap(option)}>
                    Swap
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
