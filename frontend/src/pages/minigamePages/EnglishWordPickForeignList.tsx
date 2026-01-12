import NavButtons from "../../components/NavButtons";
import { useState, useEffect } from "react";

const TOTAL_GROUPS = 143;

async function getQuestion(n: number, items: number = 4) {
    if (n === 0) return null;
    try {
        const response = await fetch(`http://localhost:3000/api/spanish/wordList?groupSubset=${n}&items=${items}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        const randomIndex = Math.floor(Math.random() * data.length);
        const target = data[randomIndex];

        return {
            text: target.foreign_value,
            answers: data.map(item => item.english_value),
            correctIndex: randomIndex
        };
    } catch (error) {
        console.error("Failed to fetch question:", error);
        return null;
    }
}

export default function EnglishWordPickForeignList() {
    // 1. New State Structure
    const [history, setHistory] = useState([]); // Array of question objects
    const [pointer, setPointer] = useState(-1);  // Index of the visible question

    const [selected, setSelected] = useState(null);
    const [maxGroupIndex, setMaxGroupIndex] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

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
                setSelected(null);
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

    function editGroup(event) {
        const inputValue = event.target.value;
        if (isNaN(inputValue) || inputValue === "") {
            setMaxGroupIndex(0);
            return;
        }
        if (inputValue < 0) {
            setMaxGroupIndex(0);
            return;
        }
        if (inputValue > TOTAL_GROUPS) {
            setMaxGroupIndex(TOTAL_GROUPS);
            return;
        }
        setMaxGroupIndex(Number(inputValue).toFixed(0));
    }

    function selectAnswer(i) {
        if (selected !== null || loading || !currentQuestion) return;

        setSelected(i);

        if (i === currentQuestion.correctIndex) {
            setTimeout(() => {
                // Only load a NEW one if we are at the end of history
                if (pointer === history.length - 1) {
                    fetchAndAppendQuestion();
                } else {
                    // Just move forward in existing history
                    setPointer(p => p + 1);
                    setSelected(null);
                }
            }, 300);
        }
    }

    // Navigation Handlers
    const goBack = () => {
        if (pointer > 0) {
            setPointer(pointer - 1);
            setSelected(null); // Reset selection view for historical questions
        }
    };

    const goForward = () => {
        if (pointer === history.length - 1) {
            fetchAndAppendQuestion();
            return;
        }
        if (pointer < history.length - 1) {
            setPointer(pointer + 1);
            setSelected(null);
        }
    };

    return (
        <div className="page">
            <NavButtons />

            <h1 className="page-title">Recognition: Given Foreign Word Pick English Word From List</h1>

            <div className="input-row">
                <label>Choose words from up to group (1-143):</label>
                <input
                    type="number"
                    min={1}
                    max={TOTAL_GROUPS}
                    value={maxGroupIndex}
                    onChange={editGroup}
                />
            </div>

            <div className="question">
                {currentQuestion?.text}
            </div>

            <div className="answers">
                {currentQuestion?.answers.map((a, i) => {
                    let className = "answer";
                    if (selected !== null) {
                        if (i === currentQuestion.correctIndex) className += " correct";
                        else if (i === selected) className += " wrong";
                    }
                    return (
                        <button key={i} className={className} onClick={() => selectAnswer(i)}>
                            {a}
                        </button>
                    );
                })}
            </div>

            <div className="nav-arrows">
                <button onClick={goBack} disabled={pointer <= 0}>←</button>
                <button onClick={goForward} disabled={pointer > history.length - 1}>→</button>
            </div>
        </div>
    );
}
