import { PHASES, PHASE_LABELS, type Phase } from '../../../shared/games';
import { LEVEL_NAMES, MAX_LEVEL } from '../../../shared/scoring';
import type { WordLevels } from '../../../shared/types';

// Small mastery meter: one row of dots per category (recognition, recall, recite, translate).
export function PhaseDots({ phase, level }: { phase: Phase; level: number }) {
  return (
    <span className={`dots phase-${phase}`} title={`${PHASE_LABELS[phase]}: ${LEVEL_NAMES[phase][level] ?? level}`}>
      {Array.from({ length: MAX_LEVEL[phase] }, (_, i) => (
        <i key={i} className={i < level ? 'on' : ''} />
      ))}
    </span>
  );
}

export default function LevelDots({ levels, only }: { levels: WordLevels; only?: Phase }) {
  const phases = only ? [only] : PHASES;
  return (
    <span className="level-dots">
      {phases.map((phase) => (
        <PhaseDots key={phase} phase={phase} level={levels[phase]} />
      ))}
    </span>
  );
}
