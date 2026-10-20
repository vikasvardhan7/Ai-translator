import type { AgentAction, ChatTurn } from '../../services/api';
import { languageName } from '../../services/languageNames';
import { isCallAction, type CallAction } from '../desktop/bridge';
import { isTheme, themeOf, type ThemeId } from '../desktop/themes';
import { isApp, type AppId } from '../desktop/windows';

export const DESKTOP_ACTIONS = ['open_app', 'close_app', 'start_conversation', 'set_theme', 'schedule_meeting'] as const;
export type Where = 'here' | 'remote' | 'meeting';
export const MAX_HISTORY = 30;
export const MAX_MESSAGE_LENGTH = 4000;

export const APP_NAMES: Record<AppId, string> = {
  translator: 'Translator',
  meetings: 'Meetings',
  trainer: 'Gym Trainer',
  assistant: 'Assistant',
  developers: 'Developers',
  personalize: 'Personalize',
  account: 'Account',
  help: 'Help',
  privacy: 'Privacy',
  terms: 'Terms',
};

const WHERE_NAMES: Record<Where, string> = {
  here: 'a conversation next to you',
  remote: 'a meeting others join with a link',
  meeting: 'live captions',
};

export interface MeetingRequest {
  title: string;
  starts_at: string;
  duration_minutes: number;
  agenda: string;
}

const CALL_NOTES: Record<CallAction, string> = {
  mute: 'Muted your microphone',
  unmute: 'Turned your microphone on',
  voice_on: 'Translations are spoken aloud',
  captions_only: 'Captions only, no voice',
  connect_meeting_sound: "Press Connect meeting in the Translator window and pick the meeting's tab",
  disconnect_meeting_sound: "Stopped listening to the meeting's sound",
  show_transcript: 'Showing the transcript',
  hide_transcript: 'Hid the transcript',
  open_settings: 'Opened the call settings',
  show_people: 'Showing the people in the call and the invite link',
  download_transcript: 'Downloaded the transcript',
  set_my_language: 'Changed your language',
  end_conversation: 'Ended the conversation',
};

export interface DesktopHandlers {
  open: (app: AppId) => void;
  close: (app: AppId) => void;
  start: (where: Where) => void;
  theme: (theme: ThemeId) => void;
  schedule: (meeting: MeetingRequest) => void;
}

export interface CallRunner {
  available: CallAction[];
  run: (name: CallAction, args: Record<string, string>) => void;
}

function isWhere(value: unknown): value is Where {
  return value === 'here' || value === 'remote' || value === 'meeting';
}

export function note(action: AgentAction): string {
  const { name, arguments: args } = action;
  if (name === 'open_app' && isApp(args.app)) {
    return `Opened ${APP_NAMES[args.app]}`;
  }
  if (name === 'close_app' && isApp(args.app)) {
    return `Closed ${APP_NAMES[args.app]}`;
  }
  if (name === 'start_conversation' && isWhere(args.where)) {
    return `Ready to start ${WHERE_NAMES[args.where]}: press I agree, let's start`;
  }
  if (name === 'schedule_meeting' && args.title && args.starts_at) {
    const when = new Date(args.starts_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    return `Scheduled “${args.title}” for ${when}. The link is in Meetings`;
  }
  if (name === 'set_theme' && isTheme(args.theme)) {
    return `Changed the look to ${themeOf(args.theme).name}`;
  }
  if (name === 'set_my_language' && args.language) {
    return `Your language is now ${languageName(args.language)}`;
  }
  if (name === 'download_transcript' && args.format === 'subtitles') {
    return 'Downloaded the subtitles';
  }
  return isCallAction(name) ? CALL_NOTES[name] : '';
}

export function runActions(actions: AgentAction[], desktop: DesktopHandlers, call: CallRunner | null): string[] {
  const done: string[] = [];
  for (const action of actions) {
    const { name, arguments: args } = action;
    if (name === 'open_app' && isApp(args.app)) {
      desktop.open(args.app);
    } else if (name === 'close_app' && isApp(args.app)) {
      desktop.close(args.app);
    } else if (name === 'start_conversation' && isWhere(args.where)) {
      desktop.start(args.where);
    } else if (name === 'set_theme' && isTheme(args.theme)) {
      desktop.theme(args.theme);
    } else if (name === 'schedule_meeting' && args.title && args.starts_at && !Number.isNaN(Date.parse(args.starts_at))) {
      desktop.schedule({
        title: args.title,
        starts_at: args.starts_at,
        duration_minutes: Number(args.duration_minutes) || 30,
        agenda: args.agenda ?? '',
      });
    } else if (isCallAction(name) && call?.available.includes(name)) {
      call.run(name, args);
    } else {
      continue;
    }
    done.push(note(action));
  }
  return done;
}

export function history(turns: readonly ChatTurn[]): ChatTurn[] {
  return turns
    .map((turn) => ({ role: turn.role, text: turn.text.trim().slice(0, MAX_MESSAGE_LENGTH) }))
    .filter((turn) => turn.text)
    .slice(-MAX_HISTORY);
}

export function possibleActions(running: boolean, call: CallRunner | null): string[] {
  const desktop: string[] = running
    ? DESKTOP_ACTIONS.filter((name) => name !== 'start_conversation')
    : [...DESKTOP_ACTIONS];
  return [...desktop, ...(call?.available ?? [])];
}
