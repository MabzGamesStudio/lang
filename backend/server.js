import express from "express";
import db from "./databaseInitialization.js";
import cors from "cors";

export function createServer() {
    const app = express();

    app.use(cors());

    app.get("/api/hello", (req, res) => {
        res.json({ message: "Hello from backend 👋" });
    });

    app.get("/api/:language/myEndpoint", (req, res) => {
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
                ORDER BY RANDOM() 
                LIMIT 4
            `);

            // 2. Execute it synchronously
            const rows = stmt.all(language, groupSubset);

            // 3. Send the response
            res.json(rows);
        } catch (err) {
            console.error("Database Error:", err.message);
            res.status(500).json({ error: "Database error" });
        }
    });

    return app;
}