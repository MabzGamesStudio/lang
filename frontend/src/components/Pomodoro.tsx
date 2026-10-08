import { useEffect, useState } from 'react';
import { Coffee, Timer } from 'lucide-react';

// 25 minutes of focused work, then a 5 minute break (configurable).
export default function Pomodoro({
  workMinutes,
  breakMinutes,
  onBreakChange,
}: {
  workMinutes: number;
  breakMinutes: number;
  onBreakChange: (onBreak: boolean) => void;
}) {
  const [phase, setPhase] = useState<'work' | 'break'>('work');
  const [endsAt, setEndsAt] = useState(() => Date.now() + workMinutes * 60_000);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (now < endsAt) return;
    const next = phase === 'work' ? 'break' : 'work';
    setPhase(next);
    setEndsAt(Date.now() + (next === 'work' ? workMinutes : breakMinutes) * 60_000);
    onBreakChange(next === 'break');
  }, [now, endsAt, phase, workMinutes, breakMinutes, onBreakChange]);

  const remaining = Math.max(0, endsAt - now);
  const label = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;

  const skipBreak = () => {
    setPhase('work');
    setEndsAt(Date.now() + workMinutes * 60_000);
    onBreakChange(false);
  };

  return (
    <>
      <span className={`pomodoro ${phase}`} title={phase === 'work' ? 'Focus time left' : 'Break time left'}>
        {phase === 'work' ? <Timer size={16} /> : <Coffee size={16} />} {label}
      </span>
      {phase === 'break' && (
        <div className="break-overlay">
          <div className="card">
            <Coffee size={40} />
            <h2>Break time — {label}</h2>
            <p className="muted">Stand up, look away from the screen, let the words settle.</p>
            <button className="button" onClick={skipBreak}>
              Skip the break
            </button>
          </div>
        </div>
      )}
    </>
  );
}
