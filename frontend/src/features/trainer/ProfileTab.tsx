import { useState, type FormEvent } from 'react';

import {
  exportTrainer,
  forgetTrainer,
  localDay,
  saveProfile,
  type Activity,
  type Diet,
  type Equipment,
  type Goal,
  type Level,
  type PricedFood,
  type Profile,
  type TrainerState,
} from '../../services/trainer';
import { saveFile } from '../session/download';
import { ACTIVITIES, DIETS, EQUIPMENT, GOALS, LEVELS } from './labels';
import { problemText } from './problems';

interface ProfileTabProps {
  state: TrainerState;
  onState: (state: TrainerState) => void;
  onForgotten: () => void;
}

interface Draft {
  name: string;
  age: string;
  sex: '' | 'male' | 'female';
  height_cm: string;
  weight_kg: string;
  target_weight_kg: string;
  goal: Goal;
  level: Level;
  activity: Activity;
  days_per_week: string;
  minutes_per_session: string;
  equipment: Equipment;
  diet: Diet;
  cuisine: string;
  meals_per_day: string;
  allergies: string;
  health_notes: string;
  currency: string;
  budget: string;
  prices: PriceRow[];
}

interface PriceRow {
  food: string;
  price: string;
  per: string;
}

const MAX_PRICES = 80;
const EMPTY_ROW: PriceRow = { food: '', price: '', per: '' };

function draftOf(profile: Profile | null): Draft {
  return {
    name: profile?.name ?? '',
    age: profile ? String(profile.age) : '',
    sex: profile?.sex ?? '',
    height_cm: profile ? String(profile.height_cm) : '',
    weight_kg: profile ? String(profile.weight_kg) : '',
    target_weight_kg: profile?.target_weight_kg ? String(profile.target_weight_kg) : '',
    goal: profile?.goal ?? 'get_fit',
    level: profile?.level ?? 'beginner',
    activity: profile?.activity ?? 'light',
    days_per_week: profile ? String(profile.days_per_week) : '3',
    minutes_per_session: profile ? String(profile.minutes_per_session) : '45',
    equipment: profile?.equipment ?? 'gym',
    diet: profile?.diet ?? 'vegetarian',
    cuisine: profile?.cuisine ?? '',
    meals_per_day: profile ? String(profile.meals_per_day) : '4',
    allergies: profile?.allergies ?? '',
    health_notes: profile?.health_notes ?? '',
    currency: profile?.currency ?? '₹',
    budget: profile?.food_budget_per_day ? String(profile.food_budget_per_day) : '',
    prices: (profile?.prices ?? []).map((item) => ({ food: item.food, price: String(item.price), per: item.per })),
  };
}

function pricesFrom(rows: readonly PriceRow[]): PricedFood[] | string {
  const filled = rows.filter((row) => row.food.trim() || row.price.trim() || row.per.trim());
  const prices: PricedFood[] = [];
  for (const row of filled) {
    const price = Number(row.price.replace(',', '.'));
    if (!row.food.trim() || !row.per.trim() || !row.price.trim() || !(price >= 0 && price <= 100_000)) {
      return `Fill in the food, its price and what the price is for, like Rice, 60, 1 kg${row.food.trim() ? ` (check ${row.food.trim()})` : ''}.`;
    }
    prices.push({ food: row.food.trim().slice(0, 60), price, per: row.per.trim().slice(0, 30) });
  }
  return prices.slice(0, MAX_PRICES);
}

export function profileFrom(draft: Draft): Profile | string {
  const number = (value: string): number => Number(value.replace(',', '.'));
  if (!draft.name.trim()) {
    return 'Type your name.';
  }
  if (!draft.sex) {
    return 'Choose the body the plan should be made for.';
  }
  const age = number(draft.age);
  const height = number(draft.height_cm);
  const weight = number(draft.weight_kg);
  const target = draft.target_weight_kg.trim() ? number(draft.target_weight_kg) : null;
  if (!Number.isInteger(age) || age < 14 || age > 90) {
    return 'Age must be a whole number from 14 to 90.';
  }
  if (!(height >= 120 && height <= 230)) {
    return 'Height must be from 120 to 230 cm.';
  }
  if (!(weight >= 30 && weight <= 300) || (target !== null && !(target >= 30 && target <= 300))) {
    return 'Weights must be from 30 to 300 kg.';
  }
  const budget = draft.budget.trim() ? number(draft.budget) : null;
  if (budget !== null && !(budget > 0 && budget <= 100_000)) {
    return 'The food budget must be a number above 0, or left empty.';
  }
  const prices = pricesFrom(draft.prices);
  if (typeof prices === 'string') {
    return prices;
  }
  return {
    name: draft.name.trim(),
    age,
    sex: draft.sex,
    height_cm: height,
    weight_kg: weight,
    target_weight_kg: target,
    goal: draft.goal,
    level: draft.level,
    activity: draft.activity,
    days_per_week: Number(draft.days_per_week),
    minutes_per_session: Number(draft.minutes_per_session),
    equipment: draft.equipment,
    diet: draft.diet,
    cuisine: draft.cuisine.trim(),
    meals_per_day: Number(draft.meals_per_day),
    allergies: draft.allergies.trim(),
    health_notes: draft.health_notes.trim(),
    currency: draft.currency.trim().slice(0, 4) || '₹',
    food_budget_per_day: budget,
    prices,
  };
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (value: T) => void }) {
  return (
    <label className="field-label">
      {label}
      <select className="text-input" value={value} onChange={(event) => onChange(event.currentTarget.value as T)}>
        {(Object.keys(options) as T[]).map((key) => (
          <option key={key} value={key}>{options[key]}</option>
        ))}
      </select>
    </label>
  );
}

export default function ProfileTab({ state, onState, onForgotten }: ProfileTabProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(state.profile));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [message, setMessage] = useState('');
  const [forgetting, setForgetting] = useState(false);

  function set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const profile = profileFrom(draft);
    if (typeof profile === 'string') {
      setProblem(profile);
      return;
    }
    setBusy(true);
    setProblem('');
    setMessage('');
    try {
      onState(await saveProfile(profile));
      setMessage('Saved. Your targets below are worked out from it.');
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setBusy(false);
    }
  }

  async function download(): Promise<void> {
    try {
      const data = await exportTrainer();
      saveFile(`trainer-${localDay()}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8', false);
    } catch (error) {
      setProblem(problemText(error));
    }
  }

  async function forget(): Promise<void> {
    try {
      await forgetTrainer();
      setForgetting(false);
      setDraft(draftOf(null));
      onForgotten();
    } catch (error) {
      setProblem(problemText(error));
    }
  }

  const targets = state.targets;
  const text = (key: Exclude<keyof Draft, 'prices'>, label: string, extra: Record<string, string | number> = {}) => (
    <label className="field-label">
      {label}
      <input className="text-input" value={draft[key]} onChange={(event) => set(key, event.currentTarget.value as never)} {...extra} />
    </label>
  );

  return (
    <div className="trainer-profile">
      {!state.profile && (
        <section className="trainer-hello">
          <h2>Your personal trainer</h2>
          <p>Tell it about yourself once. It works out your daily calories and protein, then makes a weekly workout and meal plan that you can change any time, and helps you track every day.</p>
        </section>
      )}
      <form className="trainer-form" onSubmit={(event) => void save(event)}>
        <fieldset>
          <legend>About you</legend>
          <div className="trainer-grid">
            {text('name', 'Name', { maxLength: 40, autoComplete: 'given-name' })}
            {text('age', 'Age', { inputMode: 'numeric', maxLength: 2 })}
            <label className="field-label">
              Plan for a body that is
              <select className="text-input" value={draft.sex} onChange={(event) => set('sex', event.currentTarget.value as Draft['sex'])}>
                <option value="">Choose</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </label>
            {text('height_cm', 'Height (cm)', { inputMode: 'decimal', maxLength: 5 })}
            {text('weight_kg', 'Weight (kg)', { inputMode: 'decimal', maxLength: 5 })}
            {text('target_weight_kg', 'Goal weight (kg, optional)', { inputMode: 'decimal', maxLength: 5 })}
          </div>
        </fieldset>
        <fieldset>
          <legend>Training</legend>
          <div className="trainer-grid">
            <Choice label="Main goal" value={draft.goal} options={GOALS} onChange={(value) => set('goal', value)} />
            <Choice label="Experience" value={draft.level} options={LEVELS} onChange={(value) => set('level', value)} />
            <Choice label="Daily activity outside training" value={draft.activity} options={ACTIVITIES} onChange={(value) => set('activity', value)} />
            <Choice label="Where you train" value={draft.equipment} options={EQUIPMENT} onChange={(value) => set('equipment', value)} />
            <label className="field-label">
              Training days a week
              <select className="text-input" value={draft.days_per_week} onChange={(event) => set('days_per_week', event.currentTarget.value)}>
                {[1, 2, 3, 4, 5, 6, 7].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            <label className="field-label">
              Minutes a session
              <select className="text-input" value={draft.minutes_per_session} onChange={(event) => set('minutes_per_session', event.currentTarget.value)}>
                {[20, 30, 45, 60, 75, 90, 120].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Food</legend>
          <div className="trainer-grid">
            <Choice label="You eat" value={draft.diet} options={DIETS} onChange={(value) => set('diet', value)} />
            {text('cuisine', 'Food you like (optional)', { maxLength: 60, placeholder: 'For example: South Indian' })}
            <label className="field-label">
              Meals a day
              <select className="text-input" value={draft.meals_per_day} onChange={(event) => set('meals_per_day', event.currentTarget.value)}>
                {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            {text('allergies', 'Allergies or foods to avoid', { maxLength: 200 })}
          </div>
          <label className="field-label">
            Injuries or health notes the plan should respect (optional)
            <textarea className="text-input trainer-notes" value={draft.health_notes} maxLength={300} onChange={(event) => set('health_notes', event.currentTarget.value)} />
          </label>
        </fieldset>
        <fieldset className="trainer-money">
          <legend>Food budget and your prices</legend>
          <p className="form-help">
            List the foods you buy and what you really pay. The meal plan then uses only these foods, with your prices, and shows what every meal and day costs. Leave the list empty and the plan picks everyday foods without costs.
          </p>
          <div className="trainer-grid">
            <label className="field-label">
              Money sign
              <input className="text-input" value={draft.currency} maxLength={4} onChange={(event) => set('currency', event.currentTarget.value)} />
            </label>
            {text('budget', 'Food budget a day (optional)', { inputMode: 'decimal', maxLength: 8, placeholder: 'For example: 200' })}
          </div>
          <table className="price-table">
            <caption className="visually-hidden">Your food prices</caption>
            <thead>
              <tr>
                <th scope="col">Food</th>
                <th scope="col">Price ({draft.currency || '₹'})</th>
                <th scope="col">For</th>
                <th scope="col"><span className="visually-hidden">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {draft.prices.map((row, index) => (
                <tr key={index}>
                  <td>
                    <input className="text-input" aria-label={`Food ${index + 1}`} placeholder="Rice" value={row.food} maxLength={60} onChange={(event) => set('prices', draft.prices.map((old, place) => (place === index ? { ...old, food: event.currentTarget.value } : old)))} />
                  </td>
                  <td>
                    <input className="text-input" aria-label={`Price of food ${index + 1}`} placeholder="60" inputMode="decimal" value={row.price} maxLength={9} onChange={(event) => set('prices', draft.prices.map((old, place) => (place === index ? { ...old, price: event.currentTarget.value } : old)))} />
                  </td>
                  <td>
                    <input className="text-input" aria-label={`Amount the price of food ${index + 1} is for`} placeholder="1 kg" value={row.per} maxLength={30} onChange={(event) => set('prices', draft.prices.map((old, place) => (place === index ? { ...old, per: event.currentTarget.value } : old)))} />
                  </td>
                  <td>
                    <button className="button button-link" type="button" aria-label={`Remove food ${index + 1}`} onClick={() => set('prices', draft.prices.filter((_, place) => place !== index))}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="button button-secondary button-small" type="button" disabled={draft.prices.length >= MAX_PRICES} onClick={() => set('prices', [...draft.prices, EMPTY_ROW])}>
            Add a food
          </button>
          <p className="form-help">Examples: Rice, 60, 1 kg. Eggs, 7, 1 egg. Milk, 30, 500 ml. Make a new meal plan after changing prices.</p>
        </fieldset>
        {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
        {message && <p className="notice" role="status">{message}</p>}
        <button className="button button-primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {state.profile ? 'Save changes' : 'Save and work out my targets'}
        </button>
      </form>

      {targets && (
        <section className="trainer-card trainer-targets" aria-labelledby="targets-title">
          <h3 id="targets-title">Your daily targets</h3>
          <dl>
            <div><dt>Calories</dt><dd>{targets.calories} kcal</dd></div>
            <div><dt>Protein</dt><dd>{targets.protein_g} g</dd></div>
            <div><dt>Carbohydrate</dt><dd>{targets.carbs_g} g</dd></div>
            <div><dt>Fat</dt><dd>{targets.fat_g} g</dd></div>
            <div><dt>Water</dt><dd>{(targets.water_ml / 1000).toFixed(2).replace(/0$/, '')} litres</dd></div>
          </dl>
          <p className="form-help">{targets.explanation} These are estimates, not medical advice.</p>
        </section>
      )}

      {state.profile && (
        <section className="trainer-card">
          <h3>Your data</h3>
          <p className="form-help">Your profile, plans and every tracked day are kept for your account only.</p>
          <div className="meeting-actions">
            <button className="button button-secondary button-small" type="button" onClick={() => void download()}>Download my data</button>
            {forgetting ? (
              <>
                <button className="button button-small meeting-cancel" type="button" onClick={() => void forget()}>Yes, delete everything</button>
                <button className="button button-link" type="button" onClick={() => setForgetting(false)}>Keep it</button>
              </>
            ) : (
              <button className="button button-link" type="button" onClick={() => setForgetting(true)}>Delete my trainer data…</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
