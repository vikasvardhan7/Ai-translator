import { describe, expect, it } from 'vitest';

import type { ExerciseCard, WorkoutPlan } from '../../services/trainer';
import { alternatives, fits, lastTime, lastWords, nextWords, swapped, videoLink } from './progression';

function card(id: string, equipment: string, level = 'beginner', primary = 'quadriceps', category = 'strength'): ExerciseCard {
  return { id, name: id.replace(/_/g, ' '), equipment, category, level, primary: [primary], secondary: [], images: [] };
}

const SQUAT = card('Goblet_Squat', 'kettlebells');
const CARDS = [
  SQUAT,
  card('Barbell_Squat', 'barbell', 'intermediate'),
  card('Front_Barbell_Squat', 'barbell', 'expert'),
  card('Leg_Press', 'machine'),
  card('Bodyweight_Squat', 'body only'),
  card('Dumbbell_Lunges', 'dumbbell'),
  card('Leg_Extensions', 'machine'),
  card('Box_Jump', 'body only', 'beginner', 'quadriceps', 'plyometrics'),
  card('Pushups', 'body only', 'beginner', 'chest'),
  card('Atlas_Stone', 'other', 'beginner', 'quadriceps', 'strongman'),
];

describe('other ways to train the same muscles', () => {
  it('picks level and equipment that fit, with different equipment first', () => {
    const gym = alternatives(SQUAT, CARDS, 'gym', 'beginner').map((option) => option.id);
    expect(gym).toEqual(['Barbell_Squat', 'Dumbbell_Lunges', 'Bodyweight_Squat']);
    expect(gym).not.toContain('Front_Barbell_Squat');
  });

  it('keeps to what the person has at home', () => {
    expect(alternatives(SQUAT, CARDS, 'bodyweight', 'beginner').map((option) => option.id)).toEqual(['Bodyweight_Squat']);
    expect(alternatives(SQUAT, CARDS, 'home_dumbbells', 'beginner').map((option) => option.equipment)).toEqual(['dumbbell', 'body only']);
  });

  it('never offers strongman, or expert lifts before advanced', () => {
    expect(fits(card('Atlas_Stone', 'other', 'beginner', 'quadriceps', 'strongman'), 'gym', 'advanced')).toBe(false);
    expect(fits(card('Front_Barbell_Squat', 'barbell', 'expert'), 'gym', 'advanced')).toBe(true);
    expect(fits(card('Power_Snatch', 'barbell', 'intermediate', 'hamstrings', 'olympic weightlifting'), 'gym', 'intermediate')).toBe(false);
  });

  it('swaps one exercise and keeps its sets and reps', () => {
    const plan: WorkoutPlan = {
      summary: '',
      days: [{ day: 'monday', focus: 'Legs', rest: false, warmup: '', cooldown: '', exercises: [{ name: 'Goblet squat', sets: 3, reps: '10-12', rest_seconds: 90, how: 'Chest up', library_id: 'Goblet_Squat' }] }],
    };
    const done = swapped(plan, 'monday', 0, CARDS[3]!);
    expect(done.days[0]!.exercises[0]).toEqual({ name: 'Leg Press', sets: 3, reps: '10-12', rest_seconds: 90, how: '', library_id: 'Leg_Press' });
  });
});

describe('your weights', () => {
  const history = [
    { name: 'Goblet squat', day: '2026-10-18', sets: 3, reps: 10, weight_kg: 20 },
    { name: 'Lateral raise', day: '2026-10-18', sets: 3, reps: 12, weight_kg: 4 },
    { name: 'Plank', day: '2026-10-17', sets: 3, reps: 0, weight_kg: null },
  ];

  it('finds the last time by name, whatever the capitals', () => {
    expect(lastTime(history, ' goblet SQUAT ')?.weight_kg).toBe(20);
    expect(lastTime(history, 'Deadlift')).toBeUndefined();
  });

  it('describes last time and suggests a small next step', () => {
    expect(lastWords(history[0]!)).toMatch(/^Last time \(.+\): 3 × 10 at 20 kg$/);
    expect(nextWords(history[0]!)).toContain('22.5 kg if every set felt easy');
    expect(nextWords(history[1]!)).toContain('5 kg if every set felt easy');
    expect(lastWords(history[2]!)).toContain('3 × ?, no added weight');
    expect(nextWords(history[2]!)).toContain('add 1 or 2 reps');
  });

  it('links to videos of the exercise', () => {
    expect(videoLink('Goblet squat')).toBe('https://www.youtube.com/results?search_query=Goblet%20squat%20exercise%20proper%20form');
  });
});
