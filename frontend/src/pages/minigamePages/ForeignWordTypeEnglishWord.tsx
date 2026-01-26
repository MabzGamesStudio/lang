import NavButtons from "../../components/NavButtons";
import { useState, useEffect, useRef } from "react";
import { wordService } from "../../services/wordsListService";

const TOTAL_GROUPS = 143;

async function getQuestion(n: number, items: number = 4) {
    if (n === 0) return null;
    try {
        const response = await fetch(`http://localhost:3000/api/spanish/singleWord?groupSubset=${n}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        return {
            text: data.foreign_value,
            answer: data.english_value,
            id: data.id
        };
    } catch (error) {
        console.error("Failed to fetch question:", error);
        return null;
    }
}

export default function ForeignWordTypeEnglishWord() {
    // 1. New State Structure
    const [history, setHistory] = useState([]); // Array of question objects
    const [pointer, setPointer] = useState(-1);  // Index of the visible question

    const [maxGroupIndex, setMaxGroupIndex] = useState(1);
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
        updateStarIfPerfect()
    }, [maxGroupIndex]);

    async function updateStarIfPerfect() {
        setPerfectUpToIndex(await wordService.getIsPerfect('spanish', 'recall', maxGroupIndex));
    }

    function editGroup(event) {
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
        setIsSubmitted(true);

        const alreadyAnswered = isSubmitted;

        const userGuess = inputValue.trim().toLowerCase()
        const expectedAnswer = currentQuestion.answer.toLowerCase();
        const questionText = currentQuestion.text.toLowerCase();
        let userCorrect = userGuess === expectedAnswer;

        if (!userCorrect) {
            try {
                const response = await fetch(`http://localhost:3000/api/spanish/isSynonym?givenWord=${questionText}&userAnswer=${userGuess}&isEnglishAnswer=true`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                userCorrect = data.is_correct === 1;
            } catch (error) {
                console.error("Failed to fetch question:", error);
                return null;
            }
        }

        setIsCorrect(userCorrect);
        if (userCorrect) {
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
            wordService.postRecallAnswerResult(userCorrect, currentQuestion.id)
                .then(updateStarIfPerfect);
        }
    };

    return (
        <div className="page">
            <NavButtons />

            <h1 className="page-title">Recall: Given Foreign Word Type English Word</h1>

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
                {currentQuestion?.text}
            </div>

            <div className="answer-container">
                <form onSubmit={handleSubmit}>
                    <input
                        ref={inputRef}
                        type="text"
                        className={`answer-input ${isSubmitted ? (isCorrect ? 'correct' : 'wrong') : ''}`}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        autoFocus
                    />

                </form>
            </div>

            <div className="feedback-area">
                {isCorrect !== null && <p className="msg error">{currentQuestion?.answer}</p>}
            </div>

            <div className="nav-arrows">
                <button onClick={goBack} disabled={pointer <= 0}>←</button>
                <button onClick={goForward} disabled={pointer > history.length - 1}>→</button>
            </div>

        </div>
    );
}