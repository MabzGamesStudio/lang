import { RotateCcw } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import GameIcons from '../../components/GameIcons';
import { Field, NumberInput, Section, Toggle, useSettingsDraft } from './fields';
import { PHASES, PHASE_LABELS, gamesForPhase, isListeningGame, isSpeakingGame } from '../../../../shared/games';

export default function LearningTab() {
  const { language, refreshLanguages } = useApp();
  const run = useAction();
  const [draft, update] = useSettingsDraft();
  if (!draft) return null;
  const learning = draft.learning;

  return (
    <>
      <Section title="Personal progress minigames" description="Personal progress rotates through every enabled minigame of the current phase, so each word is seen, heard, typed and spoken.">
        <div className="row">
          <Toggle checked={!learning.disableSpeaking} onChange={(value) => update((s) => void (s.learning.disableSpeaking = !value))}>
            Speaking minigames
          </Toggle>
          <Toggle checked={!learning.disableListening} onChange={(value) => update((s) => void (s.learning.disableListening = !value))}>
            Listening minigames
          </Toggle>
        </div>
        <div className="games-toggle-grid">
          {PHASES.map((phase) => (
            <div key={phase}>
              <h3 className={`phase-${phase}`}>{PHASE_LABELS[phase]}</h3>
              {gamesForPhase(phase).map((game) => {
                const blocked = (learning.disableSpeaking && isSpeakingGame(game)) || (learning.disableListening && isListeningGame(game));
                return (
                  <Toggle
                    key={game.id}
                    checked={!blocked && !learning.disabledGames.includes(game.id)}
                    onChange={(value) =>
                      update((s) => {
                        s.learning.disabledGames = value
                          ? s.learning.disabledGames.filter((id) => id !== game.id)
                          : [...s.learning.disabledGames, game.id];
                      })
                    }
                  >
                    <GameIcons game={game} size={14} /> {game.title}
                  </Toggle>
                );
              })}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Answers" description="How forgiving checking is.">
        <div className="form-grid">
          <Field label="Multiple choice options">
            <NumberInput value={learning.choiceCount} min={2} max={8} onChange={(value) => update((s) => void (s.learning.choiceCount = value))} />
          </Field>
          <Field label="Sentence closeness needed (%)" hint="Share of words that must match when typing sentences">
            <NumberInput
              value={Math.round(learning.sentenceThreshold * 100)}
              min={30}
              max={100}
              onChange={(value) => update((s) => void (s.learning.sentenceThreshold = value / 100))}
            />
          </Field>
          <Field label="Speech closeness needed (%)" hint="Similarity between what was heard and the answer">
            <NumberInput
              value={Math.round(learning.speechThreshold * 100)}
              min={30}
              max={100}
              onChange={(value) => update((s) => void (s.learning.speechThreshold = value / 100))}
            />
          </Field>
        </div>
        <div className="stack">
          <Toggle checked={learning.accentLenient} onChange={(value) => update((s) => void (s.learning.accentLenient = value))}>
            Accept answers with missing accents (the correct spelling is shown)
          </Toggle>
          <Toggle checked={learning.typoTolerance} onChange={(value) => update((s) => void (s.learning.typoTolerance = value))}>
            Accept small typos in longer words
          </Toggle>
          <Toggle checked={learning.retypeOnMistake} onChange={(value) => update((s) => void (s.learning.retypeOnMistake = value))}>
            After a mistake, type the correct answer once before continuing
          </Toggle>
          <Toggle checked={learning.memorizeHide} onChange={(value) => update((s) => void (s.learning.memorizeHide = value))}>
            Recite from memory: hide the sentence before answering
          </Toggle>
        </div>
      </Section>

      <Section title="Flow">
        <div className="form-grid">
          <Field label="Next question after a correct answer (ms)" hint="0 = wait for Enter">
            <NumberInput value={learning.autoAdvanceMs} min={0} max={10000} step={100} onChange={(value) => update((s) => void (s.learning.autoAdvanceMs = value))} />
          </Field>
          <Field label="Focus minutes">
            <NumberInput value={learning.pomodoroWorkMinutes} min={5} max={120} onChange={(value) => update((s) => void (s.learning.pomodoroWorkMinutes = value))} />
          </Field>
          <Field label="Break minutes">
            <NumberInput value={learning.pomodoroBreakMinutes} min={1} max={60} onChange={(value) => update((s) => void (s.learning.pomodoroBreakMinutes = value))} />
          </Field>
        </div>
        <div className="stack">
          <Toggle checked={learning.batchPreview} onChange={(value) => update((s) => void (s.learning.batchPreview = value))}>
            Show the 7 new words before a new batch starts
          </Toggle>
          <Toggle checked={learning.playAudioOnFeedback} onChange={(value) => update((s) => void (s.learning.playAudioOnFeedback = value))}>
            Play the correct pronunciation after a mistake
          </Toggle>
          <Toggle checked={learning.pomodoro} onChange={(value) => update((s) => void (s.learning.pomodoro = value))}>
            Pomodoro timer in Personal progress
          </Toggle>
          <Toggle checked={learning.autoPrepare} onChange={(value) => update((s) => void (s.learning.autoPrepare = value))}>
            Automatically fetch definitions, translations and audio for the block being learned
          </Toggle>
        </div>
      </Section>

      {language && (
        <Section title="Reset" description={`Forget all ${language.name} progress (knowledge levels and review schedule). Words and sentences are kept.`}>
          <button
            className="button danger"
            onClick={async () => {
              if (!window.confirm(`Reset all ${language.name} progress? This cannot be undone.`)) return;
              await run(() => api.resetProgress(language.id), 'Progress reset');
              await refreshLanguages();
            }}
          >
            <RotateCcw size={16} /> Reset {language.name} progress
          </button>
        </Section>
      )}
    </>
  );
}
