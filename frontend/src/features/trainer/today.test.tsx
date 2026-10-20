import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DaySummary, Meal, WorkoutDay } from '../../services/trainer';
import TodayGlance, { WeekStrip } from './TodayGlance';
import {
  caloriesGoal,
  clock,
  dayMarks,
  minutesOf,
  nextStep,
  proteinGoal,
  trackPlace,
  waterBehind,
  waterGoal,
  workoutGoal,
} from './today';

function meal(name: string, time: string, calories: number): Meal {
  return {
    name,
    time,
    items: [{ food: `${name} plate`, amount: '1 bowl', calories, protein_g: 20, carbs_g: 30, fat_g: 10 }],
  };
}

const MEALS = [meal('Dinner', '20:00', 700), meal('Breakfast', '08:00', 400), meal('Lunch', '13:00', 650)];

const PLAN: WorkoutDay = {
  day: 'monday',
  focus: 'Upper body',
  rest: false,
  warmup: '',
  exercises: [
    { name: 'Bench press', sets: 3, reps: '8', rest_seconds: 90, how: '' },
    { name: 'Rows', sets: 3, reps: '10', rest_seconds: 60, how: '' },
  ],
  cooldown: '',
};

const REST: WorkoutDay = { ...PLAN, rest: true, exercises: [] };

function summary(day: string, calories: number, sets: number): DaySummary {
  return {
    day,
    calories,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    water_ml: 0,
    exercises: sets ? 1 : 0,
    sets,
    weight_kg: null,
    sleep_hours: null,
    steps: null,
  };
}

describe('goals in plain words', () => {
  it('says how many calories are left, on target or over', () => {
    expect(caloriesGoal(0, 2000)).toEqual({ text: '2,000 kcal left', state: 'empty', share: 0 });
    expect(caloriesGoal(1500, 2000)).toMatchObject({ text: '500 kcal left', state: 'going', share: 0.75 });
    expect(caloriesGoal(1950, 2000)).toMatchObject({ text: 'On target', state: 'done' });
    expect(caloriesGoal(2400, 2000)).toMatchObject({ text: '400 kcal over', state: 'over', share: 1 });
    expect(caloriesGoal(800, null)).toMatchObject({ text: '800 kcal eaten', state: 'going' });
    expect(caloriesGoal(1500, 2000, true)).toMatchObject({ text: '500 kcal under' });
  });

  it('counts protein still to eat', () => {
    expect(proteinGoal(90, 140)).toMatchObject({ text: '50 g to go', state: 'going' });
    expect(proteinGoal(150, 140)).toMatchObject({ text: 'Protein target reached', state: 'done' });
    expect(proteinGoal(90, 140, true)).toMatchObject({ text: '50 g short' });
  });

  it('counts water in glasses', () => {
    expect(waterGoal(0, 2500)).toMatchObject({ text: '10 glasses to go', state: 'empty' });
    expect(waterGoal(2300, 2500)).toMatchObject({ text: '1 glass to go' });
    expect(waterGoal(2600, 2500)).toMatchObject({ text: 'Water target reached', state: 'done' });
    expect(waterGoal(2000, 2500, true)).toMatchObject({ text: '2 glasses short' });
  });

  it('describes the workout by sets', () => {
    expect(workoutGoal(2, PLAN)).toMatchObject({ text: '2 of 6 sets', state: 'going' });
    expect(workoutGoal(6, PLAN)).toMatchObject({ text: 'Workout done', state: 'done' });
    expect(workoutGoal(0, REST)).toMatchObject({ text: 'Rest day', state: 'done' });
    expect(workoutGoal(1, null)).toMatchObject({ text: '1 set logged' });
  });
});

describe('the day track', () => {
  it('reads and writes clock times', () => {
    expect(minutesOf('7:30')).toBe(450);
    expect(minutesOf(' 20:05 ')).toBe(1205);
    expect(minutesOf('25:00')).toBeNull();
    expect(minutesOf('morning')).toBeNull();
    expect(clock(450)).toBe('07:30');
    expect(clock(1205)).toBe('20:05');
  });

  it('places times between 6 in the morning and 11 at night', () => {
    expect(trackPlace(360)).toBe(0);
    expect(trackPlace(1380)).toBe(1);
    expect(trackPlace(100)).toBe(0);
    expect(trackPlace(870)).toBeCloseTo(0.5);
  });

  it('marks each meal as eaten, missed, due now or later, in time order', () => {
    const marks = dayMarks(MEALS, new Set(['breakfast']), 13 * 60 + 20);
    expect(marks.map((mark) => [mark.meal.name, mark.state])).toEqual([
      ['Breakfast', 'done'],
      ['Lunch', 'now'],
      ['Dinner', 'later'],
    ]);
    expect(marks[1]!.calories).toBe(650);
  });

  it('calls a meal missed two hours after its time', () => {
    const marks = dayMarks(MEALS, new Set(), 10 * 60 + 1);
    expect(marks[0]).toMatchObject({ state: 'missed' });
  });

  it('treats past days as finished', () => {
    const marks = dayMarks(MEALS, new Set(['lunch']), null);
    expect(marks.map((mark) => mark.state)).toEqual(['missed', 'done', 'missed']);
  });

  it('skips meals without a clock time', () => {
    expect(dayMarks([meal('Snack', 'anytime', 200)], new Set(), 600)).toEqual([]);
  });
});

describe('what to do next', () => {
  it('puts the meal that is due first', () => {
    const marks = dayMarks(MEALS, new Set(['breakfast']), 13 * 60);
    const step = nextStep(marks, PLAN, 0, 0, 2500, 13 * 60);
    expect(step).toMatchObject({ kind: 'meal', title: 'Time for lunch' });
    expect(step.detail).toBe('Lunch plate, about 650 kcal.');
  });

  it('then the workout that is left', () => {
    const marks = dayMarks(MEALS, new Set(['breakfast', 'lunch']), 16 * 60);
    expect(nextStep(marks, PLAN, 2, 2000, 2500, 16 * 60)).toMatchObject({
      kind: 'workout',
      title: 'Your upper body workout',
      detail: '4 sets still to do. The guided workout talks you through each one.',
    });
  });

  it('then water when you are behind for the time of day', () => {
    const marks = dayMarks(MEALS, new Set(['breakfast', 'lunch']), 16 * 60);
    const step = nextStep(marks, PLAN, 6, 300, 2500, 16 * 60);
    expect(step).toMatchObject({ kind: 'water', title: 'Drink a glass of water' });
    expect(waterBehind(300, 2500, 16 * 60)).toBe(1200);
  });

  it('then the next meal later on', () => {
    const marks = dayMarks(MEALS, new Set(['breakfast', 'lunch']), 16 * 60);
    expect(nextStep(marks, REST, 0, 2000, 2500, 16 * 60)).toMatchObject({ kind: 'later', title: 'Dinner at 20:00' });
  });

  it('says when everything is done, or when nothing is planned', () => {
    const marks = dayMarks(MEALS, new Set(['breakfast', 'lunch', 'dinner']), 21 * 60);
    expect(nextStep(marks, PLAN, 6, 2500, 2500, 21 * 60).kind).toBe('done');
    expect(nextStep([], null, 0, 0, null, 12 * 60).kind).toBe('nothing');
  });
});

describe('the glance', () => {
  const props = {
    targets: { calories: 2000, protein_g: 140, carbs_g: 220, fat_g: 70, water_ml: 2500, resting_calories: 1600, daily_burn: 2300, explanation: '' },
    plan: PLAN,
    meals: MEALS,
    eaten: new Set(['breakfast']),
    busy: false,
    onWater: () => undefined,
    onAte: () => undefined,
    onStart: () => undefined,
  };

  it('leads with calories left and the step that is due', () => {
    const html = renderToStaticMarkup(<TodayGlance {...props} summary={summary('2026-10-19', 400, 0)} now={13 * 60 + 10} />);
    expect(html).toContain('1,600');
    expect(html).toContain('kcal left of 2,000');
    expect(html).toContain('Time for lunch');
    expect(html).toContain('I ate this');
    expect(html).toContain('Now 13:10');
    expect(html).toContain('Breakfast at 08:00, eaten. Lunch at 13:00, now. Dinner at 20:00, later.');
  });

  it('shows no next step and no now line on another day', () => {
    const html = renderToStaticMarkup(<TodayGlance {...props} summary={summary('2026-10-18', 2500, 6)} now={null} />);
    expect(html).toContain('kcal over your 2,000 kcal target');
    expect(html).toContain('10 glasses short');
    expect(html).not.toContain('glance-next');
    expect(html).not.toContain('track-now');
  });

  it('marks food and workout days in the week strip', () => {
    const html = renderToStaticMarkup(
      <WeekStrip days={[summary('2026-10-18', 0, 0), summary('2026-10-19', 1800, 9)]} selected="2026-10-19" onPick={() => undefined} />,
    );
    expect(html).toContain('no food logged, no workout');
    expect(html).toContain('food logged, workout logged');
    expect(html).toContain('aria-pressed="true"');
  });
});
