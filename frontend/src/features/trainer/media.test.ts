import { describe, expect, it } from 'vitest';

import type { ExerciseCard, TrainerState, WorkoutDay } from '../../services/trainer';
import { stepsToRead } from './ExerciseSheet';
import { exerciseLine, filterExercises, finishLine, introLine, NO_FILTERS, restLine, setLine, spokenReps, equipmentName } from './exercises';
import { fittedSize } from './photos';
import { apart, daysBetween } from './ProgressPhotos';
import { workoutFor } from './TrainerApp';
import { languageOfText, speakable } from './voice';

function card(id: string, name: string, equipment: string, primary: string, category = 'strength'): ExerciseCard {
  return { id, name, equipment, category, level: 'beginner', primary: [primary], secondary: [], images: [] };
}

const CARDS = [
  card('Leg_Press', 'Leg Press', 'machine', 'quadriceps'),
  card('Goblet_Squat', 'Goblet Squat', 'kettlebells', 'quadriceps'),
  card('Pushups', 'Pushups', 'body only', 'chest'),
  card('Push_Up_Plank', 'Push-Up to Side Plank', 'body only', 'abdominals'),
  card('Hamstring_Stretch', 'Hamstring Stretch', 'body only', 'hamstrings', 'stretching'),
  card('Seated_Cable_Rows', 'Seated Cable Rows', 'cable', 'middle back'),
];

const DAY: WorkoutDay = {
  day: 'tuesday',
  focus: 'Full body',
  rest: false,
  warmup: '5 min walk',
  exercises: [
    { name: 'Leg press', sets: 3, reps: '10-12', rest_seconds: 90, how: 'Feet flat', library_id: 'Leg_Press' },
    { name: 'Plank', sets: 1, reps: '30 s', rest_seconds: 0, how: '' },
  ],
  cooldown: 'Stretch 5 minutes',
};

describe('exercise library filters', () => {
  it('finds by words, place, muscle and type', () => {
    const names = (filters: Partial<typeof NO_FILTERS>) => filterExercises(CARDS, { ...NO_FILTERS, ...filters }).map((item) => item.id);

    expect(names({})).toHaveLength(6);
    expect(names({ text: 'push-up' })).toEqual(['Pushups', 'Push_Up_Plank']);
    expect(names({ text: 'cable row' })).toEqual(['Seated_Cable_Rows']);
    expect(names({ place: 'machines' })).toEqual(['Leg_Press', 'Seated_Cable_Rows']);
    expect(names({ place: 'none', muscle: 'chest' })).toEqual(['Pushups']);
    expect(names({ place: 'home', type: 'stretching' })).toEqual(['Hamstring_Stretch']);
    expect(names({ text: 'zumba' })).toEqual([]);
  });

  it('names equipment plainly', () => {
    expect(equipmentName('body only')).toBe('No equipment');
    expect(equipmentName('e-z curl bar')).toBe('EZ curl bar');
    expect(equipmentName('machine')).toBe('Machine');
  });
});

describe('spoken workout', () => {
  it('says each step the way a coach would', () => {
    expect(spokenReps('10-12')).toBe('10 to 12 reps');
    expect(spokenReps('8')).toBe('8 reps');
    expect(spokenReps('30 s')).toBe('30 s');
    expect(introLine(DAY)).toBe("Let's train. Full body, 2 exercises. Warm up first: 5 min walk.");
    expect(exerciseLine(DAY.exercises[0]!, 0, 2)).toBe('Exercise 1 of 2: Leg press. 3 sets of 10 to 12 reps. Feet flat.');
    expect(exerciseLine(DAY.exercises[1]!, 1, 2)).toBe('Exercise 2 of 2: Plank. 1 set of 30 s.');
    expect(setLine(2, 3, '10-12')).toBe('Set 2 of 3. 10 to 12 reps. Go.');
    expect(restLine(90, 'Next: set 2.')).toBe('Rest 90 seconds. Next: set 2.');
    expect(restLine(0, 'Next: Plank.')).toBe('Next: Plank.');
    expect(finishLine(DAY, 4)).toBe('Workout done. 4 sets. Great work. Cool down: Stretch 5 minutes.');
  });

  it('reads plain words aloud and finds the language of an answer', () => {
    expect(speakable('- **Squat** 3 × 10\n- Rest 60 s, 2-3 kg more, 250 kcal')).toBe('Squat 3 by 10 Rest 60 seconds, 2 to 3 kilos more, 250 calories');
    expect(languageOfText('బాగా చేశారు')).toBe('te');
    expect(languageOfText('बहुत अच्छा')).toBe('hi');
    expect(languageOfText('Well done', 'en')).toBe('en');
    expect(stepsToRead({ ...CARDS[0]!, force: null, mechanic: null, instructions: ['Sit down.', 'Push.'] })).toBe('Leg Press. Step 1. Sit down. Step 2. Push.');
  });
});

describe('photos and plans', () => {
  it('shrinks big photos and keeps small ones', () => {
    expect(fittedSize(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(fittedSize(900, 1600)).toEqual({ width: 720, height: 1280 });
    expect(fittedSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(daysBetween('2026-09-01', '2026-10-20')).toBe(49);
    expect(apart(0)).toContain('same day');
    expect(apart(1)).toBe('1 day apart');
    expect(apart(14)).toBe('14 days apart');
  });

  it('starts a guided workout only on a training day with exercises', () => {
    const state: TrainerState = {
      profile: null,
      targets: null,
      diet: null,
      coach_ready: true,
      workout: { summary: '', days: [DAY, { ...DAY, day: 'wednesday', rest: true, exercises: [] }] },
    };

    expect(workoutFor(state, '2026-10-20')).toBe(DAY);
    expect(workoutFor(state, '2026-10-21')).toBeNull();
    expect(workoutFor(state, '2026-10-22')).toBeNull();
    expect(workoutFor({ ...state, workout: null }, '2026-10-20')).toBeNull();
  });
});
