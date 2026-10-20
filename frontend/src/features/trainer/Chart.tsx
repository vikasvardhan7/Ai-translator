import { useEffect, useRef, useState } from 'react';

interface ChartProps {
  title: string;
  unit: string;
  days: string[];
  values: Array<number | null>;
  target?: number | null;
  kind: 'bars' | 'line';
}

export interface Scale {
  bottom: number;
  top: number;
  ticks: number[];
}

const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 26, left: 46 };
const FIRST_WIDTH = 360;
const STEPS = [1, 2, 2.5, 5, 10];
const TICK = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const NUMBER = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  return (STEPS.find((candidate) => candidate * power >= value * (1 - 1e-9)) ?? 10) * power;
}

function clean(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function chartScale(values: readonly number[], target: number | null, kind: 'bars' | 'line'): Scale {
  const all = target ? [...values, target] : [...values];
  if (kind === 'bars') {
    all.push(0);
  }
  if (all.length === 0) {
    return { bottom: 0, top: 1, ticks: [0, 0.5, 1] };
  }
  const lowest = Math.min(...all);
  const highest = Math.max(...all);
  const room = kind === 'bars' ? 0 : Math.max(highest - lowest, 1) * 0.1;
  const low = Math.max(0, lowest - room);
  const high = kind === 'bars' ? Math.max(highest * 1.05, 1) : highest + room;
  const step = niceStep(Math.max(high - low, kind === 'bars' ? 0 : 2) / 4 || 0.25);
  let bottom = clean(Math.floor(low / step) * step);
  let top = clean(Math.ceil(high / step) * step);
  while (top - bottom < step * 2 - 1e-9) {
    if (bottom - step >= 0 && kind === 'line') {
      bottom = clean(bottom - step);
    } else {
      top = clean(top + step);
    }
  }
  const count = Math.round((top - bottom) / step);
  return { bottom, top, ticks: Array.from({ length: count + 1 }, (_, index) => clean(bottom + index * step)) };
}

function short(day: string): string {
  const [, month, date] = day.split('-');
  return `${Number(date)}/${Number(month)}`;
}

function shown(value: number): string {
  return NUMBER.format(value);
}

export default function Chart({ title, unit, days, values, target = null, kind }: ChartProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FIRST_WIDTH);

  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const measure = () => setWidth(Math.max(200, Math.round(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const known = values.filter((value): value is number => value !== null);
  const { bottom, top, ticks } = chartScale(known, target, kind);
  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = innerWidth / Math.max(days.length, 1);
  const x = (index: number): number => PAD.left + slot * (index + 0.5);
  const y = (value: number): number => PAD.top + innerHeight - ((value - bottom) / (top - bottom || 1)) * innerHeight;
  const average = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
  const latest = [...values].reverse().find((value): value is number => value !== null) ?? null;
  const every = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(innerWidth / 44))));
  const labels = days.map((_, index) => index).filter((index) => (days.length - 1 - index) % every === 0);
  const described = known.length
    ? `${title}: latest ${shown(latest!)} ${unit}, average ${shown(average!)} ${unit} over ${known.length} ${known.length === 1 ? 'day' : 'days'}${target ? `, target ${shown(target)} ${unit}` : ''}.`
    : `${title}: nothing logged in this period.`;
  const points = values
    .map((value, index) => (value === null ? null : `${x(index)},${y(value)}`))
    .filter((point): point is string => point !== null);
  const barWidth = Math.min(28, Math.max(3, slot * 0.6));

  return (
    <figure className="trainer-card chart">
      <figcaption>
        <strong>{title}</strong>
        <span>{latest !== null ? `${shown(latest)} ${unit}` : 'No data yet'}</span>
      </figcaption>
      <div className="chart-frame" ref={frame}>
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={described}>
          {ticks.map((value) => (
            <g key={value} className="chart-grid">
              <line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} />
              <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end">{TICK.format(value)}</text>
            </g>
          ))}
          {target ? <line className="chart-target" x1={PAD.left} x2={width - PAD.right} y1={y(target)} y2={y(target)} /> : null}
          {kind === 'bars'
            ? values.map((value, index) => (value === null || value === 0 ? null : (
              <rect
                key={days[index]}
                className="chart-bar"
                x={x(index) - barWidth / 2}
                width={barWidth}
                y={y(value)}
                height={Math.max(1, PAD.top + innerHeight - y(value))}
                rx={Math.min(3, barWidth / 2)}
              >
                <title>{`${short(days[index] ?? '')}: ${shown(value)} ${unit}`}</title>
              </rect>
            )))
            : (
              <>
                <polyline className="chart-line" points={points.join(' ')} />
                {values.map((value, index) => (value === null ? null : (
                  <circle key={days[index]} className="chart-dot" cx={x(index)} cy={y(value)} r={4}>
                    <title>{`${short(days[index] ?? '')}: ${shown(value)} ${unit}`}</title>
                  </circle>
                )))}
              </>
            )}
          {labels.map((index) => (
            <text key={index} className="chart-day" x={x(index)} y={HEIGHT - 8} textAnchor="middle">
              {short(days[index] ?? '')}
            </text>
          ))}
        </svg>
      </div>
      {target ? <p className="chart-key"><span aria-hidden="true" />Target {shown(target)} {unit}</p> : null}
    </figure>
  );
}
