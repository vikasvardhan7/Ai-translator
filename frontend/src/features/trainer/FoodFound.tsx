import { useState } from 'react';

import type { FoodGuess } from '../../services/trainer';
import { addUp, cleanGrams, portionChoices, portionNutrition } from './food';

export interface FoodChoice {
  guess: FoodGuess;
  grams: number;
}

interface FoodFoundProps {
  guesses: FoodGuess[];
  fromPhoto: boolean;
  meal: string;
  busy: boolean;
  onAdd: (choices: FoodChoice[]) => void;
  onCancel: () => void;
}

interface Row {
  guess: FoodGuess;
  grams: number;
  kept: boolean;
}

export default function FoodFound({ guesses, fromPhoto, meal, busy, onAdd, onCancel }: FoodFoundProps) {
  const [rows, setRows] = useState<Row[]>(() => guesses.map((guess) => ({ guess, grams: Math.round(guess.grams), kept: true })));
  const kept = rows.filter((row) => row.kept && row.grams > 0);
  const total = addUp(kept.map((row) => portionNutrition(row.guess, row.grams)));

  function change(index: number, update: Partial<Row>): void {
    setRows((current) => current.map((row, place) => (place === index ? { ...row, ...update } : row)));
  }

  if (guesses.length === 0) {
    return (
      <div className="found">
        <p className="form-help">No food was recognised. {fromPhoto ? 'Take the photo again from above, closer, in good light, or describe it in words.' : 'Try describing it differently.'}</p>
        <button className="button button-link" type="button" onClick={onCancel}>Close</button>
      </div>
    );
  }

  return (
    <div className="found">
      <p className="found-lead">
        {fromPhoto ? 'This is what the photo shows. ' : ''}
        Choose how much of each you had, or type the grams. The calories follow your choice, and nothing is saved until you press Add.
      </p>
      <ul className="found-list">
        {rows.map((row, index) => {
          const choices = portionChoices(row.guess, fromPhoto);
          const numbers = portionNutrition(row.guess, row.grams);
          return (
            <li key={index} className="found-food" data-kept={row.kept} data-sure={row.guess.sure}>
              <div className="found-head">
                <input
                  className="text-input found-name"
                  aria-label={`Name of food ${index + 1}`}
                  value={row.guess.food}
                  maxLength={80}
                  disabled={!row.kept}
                  onChange={(event) => change(index, { guess: { ...row.guess, food: event.currentTarget.value } })}
                />
                <button className="button button-link" type="button" onClick={() => change(index, { kept: !row.kept })}>
                  {row.kept ? 'Remove' : 'Put back'}
                </button>
              </div>
              {row.kept && (
                <>
                  {!row.guess.sure && <p className="found-unsure">Hard to see in the photo: check the name and the amount.</p>}
                  <div className="found-portions" role="radiogroup" aria-label={`How much ${row.guess.food}`}>
                    {choices.map((choice) => (
                      <button
                        key={`${choice.label}-${choice.grams}`}
                        className="portion-chip"
                        type="button"
                        role="radio"
                        aria-checked={row.grams === choice.grams}
                        data-estimate={choice.estimate}
                        onClick={() => change(index, { grams: choice.grams })}
                      >
                        <span>{choice.label}</span>
                        <small>{choice.grams} g</small>
                      </button>
                    ))}
                    <label className="portion-grams">
                      <input
                        className="text-input"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={2000}
                        step={5}
                        aria-label={`Grams of ${row.guess.food}`}
                        value={row.grams}
                        onChange={(event) => change(index, { grams: cleanGrams(Number(event.currentTarget.value)) })}
                      />
                      g
                    </label>
                  </div>
                  <p className="found-numbers">
                    <strong>{numbers.calories.toLocaleString()} kcal</strong>
                    <span>protein {numbers.protein_g} g, carbohydrate {numbers.carbs_g} g, fat {numbers.fat_g} g</span>
                    <small>{Math.round(row.guess.calories_100g)} kcal in every 100 g</small>
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="found-foot">
        <p className="found-total" aria-live="polite">
          <strong>{total.calories.toLocaleString()} kcal</strong> in all, protein {total.protein_g} g
        </p>
        <div className="meeting-actions">
          <button className="button button-primary" type="button" disabled={busy || kept.length === 0} onClick={() => onAdd(kept.map((row) => ({ guess: row.guess, grams: row.grams })))}>
            Add {kept.length === 1 ? '1 food' : `${kept.length} foods`} to {meal}
          </button>
          <button className="button button-link" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
