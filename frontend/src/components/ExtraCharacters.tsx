import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { LanguageSummary } from '../../../shared/types';

// Letters offered as buttons: the language's own list, or the automatic one.
export function typingCharacters(language: LanguageSummary): string[] {
  return language.extraCharacters.length ? language.extraCharacters : language.autoCharacters;
}

// Inserts text at the cursor of a controlled input and keeps the focus there.
export function useInsertAtCursor(inputRef: RefObject<HTMLInputElement | null>, setValue: Dispatch<SetStateAction<string>>) {
  return useCallback(
    (char: string) => {
      const input = inputRef.current;
      if (!input) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      setValue((current) => current.slice(0, start) + char + current.slice(end));
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(start + char.length, start + char.length);
      });
    },
    [inputRef, setValue]
  );
}

// One-click buttons for letters that are hard to type (ñ, é, ü...).
// While the answer box is focused, digits 1-9/0 insert them.
export default function ExtraCharacters({
  characters,
  inputRef,
  onInsert,
}: {
  characters: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  onInsert: (char: string) => void;
}) {
  useEffect(() => {
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
  }, [characters, inputRef, onInsert]);

  if (characters.length === 0) return null;
  return (
    <div className="extra-characters">
      {characters.slice(0, 10).map((char, index) => (
        <button key={char} type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => onInsert(char)}>
          <sup>{index === 9 ? 0 : index + 1}</sup>
          <span>{char}</span>
        </button>
      ))}
    </div>
  );
}
