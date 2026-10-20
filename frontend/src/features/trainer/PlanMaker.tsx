import { useState, type FormEvent } from 'react';

import { makePlan, type PlanKind, type TrainerState, type Weekday } from '../../services/trainer';
import { dayName } from './labels';
import { problemText } from './problems';

interface PlanMakerProps {
  kind: PlanKind;
  day?: Weekday;
  label: string;
  placeholder: string;
  ready: boolean;
  onState: (state: TrainerState) => void;
  onDone?: () => void;
}

export default function PlanMaker({ kind, day, label, placeholder, ready, onState, onDone }: PlanMakerProps) {
  const [wishes, setWishes] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      onState(await makePlan(kind, wishes.trim(), day ?? null));
      setWishes('');
      onDone?.();
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="plan-maker" onSubmit={(event) => void submit(event)}>
      <label className="field-label">
        {day ? `Anything to change on ${dayName(day)}? (optional)` : 'Anything the plan should know? (optional)'}
        <input className="text-input" value={wishes} maxLength={300} placeholder={placeholder} onChange={(event) => setWishes(event.currentTarget.value)} />
      </label>
      <button className="button button-primary" type="submit" disabled={busy || !ready} aria-busy={busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {busy ? 'The AI is making it (up to a minute)' : label}
      </button>
      {!ready && <p className="form-help">The AI is not set up on this server, so plans cannot be made yet. You can still track every day.</p>}
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
    </form>
  );
}
