import { useEffect, useState } from 'react';

import { loadProgress, localDay, type DaySummary, type TrainerState } from '../../services/trainer';
import Chart from './Chart';
import ProgressPhotos from './ProgressPhotos';
import { rounded } from './labels';
import { problemText } from './problems';

const RANGES = [7, 30, 90];

function tracked(day: DaySummary): boolean {
  return day.calories > 0 || day.water_ml > 0 || day.sets > 0 || day.weight_kg !== null || day.sleep_hours !== null || day.steps !== null;
}

export function streak(days: readonly DaySummary[]): number {
  const list = [...days];
  if (list.length > 0 && !tracked(list[list.length - 1]!)) {
    list.pop();
  }
  let count = 0;
  while (count < list.length && tracked(list[list.length - 1 - count]!)) {
    count += 1;
  }
  return count;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export default function ProgressTab({ state, changed }: { state: TrainerState; changed: number }) {
  const [range, setRange] = useState(30);
  const [days, setDays] = useState<DaySummary[] | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadProgress(localDay(), range).then(
      (loaded) => {
        if (!cancelled) {
          setDays(loaded);
          setProblem('');
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setProblem(problemText(error));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [range, changed]);

  if (!days) {
    return problem ? <p className="notice notice-danger" role="alert">{problem}</p> : <p className="meeting-empty" role="status">Loading progress</p>;
  }

  const labels = days.map((day) => day.day);
  const ate = days.filter((day) => day.calories > 0);
  const weights = days.flatMap((day) => (day.weight_kg !== null ? [day.weight_kg] : []));
  const change = weights.length > 1 ? weights[weights.length - 1]! - weights[0]! : null;
  const workouts = days.filter((day) => day.sets > 0).length;
  const sleep = average(days.flatMap((day) => (day.sleep_hours !== null ? [day.sleep_hours] : [])));
  const targets = state.targets;
  const run = streak(days);

  return (
    <div className="progress">
      <div className="progress-head">
        <div className="sign-in-tabs" role="tablist" aria-label="Period">
          {RANGES.map((value) => (
            <button type="button" role="tab" key={value} aria-selected={range === value} onClick={() => setRange(value)}>
              {value} days
            </button>
          ))}
        </div>
      </div>
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
      <section className="progress-stats" aria-label="Summary">
        <div className="today-meter"><p className="today-meter-label">Tracking streak</p><p className="today-meter-value">{run}<small>{run === 1 ? ' day' : ' days'}</small></p></div>
        <div className="today-meter"><p className="today-meter-label">Workout days</p><p className="today-meter-value">{workouts}<small> of {range}</small></p></div>
        <div className="today-meter"><p className="today-meter-label">Average calories</p><p className="today-meter-value">{ate.length ? Math.round(average(ate.map((day) => day.calories))!) : '–'}<small>{targets ? ` / ${targets.calories}` : ''} kcal</small></p></div>
        <div className="today-meter"><p className="today-meter-label">Weight change</p><p className="today-meter-value">{change === null ? '–' : `${change > 0 ? '+' : ''}${rounded(Math.round(change * 10) / 10)}`}<small> kg</small></p></div>
        <div className="today-meter"><p className="today-meter-label">Average sleep</p><p className="today-meter-value">{sleep === null ? '–' : rounded(Math.round(sleep * 10) / 10)}<small> h</small></p></div>
      </section>
      <div className="progress-charts">
        <Chart title="Weight" unit="kg" kind="line" days={labels} values={days.map((day) => day.weight_kg)} target={state.profile?.target_weight_kg ?? null} />
        <Chart title="Calories eaten" unit="kcal" kind="bars" days={labels} values={days.map((day) => day.calories)} target={targets?.calories ?? null} />
        <Chart title="Protein" unit="g" kind="bars" days={labels} values={days.map((day) => day.protein_g)} target={targets?.protein_g ?? null} />
        <Chart title="Water" unit="ml" kind="bars" days={labels} values={days.map((day) => day.water_ml)} target={targets?.water_ml ?? null} />
        <Chart title="Workout sets" unit="sets" kind="bars" days={labels} values={days.map((day) => day.sets)} />
        <Chart title="Sleep" unit="h" kind="bars" days={labels} values={days.map((day) => day.sleep_hours)} />
        <Chart title="Steps" unit="steps" kind="bars" days={labels} values={days.map((day) => day.steps)} />
      </div>
      <ProgressPhotos />
    </div>
  );
}
