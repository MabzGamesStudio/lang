import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Pencil, Volume2, XCircle } from 'lucide-react';
import { playText } from '../../lib/audio';
import { qualityLabel, type Outcome } from '../../lib/evaluate';
import { useKey } from '../../lib/hooks';
import { bestMatch } from '../../../../shared/text';
import { voiceFor } from './PromptView';
import ForeignInput from '../typing/ForeignInput';
import SentenceWords from './SentenceWords';
import type { AppSettings, LanguageSummary, Question, QuestionWord } from '../../../../shared/types';

// `counts`: for answers in the foreign language, which words are scored.
// Words that are not (names, words not met yet) are shown muted.
function SentenceDiff({ outcome, counts }: { outcome: Outcome; counts?: boolean[] }) {
  if (!outcome.alignment) return null;
  return (
    <div className="diff">
      {outcome.alignment.map((token, index) => {
        const muted = counts && token.expectedIndex !== null && !counts[token.expectedIndex] ? ' uncounted' : '';
        if (token.status === 'extra') return <del key={index}>{token.actual}</del>;
        if (token.status === 'missing') {
          return (
            <ins key={index} className={muted.trim() || undefined}>
              {token.expected}
            </ins>
          );
        }
        if (token.status === 'wrong') {
          return (
            <span key={index} className={`wrong${muted}`}>
              <del>{token.actual}</del> <ins>{token.expected}</ins>
            </span>
          );
        }
        return (
          <span key={index} className={`${token.status}${muted}`}>
            {token.actual}
          </span>
        );
      })}
    </div>
  );
}

// The correct spelling with the letters that differ from what was typed highlighted.
function CharDiff({ expected, typed }: { expected: string; typed: string }) {
  const a = Array.from(expected);
  const b = Array.from(typed.trim().toLowerCase());
  const lower = a.map((char) => char.toLowerCase());
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = lower[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const matched = new Array<boolean>(a.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (lower[i] === b[j]) {
      matched[i] = true;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return (
    <span className="char-diff">
      {a.map((char, index) => (
        <span key={index} className={matched[index] ? '' : 'differs'}>
          {char}
        </span>
      ))}
    </span>
  );
}

function WordCard({ word, onEdit, onPlay }: { word: QuestionWord; onEdit?: () => void; onPlay: () => void }) {
  return (
    <div className="word-card">
      <button className="icon-button" onClick={onPlay} title="Listen">
        <Volume2 size={18} />
      </button>
      <strong>{word.display}</strong>
      {word.pronunciation && <span className="ipa">/{word.pronunciation}/</span>}
      <span className="gloss">{word.english.join('; ') || '—'}</span>
      {word.pos && <span className="muted">{word.pos}</span>}
      {onEdit && (
        <button className="icon-button" onClick={onEdit} title="Fix this word">
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}

export default function Feedback({
  question,
  outcome,
  language,
  settings,
  onContinue,
  onEditWord,
}: {
  question: Question;
  outcome: Outcome;
  language: LanguageSummary;
  settings: AppSettings;
  onContinue: () => void;
  onEditWord: (word: QuestionWord) => void;
}) {
  // Rote reinforcement: after a mistake, type the right answer once.
  const mustRetype = !outcome.correct && settings.learning.retypeOnMistake && question.response.mode === 'type' && !question.sentence;
  const [retyped, setRetyped] = useState('');
  const [retypeOk, setRetypeOk] = useState(!mustRetype);
  const retypeRef = useRef<HTMLInputElement>(null);
  const target = question.words[0];
  const chosen = question.options && !outcome.correct ? question.words.find((w) => question.options!.some((o) => o.wordId === w.id && o.text === outcome.response)) : undefined;
  const foreignVoice = voiceFor('foreign', language, settings);

  useEffect(() => {
    setRetyped('');
    setRetypeOk(!mustRetype);
    if (mustRetype) requestAnimationFrame(() => retypeRef.current?.focus());
  }, [question.key, mustRetype]);

  // Enter continues (an answer box that uses the key stops it first).
  useKey(
    'Enter',
    (event) => {
      if (!retypeOk) return;
      event.preventDefault();
      onContinue();
    },
    { inInputs: true }
  );

  const playForeign = (text: string) => void playText(foreignVoice.target, text, foreignVoice.options);
  const checkRetype = (text: string) => {
    if (retypeOk) {
      onContinue();
      return;
    }
    const side = question.response.side;
    const ok = bestMatch(text, accepted, {
      locale: side === 'foreign' ? language.locale : 'en',
      side,
      accentLenient: false,
      typoTolerance: false,
    });
    if (ok) setRetypeOk(true);
  };
  const accepted = question.accepted?.map((a) => a.text) ?? [];
  const alternatives = question.sentence ? [] : accepted.filter((text) => text !== question.answer).slice(0, 6);

  return (
    <div className={`feedback ${outcome.correct ? 'good' : 'bad'}`}>
      <div className="feedback-title">
        {outcome.correct ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
        <span>{qualityLabel(outcome)}</span>
      </div>
      {outcome.quality === 'synonym' && outcome.matched && (
        <div className="muted">
          “{outcome.matched}” is right too. This question was asking for: <strong>{question.answer}</strong>
        </div>
      )}
      {(outcome.quality === 'accent' || outcome.quality === 'typo') && outcome.matched && (
        <div className="spelling">
          <span className="muted">You typed:</span> <span>{outcome.response.trim()}</span>
          <span className="muted"> · exact spelling:</span>{' '}
          <strong {...(question.answerSide === 'foreign' ? { lang: language.code } : {})}>
            <CharDiff expected={outcome.matched} typed={outcome.response} />
          </strong>
        </div>
      )}
      {!outcome.correct && !question.sentence && (
        <div className="expected">
          Answer: <strong {...(question.answerSide === 'foreign' ? { lang: language.code } : {})}>{question.answer}</strong>
          {alternatives.length > 0 && <span className="muted"> · also accepted: {alternatives.join(', ')}</span>}
        </div>
      )}
      {question.sentence && (
        <div className="sentence-feedback">
          <SentenceDiff
            outcome={outcome}
            counts={question.response.side === 'foreign' ? question.sentence.tokens.map((token) => token.evaluate) : undefined}
          />
          <div className="pair">
            <button className="icon-button" onClick={() => playForeign(question.sentence!.text)} title="Listen">
              <Volume2 size={18} />
            </button>
            <span lang={language.code}>{question.sentence.text}</span>
          </div>
          {question.sentence.english && <div className="pair muted">{question.sentence.english}</div>}
          <SentenceWords questionKey={question.key} tokens={question.sentence.tokens} language={language} />
        </div>
      )}
      {outcome.note && <div className="note">{outcome.note}</div>}
      {question.prompt.mode === 'image' && question.imageLabels && (
        <div className="muted">This picture means: {question.imageLabels.join(', ')}</div>
      )}
      <div className="word-cards">
        <WordCard word={target} onPlay={() => playForeign(target.display)} onEdit={() => onEditWord(target)} />
        {chosen && chosen.id !== target.id && (
          <WordCard word={chosen} onPlay={() => playForeign(chosen.display)} onEdit={() => onEditWord(chosen)} />
        )}
      </div>
      {mustRetype && (
        <div className="retype">
          {question.response.side === 'foreign' ? (
            <ForeignInput
              language={language}
              value={retyped}
              onChange={setRetyped}
              onEnter={checkRetype}
              inputRef={retypeRef}
              className={`side-foreign ${retypeOk ? 'correct' : ''}`}
              placeholder="Type the correct answer to continue"
              readOnly={retypeOk}
              showHelp={false}
            />
          ) : (
            <input
              ref={retypeRef}
              value={retyped}
              onChange={(event) => setRetyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.stopPropagation();
                checkRetype(retyped);
              }}
              placeholder="Type the correct answer to continue"
              className={`side-english ${retypeOk ? 'correct' : ''}`}
              lang="en"
            />
          )}
        </div>
      )}
      <button className="button primary continue" onClick={onContinue} disabled={!retypeOk}>
        Continue (Enter)
      </button>
    </div>
  );
}
