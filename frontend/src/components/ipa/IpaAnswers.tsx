import { useEffect, useRef, useState } from 'react';
import { Check, Play } from 'lucide-react';
import IpaInput from './IpaInput';
import ForeignInput from '../typing/ForeignInput';
import { useKey } from '../../lib/hooks';
import { playIpa } from '../../lib/audio';
import { evaluateIpaChoice, evaluateIpaTyped, type IpaOutcome } from '../../lib/ipaEvaluate';
import { IPA_BY_SYMBOL } from '../../../../shared/ipa/inventory';
import { IPA_GAMES_BY_ID, type IpaQuestion, type IpaWord } from '../../../../shared/ipa/games';
import type { AppSettings, LanguageSummary } from '../../../../shared/types';

// Words in English are blue, in other languages red; IPA is purple.
export function wordSide(word: Pick<IpaWord, 'lang'> | undefined): 'english' | 'foreign' {
  return word && (word.lang === 'en' || word.lang === 'en-GB') ? 'english' : 'foreign';
}

// The HTML language of a word: example languages are codes, your languages ids.
export function wordLang(word: IpaWord, language: LanguageSummary | null): string {
  return language && word.lang === language.id ? language.code : word.lang;
}

export interface IpaAnswerProps {
  question: IpaQuestion;
  settings: AppSettings;
  // The language of the words, when they are words of one of your languages.
  language: LanguageSummary | null;
  disabled: boolean;
  outcome: IpaOutcome | null;
  onAnswer: (outcome: IpaOutcome) => void;
}

// Symbols or transcriptions to pick from (keys 1–n).
export function TextChoices({ question, disabled, outcome, onAnswer }: IpaAnswerProps) {
  const options = question.options ?? [];
  const transcriptions = IPA_GAMES_BY_ID[question.gameId].response === 'ipaChoice';
  const choose = (index: number) => {
    if (disabled || outcome || index >= options.length) return;
    onAnswer(evaluateIpaChoice(question, index));
  };
  useKey(
    options.map((_, i) => String(i + 1)),
    (event) => choose(Number(event.key) - 1),
    { enabled: !disabled && !outcome }
  );
  return (
    <div className={`choices count-${options.length} side-ipa`}>
      {options.map((option, index) => {
        const state = outcome ? (option.correct ? 'correct' : index === outcome.chosen ? 'wrong' : 'dim') : '';
        return (
          <button key={`${question.key}-${index}`} className={`choice ${state}`} onClick={() => choose(index)} disabled={disabled && !outcome}>
            <kbd>{index + 1}</kbd>
            <span className="ipa">{transcriptions ? `/${option.text}/` : option.text}</span>
            {outcome && !transcriptions && <span className="choice-note">{IPA_BY_SYMBOL[option.text]?.name}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Recordings to pick from: keys 1–n play them, Enter picks the last one played.
export function AudioChoices({ question, settings, language, disabled, outcome, onAnswer }: IpaAnswerProps) {
  const options = question.options ?? [];
  const sounds = IPA_GAMES_BY_ID[question.gameId].response === 'soundChoice';
  const [played, setPlayed] = useState<number | null>(null);
  const [heard, setHeard] = useState<number[]>([]);
  const [silent, setSilent] = useState<number[]>([]);

  useEffect(() => {
    setPlayed(null);
    setHeard([]);
    setSilent([]);
  }, [question.key]);

  const play = async (index: number) => {
    const option = options[index];
    if (!option?.audio) return;
    setPlayed(index);
    setHeard((list) => (list.includes(index) ? list : [...list, index]));
    if (!(await playIpa(option.audio, settings.tts.rate || 1))) setSilent((list) => [...list, index]);
  };
  const choose = (index: number) => {
    if (disabled || outcome || index >= options.length) return;
    onAnswer(evaluateIpaChoice(question, index));
  };
  useKey(
    options.map((_, i) => String(i + 1)),
    (event) => void play(Number(event.key) - 1),
    { enabled: !disabled }
  );
  useKey(
    'Enter',
    (event) => {
      if (played === null) return;
      event.preventDefault();
      choose(played);
    },
    { enabled: !disabled && !outcome }
  );

  return (
    <div className={`audio-choices side-${sounds ? 'ipa' : wordSide(question.word)}`}>
      {options.map((option, index) => {
        const state = outcome ? (option.correct ? 'correct' : index === outcome.chosen ? 'wrong' : 'dim') : played === index ? 'current' : '';
        return (
          <div key={`${question.key}-${index}`} className={`audio-choice ${state}`}>
            <button type="button" className="play-option" onClick={() => void play(index)} title={`Play recording ${index + 1}`}>
              <Play size={18} />
              <kbd>{index + 1}</kbd>
            </button>
            {outcome ? (
              sounds ? (
                <span className="option-label">
                  <strong className="ipa">{option.text}</strong> <span className="muted">{IPA_BY_SYMBOL[option.text]?.name}</span>
                </span>
              ) : (
                <span className="option-label">
                  <strong lang={option.word ? wordLang(option.word, language) : undefined}>{option.text}</strong>{' '}
                  <span className="ipa muted">/{option.word?.ipa}/</span>
                </span>
              )
            ) : (
              <span className="option-label muted">{silent.includes(index) ? 'no recording yet' : heard.includes(index) ? 'played' : ''}</span>
            )}
            {!outcome && (
              <button type="button" className="button small" onClick={() => choose(index)} disabled={disabled}>
                <Check size={14} /> This one
              </button>
            )}
          </div>
        );
      })}
      {!outcome && (
        <div className="hint muted">
          Keys 1–{options.length} play a recording · Enter picks the last one played
        </div>
      )}
    </div>
  );
}

// A typed symbol or transcription (X-SAMPA or the symbol keys), or a word.
export function TypedIpaAnswer({ question, settings, language, disabled, outcome, onAnswer }: IpaAnswerProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const response = IPA_GAMES_BY_ID[question.gameId].response;

  useEffect(() => setValue(''), [question.key]);
  useEffect(() => {
    if (!disabled && !outcome) inputRef.current?.focus();
  }, [disabled, outcome, question.key]);

  const submit = (text: string) => {
    if (disabled || outcome || !text.trim()) return;
    onAnswer(evaluateIpaTyped(question, text, question.word?.audio.locale ?? 'en-US', settings.learning));
  };
  const state = outcome ? (outcome.correct ? 'correct' : 'wrong') : '';

  if (response === 'wordTyped' && question.word) {
    const word = question.word;
    const own = language && word.lang === language.id ? language : null;
    return (
      <div className="typed-answer">
        {own ? (
          <ForeignInput
            language={own}
            value={value}
            onChange={setValue}
            onEnter={submit}
            inputRef={inputRef}
            className={`answer-input side-foreign ${state}`}
            readOnly={Boolean(outcome)}
            disabled={disabled}
            placeholder={`Type the ${own.name} word…`}
          />
        ) : (
          <input
            ref={inputRef}
            className={`answer-input side-${wordSide(word)} ${state}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || disabled || outcome) return;
              event.preventDefault();
              event.stopPropagation();
              submit(value);
            }}
            readOnly={Boolean(outcome)}
            disabled={disabled}
            placeholder={`Type the ${word.langName} word…`}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            lang={word.lang}
          />
        )}
        {!outcome && <div className="hint muted">Press Enter to check</div>}
      </div>
    );
  }

  return (
    <div className="typed-answer">
      <IpaInput
        value={value}
        onChange={setValue}
        onEnter={submit}
        inputRef={inputRef}
        className={`answer-input ipa side-ipa ${state}`}
        readOnly={Boolean(outcome)}
        disabled={disabled}
        placeholder={response === 'symbolTyped' ? 'Type the symbol…' : 'Type the transcription…'}
      />
      {!outcome && <div className="hint muted">Press Enter to check · type with X-SAMPA keys (the ? button lists them) or click the symbols</div>}
    </div>
  );
}
