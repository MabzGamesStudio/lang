import { useEffect, type RefObject } from 'react';
import type { LanguageSummary } from '../../../shared/types';

// Up to this many letters are a few "extra" letters with number shortcuts; a
// longer list is a whole alphabet, shown as an on-screen keyboard.
const SHORT_LIST = 12;

function collator(locale: string): Intl.Collator {
  try {
    return new Intl.Collator(locale || undefined);
  } catch {
    return new Intl.Collator();
  }
}

// Letters offered as buttons: the language's own list, or the automatic one
// (most used first; a whole alphabet in alphabetical order, marks last).
export function typingCharacters(language: LanguageSummary): string[] {
  if (language.extraCharacters.length) return language.extraCharacters;
  const auto = language.autoCharacters;
  if (auto.length <= SHORT_LIST) return auto;
  const compare = collator(language.locale);
  const isMark = (char: string) => /^\p{M}+$/u.test(char);
  return [...auto].sort((a, b) => Number(isMark(a)) - Number(isMark(b)) || compare.compare(a, b));
}

// One-click buttons for letters that are hard to type (ñ, é, ü...). While the
// answer box is focused, digits 1-9/0 insert the first ten of a short list.
// Shift + click inserts the capital letter.
export default function ExtraCharacters({
  characters,
  inputRef,
  onInsert,
  rtl = false,
}: {
  characters: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  onInsert: (char: string) => void;
  rtl?: boolean;
}) {
  const keyboard = characters.length > SHORT_LIST;

  useEffect(() => {
    if (keyboard) return;
    const onKey = (event: KeyboardEvent) => {
      if (document.activeElement !== inputRef.current || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!/^[0-9]$/.test(event.key)) return;
      const index = event.key === '0' ? 9 : Number(event.key) - 1;
      const char = characters[index];
      if (!char) return;
      event.preventDefault();
      onInsert(event.shiftKey ? char.toLocaleUpperCase() : char);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [characters, inputRef, onInsert, keyboard]);

  if (characters.length === 0) return null;
  return (
    <div className={`extra-characters ${keyboard ? 'keyboard' : ''}`} dir={rtl ? 'rtl' : undefined}>
      {characters.map((char, index) => (
        <button
          key={char}
          type="button"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => onInsert(event.shiftKey ? char.toLocaleUpperCase() : char)}
        >
          {!keyboard && index < 10 && <sup>{index === 9 ? 0 : index + 1}</sup>}
          <span>{char}</span>
        </button>
      ))}
    </div>
  );
}
