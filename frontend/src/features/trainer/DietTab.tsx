import { useState } from 'react';

import { mealTotals, savePlan, type DietDay, type DietPlan, type FoodItem, type Meal, type TrainerState } from '../../services/trainer';
import { budgetWords, dayCost, itemsCost, money, targetWords } from './food';
import { dayName, rounded } from './labels';
import PlanMaker from './PlanMaker';
import { problemText } from './problems';

interface DietTabProps {
  state: TrainerState;
  onState: (state: TrainerState) => void;
}

const BLANK_ITEM: FoodItem = { food: '', amount: '', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

function numberOf(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function DayEditor({ day, onSave, onCancel }: { day: DietDay; onSave: (day: DietDay) => Promise<void>; onCancel: () => void }) {
  const [meals, setMeals] = useState<Meal[]>(day.meals);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  function changeMeal(index: number, update: Partial<Meal>): void {
    setMeals((current) => current.map((meal, place) => (place === index ? { ...meal, ...update } : meal)));
  }

  function changeItem(mealIndex: number, itemIndex: number, update: Partial<FoodItem>): void {
    setMeals((current) => current.map((meal, place) => (place === mealIndex
      ? { ...meal, items: meal.items.map((item, spot) => (spot === itemIndex ? { ...item, ...update } : item)) }
      : meal)));
  }

  async function save(): Promise<void> {
    const cleaned = meals
      .map((meal) => ({ ...meal, items: meal.items.filter((item) => item.food.trim()) }))
      .filter((meal) => meal.name.trim());
    setBusy(true);
    setProblem('');
    try {
      await onSave({ ...day, meals: cleaned });
    } catch (error) {
      setProblem(problemText(error));
      setBusy(false);
    }
  }

  return (
    <div className="plan-editor">
      {meals.map((meal, mealIndex) => (
        <fieldset className="plan-edit-meal" key={mealIndex}>
          <legend className="visually-hidden">Meal {mealIndex + 1}</legend>
          <div className="plan-edit-row">
            <input className="text-input" aria-label="Meal" value={meal.name} maxLength={40} onChange={(event) => changeMeal(mealIndex, { name: event.currentTarget.value })} />
            <input className="text-input" aria-label="Time" type="time" value={meal.time} onChange={(event) => changeMeal(mealIndex, { time: event.currentTarget.value })} />
            <button className="button button-link" type="button" onClick={() => setMeals(meals.filter((_, place) => place !== mealIndex))}>Remove meal</button>
          </div>
          {meal.items.map((item, itemIndex) => (
            <div className="plan-edit-row plan-edit-food" key={itemIndex}>
              <input className="text-input plan-edit-wide" aria-label="Food" placeholder="Food" value={item.food} maxLength={80} onChange={(event) => changeItem(mealIndex, itemIndex, { food: event.currentTarget.value })} />
              <input className="text-input" aria-label="Amount" placeholder="Amount" value={item.amount} maxLength={40} onChange={(event) => changeItem(mealIndex, itemIndex, { amount: event.currentTarget.value })} />
              <input className="text-input" aria-label="Calories" type="number" min={0} value={item.calories} onChange={(event) => changeItem(mealIndex, itemIndex, { calories: Math.round(numberOf(event.currentTarget.value)) })} />
              <input className="text-input" aria-label="Protein grams" type="number" min={0} step={0.5} value={item.protein_g} onChange={(event) => changeItem(mealIndex, itemIndex, { protein_g: numberOf(event.currentTarget.value) })} />
              <input className="text-input" aria-label="Carbohydrate grams" type="number" min={0} step={0.5} value={item.carbs_g} onChange={(event) => changeItem(mealIndex, itemIndex, { carbs_g: numberOf(event.currentTarget.value) })} />
              <input className="text-input" aria-label="Fat grams" type="number" min={0} step={0.5} value={item.fat_g} onChange={(event) => changeItem(mealIndex, itemIndex, { fat_g: numberOf(event.currentTarget.value) })} />
              <button className="button button-link" type="button" onClick={() => changeMeal(mealIndex, { items: meal.items.filter((_, place) => place !== itemIndex) })}>Remove</button>
            </div>
          ))}
          <button className="button button-secondary button-small" type="button" disabled={meal.items.length >= 12} onClick={() => changeMeal(mealIndex, { items: [...meal.items, BLANK_ITEM] })}>
            Add food
          </button>
        </fieldset>
      ))}
      <button className="button button-secondary button-small" type="button" disabled={meals.length >= 8} onClick={() => setMeals([...meals, { name: 'Snack', time: '', items: [BLANK_ITEM] }])}>
        Add meal
      </button>
      <p className="form-help">Each food: calories, then protein, carbohydrate and fat in grams.</p>
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
      <div className="meeting-actions">
        <button className="button button-primary button-small" type="button" disabled={busy} onClick={() => void save()}>Save day</button>
        <button className="button button-link" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function DayCard({ day, plan, state, onState }: { day: DietDay; plan: DietPlan; state: TrainerState; onState: (state: TrainerState) => void }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'redo'>('view');
  const totals = mealTotals(day.meals);
  const target = state.targets?.calories ?? 0;
  const currency = state.profile?.currency ?? '₹';
  const cost = dayCost(day);
  const spend = cost === null ? null : budgetWords(cost, state.profile?.food_budget_per_day, currency);

  async function saveDay(next: DietDay): Promise<void> {
    onState(await savePlan('diet', { ...plan, days: plan.days.map((old) => (old.day === next.day ? next : old)) }));
    setMode('view');
  }

  return (
    <li className="trainer-card plan-day">
      <header className="plan-day-top">
        <div>
          <h3>{dayName(day.day)}</h3>
          <p className="meeting-when">
            {targetWords(totals.calories, target, 'kcal')}. Protein {targetWords(totals.protein_g, state.targets?.protein_g, 'g')}. Carbohydrate {rounded(totals.carbs_g)} g, fat {rounded(totals.fat_g)} g.
          </p>
          {spend && <p className="plan-day-cost" data-over={spend.over}>Costs {spend.text}</p>}
        </div>
        {mode === 'view' && (
          <div className="meeting-actions">
            <button className="button button-secondary button-small" type="button" onClick={() => setMode('edit')}>Edit</button>
            <button className="button button-link" type="button" onClick={() => setMode('redo')}>Make again…</button>
          </div>
        )}
      </header>
      {mode === 'edit' ? (
        <DayEditor day={day} onSave={saveDay} onCancel={() => setMode('view')} />
      ) : (
        <>
          <ul className="plan-meals">
            {day.meals.map((meal, index) => (
              <li key={`${meal.name}-${index}`}>
                <p className="plan-meal-name">
                  {meal.name}{meal.time ? <span>, {meal.time}</span> : null}
                  {itemsCost(meal.items) !== null && <span className="plan-meal-cost">{money(itemsCost(meal.items)!, currency)}</span>}
                </p>
                <ul>
                  {meal.items.map((item, spot) => (
                    <li key={`${item.food}-${spot}`}>
                      <span>{item.food}{item.amount ? `, ${item.amount}` : ''}</span>
                      <small>
                        {item.calories} kcal, protein {rounded(item.protein_g)} g, carbohydrate {rounded(item.carbs_g)} g, fat {rounded(item.fat_g)} g
                        {typeof item.cost === 'number' ? `, ${money(item.cost, currency)}` : ''}
                      </small>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {mode === 'redo' && (
            <>
              <PlanMaker kind="diet" day={day.day} label={`Make ${dayName(day.day)} again`} placeholder="For example: no rice, more protein" ready={state.coach_ready} onState={onState} onDone={() => setMode('view')} />
              <button className="button button-link" type="button" onClick={() => setMode('view')}>Cancel</button>
            </>
          )}
        </>
      )}
    </li>
  );
}

function MoneyHint({ state }: { state: TrainerState }) {
  const prices = state.profile?.prices ?? [];
  if (prices.length > 0) {
    return (
      <p className="form-help">
        Uses only your {prices.length === 1 ? 'food' : `${prices.length} foods`} and prices from Profile{state.profile?.food_budget_per_day ? `, within ${money(state.profile.food_budget_per_day, state.profile.currency ?? '₹')} a day` : ''}. Changed a price? Make a new week.
      </p>
    );
  }
  return <p className="form-help">Want the meals to fit your money? In Profile, add the foods you buy with what you pay, and a daily budget, then make a new week.</p>;
}

function WeekCost({ plan, state }: { plan: DietPlan; state: TrainerState }) {
  const costs = plan.days.map(dayCost).filter((cost): cost is number => cost !== null);
  if (costs.length === 0) {
    return null;
  }
  const currency = state.profile?.currency ?? '₹';
  const average = costs.reduce((total, cost) => total + cost, 0) / costs.length;
  const budget = state.profile?.food_budget_per_day;
  const over = budget ? costs.filter((cost) => cost > budget).length : 0;
  return (
    <p className="plan-week-cost" data-over={over > 0}>
      About {money(average, currency)} a day, {money(average * 7, currency)} for the week{budget ? (over ? `. ${over === 1 ? '1 day goes' : `${over} days go`} over your ${money(budget, currency)} budget.` : `, all within your ${money(budget, currency)} budget.`) : '.'}
    </p>
  );
}

export default function DietTab({ state, onState }: DietTabProps) {
  const [remaking, setRemaking] = useState(false);
  const plan = state.diet;

  if (!plan) {
    return (
      <section className="trainer-card">
        <h2>Your meal plan</h2>
        <p className="form-help">The AI makes a week of meals that add up to your daily targets, with the food you eat. You can change any meal afterwards.</p>
        <MoneyHint state={state} />
        <PlanMaker kind="diet" label="Make my meal plan" placeholder="For example: cheap foods, no mushrooms" ready={state.coach_ready} onState={onState} />
      </section>
    );
  }

  return (
    <div className="plan-view">
      <section className="trainer-card plan-summary">
        <p>{plan.summary}</p>
        <WeekCost plan={plan} state={state} />
        <MoneyHint state={state} />
        {remaking ? (
          <PlanMaker kind="diet" label="Make a new week" placeholder="What should be different?" ready={state.coach_ready} onState={onState} onDone={() => setRemaking(false)} />
        ) : (
          <button className="button button-secondary button-small" type="button" onClick={() => setRemaking(true)}>Make a new week…</button>
        )}
      </section>
      <ul className="plan-days">
        {plan.days.map((day) => (
          <DayCard key={day.day} day={day} plan={plan} state={state} onState={onState} />
        ))}
      </ul>
    </div>
  );
}
