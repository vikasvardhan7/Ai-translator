import type { Activity, Diet, Equipment, Goal, Level, Weekday } from '../../services/trainer';

export const GOALS: Record<Goal, string> = {
  lose_fat: 'Lose fat',
  build_muscle: 'Build muscle',
  get_fit: 'Get fit and healthy',
  get_stronger: 'Get stronger',
  endurance: 'Better stamina',
};

export const LEVELS: Record<Level, string> = {
  beginner: 'Beginner (new or back after a long break)',
  intermediate: 'Intermediate (training for months)',
  advanced: 'Advanced (training for years)',
};

export const ACTIVITIES: Record<Activity, string> = {
  sitting: 'Mostly sitting',
  light: 'On my feet a little',
  moderate: 'On my feet a lot',
  very_active: 'Physical work all day',
};

export const EQUIPMENT: Record<Equipment, string> = {
  gym: 'A gym',
  home_dumbbells: 'Dumbbells at home',
  bodyweight: 'No equipment',
};

export const DIETS: Record<Diet, string> = {
  vegetarian: 'Vegetarian',
  eggetarian: 'Vegetarian with eggs',
  non_vegetarian: 'Non-vegetarian',
  vegan: 'Vegan',
};

export function dayName(day: Weekday): string {
  return day[0]!.toUpperCase() + day.slice(1);
}

export function rounded(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
