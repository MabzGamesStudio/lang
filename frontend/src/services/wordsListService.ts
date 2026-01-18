import { apiClient } from '../apis/client';

export type LevelType = 'recognition' | 'recall' | 'recite' | 'translate';
export type ResultType = '+' | '-';

export const wordService = {

    postRecognitionAnswerResult: async (isCorrect: boolean, guessWordId: number, answerWordId: number) => {
        if (isCorrect !== (guessWordId === answerWordId)) {
            console.error('Conflicting input data');
            return;
        }

        const result = isCorrect ? '+' : '-';

        if (isCorrect) {
            const url = `http://localhost:3000/api/wordsList/${guessWordId}/recognition/${result}`;

            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Response status: ${response.status}`);
            }
        } else {
            const url1 = `http://localhost:3000/api/wordsList/${guessWordId}/recognition/${result}`;

            const response1 = await fetch(url1, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response1.ok) {
                throw new Error(`Response status: ${response1.status}`);
            }

            const url2 = `http://localhost:3000/api/wordsList/${answerWordId}/recognition/${result}`;

            const response2 = await fetch(url2, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response2.ok) {
                throw new Error(`Response status: ${response2.status}`);
            }
        }
    },

    postRecallAnswerResult: async (isCorrect: boolean, guessWordId: number) => {

        const result = isCorrect ? '+' : '-';

        const url = `http://localhost:3000/api/wordsList/${guessWordId}/recall/${result}`;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

    }
};