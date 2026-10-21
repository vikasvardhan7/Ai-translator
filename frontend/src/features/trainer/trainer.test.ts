import { describe, expect, it } from 'vitest';

import type { DaySummary } from '../../services/trainer';
import { chartScale } from './Chart';
import { profileFrom } from './ProfileTab';
import { streak } from './ProgressTab';

const DRAFT = {
  name: ' Ravi ',
  age: '30',
  sex: 'male' as const,
  height_cm: '175',
  weight_kg: '80,5',
  target_weight_kg: '',
  goal: 'lose_fat' as const,
  level: 'beginner' as const,
  activity: 'moderate' as const,
  days_per_week: '3',
  minutes_per_session: '45',
  equipment: 'gym' as const,
  diet: 'vegetarian' as const,
  cuisine: ' South Indian ',
  meals_per_day: '4',
  allergies: '',
  health_notes: '',
  currency: '₹',
  budget: '',
  prices: [] as Array<{ food: string; price: string; per: string }>,
};

function day(part: Partial<DaySummary>): DaySummary {
  return {
    day: '2026-10-20',
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    water_ml: 0,
    exercises: 0,
    sets: 0,
    weight_kg: null,
    sleep_hours: null,
    steps: null,
    ...part,
  };
}

describe('trainer profile', () => {
  it('turns the form into a profile', () => {
    expect(profileFrom(DRAFT)).toMatchObject({ name: 'Ravi', age: 30, weight_kg: 80.5, target_weight_kg: null, cuisine: 'South Indian', days_per_week: 3, food_budget_per_day: null, prices: [] });
  });

  it('keeps the budget and the filled price rows, and skips empty ones', () => {
    const rows = [
      { food: ' Rice ', price: '60', per: ' 1 kg ' },
      { food: '', price: '', per: '' },
      { food: 'Eggs', price: '6,5', per: '1 egg' },
    ];
    expect(profileFrom({ ...DRAFT, budget: '150', prices: rows })).toMatchObject({
      food_budget_per_day: 150,
      prices: [
        { food: 'Rice', price: 60, per: '1 kg' },
        { food: 'Eggs', price: 6.5, per: '1 egg' },
      ],
    });
  });

  it.each([
    [{ name: ' ' }, 'name'],
    [{ sex: '' as const }, 'body'],
    [{ age: '12' }, 'Age'],
    [{ age: '30.5' }, 'Age'],
    [{ height_cm: '300' }, 'Height'],
    [{ weight_kg: 'heavy' }, 'Weights'],
    [{ target_weight_kg: '10' }, 'Weights'],
    [{ budget: '0' }, 'budget'],
    [{ prices: [{ food: 'Rice', price: '', per: '1 kg' }] }, 'check Rice'],
    [{ prices: [{ food: 'Rice', price: '60', per: '' }] }, 'what the price is for'],
  ])('explains what is wrong with %o', (change, word) => {
    expect(profileFrom({ ...DRAFT, ...change })).toEqual(expect.stringContaining(word));
  });
});

describe('tracking streak', () => {
  it('counts days in a row with anything logged, and today does not break it yet', () => {
    expect(streak([day({ water_ml: 500 }), day({}), day({ sets: 3 }), day({ calories: 200 }), day({})])).toBe(2);
    expect(streak([day({ sleep_hours: 7 }), day({ weight_kg: 80 })])).toBe(2);
    expect(streak([day({}), day({})])).toBe(0);
  });
});

describe('chart scale', () => {
  it('starts bars at zero with round steps above the target', () => {
    expect(chartScale([860], 2170, 'bars')).toEqual({ bottom: 0, top: 3000, ticks: [0, 1000, 2000, 3000] });
    expect(chartScale([7.5], null, 'bars').ticks).toEqual([0, 2, 4, 6, 8]);
  });

  it('keeps a line close to its values and includes the goal', () => {
    expect(chartScale([79.6], null, 'line').ticks).toEqual([79, 79.5, 80]);
    const scale = chartScale([79.6, 79.1], 74, 'line');
    expect(scale.bottom).toBeLessThanOrEqual(74);
    expect(scale.top).toBeGreaterThanOrEqual(79.6);
    expect(scale.ticks.length).toBeLessThanOrEqual(7);
  });

  it('draws an empty chart without data', () => {
    expect(chartScale([], null, 'line').ticks.length).toBeGreaterThanOrEqual(2);
    expect(chartScale([], null, 'bars').ticks[0]).toBe(0);
  });
});
