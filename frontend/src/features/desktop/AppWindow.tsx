import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import AppIcon, { type IconName } from './AppIcon';
import { windowSize, type Area, type WindowState } from './windows';

interface AppWindowProps {
  window: WindowState;
  title: string;
  icon: IconName;
  active: boolean;
  area: Area;
  children: ReactNode;
  onFocus: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onMove: (x: number, y: number) => void;
}

export default function AppWindow({
  window: state,
  title,
  icon,
  active,
  area,
  children,
  onFocus,
  onMinimize,
  onMaximize,
  onClose,
  onMove,
}: AppWindowProps) {
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const size = windowSize(state.app, area);
  const titleId = `window-title-${state.app}`;

  function startDrag(event: ReactPointerEvent<HTMLElement>): void {
    if (event.button !== 0 || state.maximized || (event.target as HTMLElement).closest('button')) {
      return;
    }
    dragRef.current = { id: event.pointerId, dx: event.clientX - state.x, dy: event.clientY - state.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: ReactPointerEvent<HTMLElement>): void {
    const current = dragRef.current;
    if (current && current.id === event.pointerId) {
      onMove(event.clientX - current.dx, event.clientY - current.dy);
    }
  }

  function stopDrag(event: ReactPointerEvent<HTMLElement>): void {
    if (dragRef.current?.id === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <section
      className="app-window"
      data-app={state.app}
      data-active={active}
      data-maximized={state.maximized}
      data-minimized={state.minimized}
      aria-labelledby={titleId}
      aria-hidden={state.minimized}
      inert={state.minimized}
      style={{
        zIndex: state.z,
        width: state.maximized ? undefined : size.width,
        height: state.maximized ? undefined : size.height,
        translate: state.maximized ? '0 0' : `${state.x}px ${state.y}px`,
      }}
      onPointerDownCapture={onFocus}
    >
      <header
        className="window-bar"
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) {
            onMaximize();
          }
        }}
      >
        <AppIcon name={icon} size="small" />
        <h2 className="window-title" id={titleId}>{title}</h2>
        <div className="window-buttons">
          <button className="window-button" type="button" onClick={onMinimize} aria-label={`Minimize ${title}`}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5h8" /></svg>
          </button>
          <button
            className="window-button window-maximize"
            type="button"
            onClick={onMaximize}
            aria-label={state.maximized ? `Restore ${title}` : `Maximize ${title}`}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              {state.maximized ? <path d="M3.5 4.5h4v4h-4zM5 4.5V3h4v4H7.5" /> : <path d="M2.5 2.5h7v7h-7z" />}
            </svg>
          </button>
          <button className="window-button window-close" type="button" onClick={onClose} aria-label={`Close ${title}`}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" /></svg>
          </button>
        </div>
      </header>
      <div className="window-body">{children}</div>
    </section>
  );
}
