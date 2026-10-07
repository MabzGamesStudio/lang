import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, SkipForward } from 'lucide-react';
import ExtraCharacters from '../ExtraCharacters';
import { useKey } from '../../lib/hooks';
import { evaluateChoice, evaluateSpoken, evaluateTyped, type Outcome } from '../../lib/evaluate';
import { browserRecognitionAvailable, startListening, type Listening } from '../../lib/speech';
import { errorMessage } from '../../api';
import type { AppSettings, LanguageSummary, Question } from '../../../../shared/types';

interface AnswerProps {
  question: Question;
  language: LanguageSummary;
  settings: AppSettings;
  disabled: boolean;
  outcome: Outcome | null;
  onAnswer: (outcome: Outcome) => void;
}

function sideProps(question: Question, language: LanguageSummary) {
  return question.response.side === 'foreign'
    ? { lang: language.code, dir: language.rtl ? ('rtl' as const) : ('ltr' as const) }
    : { lang: 'en' };
}

// ---------------------------------------------------------------------------

export function ChoiceAnswer({ question, language, disabled, outcome, onAnswer }: AnswerProps) {
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => setSelected(null), [question.key]);
  const options = question.options ?? [];

  const choose = (index: number) => {
    if (disabled || outcome || index >= options.length) return;
    setSelected(index);
    onAnswer(evaluateChoice(question, index));
  };
  useKey(
    options.map((_, i) => String(i + 1)),
    (event) => choose(Number(event.key) - 1),
    { enabled: !disabled && !outcome }
  );

  return (
    <div className={`choices count-${options.length}`}>
      {options.map((option, index) => {
        let state = '';
        if (outcome) {
          if (option.correct) state = 'correct';
          else if (index === selected) state = 'wrong';
          else state = 'dim';
        }
        return (
          <button key={`${question.key}-${index}`} className={`choice ${state}`} onClick={() => choose(index)} disabled={disabled && !outcome} {...sideProps(question, language)}>
            <kbd>{index + 1}</kbd>
            <span>{option.text}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function TypedAnswer({ question, language, settings, disabled, outcome, onAnswer }: AnswerProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const foreign = question.response.side === 'foreign';
  const characters = foreign ? (language.extraCharacters.length ? language.extraCharacters : language.autoCharacters) : [];

  useEffect(() => {
    setValue('');
  }, [question.key]);
  useEffect(() => {
    if (!disabled && !outcome) inputRef.current?.focus();
  }, [disabled, outcome, question.key]);

  const insert = useCallback((char: string) => {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    setValue((current) => current.slice(0, start) + char + current.slice(end));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + char.length, start + char.length);
    });
  }, []);

  return (
    <form
      className="typed-answer"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || outcome || !value.trim()) return;
        onAnswer(evaluateTyped(question, value, language.locale || language.code, settings.learning));
      }}
    >
      <input
        ref={inputRef}
        className={`answer-input ${outcome ? (outcome.correct ? 'correct' : 'wrong') : ''} ${question.sentence ? 'sentence' : ''}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        readOnly={Boolean(outcome)}
        disabled={disabled}
        placeholder={foreign ? `Type in ${language.name}…` : 'Type in English…'}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        {...sideProps(question, language)}
      />
      {!outcome && <ExtraCharacters characters={characters} inputRef={inputRef} onInsert={insert} />}
      {!outcome && (
        <div className="hint muted">
          Press Enter to check{characters.length ? ' · digits insert special letters' : ''}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------

export function SpokenAnswer({ question, language, settings, disabled, outcome, onAnswer, onSkip }: AnswerProps & { onSkip: () => void }) {
  const [listening, setListening] = useState<Listening | null>(null);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const foreign = question.response.side === 'foreign';
  const locale = foreign ? language.locale || language.code : 'en-US';
  const target = foreign ? language.id : 'english';
  const provider = settings.stt.provider;
  const unsupported = provider === 'browser' && !browserRecognitionAvailable();

  useEffect(() => {
    setHeard(null);
    setError(null);
  }, [question.key]);

  useEffect(() => {
    if (!listening) return;
    const timer = window.setInterval(() => setLevel(listening.level()), 80);
    return () => window.clearInterval(timer);
  }, [listening]);

  async function listen() {
    if (listening || disabled || outcome) return;
    setError(null);
    setHeard(null);
    try {
      const session = startListening(provider, target, locale);
      setListening(session);
      const alternatives = await session.result;
      setListening(null);
      if (alternatives.length === 0) {
        setHeard('');
        return;
      }
      setHeard(alternatives[0]);
      onAnswer(evaluateSpoken(question, alternatives, language.locale || language.code, settings.learning));
    } catch (err) {
      setListening(null);
      setError(errorMessage(err));
    }
  }

  useKey(
    ' ',
    (event) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      if (listening) listening.stop();
      else void listen();
    },
    { enabled: !disabled && !outcome }
  );

  return (
    <div className="spoken-answer">
      {unsupported ? (
        <p className="banner warning">
          This window has no built-in speech recognition. Choose Google Colab or a Whisper API under Configuration → Services → Speech recognition, open the app in Chrome, or turn off speaking minigames in Configuration → Learning.
        </p>
      ) : (
        <button className={`mic-button ${listening ? 'listening' : ''}`} onClick={() => (listening ? listening.stop() : void listen())} disabled={disabled || Boolean(outcome)}>
          {listening ? <MicOff size={36} /> : <Mic size={36} />}
          <span>{listening ? 'Listening… (Space to stop)' : `Speak in ${foreign ? language.name : 'English'} (Space)`}</span>
          {listening && (
            <span className="meter">
              <span style={{ width: `${Math.round(level * 100)}%` }} />
            </span>
          )}
        </button>
      )}
      {heard !== null && <div className="heard">{heard ? <>Heard: “{heard}”</> : 'Nothing was heard — try again.'}</div>}
      {error && <div className="banner error">{error}</div>}
      {!outcome && (
        <button className="link-button" onClick={onSkip}>
          <SkipForward size={14} /> Skip (can't speak right now)
        </button>
      )}
    </div>
  );
}
