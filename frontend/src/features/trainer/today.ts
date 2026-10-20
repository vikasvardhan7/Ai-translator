import type { Meal, WorkoutDay } from '../../services/trainer';

export const GLASS_ML = 250;
export const TRACK_START = 6 * 60;
export const TRACK_END = 23 * 60;
const DRINKING_START = 7 * 60;
const DRINKING_END = 22 * 60;
const MEAL_EARLY = 30;
const MEAL_LATE = 120;
const ON_TARGET = 0.05;

export type GoalState = 'empty' | 'going' | 'done' | 'over';
export type MarkState = 'done' | 'missed' | 'now' | 'later';

export interface Goal {
  text: string;
  state: GoalState;
  share: number;
}

export interface Mark {
  meal: Meal;
  minutes: number;
  state: MarkState;
  calories: number;
}

export interface NextStep {
  kind: 'meal' | 'workout' | 'water' | 'later' | 'done' | 'nothing';
  title: string;
  detail: string;
  meal?: Meal;
}

function share(value: number, target: number): number {
  return target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function caloriesGoal(eaten: number, target: number | null, past = false): Goal {
  if (!target) {
    return { text: `${eaten.toLocaleString()} kcal eaten`, state: eaten ? 'going' : 'empty', share: 0 };
  }
  if (eaten > target * (1 + ON_TARGET)) {
    return { text: `${Math.round(eaten - target).toLocaleString()} kcal over`, state: 'over', share: 1 };
  }
  if (eaten >= target * (1 - ON_TARGET)) {
    return { text: 'On target', state: 'done', share: 1 };
  }
  return { text: `${Math.round(target - eaten).toLocaleString()} kcal ${past ? 'under' : 'left'}`, state: eaten ? 'going' : 'empty', share: share(eaten, target) };
}

export function proteinGoal(eaten: number, target: number | null, past = false): Goal {
  if (!target) {
    return { text: `${Math.round(eaten)} g eaten`, state: eaten ? 'going' : 'empty', share: 0 };
  }
  if (eaten >= target) {
    return { text: 'Protein target reached', state: 'done', share: 1 };
  }
  return { text: `${Math.round(target - eaten)} g ${past ? 'short' : 'to go'}`, state: eaten ? 'going' : 'empty', share: share(eaten, target) };
}

export function waterGoal(drunk: number, target: number | null, past = false): Goal {
  if (!target) {
    return { text: `${drunk.toLocaleString()} ml drunk`, state: drunk ? 'going' : 'empty', share: 0 };
  }
  if (drunk >= target) {
    return { text: 'Water target reached', state: 'done', share: 1 };
  }
  const glasses = Math.ceil((target - drunk) / GLASS_ML);
  return { text: `${plural(glasses, 'glass', 'glasses')} ${past ? 'short' : 'to go'}`, state: drunk ? 'going' : 'empty', share: share(drunk, target) };
}

export function workoutGoal(sets: number, plan: WorkoutDay | null): Goal {
  if (!plan) {
    return { text: sets ? `${plural(sets, 'set', 'sets')} logged` : 'No workout planned', state: sets ? 'going' : 'empty', share: 0 };
  }
  if (plan.rest) {
    return { text: sets ? `Rest day, ${plural(sets, 'set', 'sets')} logged` : 'Rest day', state: 'done', share: 1 };
  }
  const planned = plan.exercises.reduce((total, exercise) => total + exercise.sets, 0);
  if (planned > 0 && sets >= planned) {
    return { text: 'Workout done', state: 'done', share: 1 };
  }
  return { text: `${sets} of ${plural(planned, 'set', 'sets')}`, state: sets ? 'going' : 'empty', share: share(sets, planned) };
}

export function minutesOf(time: string): number | null {
  const found = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!found) {
    return null;
  }
  const hours = Number(found[1]);
  const minutes = Number(found[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function clock(minutes: number): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

export function trackPlace(minutes: number): number {
  return Math.min(1, Math.max(0, (minutes - TRACK_START) / (TRACK_END - TRACK_START)));
}

export function dayMarks(meals: readonly Meal[], eaten: ReadonlySet<string>, now: number | null): Mark[] {
  return meals.flatMap((meal) => {
    const minutes = minutesOf(meal.time);
    if (minutes === null) {
      return [];
    }
    const calories = Math.round(meal.items.reduce((total, item) => total + item.calories, 0));
    const state: MarkState = eaten.has(meal.name.toLowerCase())
      ? 'done'
      : now === null || now > minutes + MEAL_LATE
        ? 'missed'
        : now >= minutes - MEAL_EARLY
          ? 'now'
          : 'later';
    return [{ meal, minutes, state, calories }];
  }).sort((one, two) => one.minutes - two.minutes);
}

export function waterBehind(drunk: number, target: number | null, now: number): number {
  if (!target) {
    return 0;
  }
  const expected = target * Math.min(1, Math.max(0, (now - DRINKING_START) / (DRINKING_END - DRINKING_START)));
  return Math.max(0, Math.round(expected - drunk));
}

export function foodsOf(meal: Meal): string {
  return meal.items.map((item) => item.food).join(', ');
}

export function nextStep(marks: readonly Mark[], plan: WorkoutDay | null, sets: number, drunk: number, waterTarget: number | null, now: number): NextStep {
  const current = marks.find((mark) => mark.state === 'now');
  if (current) {
    return { kind: 'meal', title: `Time for ${current.meal.name.toLowerCase()}`, detail: `${foodsOf(current.meal)}, about ${current.calories.toLocaleString()} kcal.`, meal: current.meal };
  }
  const planned = plan && !plan.rest ? plan.exercises.reduce((total, exercise) => total + exercise.sets, 0) : 0;
  if (planned > 0 && sets < planned && now < DRINKING_END) {
    const left = planned - sets;
    return { kind: 'workout', title: `Your ${plan!.focus.toLowerCase()} workout`, detail: `${plural(left, 'set', 'sets')} still to do. The guided workout talks you through each one.` };
  }
  const behind = waterBehind(drunk, waterTarget, now);
  if (behind >= GLASS_ML) {
    return { kind: 'water', title: 'Drink a glass of water', detail: `You are ${behind.toLocaleString()} ml behind for this time of day.` };
  }
  const later = marks.find((mark) => mark.state === 'later');
  if (later) {
    return { kind: 'later', title: `${later.meal.name} at ${clock(later.minutes)}`, detail: `${foodsOf(later.meal)}, about ${later.calories.toLocaleString()} kcal.`, meal: later.meal };
  }
  if (marks.length > 0 || planned > 0) {
    return { kind: 'done', title: 'Everything planned for today is done', detail: 'Log anything extra below, and note how the day felt.' };
  }
  return { kind: 'nothing', title: 'Nothing planned for today', detail: 'Log what you eat and do below, or make plans in Workouts and Diet.' };
}
