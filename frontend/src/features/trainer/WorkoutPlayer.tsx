import { useCallback, useEffect, useRef, useState } from 'react';

import { addEntry, firstNumber, loadExercise, type ExerciseDetail, type WorkoutDay } from '../../services/trainer';
import ExerciseMotion from './ExerciseMotion';
import { exerciseLine, finishLine, introLine, restLine, setLine } from './exercises';
import MuscleMap from './MuscleMap';
import { problemText } from './problems';
import { canSpeak, saveVoiceWanted, speak, stopSpeaking, voiceWanted } from './voice';

type Stage = 'warmup' | 'exercise' | 'rest' | 'done';

interface WorkoutPlayerProps {
  plan: WorkoutDay;
  day: string;
  onClose: () => void;
  onLogged: () => void;
  onShow: (id: string) => void;
}

interface WakeLock {
  release: () => Promise<void>;
}

const COUNTDOWN_WORD_AT = 10;

export default function WorkoutPlayer({ plan, day, onClose, onLogged, onShow }: WorkoutPlayerProps) {
  const exercises = plan.exercises;
  const [stage, setStage] = useState<Stage>(plan.warmup ? 'warmup' : 'exercise');
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<number[]>(() => exercises.map(() => 0));
  const [logged, setLogged] = useState<boolean[]>(() => exercises.map(() => false));
  const [weights, setWeights] = useState<string[]>(() => exercises.map(() => ''));
  const [remaining, setRemaining] = useState(0);
  const [restFor, setRestFor] = useState<'set' | 'exercise'>('set');
  const [voice, setVoice] = useState(() => voiceWanted() && canSpeak());
  const [detail, setDetail] = useState<ExerciseDetail | null>(null);
  const [problem, setProblem] = useState('');
  const voiceRef = useRef(voice);
  const dialog = useRef<HTMLDivElement | null>(null);

  const current = exercises[index];
  const say = useCallback((text: string) => {
    if (voiceRef.current) {
      void speak(text, 'en');
    }
  }, []);

  useEffect(() => {
    voiceRef.current = voice;
    if (!voice) {
      stopSpeaking();
    }
  }, [voice]);

  useEffect(() => {
    dialog.current?.focus();
    const first = exercises[0];
    say(plan.warmup || !first ? introLine(plan) : `${introLine(plan)} ${exerciseLine(first, 0, exercises.length)} ${setLine(1, first.sets, first.reps)}`);
    let lock: WakeLock | null = null;
    const screen = (globalThis.navigator as Navigator & { wakeLock?: { request: (kind: 'screen') => Promise<WakeLock> } }).wakeLock;
    screen?.request('screen').then((granted) => {
      lock = granted;
    }, () => undefined);
    return () => {
      stopSpeaking();
      void lock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const id = current?.library_id;
    setDetail(null);
    if (!id) {
      return;
    }
    let active = true;
    loadExercise(id).then((found) => {
      if (active) {
        setDetail(found);
      }
    }, () => undefined);
    return () => {
      active = false;
    };
  }, [current?.library_id]);

  const log = useCallback(async (position: number, sets: number) => {
    const exercise = exercises[position];
    if (!exercise || sets === 0 || logged[position]) {
      return;
    }
    setLogged((old) => old.map((value, place) => (place === position ? true : value)));
    const weight = Number((weights[position] ?? '').replace(',', '.'));
    try {
      await addEntry(day, {
        kind: 'exercise',
        name: exercise.name,
        sets,
        reps: firstNumber(exercise.reps),
        weight_kg: Number.isFinite(weight) && weight > 0 ? weight : null,
        minutes: null,
      });
      onLogged();
    } catch (error) {
      setLogged((old) => old.map((value, place) => (place === position ? false : value)));
      setProblem(problemText(error));
    }
  }, [day, exercises, logged, onLogged, weights]);

  const finish = useCallback((total: number) => {
    setStage('done');
    say(finishLine(plan, total));
  }, [plan, say]);

  const startExercise = useCallback((position: number) => {
    const exercise = exercises[position];
    if (!exercise) {
      return;
    }
    setIndex(position);
    setStage('exercise');
    say(`${exerciseLine(exercise, position, exercises.length)} ${setLine((done[position] ?? 0) + 1, exercise.sets, exercise.reps)}`);
  }, [done, exercises, say]);

  const afterRest = useCallback(() => {
    if (!current) {
      return;
    }
    if (restFor === 'set') {
      setStage('exercise');
      say(setLine((done[index] ?? 0) + 1, current.sets, current.reps));
    } else {
      startExercise(index + 1);
    }
  }, [current, done, index, restFor, say, startExercise]);

  useEffect(() => {
    if (stage !== 'rest') {
      return;
    }
    if (remaining <= 0) {
      afterRest();
      return;
    }
    if (remaining === COUNTDOWN_WORD_AT) {
      say(`${COUNTDOWN_WORD_AT} seconds.`);
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [stage, remaining, afterRest, say]);

  function setDoneNow(): void {
    if (!current) {
      return;
    }
    const sets = (done[index] ?? 0) + 1;
    const nextDone = done.map((value, place) => (place === index ? sets : value));
    setDone(nextDone);
    const total = nextDone.reduce((sum, value) => sum + value, 0);
    if (sets < current.sets) {
      if (current.rest_seconds > 0) {
        setRestFor('set');
        setRemaining(current.rest_seconds);
        setStage('rest');
        say(restLine(current.rest_seconds, `Next: set ${sets + 1}.`));
      } else {
        say(setLine(sets + 1, current.sets, current.reps));
      }
      return;
    }
    void log(index, sets);
    const next = exercises[index + 1];
    if (!next) {
      finish(total);
      return;
    }
    if (current.rest_seconds > 0) {
      setRestFor('exercise');
      setRemaining(current.rest_seconds);
      setStage('rest');
      say(restLine(current.rest_seconds, `Next: ${next.name}.`));
    } else {
      startExercise(index + 1);
    }
  }

  function skip(): void {
    void log(index, done[index] ?? 0);
    if (index + 1 < exercises.length) {
      startExercise(index + 1);
    } else {
      finish(done.reduce((sum, value) => sum + value, 0));
    }
  }

  function end(): void {
    if (stage === 'done') {
      onClose();
      return;
    }
    void log(index, done[index] ?? 0);
    finish(done.reduce((sum, value) => sum + value, 0));
  }

  function toggleVoice(): void {
    const next = !voice;
    setVoice(next);
    saveVoiceWanted(next);
  }

  const total = done.reduce((sum, value) => sum + value, 0);
  const planned = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  const nextExercise = exercises[index + 1];

  return (
    <div className="player-backdrop">
      <div className="player" role="dialog" aria-modal="true" aria-labelledby="player-title" tabIndex={-1} ref={dialog}>
        <header className="player-head">
          <div>
            <p className="player-eyebrow">Guided workout · {plan.focus}</p>
            <h2 id="player-title">
              {stage === 'warmup' ? 'Warm up' : stage === 'done' ? 'Workout done' : `${current?.name ?? ''}`}
            </h2>
          </div>
          <div className="player-tools">
            {canSpeak() && (
              <button className="button button-secondary button-small" type="button" aria-pressed={voice} onClick={toggleVoice}>
                {voice ? 'Voice on' : 'Voice off'}
              </button>
            )}
            <button className="button button-secondary button-small" type="button" onClick={end}>
              {stage === 'done' ? 'Close' : 'End workout'}
            </button>
          </div>
        </header>
        <div className="player-progress" role="progressbar" aria-label="Sets done" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={total}>
          <span style={{ width: `${planned ? Math.round((total / planned) * 100) : 0}%` }} />
        </div>
        {problem && <p className="notice notice-danger" role="alert">{problem}</p>}

        {stage === 'warmup' && (
          <div className="player-center">
            <p className="player-big">{plan.warmup}</p>
            <button className="button button-primary player-go" type="button" onClick={() => startExercise(0)}>I'm warmed up, start</button>
          </div>
        )}

        {(stage === 'exercise' || stage === 'rest') && current && (
          <div className="player-main">
            <div className="player-media">
              {detail ? (
                <>
                  <ExerciseMotion name={current.name} images={detail.images} />
                  <MuscleMap primary={detail.primary} secondary={detail.secondary} compact />
                </>
              ) : (
                <div className="motion motion-missing"><span>{current.library_id ? 'Loading the demo' : 'No demo for this exercise'}</span></div>
              )}
            </div>
            <div className="player-info">
              <p className="player-step">Exercise {index + 1} of {exercises.length}</p>
              <ol className="player-sets" aria-label={`Set ${Math.min((done[index] ?? 0) + 1, current.sets)} of ${current.sets}`}>
                {Array.from({ length: current.sets }, (_, set) => (
                  <li key={set} data-done={set < (done[index] ?? 0)} data-now={set === (done[index] ?? 0)}>{set + 1}</li>
                ))}
              </ol>
              {stage === 'rest' ? (
                <div className="player-rest" role="timer" aria-live="off">
                  <p className="player-count">{remaining}</p>
                  <p>Rest. {restFor === 'set' ? `Next: set ${(done[index] ?? 0) + 1}` : `Next: ${nextExercise?.name ?? ''}`}</p>
                  <div className="meeting-actions">
                    <button className="button button-primary" type="button" onClick={() => setRemaining(0)}>Skip rest</button>
                    <button className="button button-secondary" type="button" onClick={() => setRemaining(remaining + 15)}>+15 s</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="player-big">{current.reps}</p>
                  {current.how && <p className="player-cue">{current.how}</p>}
                  <label className="field-label player-weight">
                    Weight (kg, optional)
                    <input
                      className="text-input"
                      inputMode="decimal"
                      value={weights[index] ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setWeights((old) => old.map((item, place) => (place === index ? value : item)));
                      }}
                    />
                  </label>
                  <button className="button button-primary player-go" type="button" onClick={setDoneNow}>
                    Set {Math.min((done[index] ?? 0) + 1, current.sets)} done
                  </button>
                </>
              )}
              <div className="player-nav">
                <button className="button button-link" type="button" disabled={index === 0} onClick={() => startExercise(index - 1)}>Previous</button>
                {current.library_id && <button className="button button-link" type="button" onClick={() => onShow(current.library_id!)}>How to</button>}
                <button className="button button-link" type="button" onClick={skip}>{index + 1 < exercises.length ? 'Skip exercise' : 'Skip and finish'}</button>
              </div>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className="player-center">
            <p className="player-big">{total} of {planned} sets</p>
            <ul className="player-summary">
              {exercises.map((exercise, place) => (
                <li key={`${exercise.name}-${place}`} data-done={(done[place] ?? 0) > 0}>
                  {exercise.name}: {done[place] ?? 0} of {exercise.sets} sets{logged[place] ? ' · logged' : ''}
                </li>
              ))}
            </ul>
            {plan.cooldown && <p className="plan-note"><strong>Cool-down:</strong> {plan.cooldown}</p>}
            <button className="button button-primary player-go" type="button" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
