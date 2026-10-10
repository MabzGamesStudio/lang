import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Volume2, XCircle } from 'lucide-react';
import IpaInput from './IpaInput';
import ForeignInput from '../typing/ForeignInput';
import { wordLang, wordSide } from './IpaAnswers';
import { useApp } from '../../state/AppContext';
import { useKey } from '../../lib/hooks';
import { playIpa } from '../../lib/audio';
import { ipaQualityLabel, type IpaOutcome } from '../../lib/ipaEvaluate';
import { IPA_BY_SYMBOL } from '../../../../shared/ipa/inventory';
import { normalizeIpa, type IpaComparison } from '../../../../shared/ipa/text';
import { IPA_GAMES_BY_ID, type IpaAudioRef, type IpaQuestion } from '../../../../shared/ipa/games';
import { bestMatch } from '../../../../shared/text';
import type { AppSettings, LanguageSummary } from '../../../../shared/types';

export function soundRef(symbol: string): IpaAudioRef {
  return { kind: 'sound', text: symbol, lang: 'ipa', locale: '' };
}

// The expected transcription sound by sound: right, close (diacritics or
// length differ) or missed; sounds typed that are not in it are struck out.
function IpaDiff({ comparison }: { comparison: IpaComparison }) {
  return (
    <div className="diff ipa">
      {comparison.segments.map((segment, index) => (
        <span key={index} className={segment.status === 'missing' ? 'missed' : segment.status}>
          {segment.status === 'missing' ? <ins>{segment.segment}</ins> : segment.segment}
        </span>
      ))}
      {comparison.extra.length > 0 && (
        <span className="muted">
          {' '}
          · not in it: <del>{comparison.extra.join(' ')}</del>
        </span>
      )}
    </div>
  );
}

export default function IpaFeedback({
  question,
  outcome,
  settings,
  language,
  onContinue,
}: {
  question: IpaQuestion;
  outcome: IpaOutcome;
  settings: AppSettings;
  language: LanguageSummary | null;
  onContinue: () => void;
}) {
  const { notify } = useApp();
  const response = IPA_GAMES_BY_ID[question.gameId].response;
  const typed = response === 'symbolTyped' || response === 'ipaTyped' || response === 'wordTyped';
  // After a mistake, type the right answer once.
  const mustRetype = !outcome.correct && settings.learning.retypeOnMistake && typed;
  const [retyped, setRetyped] = useState('');
  const [retypeOk, setRetypeOk] = useState(!mustRetype);
  const retypeRef = useRef<HTMLInputElement>(null);
  const rate = settings.tts.rate || 1;
  const word = question.word;
  const sound = IPA_BY_SYMBOL[question.symbol];
  const chosen = outcome.chosen !== undefined ? question.options?.[outcome.chosen] : undefined;
  const own = language && word?.lang === language.id ? language : null;

  useEffect(() => {
    setRetyped('');
    setRetypeOk(!mustRetype);
    if (mustRetype) requestAnimationFrame(() => retypeRef.current?.focus());
  }, [question.key, mustRetype]);

  useKey(
    'Enter',
    (event) => {
      if (!retypeOk) return;
      event.preventDefault();
      onContinue();
    },
    { inInputs: true }
  );

  const checkRetype = (text: string) => {
    if (retypeOk) {
      onContinue();
      return;
    }
    const ok =
      response === 'wordTyped'
        ? Boolean(bestMatch(text, [question.answer], { locale: word?.audio.locale, side: 'foreign', accentLenient: false, typoTolerance: false }))
        : normalizeIpa(text) === normalizeIpa(question.answer);
    if (ok) setRetypeOk(true);
  };

  const playSound = async () => {
    if (!(await playIpa(soundRef(question.symbol), rate))) notify('No recording of this sound yet: download them on the Pronunciation page.', 'info');
  };

  const answerIsWord = response === 'wordTyped' || response === 'wordAudioChoice';
  const answer = answerIsWord ? question.answer : response === 'ipaChoice' || response === 'ipaTyped' ? `/${question.answer}/` : question.answer;

  return (
    <div className={`feedback ${outcome.correct ? 'good' : 'bad'}`}>
      <div className="feedback-title">
        {outcome.correct ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
        <span>{ipaQualityLabel(outcome)}</span>
      </div>
      {outcome.comparison && !outcome.comparison.exact && <IpaDiff comparison={outcome.comparison} />}
      {typed && outcome.response && outcome.quality !== 'exact' && (
        <div className="spelling">
          <span className="muted">You typed:</span> <span className={answerIsWord ? '' : 'ipa'}>{outcome.response}</span>
          {outcome.correct && (
            <>
              <span className="muted"> · exactly:</span> <strong className={answerIsWord ? '' : 'ipa'}>{answer}</strong>
            </>
          )}
        </div>
      )}
      {!outcome.correct && (
        <div className="expected">
          Answer:{' '}
          <strong className={answerIsWord ? '' : 'ipa'} {...(answerIsWord && word ? { lang: wordLang(word, language) } : {})}>
            {answer}
          </strong>
          {chosen && !chosen.correct && (
            <span className="muted">
              {' '}
              · you picked {response === 'ipaChoice' ? `/${chosen.text}/` : chosen.text}
              {chosen.symbol && IPA_BY_SYMBOL[chosen.symbol] && response !== 'wordAudioChoice' ? ` (${IPA_BY_SYMBOL[chosen.symbol].name})` : ''}
            </span>
          )}
        </div>
      )}
      <div className="word-cards">
        <div className="word-card side-ipa">
          <button className="icon-button" onClick={() => void playSound()} title="Listen to the sound on its own">
            <Volume2 size={18} />
          </button>
          <strong className="ipa">{question.symbol}</strong>
          <span className="gloss">{sound?.name}</span>
        </div>
        {word && (
          <div className={`word-card side-${wordSide(word)}`}>
            <button className="icon-button" onClick={() => void playIpa(word.audio, rate)} title="Listen to the word">
              <Volume2 size={18} />
            </button>
            <strong lang={wordLang(word, language)}>{word.word}</strong>
            <span className="ipa">/{word.ipa}/</span>
            <span className="gloss">{word.gloss ? `“${word.gloss}”` : ''}</span>
            <span className="muted">{word.langName}</span>
          </div>
        )}
      </div>
      {outcome.results.length > 1 && (
        <div className="sound-results" title="The sounds this answer counts for">
          <span className="muted">Sounds:</span>
          {outcome.results.map((result) => (
            <span key={result.symbol} className={`sound-result ${result.correct ? 'right' : 'wrong'}`}>
              <span className="ipa">{result.symbol}</span> {result.correct ? '✓' : '✗'}
            </span>
          ))}
        </div>
      )}
      {mustRetype && (
        <div className="retype">
          {response === 'wordTyped' && own ? (
            <ForeignInput
              language={own}
              value={retyped}
              onChange={setRetyped}
              onEnter={checkRetype}
              inputRef={retypeRef}
              className={`side-foreign ${retypeOk ? 'correct' : ''}`}
              placeholder="Type the correct answer to continue"
              readOnly={retypeOk}
              showHelp={false}
            />
          ) : response === 'wordTyped' ? (
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
              className={`side-${wordSide(word)} ${retypeOk ? 'correct' : ''}`}
              readOnly={retypeOk}
              lang={word?.lang}
            />
          ) : (
            <IpaInput
              value={retyped}
              onChange={setRetyped}
              onEnter={checkRetype}
              inputRef={retypeRef}
              className={`ipa side-ipa ${retypeOk ? 'correct' : ''}`}
              placeholder="Type the correct answer to continue"
              readOnly={retypeOk}
              showHelp={false}
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
