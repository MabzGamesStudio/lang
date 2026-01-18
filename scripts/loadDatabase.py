import csv
import os
import sqlite3

LANGUAGE = 'spanish'

DB_PATH = "../langData/app.db"
CSV_PATH = f"../langData/{LANGUAGE}/1000Words/1000Words.csv"
IMAGE_DATA_FOLDER_PATH = f"../langData/images"

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
    recognition_level INTEGER,
    recall_level INTEGER,
    recite_level INTEGER,
    translate_level INTEGER,
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
            0,
            0,
            0,
            0,
        )
        for idx, r in enumerate(reader, 1)
    ]

insert_sql = """
INSERT OR REPLACE INTO words_list
(id, language, frequency_rank, frequency_group_rank, english_value, foreign_value, recognition_level, recall_level, recite_level, translate_level, image_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
"""

cur.executemany(insert_sql, rows)

# Iterate through the files in the folder

images_added = 0
for filename in os.listdir(IMAGE_DATA_FOLDER_PATH):
    if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp')):
        file_path = os.path.join(IMAGE_DATA_FOLDER_PATH, filename)
        
        try:
            with open(file_path, "rb") as file:
                binary_data = file.read()

            cur.execute(
                "INSERT INTO image_data (image_description, data) VALUES (?, ?)",
                (filename[:filename.find('.')], binary_data)
            )
            images_added += 1
            
        except Exception as e:
            print(f"Failed to insert {filename}: {e}")

conn.commit()
conn.close()

print(f"Inserted {len(rows)} rows into words_list")
print(f"Inserted {images_added} rows into image_data")
