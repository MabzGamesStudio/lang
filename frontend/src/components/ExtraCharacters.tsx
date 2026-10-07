import { useEffect, type RefObject } from 'react';

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
