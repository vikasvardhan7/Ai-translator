import { useCallback, useEffect, useState } from 'react';

import { loadTrainer, localDay, weekdayOf, type CoachAction, type TrainerState, type WorkoutDay } from '../../services/trainer';
import CoachTab, { type CoachEntry } from './CoachTab';
import DietTab from './DietTab';
import ExerciseSheet from './ExerciseSheet';
import ExercisesTab from './ExercisesTab';
import { problemText } from './problems';
import ProfileTab from './ProfileTab';
import ProgressTab from './ProgressTab';
import TodayTab from './TodayTab';
import WorkoutPlayer from './WorkoutPlayer';
import WorkoutTab from './WorkoutTab';

const TABS = ['today', 'workouts', 'diet', 'exercises', 'progress', 'coach', 'profile'] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = {
  today: 'Today',
  workouts: 'Workouts',
  diet: 'Diet',
  exercises: 'Exercises',
  progress: 'Progress',
  coach: 'Coach',
  profile: 'Profile',
};

interface Playing {
  plan: WorkoutDay;
  day: string;
}

export function workoutFor(state: TrainerState, day: string): WorkoutDay | null {
  const plan = state.workout?.days.find((item) => item.day === weekdayOf(day)) ?? null;
  return plan && !plan.rest && plan.exercises.length > 0 ? plan : null;
}

export default function TrainerApp() {
  const [state, setState] = useState<TrainerState | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [problem, setProblem] = useState('');
  const [chat, setChat] = useState<CoachEntry[]>([]);
  const [changed, setChanged] = useState(0);
  const [showing, setShowing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [playing, setPlaying] = useState<Playing | null>(null);

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadTrainer();
      setState(loaded);
      setProblem('');
      if (!loaded.profile) {
        setTab('profile');
      }
    } catch (error) {
      setProblem(problemText(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logged = useCallback(() => setChanged((value) => value + 1), []);

  const lookUp = useCallback((name: string) => {
    setSearch(name);
    setTab('exercises');
  }, []);

  const startWorkout = useCallback((day: string): boolean => {
    const plan = state ? workoutFor(state, day) : null;
    if (plan) {
      setPlaying({ plan, day });
    }
    return plan !== null;
  }, [state]);

  const act = useCallback((actions: CoachAction[]): string | null => {
    let note: string | null = null;
    for (const action of actions) {
      if (action.kind === 'show_exercise') {
        if (action.exercise_id) {
          setShowing(action.exercise_id);
        } else if (action.query) {
          lookUp(action.query);
        }
      } else if (action.kind === 'start_workout') {
        if (!startWorkout(localDay())) {
          note = 'There is no workout planned for today, so there is nothing to start.';
        }
      } else if (action.page) {
        setTab(action.page);
      }
    }
    return note;
  }, [lookUp, startWorkout]);

  if (!state) {
    return (
      <div className="trainer-app">
        {problem ? (
          <div className="notice notice-danger" role="alert">
            <span>{problem}</span>
            <button className="button button-small button-secondary" type="button" onClick={() => void refresh()}>Try again</button>
          </div>
        ) : (
          <p className="meeting-empty" role="status">Loading your trainer</p>
        )}
      </div>
    );
  }

  return (
    <div className="trainer-app">
      <nav className="trainer-tabs" role="tablist" aria-label="Trainer">
        {TABS.map((name) => (
          <button
            type="button"
            role="tab"
            key={name}
            aria-selected={tab === name}
            disabled={!state.profile && name !== 'profile'}
            onClick={() => setTab(name)}
          >
            {TAB_NAMES[name]}
          </button>
        ))}
      </nav>
      <div className="trainer-body" role="tabpanel" aria-label={TAB_NAMES[tab]}>
        {tab === 'today' && (
          <TodayTab
            state={state}
            changed={changed}
            onState={setState}
            onPlans={() => setTab('workouts')}
            onStart={(day) => void startWorkout(day)}
            onShow={setShowing}
            onLookUp={lookUp}
          />
        )}
        {tab === 'workouts' && <WorkoutTab state={state} onState={setState} onShow={setShowing} onLookUp={lookUp} />}
        {tab === 'diet' && <DietTab state={state} onState={setState} />}
        {tab === 'exercises' && <ExercisesTab search={search} onShow={setShowing} />}
        {tab === 'progress' && <ProgressTab state={state} changed={changed} />}
        {tab === 'coach' && <CoachTab state={state} chat={chat} onChat={setChat} onLogged={logged} onActions={act} />}
        {tab === 'profile' && (
          <ProfileTab
            state={state}
            onState={(next) => {
              const first = !state.profile;
              setState(next);
              if (first && next.profile) {
                setTab('workouts');
              }
            }}
            onForgotten={() => {
              setChat([]);
              void refresh();
            }}
          />
        )}
      </div>
      {playing && (
        <WorkoutPlayer
          plan={playing.plan}
          day={playing.day}
          onClose={() => setPlaying(null)}
          onLogged={logged}
          onShow={setShowing}
        />
      )}
      {showing && <ExerciseSheet exerciseId={showing} onClose={() => setShowing(null)} />}
    </div>
  );
}
