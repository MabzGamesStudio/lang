import { useEffect } from "react";

interface ExtraCharactersInput {
    characters: string[];
    activeInputRef: any;
    insertCharacter: (char: string) => void;
}

export default function ExtraCharacters({ activeInputRef, characters, insertCharacter }: ExtraCharactersInput) {

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