import type { Equipment, ExerciseCard, ExerciseLast, Level, WorkoutDay, WorkoutPlan } from '../../services/trainer';

const EQUIPMENT_FOR: Record<Equipment, readonly string[] | null> = {
  gym: null,
  home_dumbbells: ['body only', 'dumbbell'],
  bodyweight: ['body only'],
};
const LEVELS_FOR: Record<Level, readonly string[]> = {
  beginner: ['beginner', 'intermediate'],
  intermediate: ['beginner', 'intermediate'],
  advanced: ['beginner', 'intermediate', 'expert'],
};
const NOT_FOR_PLANS = ['strongman'];
const COMMON_EQUIPMENT = ['barbell', 'dumbbell', 'body only', 'machine', 'cable', 'kettlebells'];
const LEVEL_ORDER = ['beginner', 'intermediate', 'expert'];
const LIGHT_KG = 10;
const SMALL_STEP_KG = 1;
const STEP_KG = 2.5;

function rank(list: readonly string[], value: string): number {
  const place = list.indexOf(value);
  return place === -1 ? list.length : place;
}

export function fits(card: ExerciseCard, equipment: Equipment, level: Level): boolean {
  const kinds = EQUIPMENT_FOR[equipment];
  return (
    !NOT_FOR_PLANS.includes(card.category)
    && (kinds === null || kinds.includes(card.equipment))
    && LEVELS_FOR[level].includes(card.level)
    && (level === 'advanced' || card.category !== 'olympic weightlifting')
  );
}

export function alternatives(current: ExerciseCard, cards: readonly ExerciseCard[], equipment: Equipment, level: Level, count = 3): ExerciseCard[] {
  const main = current.primary[0];
  if (!main) {
    return [];
  }
  const sorted = cards
    .filter((card) => card.id !== current.id && card.primary[0] === main && card.category === current.category && fits(card, equipment, level))
    .sort(
      (one, two) =>
        rank(COMMON_EQUIPMENT, one.equipment) - rank(COMMON_EQUIPMENT, two.equipment)
        || rank(LEVEL_ORDER, one.level) - rank(LEVEL_ORDER, two.level)
        || one.name.length - two.name.length
        || one.name.localeCompare(two.name),
    );
  const picked: ExerciseCard[] = [];
  for (const card of sorted) {
    if (picked.length < count && !picked.some((chosen) => chosen.equipment === card.equipment)) {
      picked.push(card);
    }
  }
  for (const card of sorted) {
    if (picked.length < count && !picked.includes(card)) {
      picked.push(card);
    }
  }
  return picked;
}

export function lastTime(history: readonly ExerciseLast[], name: string): ExerciseLast | undefined {
  const wanted = name.trim().toLowerCase();
  return history.find((item) => item.name.trim().toLowerCase() === wanted);
}

function weight(kg: number): string {
  return `${Math.round(kg * 10) / 10} kg`;
}

export function lastWords(last: ExerciseLast): string {
  const when = new Date(`${last.day}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const dose = `${last.sets} × ${last.reps || '?'}`;
  return `Last time (${when}): ${dose}${last.weight_kg ? ` at ${weight(last.weight_kg)}` : ', no added weight'}`;
}

export function nextWords(last: ExerciseLast): string {
  if (!last.weight_kg) {
    return 'Next time: add 1 or 2 reps to each set, or slow the lowering down to 3 seconds.';
  }
  const step = last.weight_kg < LIGHT_KG ? SMALL_STEP_KG : STEP_KG;
  return `Next time: ${weight(last.weight_kg + step)} if every set felt easy with 2 or more reps to spare; otherwise stay at ${weight(last.weight_kg)} and add a rep.`;
}

export function swapped(plan: WorkoutPlan, day: WorkoutDay['day'], index: number, card: ExerciseCard): WorkoutPlan {
  return {
    ...plan,
    days: plan.days.map((old) =>
      old.day === day
        ? { ...old, exercises: old.exercises.map((exercise, place) => (place === index ? { ...exercise, name: card.name, library_id: card.id, how: '' } : exercise)) }
        : old,
    ),
  };
}

export function videoLink(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise proper form`)}`;
}
