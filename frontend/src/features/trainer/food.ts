import type { DietDay, EntryData, FoodGuess, FoodItem, Meal, Portion } from '../../services/trainer';

const SAME_PORTION = 0.08;
const MAX_GRAMS = 2000;

export interface Nutrition {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface PortionChoice extends Portion {
  estimate: boolean;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function cleanGrams(grams: number): number {
  return Number.isFinite(grams) ? Math.min(MAX_GRAMS, Math.max(0, Math.round(grams))) : 0;
}

export function portionNutrition(guess: FoodGuess, grams: number): Nutrition {
  const share = cleanGrams(grams) / 100;
  return {
    calories: Math.round(guess.calories_100g * share),
    protein_g: oneDecimal(guess.protein_100g * share),
    carbs_g: oneDecimal(guess.carbs_100g * share),
    fat_g: oneDecimal(guess.fat_100g * share),
  };
}

export function portionChoices(guess: FoodGuess, fromPhoto: boolean): PortionChoice[] {
  const estimate: PortionChoice = {
    label: fromPhoto ? 'What the photo shows' : 'Usual amount',
    grams: Math.round(guess.grams),
    estimate: true,
  };
  const others = guess.portions
    .filter((portion) => portion.grams > 0)
    .filter((portion) => Math.abs(portion.grams - estimate.grams) > estimate.grams * SAME_PORTION)
    .map((portion): PortionChoice => ({ label: portion.label, grams: Math.round(portion.grams), estimate: false }));
  return [...others, estimate].sort((one, two) => one.grams - two.grams);
}

export function addUp(parts: readonly Nutrition[]): Nutrition {
  return parts.reduce(
    (total, part) => ({
      calories: total.calories + part.calories,
      protein_g: oneDecimal(total.protein_g + part.protein_g),
      carbs_g: oneDecimal(total.carbs_g + part.carbs_g),
      fat_g: oneDecimal(total.fat_g + part.fat_g),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

export function guessEntry(guess: FoodGuess, grams: number, meal: string, photoId: string | null): EntryData {
  const amount = cleanGrams(grams);
  return {
    kind: 'meal',
    meal,
    food: `${guess.food.trim() || 'Food'}, ${amount} g`.slice(0, 200),
    ...portionNutrition(guess, amount),
    photo_id: photoId,
  };
}

export function itemsCost(items: readonly FoodItem[]): number | null {
  const priced = items.filter((item) => typeof item.cost === 'number');
  return priced.length === 0 ? null : priced.reduce((total, item) => total + (item.cost ?? 0), 0);
}

export function dayCost(day: DietDay): number | null {
  return itemsCost(day.meals.flatMap((meal: Meal) => meal.items));
}

export function dayNutrition(day: DietDay): Nutrition {
  return addUp(
    day.meals.flatMap((meal) => meal.items).map((item) => ({
      calories: item.calories,
      protein_g: item.protein_g,
      carbs_g: item.carbs_g,
      fat_g: item.fat_g,
    })),
  );
}

export function money(amount: number, currency: string): string {
  const rounded = amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10;
  return `${currency}${rounded.toLocaleString()}`;
}

export function budgetWords(cost: number, budget: number | null | undefined, currency: string): { text: string; over: boolean } {
  if (!budget) {
    return { text: `${money(cost, currency)} a day`, over: false };
  }
  const left = budget - cost;
  if (left >= 0) {
    return { text: `${money(cost, currency)} of your ${money(budget, currency)} budget, ${money(left, currency)} to spare`, over: false };
  }
  return { text: `${money(cost, currency)}, ${money(-left, currency)} over your ${money(budget, currency)} budget`, over: true };
}

export function targetWords(eaten: number, target: number | null | undefined, unit: string): string {
  if (!target) {
    return `${Math.round(eaten).toLocaleString()} ${unit}`;
  }
  const gap = Math.round(eaten - target);
  if (Math.abs(gap) <= target * 0.05) {
    return `${Math.round(eaten).toLocaleString()} ${unit}, on target`;
  }
  return `${Math.round(eaten).toLocaleString()} ${unit}, ${Math.abs(gap).toLocaleString()} ${unit} ${gap > 0 ? 'over' : 'under'} target`;
}
