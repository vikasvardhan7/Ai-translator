import type { Exercise, ExerciseCard, WorkoutDay } from '../../services/trainer';

export type Place = 'all' | 'machines' | 'weights' | 'home' | 'none';

export const PLACES: Record<Place, { label: string; equipment: readonly string[] | null }> = {
  all: { label: 'Everywhere', equipment: null },
  machines: { label: 'Gym machines', equipment: ['machine', 'cable'] },
  weights: { label: 'Free weights', equipment: ['barbell', 'dumbbell', 'kettlebells', 'e-z curl bar'] },
  home: { label: 'At home', equipment: ['body only', 'dumbbell', 'bands', 'kettlebells', 'exercise ball', 'medicine ball', 'foam roll'] },
  none: { label: 'No equipment', equipment: ['body only'] },
};

export const MUSCLES = [
  'abdominals',
  'abductors',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'forearms',
  'glutes',
  'hamstrings',
  'lats',
  'lower back',
  'middle back',
  'neck',
  'quadriceps',
  'shoulders',
  'traps',
  'triceps',
] as const;

export const TYPES = ['strength', 'stretching', 'cardio', 'plyometrics', 'powerlifting', 'olympic weightlifting', 'strongman'] as const;

const EQUIPMENT_NAMES: Record<string, string> = {
  'body only': 'No equipment',
  'e-z curl bar': 'EZ curl bar',
  kettlebells: 'Kettlebell',
  bands: 'Resistance band',
};

export interface Filters {
  text: string;
  place: Place;
  muscle: string;
  type: string;
}

export const NO_FILTERS: Filters = { text: '', place: 'all', muscle: '', type: '' };

export function capital(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

export function equipmentName(equipment: string): string {
  return EQUIPMENT_NAMES[equipment] ?? capital(equipment);
}

export function muscleList(muscles: readonly string[]): string {
  return muscles.map(capital).join(', ');
}

function plain(text: string): string {
  return text.toLowerCase().replace(/(\w)-(\w)/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function filterExercises(cards: readonly ExerciseCard[], filters: Filters): ExerciseCard[] {
  const wanted = plain(filters.text).split(' ').filter(Boolean);
  const equipment = PLACES[filters.place].equipment;
  const found = cards.filter((card) => {
    const name = plain(card.name);
    return (
      wanted.every((word) => name.includes(word))
      && (!equipment || equipment.includes(card.equipment))
      && (!filters.muscle || card.primary.includes(filters.muscle))
      && (!filters.type || card.category === filters.type)
    );
  });
  if (!wanted.length) {
    return found;
  }
  const first = wanted.join(' ');
  const later = (card: ExerciseCard): number => (plain(card.name).startsWith(first) ? 0 : 1);
  return [...found].sort((one, two) => later(one) - later(two) || one.name.length - two.name.length);
}

export function spokenReps(reps: string): string {
  const text = reps.trim();
  if (/^\d+\s*[-–]\s*\d+$/.test(text)) {
    return `${text.replace(/\s*[-–]\s*/, ' to ')} reps`;
  }
  if (/^\d+$/.test(text)) {
    return `${text} reps`;
  }
  return text;
}

export function introLine(day: WorkoutDay): string {
  const count = day.exercises.length;
  return [
    `Let's train. ${day.focus}, ${count} ${count === 1 ? 'exercise' : 'exercises'}.`,
    day.warmup ? `Warm up first: ${day.warmup}.` : '',
  ].filter(Boolean).join(' ');
}

export function exerciseLine(exercise: Exercise, index: number, total: number): string {
  return [
    `Exercise ${index + 1} of ${total}: ${exercise.name}.`,
    `${exercise.sets} ${exercise.sets === 1 ? 'set' : 'sets'} of ${spokenReps(exercise.reps)}.`,
    exercise.how ? `${exercise.how}.` : '',
  ].filter(Boolean).join(' ');
}

export function setLine(set: number, sets: number, reps: string): string {
  return `Set ${set} of ${sets}. ${capital(spokenReps(reps))}. Go.`;
}

export function restLine(seconds: number, next: string): string {
  return seconds > 0 ? `Rest ${seconds} seconds. ${next}` : next;
}

export function finishLine(day: WorkoutDay, sets: number): string {
  return [`Workout done. ${sets} ${sets === 1 ? 'set' : 'sets'}. Great work.`, day.cooldown ? `Cool down: ${day.cooldown}.` : ''].filter(Boolean).join(' ');
}
