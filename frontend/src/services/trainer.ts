import { getBackendUrl } from '../config';
import { requestJson } from './api';

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type Goal = 'lose_fat' | 'build_muscle' | 'get_fit' | 'get_stronger' | 'endurance';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type Activity = 'sitting' | 'light' | 'moderate' | 'very_active';
export type Equipment = 'gym' | 'home_dumbbells' | 'bodyweight';
export type Diet = 'vegetarian' | 'eggetarian' | 'non_vegetarian' | 'vegan';
export type PlanKind = 'workout' | 'diet';
export type PhotoKind = 'meal' | 'body';
export type Page = 'today' | 'workouts' | 'diet' | 'progress' | 'exercises' | 'profile';

export interface Profile {
  name: string;
  age: number;
  sex: 'male' | 'female';
  height_cm: number;
  weight_kg: number;
  target_weight_kg: number | null;
  goal: Goal;
  level: Level;
  activity: Activity;
  days_per_week: number;
  minutes_per_session: number;
  equipment: Equipment;
  diet: Diet;
  cuisine: string;
  meals_per_day: number;
  allergies: string;
  health_notes: string;
}

export interface Targets {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  water_ml: number;
  resting_calories: number;
  daily_burn: number;
  explanation: string;
}

export interface Exercise {
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  how: string;
  library_id?: string;
}

export interface WorkoutDay {
  day: Weekday;
  focus: string;
  rest: boolean;
  warmup: string;
  exercises: Exercise[];
  cooldown: string;
}

export interface FoodItem {
  food: string;
  amount: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Meal {
  name: string;
  time: string;
  items: FoodItem[];
}

export interface DietDay {
  day: Weekday;
  meals: Meal[];
}

export interface WorkoutPlan {
  summary: string;
  days: WorkoutDay[];
}

export interface DietPlan {
  summary: string;
  days: DietDay[];
}

export type EntryData =
  | { kind: 'exercise'; name: string; sets: number; reps: number; weight_kg: number | null; minutes: number | null }
  | { kind: 'meal'; meal: string; food: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; photo_id?: string | null }
  | { kind: 'water'; ml: number }
  | { kind: 'weight'; kg: number }
  | { kind: 'sleep'; hours: number }
  | { kind: 'steps'; count: number }
  | { kind: 'note'; text: string };

export interface Entry {
  id: string;
  day: string;
  data: EntryData;
  created_at: string;
}

export interface DaySummary {
  day: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  water_ml: number;
  exercises: number;
  sets: number;
  weight_kg: number | null;
  sleep_hours: number | null;
  steps: number | null;
}

export interface DayLog {
  day: string;
  entries: Entry[];
  summary: DaySummary;
}

export interface TrainerState {
  profile: Profile | null;
  targets: Targets | null;
  workout: WorkoutPlan | null;
  diet: DietPlan | null;
  coach_ready: boolean;
}

export interface CoachLine {
  role: 'user' | 'assistant';
  text: string;
}

export interface CoachAction {
  kind: 'show_exercise' | 'start_workout' | 'open';
  exercise_id: string | null;
  query: string | null;
  page: Page | null;
}

export interface CoachReply {
  answer: string;
  logged: Entry[];
  actions: CoachAction[];
}

export interface Photo {
  id: string;
  day: string;
  kind: PhotoKind;
  created_at: string;
  size: number;
}

export interface ExerciseCard {
  id: string;
  name: string;
  equipment: string;
  category: string;
  level: string;
  primary: string[];
  secondary: string[];
  images: string[];
}

export interface ExerciseDetail extends ExerciseCard {
  force: string | null;
  mechanic: string | null;
  instructions: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checked<T>(value: unknown, keys: string[], what: string): T {
  if (!isRecord(value) || keys.some((key) => !(key in value))) {
    throw new Error(`The backend returned an invalid ${what}.`);
  }
  return value as T;
}

function sendJson(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

const STATE_KEYS = ['profile', 'targets', 'workout', 'diet', 'coach_ready'];

export async function loadTrainer(): Promise<TrainerState> {
  return checked(await requestJson<unknown>('/api/trainer'), STATE_KEYS, 'trainer');
}

export async function saveProfile(profile: Profile): Promise<TrainerState> {
  return checked(await requestJson<unknown>('/api/trainer/profile', sendJson(profile, 'PUT')), STATE_KEYS, 'trainer');
}

export async function makePlan(kind: PlanKind, wishes: string, day: Weekday | null = null): Promise<TrainerState> {
  return checked(await requestJson<unknown>(`/api/trainer/plans/${kind}`, sendJson({ wishes, day })), STATE_KEYS, 'trainer');
}

export async function savePlan(kind: PlanKind, plan: WorkoutPlan | DietPlan): Promise<TrainerState> {
  return checked(await requestJson<unknown>(`/api/trainer/plans/${kind}`, sendJson(plan, 'PUT')), STATE_KEYS, 'trainer');
}

export async function loadDay(day: string): Promise<DayLog> {
  return checked(await requestJson<unknown>(`/api/trainer/days/${encodeURIComponent(day)}`), ['day', 'entries', 'summary'], 'day');
}

export async function addEntry(day: string, data: EntryData): Promise<Entry> {
  return checked(
    await requestJson<unknown>(`/api/trainer/days/${encodeURIComponent(day)}/entries`, sendJson({ data })),
    ['id', 'day', 'data'],
    'entry',
  );
}

export async function removeEntry(id: string): Promise<void> {
  await requestJson<unknown>(`/api/trainer/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function loadProgress(until: string, days: number): Promise<DaySummary[]> {
  const body = checked<{ days: DaySummary[] }>(
    await requestJson<unknown>(`/api/trainer/progress?until=${encodeURIComponent(until)}&days=${days}`),
    ['days'],
    'progress',
  );
  return body.days;
}

export async function estimateFoods(text: string, photoId: string | null = null): Promise<FoodItem[]> {
  const body = photoId ? { text, photo_id: photoId } : { text };
  return checked<{ items: FoodItem[] }>(await requestJson<unknown>('/api/trainer/foods', sendJson(body)), ['items'], 'food list').items;
}

export async function askCoach(messages: CoachLine[], day: string, now: string): Promise<CoachReply> {
  const reply = checked<CoachReply>(await requestJson<unknown>('/api/trainer/coach', sendJson({ messages, day, now })), ['answer', 'logged'], 'answer');
  return { ...reply, actions: Array.isArray(reply.actions) ? reply.actions : [] };
}

export async function uploadPhoto(picture: Blob, day: string, kind: PhotoKind): Promise<Photo> {
  return checked(
    await requestJson<unknown>(`/api/trainer/photos?day=${encodeURIComponent(day)}&kind=${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': picture.type || 'image/jpeg' },
      body: picture,
    }),
    ['id', 'day', 'kind'],
    'photo',
  );
}

export async function listPhotos(kind: PhotoKind): Promise<Photo[]> {
  return checked<{ photos: Photo[] }>(await requestJson<unknown>(`/api/trainer/photos?kind=${kind}`), ['photos'], 'photo list').photos;
}

export async function deletePhoto(id: string): Promise<void> {
  await requestJson<unknown>(`/api/trainer/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function photoUrl(id: string): string {
  return `${getBackendUrl()}/api/trainer/photos/${encodeURIComponent(id)}`;
}

let library: Promise<ExerciseCard[]> | null = null;

export function loadExercises(): Promise<ExerciseCard[]> {
  library ??= requestJson<unknown>('/api/trainer/exercises').then(
    (body) => checked<{ exercises: ExerciseCard[] }>(body, ['exercises'], 'exercise library').exercises,
    (error: unknown) => {
      library = null;
      throw error;
    },
  );
  return library;
}

const details = new Map<string, Promise<ExerciseDetail>>();

export function loadExercise(id: string): Promise<ExerciseDetail> {
  let found = details.get(id);
  if (!found) {
    found = requestJson<unknown>(`/api/trainer/exercises/${encodeURIComponent(id)}`).then(
      (body) => checked<ExerciseDetail>(body, ['id', 'name', 'instructions', 'images'], 'exercise'),
      (error: unknown) => {
        details.delete(id);
        throw error;
      },
    );
    details.set(id, found);
  }
  return found;
}

export async function exportTrainer(): Promise<unknown> {
  return requestJson<unknown>('/api/trainer/export');
}

export async function forgetTrainer(): Promise<void> {
  await requestJson<unknown>('/api/trainer', { method: 'DELETE' });
}

export function localDay(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function shiftDay(day: string, by: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return localDay(new Date(year!, month! - 1, date! + by));
}

export function weekdayOf(day: string): Weekday {
  const [year, month, date] = day.split('-').map(Number);
  const index = new Date(year!, month! - 1, date!).getDay();
  return WEEKDAYS[(index + 6) % 7]!;
}

export function localNow(date: Date = new Date()): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (value: number): string => String(Math.floor(Math.abs(value))).padStart(2, '0');
  return `${localDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

export function firstNumber(text: string): number {
  const found = /\d+/.exec(text);
  return found ? Number(found[0]) : 0;
}

export function mealTotals(meals: readonly Meal[]): { calories: number; protein_g: number; carbs_g: number; fat_g: number } {
  const items = meals.flatMap((meal) => meal.items);
  const sum = (pick: (item: FoodItem) => number): number => Math.round(items.reduce((total, item) => total + pick(item), 0) * 10) / 10;
  return {
    calories: Math.round(sum((item) => item.calories)),
    protein_g: sum((item) => item.protein_g),
    carbs_g: sum((item) => item.carbs_g),
    fat_g: sum((item) => item.fat_g),
  };
}
