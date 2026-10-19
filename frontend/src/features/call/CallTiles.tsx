import { memo } from 'react';

import type { SpeakerId } from '../../services/protocol';

export interface Tile {
  id: SpeakerId;
  title: string;
  badge: string;
  detail: string;
  away: boolean;
}

interface CallTilesProps {
  tiles: Tile[];
  you: SpeakerId | null;
  talking: ReadonlySet<SpeakerId>;
  hearing: SpeakerId | null;
  muted: boolean;
  roomTalking: boolean;
}

const STATUS = {
  away: 'Not connected right now',
  talking: 'Speaking',
  listening: 'Listening',
  hearing: 'Hearing the translation',
  muted: 'Microphone off',
  idle: '',
};

function stateOf(tile: Tile, props: CallTilesProps): keyof typeof STATUS {
  if (tile.away) {
    return 'away';
  }
  if (props.talking.has(tile.id)) {
    return 'talking';
  }
  if (props.roomTalking) {
    return 'listening';
  }
  if (props.hearing === tile.id) {
    return 'hearing';
  }
  return tile.id === props.you && props.muted ? 'muted' : 'idle';
}

function CallTiles(props: CallTilesProps) {
  const { tiles, you } = props;
  const ordered = you ? [...tiles.filter((tile) => tile.id !== you), ...tiles.filter((tile) => tile.id === you)] : tiles;

  return (
    <div className="call-tiles" data-many={ordered.length > 2}>
      {ordered.map((tile) => {
        const state = stateOf(tile, props);
        return (
          <section className="call-tile" data-state={state} aria-label={tile.title} key={tile.id}>
            <div className="call-avatar" aria-hidden="true">
              <span className="call-avatar-ring" />
              <span className="call-avatar-ring call-avatar-ring-late" />
              <span className="call-avatar-face">{tile.badge}</span>
            </div>
            <h2 dir="auto">{tile.title}</h2>
            <p className="call-tile-language">{tile.detail}</p>
            <p className="call-tile-status" aria-live="polite">{STATUS[state]}</p>
          </section>
        );
      })}
    </div>
  );
}

export default memo(CallTiles);
