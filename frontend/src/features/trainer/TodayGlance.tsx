import type { ReactNode } from 'react';

import type { DaySummary, Meal, Targets, WorkoutDay } from '../../services/trainer';
import { rounded } from './labels';
import {
  caloriesGoal,
  clock,
  dayMarks,
  GLASS_ML,
  nextStep,
  proteinGoal,
  trackPlace,
  TRACK_END,
  TRACK_START,
  waterGoal,
  workoutGoal,
  type Goal,
  type Mark,
} from './today';

interface TodayGlanceProps {
  summary: DaySummary | null;
  targets: Targets | null;
  plan: WorkoutDay | null;
  meals: readonly Meal[];
  eaten: ReadonlySet<string>;
  now: number | null;
  busy: boolean;
  onWater: (ml: number) => void;
  onAte: (meal: Meal) => void;
  onStart: () => void;
}

const HOURS = [6, 9, 12, 15, 18, 21];
const EDGE = 0.08;
const NOW_ROOM = 170;
const STATE_WORDS: Record<Mark['state'], string> = {
  done: 'eaten',
  missed: 'not logged',
  now: 'now',
  later: 'later',
};

function GoalRow({ name, goal, children }: { name: string; goal: Goal; children?: ReactNode }) {
  return (
    <li className="glance-goal" data-state={goal.state}>
      <span className="glance-goal-name">{name}</span>
      <span className="glance-goal-bar" role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(goal.share * 100)} aria-valuetext={goal.text}>
        <span style={{ width: `${Math.round(goal.share * 100)}%` }} />
      </span>
      <span className="glance-goal-text">{goal.text}</span>
      {children}
    </li>
  );
}

function edgeOf(place: number): 'start' | 'end' | undefined {
  return place < EDGE ? 'start' : place > 1 - EDGE ? 'end' : undefined;
}

function DayTrack({ marks, now }: { marks: Mark[]; now: number | null }) {
  if (marks.length === 0) {
    return null;
  }
  const spoken = marks.map((mark) => `${mark.meal.name} at ${clock(mark.minutes)}, ${STATE_WORDS[mark.state]}`).join('. ');
  const shownNow = now !== null && now >= TRACK_START && now <= TRACK_END ? now : null;
  const hours = HOURS.filter((hour) => shownNow === null || Math.abs(hour * 60 - shownNow) > NOW_ROOM);
  return (
    <div className="track">
      <p className="visually-hidden">{spoken}.</p>
      <div className="track-line" aria-hidden="true">
        {shownNow !== null && <span className="track-done" style={{ width: `${trackPlace(shownNow) * 100}%` }} />}
        {shownNow !== null && <span className="track-now" style={{ left: `${trackPlace(shownNow) * 100}%` }} />}
        {marks.map((mark, index) => {
          const place = trackPlace(mark.minutes);
          return (
            <span
              key={`${mark.meal.name}-${mark.minutes}`}
              className="track-mark"
              data-state={mark.state}
              data-side={index % 2 === 0 ? 'above' : 'below'}
              data-edge={edgeOf(place)}
              style={{ left: `${place * 100}%` }}
            >
              <span className="track-dot" />
              <span className="track-label">
                <strong>{mark.meal.name}</strong>
                <small>{clock(mark.minutes)}{mark.state === 'done' ? ', eaten' : mark.state === 'missed' ? ', not logged' : ''}</small>
              </span>
            </span>
          );
        })}
      </div>
      <div className="track-hours" aria-hidden="true">
        {hours.map((hour) => {
          const place = trackPlace(hour * 60);
          return <span key={hour} data-edge={edgeOf(place)} style={{ left: `${place * 100}%` }}>{clock(hour * 60)}</span>;
        })}
        {shownNow !== null && (
          <span className="track-hours-now" data-edge={edgeOf(trackPlace(shownNow))} style={{ left: `${trackPlace(shownNow) * 100}%` }}>Now {clock(shownNow)}</span>
        )}
      </div>
    </div>
  );
}

export default function TodayGlance({ summary, targets, plan, meals, eaten, now, busy, onWater, onAte, onStart }: TodayGlanceProps) {
  const past = now === null;
  const calories = summary?.calories ?? 0;
  const calorieGoal = caloriesGoal(calories, targets?.calories ?? null, past);
  const marks = dayMarks(meals, eaten, now);
  const step = now === null ? null : nextStep(marks, plan, summary?.sets ?? 0, summary?.water_ml ?? 0, targets?.water_ml ?? null, now);
  const target = targets?.calories ?? null;
  const [big, small] = !target
    ? [calories.toLocaleString(), 'kcal eaten']
    : calorieGoal.state === 'done'
      ? ['On target', `${calories.toLocaleString()} of ${target.toLocaleString()} kcal`]
      : calorieGoal.state === 'over'
        ? [Math.round(calories - target).toLocaleString(), `kcal over your ${target.toLocaleString()} kcal target`]
        : past
          ? [calories.toLocaleString(), `kcal eaten of ${target.toLocaleString()}`]
          : [Math.round(target - calories).toLocaleString(), `kcal left of ${target.toLocaleString()}`];

  return (
    <section className="glance" aria-label="Your day so far">
      <div className="glance-top">
        <div className="glance-calories" data-state={calorieGoal.state}>
          <p className="glance-big"><strong>{big}</strong> <span>{small}</span></p>
          <span className="glance-fuel" role="meter" aria-label="Calories" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(calorieGoal.share * 100)} aria-valuetext={calorieGoal.text}>
            <span style={{ width: `${Math.round(calorieGoal.share * 100)}%` }} />
          </span>
          <p className="glance-macros">
            {calories.toLocaleString()} kcal eaten: protein {rounded(summary?.protein_g ?? 0)} g, carbohydrate {rounded(summary?.carbs_g ?? 0)} g, fat {rounded(summary?.fat_g ?? 0)} g.
          </p>
        </div>
        <ul className="glance-goals">
          <GoalRow name="Protein" goal={proteinGoal(summary?.protein_g ?? 0, targets?.protein_g ?? null, past)} />
          <GoalRow name="Water" goal={waterGoal(summary?.water_ml ?? 0, targets?.water_ml ?? null, past)}>
            <span className="glance-water">
              <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => onWater(GLASS_ML)}>+1 glass</button>
              <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => onWater(GLASS_ML * 2)}>+2 glasses</button>
            </span>
          </GoalRow>
          <GoalRow name="Workout" goal={workoutGoal(summary?.sets ?? 0, plan)} />
        </ul>
      </div>

      <DayTrack marks={marks} now={now} />

      {step && (
        <div className="glance-next" data-kind={step.kind} aria-live="polite">
          <div>
            <p className="glance-next-title">{step.kind === 'later' ? `Next: ${step.title}` : step.title}</p>
            <p className="glance-next-detail">{step.detail}</p>
          </div>
          {step.kind === 'meal' && step.meal && (
            <button className="button button-primary" type="button" disabled={busy} onClick={() => onAte(step.meal!)}>I ate this</button>
          )}
          {step.kind === 'workout' && (
            <button className="button button-primary" type="button" onClick={onStart}>Start guided workout</button>
          )}
          {step.kind === 'water' && (
            <button className="button button-primary" type="button" disabled={busy} onClick={() => onWater(GLASS_ML)}>I drank a glass</button>
          )}
        </div>
      )}
    </section>
  );
}

export function WeekStrip({ days, selected, onPick }: { days: readonly DaySummary[]; selected: string; onPick: (day: string) => void }) {
  if (days.length === 0) {
    return null;
  }
  return (
    <nav className="week-strip" aria-label="This week">
      {days.map((day) => {
        const date = new Date(`${day.day}T12:00:00`);
        const food = day.calories > 0;
        const trained = day.sets > 0;
        const words = [food ? 'food logged' : 'no food logged', trained ? 'workout logged' : 'no workout'].join(', ');
        return (
          <button
            key={day.day}
            type="button"
            className="week-day"
            aria-pressed={day.day === selected}
            aria-label={`${date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}: ${words}`}
            onClick={() => onPick(day.day)}
          >
            <span className="week-day-name">{date.toLocaleDateString([], { weekday: 'short' })}</span>
            <span className="week-day-date">{date.getDate()}</span>
            <span className="week-day-marks" aria-hidden="true">
              <span data-on={food} data-kind="food" />
              <span data-on={trained} data-kind="workout" />
            </span>
          </button>
        );
      })}
      <p className="week-key" aria-hidden="true">
        <span data-kind="food" /> food <span data-kind="workout" /> workout
      </p>
    </nav>
  );
}
