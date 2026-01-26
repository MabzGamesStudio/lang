import NavButtons from "../../components/NavButtons";
import { useState, useEffect, useRef } from "react";
import { wordService } from '../../services/wordsListService';
import ExtraCharacters from "../../components/ExtraCharacters";

const TOTAL_GROUPS = 143;

const SPECIAL_CHARS = ['ñ', 'á', 'é', 'í', 'ó', 'ú', 'ü'];

async function getQuestion(n: number, items: number = 3) {
    if (n === 0) return null;

    try {
        const response = await fetch(`http://localhost:3000/api/spanish/image?groupSubset=${n}`);

        if (response.status === 404) {
            return {
                image: null,
                answers: null,
                otherAnswers: null
            };
        } else if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        const base64String = btoa(
            new Uint8Array(data.image.data || data.image)
                .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        const imageSrc = `data:image/jpeg;base64,${base64String}`;

        const validCorrectAnswers = data.words.filter(
            word => word.group_id <= n
        );

        const correctEntry = validCorrectAnswers[Math.floor(Math.random() * validCorrectAnswers.length)];
        const correctAnswerText = correctEntry.foreign_value;
        const correctAnswerId = correctEntry.id;

        return {
            image: imageSrc,
            answers: data.words,
            correctAnswerText: correctAnswerText,
            correctAnswerId: correctAnswerId
        };

    } catch (error) {
        console.error("Failed to fetch question:", error);
        return null;
    }
}

export default function ImageTypeForeignWord() {
    const [history, setHistory] = useState([]); // Array of question objects
    const [pointer, setPointer] = useState(-1);  // Index of the visible question

    const [maxGroupIndex, setMaxGroupIndex] = useState<number>(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [inputValue, setInputValue] = useState("");
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isCorrect, setIsCorrect] = useState(null);
    const [perfectUpToIndex, setPerfectUpToIndex] = useState(false);

    const inputRef = useRef(null);

    // Helper: The currently visible question
    const currentQuestion = history[pointer];

    async function fetchAndAppendQuestion() {
        setLoading(true);
        try {
            const data = await getQuestion(maxGroupIndex);
            if (data) {
                setHistory(prev => {
                    const newHistory = [...prev, data];
                    // Keep only the last 10
                    if (newHistory.length > 10) newHistory.shift();
                    return newHistory;
                });
                // Move pointer to the end (the newest question)
                setPointer(prev => Math.min(prev + 1, 9));
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    // Initial load
    useEffect(() => {
        if (history.length === 0) fetchAndAppendQuestion();
    }, []);

    useEffect(() => {
    }, [inputRef]);

    useEffect(() => {

        updateStarIfPerfect()
    }, [maxGroupIndex]);

    async function updateStarIfPerfect() {
        setPerfectUpToIndex(await wordService.getIsPerfect('spanish', 'recall', maxGroupIndex));
    }

    function editGroup(event: React.ChangeEvent<HTMLInputElement>) {
        let rawValue = event.target.value;

        const digitsOnly = rawValue.replace(/\D/g, "");

        if (digitsOnly === "") {
            setMaxGroupIndex(0);
            return;
        }

        let numericValue = parseInt(digitsOnly, 10);

        if (numericValue < 0) {
            numericValue = 0;
        } else if (numericValue > TOTAL_GROUPS) {
            numericValue = TOTAL_GROUPS;
        }

        setMaxGroupIndex(Math.floor(numericValue));
    }

    // Navigation Handlers
    const goBack = () => {
        if (pointer > 0) {
            setPointer(pointer - 1);
        }
    };

    const goForward = () => {
        if (pointer === history.length - 1) {
            fetchAndAppendQuestion();
            setIsCorrect(null);
            setIsSubmitted(false);
            setInputValue('');
            inputRef.current?.focus();
            return;
        }
        if (pointer < history.length - 1) {
            setPointer(pointer + 1);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (loading || !currentQuestion) return;

        const alreadyAnswered = isSubmitted;

        setIsSubmitted(true);

        const userGuess = inputValue.trim().toLowerCase();
        const isCorrect = currentQuestion.answers.map(entry => entry.foreign_value).includes(userGuess);

        setIsCorrect(isCorrect);
        if (isCorrect) {
            setTimeout(() => {
                if (pointer === history.length - 1) {
                    fetchAndAppendQuestion();
                } else {
                    setPointer(p => p + 1);
                }
                setIsCorrect(null);
                setIsSubmitted(false);
                setInputValue('');
            }, 300);
        }

        if (!alreadyAnswered) {
            wordService.postRecallAnswerResult(isCorrect, currentQuestion.correctAnswerId)
                .then(updateStarIfPerfect);
        }
    };

    const insertCharacter = (char: string) => {

        if (!inputRef.current) return;

        const start = inputRef.current.selectionStart;
        const end = inputRef.current.selectionStart;

        // setInputValue(newValue);
        setInputValue((prev) => {
            // 'prev' is guaranteed to be the current state
            return prev.substring(0, start) + char + prev.substring(end);
        });

        // Use a timeout to reset the cursor after the state render
        setTimeout(() => {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(start + 1, start + 1);
        }, 0);
    }

    return (
        <div className="page">
            <NavButtons />

            <h1 className="page-title">Recall: Given English Word Type Foreign Word</h1>

            <div className="input-row">
                <label>Choose words from up to group (1-143):</label>
                <input
                    type="number"
                    min={1}
                    max={TOTAL_GROUPS}
                    value={maxGroupIndex.toString()}
                    onChange={editGroup}
                />
                {perfectUpToIndex && <div>★</div>}
            </div>

            <div className="question">
                {currentQuestion?.image ? <img src={currentQuestion.image} className="question-image" /> : <div>No images could be fetched, increase the group index to include more words, and click the next arrow to try to fetch again</div>}
            </div>

            <div className="answer-container">
                <form onSubmit={handleSubmit}>
                    <input
                        ref={inputRef}
                        type="text"
                        className={`answer-input ${isSubmitted ? (isCorrect ? 'correct' : 'wrong') : ''}`}
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value);
                        }}
                        autoFocus
                    />

                </form>
            </div>

            <div className="feedback-area">
                {isCorrect !== null && <p className="msg error">{currentQuestion?.correctAnswerText}</p>}
            </div>

            <div className="nav-arrows">
                <button onClick={goBack} disabled={pointer <= 0}>←</button>
                <button onClick={goForward} disabled={pointer > history.length - 1}>→</button>
            </div>
            <ExtraCharacters activeInputRef={inputRef} characters={SPECIAL_CHARS} insertCharacter={insertCharacter} />
        </div>
    );
}