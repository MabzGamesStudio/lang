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
            const stmt = db.prepare(`
                SELECT * FROM words_list 
                WHERE language = ? 
                AND frequency_group_rank <= ? 
                ORDER BY recognition_level ASC, RANDOM()
                LIMIT ?
            `);

            // 2. Execute it synchronously
            const rows = stmt.all(language, groupSubset, items);

            // 3. Send the response
            res.json(rows);
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

    app.put("/api/wordsList/:wordId/:levelType/:result", (req, res) => {
        const { wordId, levelType, result } = req.params;

        try {

            let variableName;
            switch (levelType) {
                case 'recognition':
                    variableName = 'recognition_level';
                    break;
                case 'recall':
                    variableName = 'recall_level';
                    break;
                case 'recite':
                    variableName = 'recite_level';
                    break;
                case 'translate':
                    variableName = 'translate_level';
                    break;
                default:
                    res.status(400).json({ error: "Level type invalid" });
                    break;
            }

            const levelTypeResult = `${levelType}|${result}`;
            let changeValue = 0;
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
                    changeValue = '- 2';
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
                    changeValue = '- 2';
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

    return app;
}