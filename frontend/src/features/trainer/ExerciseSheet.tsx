import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { loadExercise, type ExerciseDetail } from '../../services/trainer';
import ExerciseMotion from './ExerciseMotion';
import { capital, equipmentName } from './exercises';
import MuscleMap from './MuscleMap';
import { problemText } from './problems';
import { canSpeak, speak, stopSpeaking } from './voice';

interface ExerciseSheetProps {
  exerciseId: string;
  onClose: () => void;
}

export function stepsToRead(exercise: ExerciseDetail): string {
  return [`${exercise.name}.`, ...exercise.instructions.map((step, index) => `Step ${index + 1}. ${step}`)].join(' ');
}

export default function ExerciseSheet({ exerciseId, onClose }: ExerciseSheetProps) {
  const [exercise, setExercise] = useState<ExerciseDetail | null>(null);
  const [problem, setProblem] = useState('');
  const [reading, setReading] = useState(false);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    let current = true;
    setExercise(null);
    setProblem('');
    loadExercise(exerciseId).then(
      (found) => {
        if (current) {
          setExercise(found);
        }
      },
      (error: unknown) => {
        if (current) {
          setProblem(problemText(error));
        }
      },
    );
    return () => {
      current = false;
      stopSpeaking();
    };
  }, [exerciseId]);

  useEffect(() => {
    heading.current?.focus();
  }, [exercise]);

  async function read(): Promise<void> {
    if (!exercise) {
      return;
    }
    if (reading) {
      stopSpeaking();
      setReading(false);
      return;
    }
    setReading(true);
    await speak(stepsToRead(exercise), 'en');
    setReading(false);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div className="exercise-sheet-backdrop" onClick={onClose}>
      <div className="exercise-sheet" role="dialog" aria-modal="true" aria-labelledby="exercise-sheet-title" onClick={(event) => event.stopPropagation()} onKeyDown={keyDown}>
        <header className="exercise-sheet-head">
          <h2 id="exercise-sheet-title" tabIndex={-1} ref={heading}>{exercise?.name ?? 'Exercise'}</h2>
          <button className="button button-secondary button-small" type="button" onClick={onClose}>Close</button>
        </header>
        {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
        {!exercise && !problem && <p className="meeting-empty" role="status">Loading the exercise</p>}
        {exercise && (
          <div className="exercise-detail">
            <div className="exercise-detail-media">
              <ExerciseMotion name={exercise.name} images={exercise.images} />
              <MuscleMap primary={exercise.primary} secondary={exercise.secondary} />
            </div>
            <div className="exercise-detail-text">
              <ul className="exercise-chips" aria-label="About this exercise">
                <li>{equipmentName(exercise.equipment)}</li>
                <li>{capital(exercise.level)}</li>
                <li>{capital(exercise.category)}</li>
                {exercise.mechanic && <li>{capital(exercise.mechanic)}</li>}
              </ul>
              {exercise.instructions.length > 0 ? (
                <ol className="exercise-steps">
                  {exercise.instructions.map((step, index) => <li key={index}>{step}</li>)}
                </ol>
              ) : (
                <p className="form-help">No steps are written for this exercise.</p>
              )}
              {canSpeak() && exercise.instructions.length > 0 && (
                <button className="button button-primary button-small" type="button" aria-pressed={reading} onClick={() => void read()}>
                  {reading ? 'Stop reading' : 'Read the steps aloud'}
                </button>
              )}
              <p className="form-help exercise-credit">Pictures and steps from the Free Exercise DB, an open, public domain exercise list.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
