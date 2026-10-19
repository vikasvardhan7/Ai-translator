import { useEffect, useState } from 'react';

const TIPS = [
  'Say “start meeting captions” in the ask box to begin.',
  'Double-click Call another device to invite up to 5 people.',
  'Ask “summarise so far” during any call.',
  'Minimize a call: it keeps running in the taskbar.',
  'Open Personalize to change the colours.',
];
const TIP_MS = 6_000;

function greeting(hour: number): string {
  if (hour < 5) {
    return 'Good night';
  }
  if (hour < 12) {
    return 'Good morning';
  }
  return hour < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DesktopWidget() {
  const [now, setNow] = useState(() => new Date());
  const [tip, setTip] = useState(0);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    const tips = window.setInterval(() => setTip((current) => (current + 1) % TIPS.length), TIP_MS);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(tips);
    };
  }, []);

  return (
    <aside className="desk-widget" aria-label="Clock and tips">
      <p className="desk-greeting">{greeting(now.getHours())}</p>
      <p className="desk-time">
        <time dateTime={now.toISOString()}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        <span className="desk-seconds" aria-hidden="true">{String(now.getSeconds()).padStart(2, '0')}</span>
      </p>
      <p className="desk-date">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <p className="desk-tip" key={tip} aria-live="off">{TIPS[tip]}</p>
    </aside>
  );
}
