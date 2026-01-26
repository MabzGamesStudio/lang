import NavButtons from "../../components/NavButtons";
import { useState, useEffect } from "react";
import { wordService } from '../../services/wordsListService';

const TOTAL_GROUPS = 143;

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

        if (!data.image || !data.words) {
            return null;
        }

        const response2 = await fetch(`http://localhost:3000/api/spanish/wordList?groupSubset=${n}&items=${items}`);

        if (!response2.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data2 = await response2.json();

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
            correctAnswerId: correctAnswerId,
            otherAnswers: data2.map((entry) => {
                return {
                    text: entry.foreign_value,
                    id: entry.id
                };
            })
        };

    } catch (error) {
        console.error("Failed to fetch question:", error);
        return null;
    }
}

export default function ImagePickForeignList() {
    // 1. New State Structure
    const [history, setHistory] = useState([]); // Array of question objects
    const [pointer, setPointer] = useState(-1);  // Index of the visible question

    const [selected, setSelected] = useState(null);
    const [maxGroupIndex, setMaxGroupIndex] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [perfectUpToIndex, setPerfectUpToIndex] = useState(false);

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

    useEffect(() => {
        if (history.length === 0) fetchAndAppendQuestion();
    }, []);

    useEffect(() => {
        updateStarIfPerfect()
    }, [maxGroupIndex]);

    async function updateStarIfPerfect() {
        setPerfectUpToIndex(await wordService.getIsPerfect('spanish', 'recognition', maxGroupIndex));
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

    function selectAnswer(answerText) {
        if (selected !== null || loading || !currentQuestion) return;

        setSelected(answerText);

        const isCorrect = currentQuestion.answers.map(entry => entry.foreign_value).includes(answerText);
        if (isCorrect) {
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

        const combinedAnswerData = [{ text: currentQuestion.correctAnswerText, id: currentQuestion.correctAnswerId }, ...currentQuestion.otherAnswers];
        const userAnswer = combinedAnswerData.find(entry => entry.text === answerText);
        wordService.postRecognitionAnswerResult(
            isCorrect,
            currentQuestion.correctAnswerId,
            userAnswer.id)
            .then(updateStarIfPerfect);
    }

    function getAnswersFromResponse(questionData) {
        if (!questionData?.answers) {
            return null;
        }

        const allAnswers = [questionData.correctAnswerText, ...questionData.otherAnswers.map(entry => entry.text)];
        const shuffledAnswers = allAnswers.sort((a, b) => a.localeCompare(b));

        return shuffledAnswers.map((answerText, i) => {
            let className = "answer";
            if (selected !== null) {
                if (questionData.answers.map(entry => entry.foreign_value).includes(answerText) && selected === answerText) {
                    className += " correct";
                } else if (selected === answerText) {
                    className += " wrong";
                }
            }
            return (<button
                key={`answer-${i}`}
                className={className}
                onClick={() => selectAnswer(answerText)}
            >
                {answerText}
            </button>)
        });
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
                    value={maxGroupIndex.toString()}
                    onChange={editGroup}
                />
                {perfectUpToIndex && <div>★</div>}
            </div>

            <div className="question">
                {currentQuestion?.image ? <img src={currentQuestion.image} className="question-image" /> : <div>No images could be fetched, increase the group index to include more words, and click the next arrow to try to fetch again</div>}
            </div>

            <div className="answers">
                {getAnswersFromResponse(currentQuestion)}
            </div>

            <div className="nav-arrows">
                <button onClick={goBack} disabled={pointer <= 0}>←</button>
                <button onClick={goForward} disabled={pointer > history.length - 1}>→</button>
            </div>
        </div>
    );
}