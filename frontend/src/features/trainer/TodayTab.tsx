import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  addEntry,
  deletePhoto,
  estimateFoods,
  firstNumber,
  loadDay,
  localDay,
  photoUrl,
  removeEntry,
  shiftDay,
  uploadPhoto,
  weekdayOf,
  type DayLog,
  type Entry,
  type EntryData,
  type Exercise,
  type FoodItem,
  type TrainerState,
} from '../../services/trainer';
import { dayName, rounded } from './labels';
import { shrinkPhoto } from './photos';
import { problemText } from './problems';

interface TodayTabProps {
  state: TrainerState;
  changed: number;
  onPlans: () => void;
  onStart: (day: string) => void;
  onShow: (id: string) => void;
  onLookUp: (name: string) => void;
}

interface MealPhoto {
  id: string;
  preview: string;
}

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

function Meter({ label, value, target, unit }: { label: string; value: number; target: number | null; unit: string }) {
  const share = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div className="today-meter">
      <p className="today-meter-label">{label}</p>
      <p className="today-meter-value">
        {rounded(value)}
        <small>{target ? ` / ${rounded(target)} ${unit}` : ` ${unit}`}</small>
      </p>
      {target ? (
        <div className="dev-usage" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(value, target)}>
          <span style={{ width: `${share}%` }} data-full={value > target * 1.1} />
        </div>
      ) : null}
    </div>
  );
}

function describe(data: EntryData): string {
  switch (data.kind) {
    case 'exercise':
      return `${data.name}: ${data.sets} ${data.sets === 1 ? 'set' : 'sets'}${data.reps ? ` × ${data.reps}` : ''}${data.weight_kg ? ` at ${rounded(data.weight_kg)} kg` : ''}${data.minutes ? `, ${data.minutes} min` : ''}`;
    case 'meal':
      return `${data.meal}: ${data.food} · ${data.calories} kcal · P ${rounded(data.protein_g)} g`;
    case 'water':
      return `Water ${data.ml} ml`;
    case 'weight':
      return `Weight ${rounded(data.kg)} kg`;
    case 'sleep':
      return `Sleep ${rounded(data.hours)} h`;
    case 'steps':
      return `${data.count.toLocaleString()} steps`;
    case 'note':
      return `Note: ${data.text}`;
  }
}

export default function TodayTab({ state, changed, onPlans, onStart, onShow, onLookUp }: TodayTabProps) {
  const today = localDay();
  const [day, setDay] = useState(today);
  const [log, setLog] = useState<DayLog | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [foodText, setFoodText] = useState('');
  const [foodMeal, setFoodMeal] = useState('Breakfast');
  const [found, setFound] = useState<FoodItem[] | null>(null);
  const [body, setBody] = useState({ weight: '', sleep: '', steps: '', note: '' });
  const [extra, setExtra] = useState({ name: '', sets: '3', reps: '10', weight: '', minutes: '' });
  const [photo, setPhoto] = useState<MealPhoto | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const preview = useRef<string | null>(null);

  useEffect(() => () => {
    if (preview.current) {
      URL.revokeObjectURL(preview.current);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLog(await loadDay(day));
      setProblem('');
    } catch (error) {
      setProblem(problemText(error));
    }
  }, [day]);

  useEffect(() => {
    void refresh();
  }, [refresh, changed]);

  async function add(...entries: EntryData[]): Promise<boolean> {
    setBusy(true);
    setProblem('');
    try {
      for (const data of entries) {
        await addEntry(day, data);
      }
      await refresh();
      return true;
    } catch (error) {
      setProblem(problemText(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: Entry): Promise<void> {
    try {
      await removeEntry(entry.id);
      await refresh();
    } catch (error) {
      setProblem(problemText(error));
    }
  }

  async function workOutFood(event?: FormEvent<HTMLFormElement>, photoId = photo?.id ?? null): Promise<void> {
    event?.preventDefault();
    if (!foodText.trim() && !photoId) {
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      setFound(await estimateFoods(foodText.trim(), photoId));
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setBusy(false);
    }
  }

  function clearPhoto(keepOnServer: boolean): void {
    if (photo && !keepOnServer) {
      void deletePhoto(photo.id).catch(() => undefined);
    }
    if (preview.current) {
      URL.revokeObjectURL(preview.current);
      preview.current = null;
    }
    setPhoto(null);
  }

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }
    setBusy(true);
    setProblem('');
    setFound(null);
    try {
      const small = await shrinkPhoto(file);
      const saved = await uploadPhoto(small, day, 'meal');
      clearPhoto(false);
      preview.current = URL.createObjectURL(small);
      setPhoto({ id: saved.id, preview: preview.current });
      setBusy(false);
      await workOutFood(undefined, saved.id);
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setBusy(false);
    }
  }

  async function addFound(): Promise<void> {
    if (!found) {
      return;
    }
    const meals = found.map((item): EntryData => ({
      kind: 'meal',
      meal: foodMeal,
      food: `${item.food}${item.amount ? `, ${item.amount}` : ''}`.slice(0, 200),
      calories: Math.max(0, Math.round(item.calories)),
      protein_g: item.protein_g,
      carbs_g: item.carbs_g,
      fat_g: item.fat_g,
      photo_id: photo?.id ?? null,
    }));
    if (await add(...meals)) {
      setFound(null);
      setFoodText('');
      clearPhoto(true);
    }
  }

  function howTo(exercise: Exercise): void {
    if (exercise.library_id) {
      onShow(exercise.library_id);
    } else {
      onLookUp(exercise.name);
    }
  }

  async function saveBody(kind: 'weight' | 'sleep' | 'steps' | 'note'): Promise<void> {
    const value = body[kind].trim();
    if (!value) {
      return;
    }
    const number = Number(value.replace(',', '.'));
    const data: EntryData | null = kind === 'note'
      ? { kind, text: value.slice(0, 500) }
      : !Number.isFinite(number) || number <= 0
        ? null
        : kind === 'weight'
          ? { kind, kg: number }
          : kind === 'sleep'
            ? { kind, hours: number }
            : { kind, count: Math.round(number) };
    if (!data) {
      setProblem('Type a number above zero.');
      return;
    }
    if (await add(data)) {
      setBody((current) => ({ ...current, [kind]: '' }));
    }
  }

  async function addExtra(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!extra.name.trim()) {
      return;
    }
    const ok = await add({
      kind: 'exercise',
      name: extra.name.trim().slice(0, 80),
      sets: Math.max(1, Math.round(Number(extra.sets) || 1)),
      reps: Math.max(0, Math.round(Number(extra.reps) || 0)),
      weight_kg: extra.weight ? Number(extra.weight) : null,
      minutes: extra.minutes ? Math.round(Number(extra.minutes)) : null,
    });
    if (ok) {
      setExtra({ name: '', sets: '3', reps: '10', weight: '', minutes: '' });
    }
  }

  const weekday = weekdayOf(day);
  const workout = state.workout?.days.find((item) => item.day === weekday) ?? null;
  const diet = state.diet?.days.find((item) => item.day === weekday) ?? null;
  const entries = log?.entries ?? [];
  const summary = log?.summary;
  const targets = state.targets;
  const doneNames = new Set(entries.flatMap((entry) => (entry.data.kind === 'exercise' ? [entry.data.name.toLowerCase()] : [])));
  const eatenMeals = new Set(entries.flatMap((entry) => (entry.data.kind === 'meal' ? [entry.data.meal.toLowerCase()] : [])));
  const plannedSets = workout?.exercises.reduce((total, exercise) => total + exercise.sets, 0) ?? 0;
  const label = day === today ? 'Today' : day === shiftDay(today, -1) ? 'Yesterday' : dayName(weekday);
  const shownPhotos = new Set<string>();
  const pretty = new Date(`${day}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="today">
      <header className="today-head">
        <button className="button button-secondary button-small" type="button" aria-label="Day before" onClick={() => setDay(shiftDay(day, -1))}>‹</button>
        <h2>{label} <small>{pretty}</small></h2>
        <button className="button button-secondary button-small" type="button" aria-label="Day after" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}>›</button>
      </header>
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}

      <section className="today-meters" aria-label="Day so far">
        <Meter label="Calories" value={summary?.calories ?? 0} target={targets?.calories ?? null} unit="kcal" />
        <Meter label="Protein" value={summary?.protein_g ?? 0} target={targets?.protein_g ?? null} unit="g" />
        <Meter label="Carbohydrate" value={summary?.carbs_g ?? 0} target={targets?.carbs_g ?? null} unit="g" />
        <Meter label="Fat" value={summary?.fat_g ?? 0} target={targets?.fat_g ?? null} unit="g" />
        <div className="today-meter">
          <Meter label="Water" value={summary?.water_ml ?? 0} target={targets?.water_ml ?? null} unit="ml" />
          <div className="meeting-actions">
            {[250, 500].map((ml) => (
              <button className="button button-secondary button-small" type="button" key={ml} disabled={busy} onClick={() => void add({ kind: 'water', ml })}>+{ml} ml</button>
            ))}
          </div>
        </div>
        <Meter label="Workout sets" value={summary?.sets ?? 0} target={plannedSets || null} unit="sets" />
      </section>

      <section className="trainer-card" aria-labelledby="today-workout">
        <h3 id="today-workout">{dayName(weekday)}'s workout{workout ? `: ${workout.focus}` : ''}</h3>
        {!workout ? (
          <p className="form-help">No workout plan yet. <button className="button button-link" type="button" onClick={onPlans}>Make one</button></p>
        ) : workout.rest ? (
          <p className="form-help">Rest day. A walk and some stretching help you recover.</p>
        ) : (
          <>
            {workout.exercises.length > 0 && (
              <div className="today-guided">
                <button className="button button-primary" type="button" onClick={() => onStart(day)}>Start guided workout</button>
                <span className="form-help">Shows each exercise, counts your rests and talks you through every set.</span>
              </div>
            )}
            {workout.warmup && <p className="plan-note"><strong>Warm-up:</strong> {workout.warmup}</p>}
            <ul className="today-list">
              {workout.exercises.map((exercise, index) => {
                const done = doneNames.has(exercise.name.toLowerCase());
                return (
                  <li key={`${exercise.name}-${index}`} data-done={done}>
                    <span className="today-item">
                      <strong>{exercise.name}</strong>
                      <small>{exercise.sets} × {exercise.reps}{exercise.rest_seconds ? ` · rest ${exercise.rest_seconds} s` : ''}{exercise.how ? ` · ${exercise.how}` : ''}</small>
                    </span>
                    <button className="button button-link" type="button" aria-label={`How to do ${exercise.name}`} onClick={() => howTo(exercise)}>How to</button>
                    <input
                      className="text-input today-weight"
                      aria-label={`Weight used for ${exercise.name}, kg`}
                      placeholder="kg"
                      inputMode="decimal"
                      value={weights[exercise.name] ?? ''}
                      onChange={(event) => setWeights({ ...weights, [exercise.name]: event.currentTarget.value })}
                    />
                    <button
                      className={`button button-small ${done ? 'button-secondary' : 'button-primary'}`}
                      type="button"
                      disabled={busy}
                      onClick={() => void add({
                        kind: 'exercise',
                        name: exercise.name,
                        sets: exercise.sets,
                        reps: firstNumber(exercise.reps),
                        weight_kg: weights[exercise.name] ? Number(weights[exercise.name]!.replace(',', '.')) || null : null,
                        minutes: null,
                      })}
                    >
                      {done ? 'Done ✓ again' : 'Done'}
                    </button>
                  </li>
                );
              })}
            </ul>
            {workout.cooldown && <p className="plan-note"><strong>Cool-down:</strong> {workout.cooldown}</p>}
          </>
        )}
        <form className="today-extra" onSubmit={(event) => void addExtra(event)}>
          <input className="text-input plan-edit-wide" aria-label="Other exercise" placeholder="Other exercise, like Cycling" value={extra.name} maxLength={80} onChange={(event) => setExtra({ ...extra, name: event.currentTarget.value })} />
          <input className="text-input" aria-label="Sets" type="number" min={1} max={20} value={extra.sets} onChange={(event) => setExtra({ ...extra, sets: event.currentTarget.value })} />
          <input className="text-input" aria-label="Reps" type="number" min={0} max={500} value={extra.reps} onChange={(event) => setExtra({ ...extra, reps: event.currentTarget.value })} />
          <input className="text-input" aria-label="Weight kg" placeholder="kg" inputMode="decimal" value={extra.weight} onChange={(event) => setExtra({ ...extra, weight: event.currentTarget.value })} />
          <input className="text-input" aria-label="Minutes" placeholder="min" inputMode="numeric" value={extra.minutes} onChange={(event) => setExtra({ ...extra, minutes: event.currentTarget.value })} />
          <button className="button button-secondary button-small" type="submit" disabled={busy || !extra.name.trim()}>Log</button>
        </form>
      </section>

      <section className="trainer-card" aria-labelledby="today-food">
        <h3 id="today-food">{dayName(weekday)}'s meals</h3>
        {!diet ? (
          <p className="form-help">No meal plan yet. Log what you eat below, or make a plan in Diet.</p>
        ) : (
          <ul className="today-list">
            {diet.meals.map((meal, index) => {
              const eaten = eatenMeals.has(meal.name.toLowerCase());
              const calories = meal.items.reduce((total, item) => total + item.calories, 0);
              return (
                <li key={`${meal.name}-${index}`} data-done={eaten}>
                  <span className="today-item">
                    <strong>{meal.name}{meal.time ? ` · ${meal.time}` : ''}</strong>
                    <small>{meal.items.map((item) => `${item.food}${item.amount ? ` (${item.amount})` : ''}`).join(', ')} · {calories} kcal</small>
                  </span>
                  <button
                    className={`button button-small ${eaten ? 'button-secondary' : 'button-primary'}`}
                    type="button"
                    disabled={busy}
                    onClick={() => void add(...meal.items.map((item): EntryData => ({
                      kind: 'meal',
                      meal: meal.name,
                      food: `${item.food}${item.amount ? `, ${item.amount}` : ''}`.slice(0, 200),
                      calories: item.calories,
                      protein_g: item.protein_g,
                      carbs_g: item.carbs_g,
                      fat_g: item.fat_g,
                    })))}
                  >
                    {eaten ? 'Ate ✓ again' : 'Ate this'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <form className="today-food" onSubmit={(event) => void workOutFood(event)}>
          <select className="text-input" aria-label="Meal" value={foodMeal} onChange={(event) => setFoodMeal(event.currentTarget.value)}>
            {MEALS.map((meal) => <option key={meal}>{meal}</option>)}
          </select>
          <input className="text-input plan-edit-wide" aria-label="What did you eat?" placeholder="What you ate, like 2 dosa and coconut chutney" value={foodText} maxLength={300} onChange={(event) => setFoodText(event.currentTarget.value)} />
          <input ref={picker} className="visually-hidden" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(event) => void pickPhoto(event)} />
          <button className="button button-secondary button-small" type="button" disabled={busy || !state.coach_ready} onClick={() => picker.current?.click()}>Photo</button>
          <button className="button button-secondary button-small" type="submit" disabled={busy || (!foodText.trim() && !photo) || !state.coach_ready}>
            {busy && photo && !found ? 'Looking at the photo' : 'Work out calories'}
          </button>
        </form>
        {photo && (
          <div className="today-photo">
            <img src={photo.preview} alt="Your food photo" />
            <p className="form-help">
              {found ? 'Calories worked out from your photo. They are estimates: correct any number you know better.' : busy ? 'Looking at your photo' : 'Photo ready. Press Work out calories.'}
            </p>
            {!found && <button className="button button-link" type="button" disabled={busy} onClick={() => clearPhoto(false)}>Remove photo</button>}
          </div>
        )}
        {found && (
          <div className="today-found">
            {found.length === 0 ? (
              <p className="form-help">No food was recognised. {photo ? 'Try another photo, or describe it in words.' : 'Try describing it differently.'}</p>
            ) : (
              <ul className="today-list">
                {found.map((item, index) => (
                  <li key={`${item.food}-${index}`}>
                    <span className="today-item">
                      <strong>{item.food}{item.amount ? `, ${item.amount}` : ''}</strong>
                      <small>P {rounded(item.protein_g)} g · C {rounded(item.carbs_g)} g · F {rounded(item.fat_g)} g</small>
                    </span>
                    <label className="today-kcal">
                      <input
                        className="text-input"
                        type="number"
                        min={0}
                        aria-label={`Calories in ${item.food}`}
                        value={item.calories}
                        onChange={(event) => setFound(found.map((old, place) => (place === index ? { ...old, calories: Number(event.currentTarget.value) || 0 } : old)))}
                      />
                      kcal
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="meeting-actions">
              <button className="button button-primary button-small" type="button" disabled={busy || found.length === 0} onClick={() => void addFound()}>Add to {foodMeal}</button>
              <button className="button button-link" type="button" onClick={() => { setFound(null); clearPhoto(false); }}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className="trainer-card" aria-labelledby="today-body">
        <h3 id="today-body">Body and habits</h3>
        <div className="today-body">
          {([
            ['weight', 'Weight (kg)', summary?.weight_kg],
            ['sleep', 'Sleep (hours)', summary?.sleep_hours],
            ['steps', 'Steps', summary?.steps],
          ] as const).map(([kind, name, current]) => (
            <form key={kind} className="today-body-field" onSubmit={(event) => { event.preventDefault(); void saveBody(kind); }}>
              <label className="field-label">
                {name}
                <input
                  className="text-input"
                  inputMode="decimal"
                  placeholder={current != null ? `Logged: ${rounded(current)}` : undefined}
                  value={body[kind]}
                  onChange={(event) => setBody({ ...body, [kind]: event.currentTarget.value })}
                />
              </label>
              <button className="button button-secondary button-small" type="submit" disabled={busy || !body[kind].trim()}>Save</button>
            </form>
          ))}
          <form className="today-body-field today-note" onSubmit={(event) => { event.preventDefault(); void saveBody('note'); }}>
            <label className="field-label">
              How did today feel?
              <input className="text-input" maxLength={500} value={body.note} onChange={(event) => setBody({ ...body, note: event.currentTarget.value })} />
            </label>
            <button className="button button-secondary button-small" type="submit" disabled={busy || !body.note.trim()}>Save</button>
          </form>
        </div>
      </section>

      <section className="trainer-card" aria-labelledby="today-log">
        <h3 id="today-log">Logged {label === 'Today' ? 'today' : `on ${pretty}`}</h3>
        {entries.length === 0 ? (
          <p className="form-help">Nothing yet. Everything you log shows up here.</p>
        ) : (
          <ul className="today-entries">
            {entries.map((entry) => {
              const picture = entry.data.kind === 'meal' && entry.data.photo_id && !shownPhotos.has(entry.data.photo_id) ? entry.data.photo_id : null;
              if (picture) {
                shownPhotos.add(picture);
              }
              return (
              <li key={entry.id}>
                <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                <span dir="auto" className="today-entry-text">
                  {picture && <img className="today-entry-photo" src={photoUrl(picture)} alt="" loading="lazy" />}
                  {describe(entry.data)}
                </span>
                <button className="button button-link" type="button" aria-label={`Remove ${describe(entry.data)}`} onClick={() => void remove(entry)}>Remove</button>
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
