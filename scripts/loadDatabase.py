import csv
import sqlite3

LANGUAGE = 'spanish'

DB_PATH = "../langData/app.db"
CSV_PATH = f"../langData/{LANGUAGE}/1000Words/1000Words.csv"

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

cur.execute("""
CREATE TABLE IF NOT EXISTS image_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_description TEXT NOT NULL,
    data BLOB NOT NULL
)
""")

cur.execute("""
CREATE TABLE IF NOT EXISTS words_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    language TEXT,
    frequency_rank INTEGER,
    frequency_group_rank INTEGER,
    english_value TEXT,
    foreign_value TEXT,
    packed_levels BLOB,
    image_id INTEGER,
    FOREIGN KEY (image_id) REFERENCES image_data(id)
)
""")

cur.execute("DELETE FROM words_list WHERE language = ?", (LANGUAGE,))

with open(CSV_PATH, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = [
        (
            None,
            LANGUAGE,
            idx,
            1 + (idx // 7),
            str(r["english_value"]),
            str(r["foreign_value"]),
            b'\x00\x00'
        )
        for idx, r in enumerate(reader, 1)
    ]

insert_sql = """
INSERT OR REPLACE INTO words_list
(id, language, frequency_rank, frequency_group_rank, english_value, foreign_value, packed_levels, image_id)
VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
"""

cur.executemany(insert_sql, rows)

conn.commit()
conn.close()

print(f"Inserted {len(rows)} rows into items")
