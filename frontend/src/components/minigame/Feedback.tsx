import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Pencil, Volume2, XCircle } from 'lucide-react';
import { playText } from '../../lib/audio';
import { qualityLabel, type Outcome } from '../../lib/evaluate';
import { useKey } from '../../lib/hooks';
import { bestMatch } from '../../../../shared/text';
import { voiceFor } from './PromptView';
import ExtraCharacters, { typingCharacters, useInsertAtCursor } from '../ExtraCharacters';
import type { AppSettings, LanguageSummary, Question, QuestionWord } from '../../../../shared/types';

function SentenceDiff({ outcome }: { outcome: Outcome }) {
  if (!outcome.alignment) return null;
  return (
    <div className="diff">
      {outcome.alignment.map((token, index) => {
        if (token.status === 'extra') return <del key={index}>{token.actual}</del>;
        if (token.status === 'missing') return <ins key={index}>{token.expected}</ins>;
        if (token.status === 'wrong') {
          return (
            <span key={index} className="wrong">
              <del>{token.actual}</del> <ins>{token.expected}</ins>
            </span>
          );
        }
        return (
          <span key={index} className={token.status}>
            {token.actual}
          </span>
        );
      })}
    </div>
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
  const insertRetype = useInsertAtCursor(retypeRef, setRetyped);
  const retypeCharacters = question.response.side === 'foreign' ? typingCharacters(language) : [];
  const target = question.words[0];
  const chosen = question.options && !outcome.correct ? question.words.find((w) => question.options!.some((o) => o.wordId === w.id && o.text === outcome.response)) : undefined;
  const foreignVoice = voiceFor('foreign', language, settings);

  useEffect(() => {
    setRetyped('');
    setRetypeOk(!mustRetype);
    if (mustRetype) requestAnimationFrame(() => retypeRef.current?.focus());
  }, [question.key, mustRetype]);

  useKey(
    'Enter',
    (event) => {
      if (event.target === retypeRef.current) return;
      if (!retypeOk) return;
      event.preventDefault();
      onContinue();
    },
    { inInputs: true }
  );

  const playForeign = (text: string) => void playText(foreignVoice.target, text, foreignVoice.options);
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
        <div className="muted">
          Exact spelling: <strong>{outcome.matched}</strong>
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
          <SentenceDiff outcome={outcome} />
          <div className="pair">
            <button className="icon-button" onClick={() => playForeign(question.sentence!.text)} title="Listen">
              <Volume2 size={18} />
            </button>
            <span lang={language.code}>{question.sentence.text}</span>
          </div>
          {question.sentence.english && <div className="pair muted">{question.sentence.english}</div>}
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
        <form
          className="retype"
          onSubmit={(event) => {
            event.preventDefault();
            if (retypeOk) {
              onContinue();
              return;
            }
            const side = question.response.side;
            const ok = bestMatch(retyped, accepted, {
              locale: side === 'foreign' ? language.locale : 'en',
              side,
              accentLenient: false,
              typoTolerance: false,
            });
            if (ok) setRetypeOk(true);
          }}
        >
          <input
            ref={retypeRef}
            value={retyped}
            onChange={(event) => setRetyped(event.target.value)}
            placeholder="Type the correct answer to continue"
            className={retypeOk ? 'correct' : ''}
            {...(question.response.side === 'foreign' ? { lang: language.code } : {})}
          />
          {!retypeOk && <ExtraCharacters characters={retypeCharacters} inputRef={retypeRef} onInsert={insertRetype} />}
        </form>
      )}
      <button className="button primary continue" onClick={onContinue} disabled={!retypeOk}>
        Continue (Enter)
      </button>
    </div>
  );
}
