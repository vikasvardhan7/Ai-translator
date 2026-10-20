import { useState } from 'react';

import { savePlan, type Exercise, type TrainerState, type WorkoutDay, type WorkoutPlan } from '../../services/trainer';
import { dayName } from './labels';
import PlanMaker from './PlanMaker';
import { problemText } from './problems';

interface WorkoutTabProps {
  state: TrainerState;
  onState: (state: TrainerState) => void;
  onShow: (id: string) => void;
  onLookUp: (name: string) => void;
}

interface Looking {
  onShow: (id: string) => void;
  onLookUp: (name: string) => void;
}

const BLANK: Exercise = { name: '', sets: 3, reps: '10', rest_seconds: 60, how: '' };

function DayEditor({ day, onSave, onCancel }: { day: WorkoutDay; onSave: (day: WorkoutDay) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<WorkoutDay>(day);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  function change(index: number, update: Partial<Exercise>): void {
    setDraft((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, place) => (place === index ? { ...exercise, ...update } : exercise)),
    }));
  }

  async function save(): Promise<void> {
    const cleaned = { ...draft, exercises: draft.rest ? [] : draft.exercises.filter((exercise) => exercise.name.trim()) };
    if (!cleaned.focus.trim()) {
      setProblem('Give the day a focus, like Legs or Rest.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      await onSave(cleaned);
    } catch (error) {
      setProblem(problemText(error));
      setBusy(false);
    }
  }

  return (
    <div className="plan-editor">
      <div className="trainer-grid">
        <label className="field-label">
          Focus
          <input className="text-input" value={draft.focus} maxLength={60} onChange={(event) => setDraft({ ...draft, focus: event.currentTarget.value })} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={draft.rest} onChange={(event) => setDraft({ ...draft, rest: event.currentTarget.checked })} />
          <span>Rest day</span>
        </label>
      </div>
      {!draft.rest && (
        <>
          <label className="field-label">
            Warm-up
            <input className="text-input" value={draft.warmup} maxLength={200} onChange={(event) => setDraft({ ...draft, warmup: event.currentTarget.value })} />
          </label>
          <ul className="plan-edit-list">
            {draft.exercises.map((exercise, index) => (
              <li key={index} className="plan-edit-row">
                <input className="text-input" aria-label="Exercise" placeholder="Exercise" value={exercise.name} maxLength={80} onChange={(event) => change(index, { name: event.currentTarget.value, library_id: '' })} />
                <input className="text-input" aria-label="Sets" type="number" min={1} max={10} value={exercise.sets} onChange={(event) => change(index, { sets: Number(event.currentTarget.value) })} />
                <input className="text-input" aria-label="Reps" placeholder="Reps" value={exercise.reps} maxLength={20} onChange={(event) => change(index, { reps: event.currentTarget.value })} />
                <input className="text-input" aria-label="Rest seconds" type="number" min={0} max={600} step={15} value={exercise.rest_seconds} onChange={(event) => change(index, { rest_seconds: Number(event.currentTarget.value) })} />
                <input className="text-input plan-edit-wide" aria-label="How" placeholder="How to do it" value={exercise.how} maxLength={200} onChange={(event) => change(index, { how: event.currentTarget.value })} />
                <button className="button button-link" type="button" onClick={() => setDraft({ ...draft, exercises: draft.exercises.filter((_, place) => place !== index) })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button className="button button-secondary button-small" type="button" disabled={draft.exercises.length >= 15} onClick={() => setDraft({ ...draft, exercises: [...draft.exercises, BLANK] })}>
            Add exercise
          </button>
          <label className="field-label">
            Cool-down
            <input className="text-input" value={draft.cooldown} maxLength={200} onChange={(event) => setDraft({ ...draft, cooldown: event.currentTarget.value })} />
          </label>
        </>
      )}
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
      <div className="meeting-actions">
        <button className="button button-primary button-small" type="button" disabled={busy} onClick={() => void save()}>Save day</button>
        <button className="button button-link" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function DayCard({ day, plan, ready, onState, onShow, onLookUp }: { day: WorkoutDay; plan: WorkoutPlan; ready: boolean; onState: (state: TrainerState) => void } & Looking) {
  const [mode, setMode] = useState<'view' | 'edit' | 'redo'>('view');

  async function saveDay(next: WorkoutDay): Promise<void> {
    onState(await savePlan('workout', { ...plan, days: plan.days.map((old) => (old.day === next.day ? next : old)) }));
    setMode('view');
  }

  return (
    <li className="trainer-card plan-day" data-rest={day.rest}>
      <header className="plan-day-top">
        <div>
          <h3>{dayName(day.day)}</h3>
          <p className="meeting-when">{day.focus}</p>
        </div>
        {mode === 'view' && (
          <div className="meeting-actions">
            <button className="button button-secondary button-small" type="button" onClick={() => setMode('edit')}>Edit</button>
            <button className="button button-link" type="button" onClick={() => setMode('redo')}>Make again…</button>
          </div>
        )}
      </header>
      {mode === 'edit' ? (
        <DayEditor day={day} onSave={saveDay} onCancel={() => setMode('view')} />
      ) : (
        <>
          {!day.rest && day.warmup && <p className="plan-note"><strong>Warm-up:</strong> {day.warmup}</p>}
          {day.exercises.length > 0 && (
            <ol className="plan-exercises">
              {day.exercises.map((exercise, index) => (
                <li key={`${exercise.name}-${index}`}>
                  <span className="plan-exercise-name">
                    {exercise.name}
                    <button
                      className="button button-link plan-how"
                      type="button"
                      aria-label={`How to do ${exercise.name}`}
                      onClick={() => (exercise.library_id ? onShow(exercise.library_id) : onLookUp(exercise.name))}
                    >
                      How to
                    </button>
                  </span>
                  <span className="plan-exercise-dose">{exercise.sets} × {exercise.reps}{exercise.rest_seconds ? ` · rest ${exercise.rest_seconds} s` : ''}</span>
                  {exercise.how && <small>{exercise.how}</small>}
                </li>
              ))}
            </ol>
          )}
          {!day.rest && day.cooldown && <p className="plan-note"><strong>Cool-down:</strong> {day.cooldown}</p>}
          {mode === 'redo' && (
            <>
              <PlanMaker kind="workout" day={day.day} label={`Make ${dayName(day.day)} again`} placeholder="For example: my knee hurts, no jumping" ready={ready} onState={onState} onDone={() => setMode('view')} />
              <button className="button button-link" type="button" onClick={() => setMode('view')}>Cancel</button>
            </>
          )}
        </>
      )}
    </li>
  );
}

export default function WorkoutTab({ state, onState, onShow, onLookUp }: WorkoutTabProps) {
  const [remaking, setRemaking] = useState(false);
  const plan = state.workout;

  if (!plan) {
    return (
      <section className="trainer-card">
        <h2>Your workout plan</h2>
        <p className="form-help">The AI makes a week of workouts that fits your goal, days and equipment. You can change any day afterwards.</p>
        <PlanMaker kind="workout" label="Make my workout plan" placeholder="For example: I like cycling, no running" ready={state.coach_ready} onState={onState} />
      </section>
    );
  }

  return (
    <div className="plan-view">
      <section className="trainer-card plan-summary">
        <p>{plan.summary}</p>
        {remaking ? (
          <PlanMaker kind="workout" label="Make a new week" placeholder="What should be different?" ready={state.coach_ready} onState={onState} onDone={() => setRemaking(false)} />
        ) : (
          <button className="button button-secondary button-small" type="button" onClick={() => setRemaking(true)}>Make a new week…</button>
        )}
      </section>
      <ul className="plan-days">
        {plan.days.map((day) => (
          <DayCard key={day.day} day={day} plan={plan} ready={state.coach_ready} onState={onState} onShow={onShow} onLookUp={onLookUp} />
        ))}
      </ul>
    </div>
  );
}
