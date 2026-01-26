import express from "express";
import db from "./databaseInitialization.js";
import cors from "cors";

export function createServer() {
    const app = express();

    app.use(cors());

    app.get("/api/hello", (req, res) => {
        res.json({ message: "Hello from backend 👋" });
    });

    app.get("/api/:language/wordList", (req, res) => {
        const { language } = req.params;
        const groupSubset = parseInt(req.query.groupSubset);
        const items = parseInt(req.query.items);

        // Validate that groupSubset is a number
        if (isNaN(groupSubset)) {
            return res.status(400).json({ error: "groupSubset must be a number" });
        }

        try {
            const poolSize = items * 2;

            const stmt = db.prepare(`
                SELECT * FROM words_list 
                WHERE language = ? 
                AND frequency_group_rank <= ? 
                ORDER BY recognition_level ASC, RANDOM()
                LIMIT ?;
            `);

            const pool = stmt.all(language, groupSubset, poolSize);

            const finalSelection = [];
            const seenEnglish = new Set();
            const seenForeign = new Set();

            for (const row of pool) {
                if (finalSelection.length >= items) break;

                const english = row.english_value;
                const foreign = row.foreign_value;

                if (!seenEnglish.has(english) && !seenForeign.has(foreign)) {
                    finalSelection.push(row);
                    seenEnglish.add(english);
                    seenForeign.add(foreign);
                }
            }

            res.json(finalSelection);

        } catch (err) {
            console.error("Database Error:", err.message);
            res.status(500).json({ error: "Database error" });
        }
    });

    app.get("/api/:language/singleWord", (req, res) => {
        const { language } = req.params;
        const groupSubset = parseInt(req.query.groupSubset);

        // Validate that groupSubset is a number
        if (isNaN(groupSubset)) {
            return res.status(400).json({ error: "groupSubset must be a number" });
        }

        try {
            const stmt = db.prepare(`
                SELECT * FROM words_list 
                WHERE language = ? 
                AND frequency_group_rank <= ? 
                ORDER BY recall_level ASC, RANDOM() 
                LIMIT 1
            `);

            const rows = stmt.all(language, groupSubset)[0];

            res.json(rows);
        } catch (err) {
            console.error("Database Error:", err.message);
            res.status(500).json({ error: "Database error" });
        }
    });

    app.get("/api/:language/:levelType/:groupSubset/isPerfect", (req, res) => {
        const { language, levelType, groupSubset } = req.params;
        const perfectScore = parseInt(req.query.groupSubset ?? '3');

        if (isNaN(groupSubset) || !Number.isInteger(Number(groupSubset)) || Number(groupSubset) < 1) {
            return res.status(400).json({ error: "groupSubset must be a positive integer" });
        }

        const variableName = getDatabaseVariable(levelType);

        try {

            const stmt = db.prepare(`
                SELECT 
                    (COUNT(*) = SUM(CASE WHEN ${variableName} = ? THEN 1 ELSE 0 END)) as isPerfect
                FROM words_list
                WHERE frequency_group_rank <= ?
                AND language = ?;
            `);

            const result = stmt.get(perfectScore, groupSubset, language);

            res.json(result);
        } catch (err) {
            console.error("Database Error:", err.message);
            res.status(500).json({ error: "Database error" });
        }
    });

    app.put("/api/wordsList/:wordId/:levelType/:result", (req, res) => {
        const { wordId, levelType, result } = req.params;

        try {

            const variableName = getDatabaseVariable(levelType);
            if (variableName === null) {
                res.status(400).json({ error: "Level type invalid" });
                return;
            }

            const levelTypeResult = `${levelType}|${result}`;
            let changeValue = "";
            switch (levelTypeResult) {
                case 'recognition|+':
                    changeValue = '+ 1';
                    break;
                case 'recognition|-':
                    changeValue = '- 1';
                    break;
                case 'recall|+':
                    changeValue = '+ 1';
                    break;
                case 'recall|-':
                    changeValue = '- 1';
                    break;
                case 'recite|+':
                    changeValue = '+ 1';
                    break;
                case 'recite|-':
                    changeValue = '- 1';
                    break;
                case 'translate|+':
                    changeValue = '+ 1';
                    break;
                case 'translate|-':
                    changeValue = '- 1';
                    break;
                default:
                    res.status(400).json({ error: "Result invalid" });
                    break;
            }

            const stmt = db.prepare(`
                UPDATE words_list 
                SET ${variableName} = CASE 
                    WHEN ${variableName} ${changeValue} > 3 THEN 3
                    WHEN ${variableName} ${changeValue} < 1 THEN 1
                    ELSE ${variableName} ${changeValue}
                END
                WHERE id = ${wordId};
            `);

            stmt.run();

            res.json({
                success: true
            });
        } catch (err) {
            console.error("Database Error:", err.message);
            res.status(500).json({ error: "Database error" });
        }
    });

    app.get("/api/:language/isSynonym", (req, res) => {
        const { language } = req.params;
        const givenWord = req.query.givenWord;
        const userAnswer = req.query.userAnswer;
        const isEnglishAnswer = req.query.isEnglishAnswer;

        if (givenWord === undefined || userAnswer === undefined) {
            return res.status(400).json({ error: "givenWord and userAnswer query parameters required." });
        }

        try {

            const stmt = db.prepare(`
                SELECT EXISTS(
                    SELECT 1 
                    FROM words_list 
                    WHERE english_value = ? 
                    AND foreign_value = ?
                    AND language = ?
                ) AS is_correct;
            `);

            let result;
            if (isEnglishAnswer === "true") {
                result = stmt.get(userAnswer, givenWord, language);
            } else {
                result = stmt.get(givenWord, userAnswer, language);
            }

            res.json(result);
        } catch (err) {
            console.error("Database Error:", err.message);
            res.status(500).json({ error: "Database error" });
        }
    });

    app.get("/api/:language/image", (req, res) => {
        const { language } = req.params;
        const groupSubset = parseInt(req.query.groupSubset);

        if (isNaN(groupSubset) || groupSubset < 1 || groupSubset > 143) {
            return res.status(400).json({ error: "groupSubset must be a number from 1 to 143" });
        }

        // Query 1: Get a random word that fits criteria and has an image
        try {
            const randomWordSql = `
                SELECT image_id 
                FROM words_list 
                WHERE language = ? 
                AND frequency_group_rank <= ? 
                AND image_id IS NOT NULL 
                ORDER BY RANDOM() 
                LIMIT 1
            `;

            const row = db.prepare(randomWordSql).get(language, groupSubset);
            if (!row) return res.status(404).json({ error: "No words found with images in this range" });

            const targetImageId = row.image_id;

            // Query 2: Get the image BLOB and all foreign_values sharing that image_id
            const dataSql = `
                SELECT 
                    (SELECT data FROM image_data WHERE id = ?) as imageBlob,
                    group_concat(foreign_value || ':' || frequency_group_rank || ':' || id) as wordData
                FROM words_list 
                WHERE image_id = ?
            `;

            const dataRow = db.prepare(dataSql).get(targetImageId, targetImageId);

            const wordsArray = dataRow.wordData ? dataRow.wordData.split(',').map(item => {
                const [foreign_value, group_id, id] = item.split(':');
                return {
                    foreign_value,
                    group_id: parseInt(group_id),
                    id: parseInt(id),
                };
            }) : [];

            res.json({
                image: dataRow.imageBlob,
                words: wordsArray
            });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }

    });

    return app;
}

function getDatabaseVariable(levelType) {
    switch (levelType) {
        case 'recognition':
            return 'recognition_level';
        case 'recall':
            return 'recall_level';
        case 'recite':
            return 'recite_level';
        case 'translate':
            return 'translate_level';
        default:
            return null;
    }
}