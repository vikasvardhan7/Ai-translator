import { describe, expect, it } from 'vitest';

import type { DietDay, FoodGuess } from '../../services/trainer';
import { budgetWords, cleanGrams, dayCost, dayNutrition, guessEntry, itemsCost, portionChoices, portionNutrition, targetWords } from './food';

const RICE: FoodGuess = {
  food: 'Steamed rice',
  grams: 180,
  calories_100g: 130,
  protein_100g: 2.7,
  carbs_100g: 28,
  fat_100g: 0.3,
  portions: [
    { label: '1 small katori', grams: 100 },
    { label: '1 medium katori', grams: 175 },
    { label: '1 large plate', grams: 300 },
  ],
  sure: true,
};

function item(food: string, calories: number, cost?: number) {
  return { food, amount: '', calories, protein_g: 10, carbs_g: 20, fat_g: 5, ...(cost === undefined ? {} : { cost }) };
}

describe('food from a photo', () => {
  it('works out the numbers from the grams the person picks', () => {
    expect(portionNutrition(RICE, 200)).toEqual({ calories: 260, protein_g: 5.4, carbs_g: 56, fat_g: 0.6 });
    expect(portionNutrition(RICE, 0).calories).toBe(0);
  });

  it('offers the usual portions around the estimate, without near copies', () => {
    expect(portionChoices(RICE, true)).toEqual([
      { label: '1 small katori', grams: 100, estimate: false },
      { label: 'What the photo shows', grams: 180, estimate: true },
      { label: '1 large plate', grams: 300, estimate: false },
    ]);
    expect(portionChoices(RICE, false)[1]!.label).toBe('Usual amount');
  });

  it('keeps grams whole and within reason', () => {
    expect([cleanGrams(152.6), cleanGrams(-5), cleanGrams(9000), cleanGrams(Number.NaN)]).toEqual([153, 0, 2000, 0]);
  });

  it('logs the food with its grams and the photo', () => {
    expect(guessEntry(RICE, 150, 'Lunch', 'a'.repeat(32))).toEqual({
      kind: 'meal',
      meal: 'Lunch',
      food: 'Steamed rice, 150 g',
      calories: 195,
      protein_g: 4.1,
      carbs_g: 42,
      fat_g: 0.5,
      photo_id: 'a'.repeat(32),
    });
    expect(guessEntry({ ...RICE, food: '  ' }, 100, 'Lunch', null)).toMatchObject({ food: 'Food, 100 g' });
  });
});

describe('meal plan money', () => {
  const day: DietDay = {
    day: 'monday',
    meals: [
      { name: 'Breakfast', time: '08:00', items: [item('Eggs', 150, 14), item('Bread', 160, 6.5)] },
      { name: 'Lunch', time: '13:00', items: [item('Rice', 400, 12)] },
    ],
  };

  it('adds up the cost of every food, meal and day', () => {
    expect(itemsCost(day.meals[0]!.items)).toBe(20.5);
    expect(dayCost(day)).toBe(32.5);
    expect(dayCost({ ...day, meals: [{ name: 'Lunch', time: '', items: [item('Rice', 400)] }] })).toBeNull();
    expect(dayNutrition(day)).toEqual({ calories: 710, protein_g: 30, carbs_g: 60, fat_g: 15 });
  });

  it('says how the day sits against the budget', () => {
    expect(budgetWords(180, 200, '₹')).toEqual({ text: '₹180 of your ₹200 budget, ₹20 to spare', over: false });
    expect(budgetWords(230, 200, '₹')).toEqual({ text: '₹230, ₹30 over your ₹200 budget', over: true });
    expect(budgetWords(32.5, null, '₹').text).toBe('₹32.5 a day');
  });

  it('says how the day sits against the targets', () => {
    expect(targetWords(2010, 2000, 'kcal')).toBe('2,010 kcal, on target');
    expect(targetWords(1700, 2000, 'kcal')).toBe('1,700 kcal, 300 kcal under target');
    expect(targetWords(95, null, 'g')).toBe('95 g');
  });
});
