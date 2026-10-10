import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { HelpCircle } from 'lucide-react';
import { api } from '../../api';
import ExtraCharacters, { typingCharacters } from '../ExtraCharacters';
import {
  isComposingMethod,
  pinyinConsumes,
  prepareEntries,
  resolveInputMethod,
  searchCandidates,
  type PreparedEntry,
  type ResolvedInputMethod,
} from '../../../../shared/ime/index';
import { phoneticConsumes, phoneticHelp, phoneticScheme, transliterate } from '../../../../shared/ime/transliterate';
import { hiraganaToKatakana, kanaConsumes, romajiToHiragana } from '../../../../shared/ime/kana';
import { HANGUL_LAYOUT, hangulConsumes, hangulFromKeys } from '../../../../shared/ime/hangul';
import type { LanguageSummary } from '../../../../shared/types';

// Answer box for the foreign language with the language's input method:
// letter buttons, phonetic Latin → script, pinyin, romaji → kana/kanji or
// 2-set Hangul. Composition happens at the end of the text.

const PAGE_SIZE = 9;
const indexCache = new Map<string, Promise<PreparedEntry[]>>();

// What the answer box needs to know about the language typed (IPA is typed
// like a language too).
export type TypingLanguage = Pick<
  LanguageSummary,
  'id' | 'code' | 'locale' | 'rtl' | 'inputMethod' | 'extraCharacters' | 'autoCharacters' | 'wordCount' | 'definedWordCount'
>;

function useInputIndex(language: TypingLanguage, method: ResolvedInputMethod): PreparedEntry[] | null {
  const [entries, setEntries] = useState<PreparedEntry[] | null>(null);
  const needed = method === 'pinyin' || method === 'japanese';
  const key = `${language.id}:${method}:${language.wordCount}:${language.definedWordCount}`;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    let pending = indexCache.get(key);
    if (!pending) {
      pending = api
        .inputIndex(language.id)
        .then((index) => prepareEntries(index.entries, method === 'pinyin' ? 'pinyin' : 'japanese'))
        .catch(() => []);
      indexCache.set(key, pending);
    }
    void pending.then((prepared) => !cancelled && setEntries(prepared));
    return () => {
      cancelled = true;
    };
  }, [key, needed, language.id, method]);
  return needed ? entries : null;
}

function storedEnabled(langId: string): boolean {
  try {
    return localStorage.getItem(`lang.ime.${langId}`) !== 'off';
  } catch {
    return true;
  }
}

function methodLabel(method: ResolvedInputMethod, code: string): string {
  switch (method) {
    case 'pinyin':
      return '拼音';
    case 'japanese':
      return 'かな';
    case 'hangul':
      return '한글';
    case 'phonetic': {
      const base = code.split('-')[0];
      if (base === 'ipa') return 'IPA';
      if (base === 'el') return 'Ελλ';
      if (['hi', 'mr', 'ne'].includes(base)) return 'देव';
      return 'Кир';
    }
    default:
      return '';
  }
}

function japaneseCandidates(entries: PreparedEntry[], kana: string): string[] {
  if (!kana || /[a-z]/i.test(kana)) return kana ? [kana] : [];
  const exact = entries.filter((entry) => entry.full === kana).sort((a, b) => a.rank - b.rank).map((entry) => entry.text);
  const completions = searchCandidates(entries, kana, 40);
  return [...new Set([...exact, kana, hiraganaToKatakana(kana), ...completions])];
}

export interface ForeignInputProps {
  language: TypingLanguage;
  value: string;
  onChange: (value: string) => void;
  // Enter with nothing being composed (the final text is passed along).
  onEnter?: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  showHelp?: boolean;
  // Letter buttons even while typing converts (the IPA keyboard).
  alwaysShowLetters?: boolean;
  // Shift + click on a letter button gives its capital (not for IPA).
  capitals?: boolean;
}

export default function ForeignInput({
  language,
  value,
  onChange,
  onEnter,
  inputRef: externalRef,
  className = '',
  placeholder,
  readOnly = false,
  disabled = false,
  autoFocus = false,
  showHelp = true,
  alwaysShowLetters = false,
  capitals = true,
}: ForeignInputProps) {
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? localRef;
  const method = resolveInputMethod(language.inputMethod, language.code);
  const scheme = method === 'phonetic' ? phoneticScheme(language.code) : null;
  const [enabled, setEnabled] = useState(() => storedEnabled(language.id));
  const [pending, setPending] = useState('');
  const [page, setPage] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const entries = useInputIndex(language, method);
  const composing = enabled && isComposingMethod(method) && !readOnly && !disabled;
  const hasCandidates = method === 'pinyin' || method === 'japanese';

  // Leaving the answer (next question, read-only feedback) drops any composition.
  useEffect(() => {
    if (readOnly || disabled) setPending('');
  }, [readOnly, disabled]);

  const preview = useMemo(() => {
    if (!pending) return '';
    if (method === 'phonetic' && scheme) return transliterate(pending, scheme);
    if (method === 'hangul') return hangulFromKeys(pending);
    if (method === 'japanese') return romajiToHiragana(pending);
    return pending;
  }, [pending, method, scheme]);

  const candidates = useMemo(() => {
    if (!pending || !hasCandidates) return [];
    if (method === 'pinyin') return searchCandidates(entries ?? [], pending, 90);
    return japaneseCandidates(entries ?? [], romajiToHiragana(pending, true));
  }, [pending, hasCandidates, method, entries]);
  const pageCount = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const visible = candidates.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // While composing, the caret stays at the end of the text.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && pending && document.activeElement === input) {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  });

  const finalText = (choice?: number): string => {
    if (!pending) return '';
    if (method === 'phonetic' && scheme) return transliterate(pending, scheme);
    if (method === 'hangul') return hangulFromKeys(pending);
    if (method === 'japanese') return choice !== undefined && candidates[choice] ? candidates[choice] : romajiToHiragana(pending, true);
    return choice !== undefined && candidates[choice] ? candidates[choice] : pending;
  };

  const commit = (choice?: number, append = ''): string => {
    const next = value + finalText(choice) + append;
    setPending('');
    setPage(0);
    onChange(next);
    return next;
  };

  const consumes = (key: string): boolean => {
    if (method === 'phonetic' && scheme) return phoneticConsumes(scheme, key);
    if (method === 'hangul') return hangulConsumes(key);
    if (method === 'japanese') return kanaConsumes(key);
    if (method === 'pinyin') return pinyinConsumes(key);
    return false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // An input method of the operating system is composing: leave it alone.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    // A finished answer: keys go to the page (e.g. Enter to continue).
    if (readOnly || disabled) return;
    const key = event.key;
    // Keys used here never reach the shortcuts of the page as well.
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (composing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (consumes(key) && !(pending === '' && key === "'")) {
        handled();
        setPending((current) => current + key);
        setPage(0);
        return;
      }
      if (pending) {
        if (key === 'Backspace') {
          handled();
          setPending((current) => current.slice(0, -1));
          setPage(0);
          return;
        }
        if (key === 'Escape') {
          handled();
          if (hasCandidates) setPending('');
          else commit();
          return;
        }
        if (hasCandidates && /^[1-9]$/.test(key) && visible[Number(key) - 1]) {
          handled();
          commit(page * PAGE_SIZE + Number(key) - 1);
          return;
        }
        if (hasCandidates && ['ArrowDown', 'PageDown', '='].includes(key)) {
          handled();
          setPage((current) => Math.min(pageCount - 1, current + 1));
          return;
        }
        if (hasCandidates && ['ArrowUp', 'PageUp'].includes(key)) {
          handled();
          setPage((current) => Math.max(0, current - 1));
          return;
        }
        if (key === ' ') {
          handled();
          if (hasCandidates) commit(candidates.length ? 0 : undefined);
          else commit(undefined, ' ');
          return;
        }
        if (key === 'Enter') {
          handled();
          // Pinyin / kana: Enter only ends the composition. Other methods
          // finish the word and submit in one go.
          if (hasCandidates) commit(method === 'pinyin' && candidates.length ? 0 : undefined);
          else onEnter?.(commit());
          return;
        }
        if (key.length === 1) {
          handled();
          commit(hasCandidates && candidates.length ? 0 : undefined, key);
          return;
        }
        commit();
      }
    }
    if (key === 'Enter' && onEnter) {
      handled();
      onEnter(value);
    }
  };

  const insert = (char: string) => {
    const input = inputRef.current;
    if (pending) {
      // What is being composed is finished first; the letter goes after it.
      const next = commit(undefined, char);
      requestAnimationFrame(() => {
        input?.focus();
        input?.setSelectionRange(next.length, next.length);
      });
      return;
    }
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    onChange(value.slice(0, start) + char + value.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + char.length, start + char.length);
    });
  };

  const toggle = () => {
    const next = !enabled;
    if (!next && pending) commit();
    setEnabled(next);
    try {
      localStorage.setItem(`lang.ime.${language.id}`, next ? 'on' : 'off');
    } catch {
      // storage unavailable
    }
    inputRef.current?.focus();
  };

  const showLetters = alwaysShowLetters || method === 'letters' || (isComposingMethod(method) && !enabled);
  const letters = useMemo(() => (showLetters ? typingCharacters(language) : []), [showLetters, language]);
  const label = methodLabel(method, language.code);

  return (
    <div className="foreign-input">
      <div className="foreign-input-row">
        <input
          ref={inputRef}
          className={className}
          value={value + preview}
          onChange={(event) => {
            setPending('');
            onChange(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => pending && !hasCandidates && commit()}
          readOnly={readOnly}
          disabled={disabled}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          lang={language.code === 'ipa' ? 'und-fonipa' : language.code}
          dir={language.rtl ? 'rtl' : 'ltr'}
        />
        {isComposingMethod(method) && !readOnly && (
          <button
            type="button"
            className={`ime-toggle ${enabled ? 'on' : ''}`}
            title={enabled ? 'Typing converts Latin letters — click to type directly' : 'Click to convert Latin letters while typing'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggle}
          >
            {enabled ? label : 'A'}
          </button>
        )}
        {showHelp && isComposingMethod(method) && !readOnly && (
          <button type="button" className="icon-button" title="How to type" onMouseDown={(e) => e.preventDefault()} onClick={() => setHelpOpen(!helpOpen)}>
            <HelpCircle size={18} />
          </button>
        )}
      </div>
      {composing && pending && hasCandidates && (
        <div className="ime-candidates" role="listbox">
          <span className="ime-reading">{method === 'japanese' ? romajiToHiragana(pending) : pending}</span>
          {visible.length === 0 && <span className="muted">{entries ? 'no match' : 'loading…'}</span>}
          {visible.map((candidate, index) => (
            <button
              key={`${candidate}-${index}`}
              type="button"
              className={index === 0 && page === 0 ? 'first' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(page * PAGE_SIZE + index)}
              lang={language.code}
            >
              <sup>{index + 1}</sup>
              {candidate}
            </button>
          ))}
          {pageCount > 1 && (
            <span className="muted">
              {page + 1}/{pageCount} ↓
            </span>
          )}
        </div>
      )}
      {!readOnly && letters.length > 0 && (
        <ExtraCharacters characters={letters} inputRef={inputRef} onInsert={insert} rtl={language.rtl} capitals={capitals} />
      )}
      {helpOpen && <InputHelp method={method} code={language.code} />}
    </div>
  );
}

function InputHelp({ method, code }: { method: ResolvedInputMethod; code: string }) {
  if (method === 'pinyin') {
    return (
      <div className="ime-help">
        Type pinyin without tones (ü = v): <kbd>xuesheng</kbd> → 学生. Initials work too: <kbd>xs</kbd>. <kbd>Space</kbd> picks the
        first word, <kbd>1</kbd>–<kbd>9</kbd> pick another, <kbd>↓</kbd> shows more, <kbd>Enter</kbd> keeps the letters, <kbd>Esc</kbd>{' '}
        cancels. Words come from your vocabulary.
      </div>
    );
  }
  if (method === 'japanese') {
    return (
      <div className="ime-help">
        Type romaji: <kbd>nihongo</kbd> → にほんご. <kbd>Space</kbd> picks the first suggestion (kanji from your vocabulary),{' '}
        <kbd>1</kbd>–<kbd>9</kbd> choose, <kbd>Enter</kbd> keeps the kana. <kbd>nn</kbd> or <kbd>n'</kbd> → ん, double consonants → っ,{' '}
        <kbd>-</kbd> → ー.
      </div>
    );
  }
  if (method === 'hangul') {
    return (
      <div className="ime-help">
        <p>Standard Korean 2-set layout. Shift gives ㄲ ㄸ ㅃ ㅆ ㅉ ㅒ ㅖ.</p>
        <div className="ime-table">
          {Object.entries(HANGUL_LAYOUT).map(([key, jamo]) => (
            <span key={key}>
              <kbd>{key}</kbd> {jamo}
            </span>
          ))}
        </div>
      </div>
    );
  }
  const scheme = phoneticScheme(code);
  if (!scheme) return null;
  return (
    <div className="ime-help">
      {scheme.id === 'ipa' ? (
        <p>
          X-SAMPA: IPA typed with plain keys. Upper and lower case are different sounds (<kbd>s</kbd> s, <kbd>S</kbd> ʃ), and{' '}
          <kbd>\</kbd> or <kbd>`</kbd> after a letter give more (<kbd>r\</kbd> ɹ, <kbd>t`</kbd> ʈ). Or click the symbols. Type{' '}
          <kbd>|</kbd> to keep keys apart.
        </p>
      ) : (
        <p>
          Type with Latin letters; the longest match wins. Type <kbd>|</kbd> between letters to keep them apart.
        </p>
      )}
      <div className="ime-table">
        {phoneticHelp(scheme).map(([latin, output]) => (
          <span key={latin + output}>
            <kbd>{latin}</kbd> {output}
          </span>
        ))}
      </div>
    </div>
  );
}
