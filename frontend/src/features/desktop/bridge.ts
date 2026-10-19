import { createContext } from 'react';

import type { RoomAccess, SaidLine } from '../../services/api';

export const CALL_ACTIONS = [
  'mute',
  'unmute',
  'voice_on',
  'captions_only',
  'connect_meeting_sound',
  'disconnect_meeting_sound',
  'show_transcript',
  'hide_transcript',
  'open_settings',
  'show_people',
  'download_transcript',
  'set_my_language',
  'end_conversation',
] as const;
export type CallAction = (typeof CALL_ACTIONS)[number];

export interface CallControls {
  actions: CallAction[];
  run: (name: CallAction, args: Record<string, string>) => void;
  transcript: () => SaidLine[];
  language: string;
  room?: RoomAccess;
}

export function isCallAction(value: string): value is CallAction {
  return (CALL_ACTIONS as readonly string[]).includes(value);
}

export class CallBridge {
  private owner: object | null = null;
  private controls: CallControls | null = null;

  set(owner: object, controls: CallControls): void {
    this.owner = owner;
    this.controls = controls;
  }

  clear(owner: object): void {
    if (this.owner === owner) {
      this.owner = null;
      this.controls = null;
    }
  }

  get(): CallControls | null {
    return this.controls;
  }
}

export const CallBridgeContext = createContext<CallBridge | null>(null);
