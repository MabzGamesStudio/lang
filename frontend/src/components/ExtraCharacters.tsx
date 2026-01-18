import { useEffect } from "react";

interface ExtraCharactersInput {
    characters: string[];
    activeInputRef: any;
}

export default function ExtraCharacters({ activeInputRef, characters }: ExtraCharactersInput) {

    const insertCharacter = (char: string) => {
        const activeElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement;

        if (!activeInputRef.current || document.activeElement !== activeInputRef.current) {
            return;
        }

        // Check if the focused element is actually a text field
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            const start = activeElement.selectionStart || 0;
            const end = activeElement.selectionEnd || 0;
            const text = activeElement.value;

            // Insert the character at the cursor position
            activeElement.value = text.substring(0, start) + char + text.substring(end);

            // Restore cursor position after character
            activeElement.setSelectionRange(start + 1, start + 1);

            // Trigger an 'input' event so React/other frameworks notice the change
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const isTargetFocused = document.activeElement === activeInputRef.current;

            if (!isTargetFocused) {
                return;
            }

            const keyNum = parseInt(event.key);
            if (!isNaN(keyNum)) {
                const index = keyNum === 0 ? 9 : keyNum - 1;

                if (characters[index]) {
                    event.preventDefault();
                    insertCharacter(characters[index]);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [characters]);

    return (

        <div className="extra-characters">
            {characters.map((char, index) => {
                const displayDigit = index === 9 ? 0 : index + 1;
                return (
                    <button
                        key={index}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertCharacter(char)}
                    >
                        <sup>{displayDigit}</sup>
                        <span>{char}</span>
                    </button>
                );
            })}
        </div>
    );
}