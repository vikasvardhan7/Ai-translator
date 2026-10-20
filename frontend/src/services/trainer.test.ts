import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addEntry,
  askCoach,
  deletePhoto,
  estimateFoods,
  firstNumber,
  listPhotos,
  loadExercise,
  loadExercises,
  loadProgress,
  localDay,
  localNow,
  makePlan,
  mealTotals,
  photoUrl,
  shiftDay,
  uploadPhoto,
  weekdayOf,
} from './trainer';

const fetchMock = vi.fn<typeof fetch>();

describe('trainer helpers', () => {
  it('works with local calendar days', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf('2026-10-19')).toBe('monday');
    expect(weekdayOf('2026-10-25')).toBe('sunday');
    expect(localNow(new Date(2026, 9, 20, 8, 5))).toMatch(/^2026-10-20T08:05:00[+-]\d{2}:\d{2}$/);
  });

  it('reads the first number of planned reps and adds up meals', () => {
    expect(firstNumber('8-12')).toBe(8);
    expect(firstNumber('30 s')).toBe(30);
    expect(firstNumber('as many as you can')).toBe(0);
    expect(mealTotals([
      { name: 'Breakfast', time: '08:00', items: [{ food: 'Idli', amount: '3', calories: 180, protein_g: 6, carbs_g: 36, fat_g: 1 }] },
      { name: 'Lunch', time: '13:00', items: [{ food: 'Dal', amount: '1 cup', calories: 230.4, protein_g: 12.25, carbs_g: 30, fat_g: 6 }] },
    ])).toEqual({ calories: 410, protein_g: 18.3, carbs_g: 66, fat_g: 7 });
  });
});

describe('trainer API calls', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for plans, logs entries, reads progress and talks to the coach', async () => {
    const state = { profile: null, targets: null, workout: null, diet: null, coach_ready: true };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(state), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'e1', day: '2026-10-20', data: { kind: 'water', ml: 250 }, created_at: 'x' }), { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response('{"days":[]}', { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response('{"answer":"Nice","logged":[]}', { status: 200 }));

    await expect(makePlan('workout', 'No running', 'monday')).resolves.toEqual(state);
    await expect(addEntry('2026-10-20', { kind: 'water', ml: 250 })).resolves.toMatchObject({ id: 'e1' });
    await expect(loadProgress('2026-10-20', 30)).resolves.toEqual([]);
    await expect(askCoach([{ role: 'user', text: 'Hi' }], '2026-10-20', '2026-10-20T08:00:00+05:30')).resolves.toEqual({ answer: 'Nice', logged: [], actions: [] });

    const calls = fetchMock.mock.calls;
    expect(calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['http://localhost:8000/api/trainer/plans/workout', 'POST'],
      ['http://localhost:8000/api/trainer/days/2026-10-20/entries', 'POST'],
      ['http://localhost:8000/api/trainer/progress?until=2026-10-20&days=30', 'GET'],
      ['http://localhost:8000/api/trainer/coach', 'POST'],
    ]);
    expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({ wishes: 'No running', day: 'monday' });
    expect(JSON.parse(String(calls[1]![1]!.body))).toEqual({ data: { kind: 'water', ml: 250 } });
  });

  it('refuses answers that are not what was asked for', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"answer":"x"}', { status: 200 }));

    await expect(askCoach([{ role: 'user', text: 'Hi' }], '2026-10-20', 'now')).rejects.toThrow('invalid answer');
  });

  it('sends photos as pictures and asks for calories from them', async () => {
    const photo = { id: 'a'.repeat(32), day: '2026-10-20', kind: 'meal', created_at: 'x', size: 3 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(photo), { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response('{"items":[]}', { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ photos: [photo] }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const picture = new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' });

    await expect(uploadPhoto(picture, '2026-10-20', 'meal')).resolves.toEqual(photo);
    await expect(estimateFoods('', photo.id)).resolves.toEqual([]);
    await expect(listPhotos('body')).resolves.toEqual([photo]);
    await deletePhoto(photo.id);

    const calls = fetchMock.mock.calls;
    expect(calls[0]![0]).toBe('http://localhost:8000/api/trainer/photos?day=2026-10-20&kind=meal');
    expect(new Headers(calls[0]![1]!.headers).get('Content-Type')).toBe('image/jpeg');
    expect(calls[0]![1]!.body).toBe(picture);
    expect(JSON.parse(String(calls[1]![1]!.body))).toEqual({ text: '', photo_id: photo.id });
    expect(calls[2]![0]).toBe('http://localhost:8000/api/trainer/photos?kind=body');
    expect(calls[3]![1]!.method).toBe('DELETE');
    expect(photoUrl(photo.id)).toBe(`http://localhost:8000/api/trainer/photos/${photo.id}`);
  });

  it('loads the exercise library once and each exercise once', async () => {
    const card = { id: 'Plank', name: 'Plank', equipment: 'body only', category: 'strength', level: 'beginner', primary: ['abdominals'], secondary: [], images: [] };
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"offline"}', { status: 503 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ exercises: [card], source: 'x' }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...card, force: null, mechanic: null, instructions: ['Hold'] }), { status: 200 }));

    await expect(loadExercises()).rejects.toThrow('offline');
    await expect(loadExercises()).resolves.toEqual([card]);
    await expect(loadExercises()).resolves.toEqual([card]);
    await expect(loadExercise('Plank')).resolves.toMatchObject({ instructions: ['Hold'] });
    await expect(loadExercise('Plank')).resolves.toMatchObject({ id: 'Plank' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('passes on what the coach asks the app to do', async () => {
    const action = { kind: 'start_workout', exercise_id: null, query: null, page: null };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ answer: 'Go', logged: [], actions: [action] }), { status: 200 }));

    await expect(askCoach([{ role: 'user', text: 'Start' }], '2026-10-20', 'now')).resolves.toEqual({ answer: 'Go', logged: [], actions: [action] });
  });
});
