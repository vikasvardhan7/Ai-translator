import type { ReactNode } from 'react';

import { capital, muscleList } from './exercises';

type Level = 'primary' | 'secondary' | 'none';

interface MuscleMapProps {
  primary: readonly string[];
  secondary: readonly string[];
  compact?: boolean;
}

function pair(left: ReactNode, right: ReactNode): ReactNode {
  return (
    <>
      {left}
      {right}
    </>
  );
}

export default function MuscleMap({ primary, secondary, compact = false }: MuscleMapProps) {
  const level = (muscle: string): Level => (primary.includes(muscle) ? 'primary' : secondary.includes(muscle) ? 'secondary' : 'none');
  const group = (muscle: string, shapes: ReactNode): ReactNode => (
    <g className="muscle" data-level={level(muscle)}>
      <title>{`${capital(muscle)}${level(muscle) === 'primary' ? ' (main)' : level(muscle) === 'secondary' ? ' (also)' : ''}`}</title>
      {shapes}
    </g>
  );
  const body = (
    <g className="muscle-body">
      <circle cx={60} cy={18} r={12} />
      <path d="M40 40 Q60 34 80 40 L84 66 L78 104 L42 104 L36 66 Z" />
      <path d="M42 102 L78 102 L74 118 L46 118 Z" />
      <circle cx={25} cy={116} r={5} />
      <circle cx={95} cy={116} r={5} />
      <circle cx={50} cy={174} r={6} />
      <circle cx={70} cy={174} r={6} />
      <ellipse cx={48} cy={226} rx={7} ry={4} />
      <ellipse cx={72} cy={226} rx={7} ry={4} />
    </g>
  );
  const arms = (inner: string) => (
    <>
      {group(inner, pair(<ellipse cx={31} cy={68} rx={6} ry={13} />, <ellipse cx={89} cy={68} rx={6} ry={13} />))}
      {group('forearms', pair(<ellipse cx={27} cy={96} rx={5.5} ry={14} />, <ellipse cx={93} cy={96} rx={5.5} ry={14} />))}
      {group('shoulders', pair(<ellipse cx={37} cy={48} rx={9} ry={9} />, <ellipse cx={83} cy={48} rx={9} ry={9} />))}
    </>
  );
  const described = [
    primary.length ? `Works mainly: ${muscleList(primary)}.` : 'No main muscle is listed.',
    secondary.length ? `Also works: ${muscleList(secondary)}.` : '',
  ].filter(Boolean).join(' ');

  return (
    <figure className="muscle-map" data-compact={compact}>
      <svg viewBox="0 0 250 252" role="img" aria-label={described}>
        <g>
          {body}
          {group('neck', <rect x={54} y={29} width={12} height={9} rx={3} />)}
          {group('traps', pair(<path d="M54 36 L42 42 L54 43 Z" />, <path d="M66 36 L78 42 L66 43 Z" />))}
          {group('chest', pair(<path d="M44 44 Q52 41 59 44 L59 60 Q51 64 44 59 Z" />, <path d="M76 44 Q68 41 61 44 L61 60 Q69 64 76 59 Z" />))}
          {arms('biceps')}
          {group('abdominals', <rect x={51} y={64} width={18} height={36} rx={5} />)}
          <path className="muscle-line" d="M60 66 V98 M52 76 H68 M52 88 H68" />
          {group('abductors', pair(<ellipse cx={41} cy={114} rx={4.5} ry={9} />, <ellipse cx={79} cy={114} rx={4.5} ry={9} />))}
          {group('quadriceps', pair(<ellipse cx={50} cy={146} rx={9} ry={25} />, <ellipse cx={70} cy={146} rx={9} ry={25} />))}
          {group('adductors', pair(<ellipse cx={57.5} cy={128} rx={3.2} ry={12} />, <ellipse cx={62.5} cy={128} rx={3.2} ry={12} />))}
          {group('calves', pair(<ellipse cx={49} cy={200} rx={6} ry={20} />, <ellipse cx={71} cy={200} rx={6} ry={20} />))}
          <text x={60} y={248} textAnchor="middle">Front</text>
        </g>
        <g transform="translate(130 0)">
          {body}
          {group('neck', <rect x={54} y={29} width={12} height={9} rx={3} />)}
          {group('middle back', <rect x={52} y={56} width={16} height={22} rx={4} />)}
          {group('traps', <path d="M60 30 L44 42 L60 58 L76 42 Z" />)}
          {group('lats', pair(<path d="M44 52 L52 60 L54 90 L46 84 L40 66 Z" />, <path d="M76 52 L68 60 L66 90 L74 84 L80 66 Z" />))}
          {group('lower back', <rect x={53} y={80} width={14} height={20} rx={4} />)}
          {arms('triceps')}
          {group('glutes', pair(<ellipse cx={52} cy={112} rx={9} ry={10} />, <ellipse cx={68} cy={112} rx={9} ry={10} />))}
          {group('abductors', pair(<ellipse cx={41} cy={110} rx={4} ry={8} />, <ellipse cx={79} cy={110} rx={4} ry={8} />))}
          {group('hamstrings', pair(<ellipse cx={50} cy={148} rx={8.5} ry={23} />, <ellipse cx={70} cy={148} rx={8.5} ry={23} />))}
          {group('adductors', pair(<ellipse cx={57.5} cy={132} rx={3} ry={11} />, <ellipse cx={62.5} cy={132} rx={3} ry={11} />))}
          {group('calves', pair(<ellipse cx={49} cy={194} rx={7.5} ry={18} />, <ellipse cx={71} cy={194} rx={7.5} ry={18} />))}
          <text x={60} y={248} textAnchor="middle">Back</text>
        </g>
      </svg>
      {!compact && (
        <figcaption>
          <span className="muscle-key" data-level="primary">Main: {primary.length ? muscleList(primary) : 'not listed'}</span>
          {secondary.length > 0 && <span className="muscle-key" data-level="secondary">Also: {muscleList(secondary)}</span>}
        </figcaption>
      )}
    </figure>
  );
}
