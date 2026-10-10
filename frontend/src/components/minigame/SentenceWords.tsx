import { useEffect, useState } from 'react';
import { Ban, RotateCcw } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useApp } from '../../state/AppContext';
import type { LanguageSummary, SentenceToken } from '../../../../shared/types';

const SKIP_TITLES: Record<NonNullable<SentenceToken['skip']>, string> = {
  excluded: 'Not counted: a name or a word taken out of the vocabulary',
  unseen: 'Not counted: you have not met this word yet',
  later: 'Not counted: further on in the vocabulary',
};

// The words of a sentence question, showing which ones were scored. Any word
// can be made neutral (e.g. a name): it is taken out of the vocabulary and
// never counted again — or counted again.
export default function SentenceWords({ questionKey, tokens, language }: { questionKey: string; tokens: SentenceToken[]; language: LanguageSummary }) {
  const { notify } = useApp();
  // Word id → excluded (true) or counted again (false) during this question.
  const [changed, setChanged] = useState<Record<number, boolean>>({});
  useEffect(() => setChanged({}), [questionKey]);

  const words: SentenceToken[] = [];
  const seen = new Set<number>();
  for (const token of tokens) {
    if (token.wordId === null || seen.has(token.wordId)) continue;
    seen.add(token.wordId);
    words.push(token);
  }
  if (words.length === 0) return null;

  async function toggle(token: SentenceToken, exclude: boolean) {
    try {
      await api.updateWord(language.id, token.wordId!, { excluded: exclude });
      setChanged((current) => ({ ...current, [token.wordId!]: exclude }));
      notify(exclude ? `“${token.text}” is not counted any more.` : `“${token.text}” counts again from the next question.`, 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }

  return (
    <div className="sentence-words">
      <span className="muted">Words</span>
      {words.map((token) => {
        const change = changed[token.wordId!];
        const excluded = change ?? token.skip === 'excluded';
        const state = excluded ? 'excluded' : change === false ? 'restored' : token.evaluate ? 'counted' : 'uncounted';
        const title =
          state === 'excluded'
            ? SKIP_TITLES.excluded
            : state === 'restored'
              ? 'Counts again from the next question'
              : state === 'counted'
                ? token.target
                  ? 'The word this question is about'
                  : 'Scored in this sentence'
                : SKIP_TITLES[token.skip ?? 'unseen'];
        return (
          <span key={token.wordId} className={`word-chip ${state} ${token.target ? 'target' : ''}`} title={title} lang={language.code}>
            {token.text}
            {!token.target &&
              (excluded ? (
                <button type="button" title="Count this word again" onClick={() => void toggle(token, false)}>
                  <RotateCcw size={12} />
                </button>
              ) : (
                <button type="button" title="Don’t count this word (e.g. a name)" onClick={() => void toggle(token, true)}>
                  <Ban size={12} />
                </button>
              ))}
          </span>
        );
      })}
    </div>
  );
}
