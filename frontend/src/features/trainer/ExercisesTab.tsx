import { useEffect, useMemo, useState } from 'react';

import { loadExercises, type ExerciseCard } from '../../services/trainer';
import { capital, equipmentName, filterExercises, muscleList, MUSCLES, PLACES, TYPES, type Filters, type Place } from './exercises';
import { problemText } from './problems';

const PAGE = 48;

interface ExercisesTabProps {
  search: string;
  onShow: (id: string) => void;
}

export default function ExercisesTab({ search, onShow }: ExercisesTabProps) {
  const [cards, setCards] = useState<ExerciseCard[] | null>(null);
  const [problem, setProblem] = useState('');
  const [filters, setFilters] = useState<Filters>({ text: search, place: 'all', muscle: '', type: '' });
  const [shown, setShown] = useState(PAGE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setFilters((current) => ({ ...current, text: search }));
  }, [search]);

  useEffect(() => {
    let current = true;
    loadExercises().then(
      (loaded) => {
        if (current) {
          setCards(loaded);
          setProblem('');
        }
      },
      (error: unknown) => {
        if (current) {
          setProblem(problemText(error));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  useEffect(() => {
    setShown(PAGE);
  }, [filters]);

  const found = useMemo(() => (cards ? filterExercises(cards, filters) : []), [cards, filters]);

  function set<K extends keyof Filters>(key: K, value: Filters[K]): void {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="exercises">
      <form className="exercises-filters" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="field-label exercises-search">
          Find an exercise
          <input className="text-input" type="search" value={filters.text} placeholder="For example: squat, lat pulldown, plank" onChange={(event) => set('text', event.currentTarget.value)} />
        </label>
        <div className="exercise-places" role="group" aria-label="Where">
          {(Object.keys(PLACES) as Place[]).map((place) => (
            <button key={place} type="button" className="chip-button" aria-pressed={filters.place === place} onClick={() => set('place', place)}>
              {PLACES[place].label}
            </button>
          ))}
        </div>
        <label className="field-label">
          Muscle
          <select className="text-input" value={filters.muscle} onChange={(event) => set('muscle', event.currentTarget.value)}>
            <option value="">Any muscle</option>
            {MUSCLES.map((muscle) => <option key={muscle} value={muscle}>{capital(muscle)}</option>)}
          </select>
        </label>
        <label className="field-label">
          Type
          <select className="text-input" value={filters.type} onChange={(event) => set('type', event.currentTarget.value)}>
            <option value="">Any type</option>
            {TYPES.map((type) => <option key={type} value={type}>{capital(type)}</option>)}
          </select>
        </label>
      </form>

      {problem && (
        <div className="notice notice-danger" role="alert">
          <span>{problem}</span>
          <button className="button button-small button-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        </div>
      )}
      {!cards && !problem && <p className="meeting-empty" role="status">Loading the exercise library</p>}
      {cards && (
        <>
          <p className="form-help" role="status">
            {found.length === cards.length ? `${cards.length} exercises` : `${found.length} of ${cards.length} exercises`}. Pick one to see how it is done and what it works.
          </p>
          <ul className="exercise-grid">
            {found.slice(0, shown).map((card) => (
              <li key={card.id}>
                <button className="exercise-card" type="button" onClick={() => onShow(card.id)}>
                  {card.images[0] ? <img src={card.images[0]} alt="" loading="lazy" decoding="async" /> : <span className="exercise-card-blank" aria-hidden="true" />}
                  <strong>{card.name}</strong>
                  <small>{muscleList(card.primary)} · {equipmentName(card.equipment)}</small>
                </button>
              </li>
            ))}
          </ul>
          {found.length > shown && (
            <button className="button button-secondary exercises-more" type="button" onClick={() => setShown(shown + PAGE)}>
              Show more ({found.length - shown} left)
            </button>
          )}
          {found.length === 0 && <p className="meeting-empty">Nothing matches. Try fewer words or another filter.</p>}
        </>
      )}
    </div>
  );
}
