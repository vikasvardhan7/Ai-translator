import { useCallback, useEffect, useState } from 'react';

import { loadTrainer, type TrainerState } from '../../services/trainer';
import CoachTab, { type CoachEntry } from './CoachTab';
import DietTab from './DietTab';
import { problemText } from './problems';
import ProfileTab from './ProfileTab';
import ProgressTab from './ProgressTab';
import TodayTab from './TodayTab';
import WorkoutTab from './WorkoutTab';

const TABS = ['today', 'workouts', 'diet', 'progress', 'coach', 'profile'] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = {
  today: 'Today',
  workouts: 'Workouts',
  diet: 'Diet',
  progress: 'Progress',
  coach: 'Coach',
  profile: 'Profile',
};

export default function TrainerApp() {
  const [state, setState] = useState<TrainerState | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [problem, setProblem] = useState('');
  const [chat, setChat] = useState<CoachEntry[]>([]);
  const [changed, setChanged] = useState(0);

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
        {tab === 'today' && <TodayTab state={state} changed={changed} onPlans={() => setTab('workouts')} />}
        {tab === 'workouts' && <WorkoutTab state={state} onState={setState} />}
        {tab === 'diet' && <DietTab state={state} onState={setState} />}
        {tab === 'progress' && <ProgressTab state={state} changed={changed} />}
        {tab === 'coach' && <CoachTab state={state} chat={chat} onChat={setChat} onLogged={logged} />}
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
    </div>
  );
}
