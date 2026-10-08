import { PHASES, PHASE_LABELS, type Phase } from '../../../shared/games';
import { levelNames, requiredLevels } from '../../../shared/scoring';
import { useApp } from '../state/AppContext';
import type { WordLevels } from '../../../shared/types';

// Small mastery meter: one row of dots per category (recognition, recall,
// recite, translate); the number of dots is the number of correct answers
// needed (adjustable in Configuration → Learning).
export function PhaseDots({ phase, level, max }: { phase: Phase; level: number; max: number }) {
  const shown = Math.min(level, max);
  return (
    <span className={`dots phase-${phase}`} title={`${PHASE_LABELS[phase]}: ${levelNames(phase, max)[shown] ?? shown} (${shown}/${max})`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < shown ? 'on' : ''} />
      ))}
    </span>
  );
}

export default function LevelDots({ levels, only }: { levels: WordLevels; only?: Phase }) {
  const { settings } = useApp();
  const required = requiredLevels(settings?.learning);
  const phases = only ? [only] : PHASES;
  return (
    <span className="level-dots">
      {phases.map((phase) => (
        <PhaseDots key={phase} phase={phase} level={levels[phase]} max={required[phase]} />
      ))}
    </span>
  );
}
