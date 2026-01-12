import NavButtons from "../../components/NavButtons";
import { useState, useEffect } from "react";

const TOTAL_GROUPS = 143;

async function getQuestion(n: number) {
    if (n === 0) return null;
    try {
        const response = await fetch(`http://localhost:3000/api/spanish/myEndpoint?groupSubset=${n}`);
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

export default function ForeignWordPickEnglishList() {

    const [selected, setSelected] = useState(null);
    const [maxGroupIndex, setMaxGroupIndex] = useState(1);
    const [question, setQuestion] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [correctIndex, setCorrectIndex] = useState(null);

    function loadNewQuestion() {
        let isMounted = true;
        setLoading(true);
        setError(null);

        getQuestion(maxGroupIndex)
            .then(data => {
                if (isMounted) {
                    if (data) {
                        setQuestion(data);
                        setCorrectIndex(data.correctIndex);
                    } else {
                        setError("Could not load question data.");
                    }
                    setLoading(false);
                }
            })
            .catch(err => {
                if (isMounted) {
                    setError(err.message);
                    setLoading(false);
                }
            });

        return () => { isMounted = false; };
    }

    useEffect(loadNewQuestion, [maxGroupIndex]);

    function selectAnswer(i: number) {
        if (selected !== null || loading || error) return;

        setSelected(i);

        if (i === correctIndex) {
            setTimeout(() => {
                setSelected(null);
                console.log("here");
                loadNewQuestion();
            }, 500);
        } else {

        }
    }

    function goto(n) {
        setSelected(null);
    }

    return (
        <div className="page">
            <NavButtons />

            <h1 className="page-title">Recognition: Given Foreign Word Pick English Word From List</h1>

            <div className="input-row">
                <label>Choose words from up to group x:</label>
                <input
                    type="number"
                    min={1}
                    max={TOTAL_GROUPS}
                    value={maxGroupIndex}
                    onChange={(e) => setMaxGroupIndex(Number(e.target.value))}
                />
            </div>

            <div className="question">
                {question?.text ?? ''}
            </div>

            <div className="answers">
                {question?.answers.map((a, i) => {
                    let className = "answer";
                    if (selected !== null) {
                        if (i === question.correctIndex) className += " correct";
                        else if (i === selected) className += " wrong";
                    }

                    return (
                        <button
                            key={i}
                            className={className}
                            onClick={() => selectAnswer(i)}
                        >
                            {a}
                        </button>
                    );
                })}
            </div>

            <div className="nav-arrows">
                <button
                    onClick={() => goto(Math.max(1, maxGroupIndex - 1))}
                    disabled={maxGroupIndex === 1}
                >
                    ←
                </button>

                <button
                    onClick={() => goto(Math.min(TOTAL_GROUPS, maxGroupIndex + 1))}
                    disabled={maxGroupIndex === TOTAL_GROUPS}
                >
                    →
                </button>
            </div>
        </div>
    );
}
