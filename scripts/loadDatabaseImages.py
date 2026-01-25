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

cur.execute("DELETE FROM image_data")

images_added = 0
for filename in os.listdir(IMAGE_DATA_FOLDER_PATH):
    if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp')):
        file_path = os.path.join(IMAGE_DATA_FOLDER_PATH, filename)
        
        try:
            with open(file_path, "rb") as file:
                binary_data = file.read()

            filename_no_extension = filename[:filename.find('.')]
            cur.execute(
                "INSERT INTO image_data (image_description, data) VALUES (?, ?)",
                (filename_no_extension, binary_data)
            )
            images_added += 1
            
        except Exception as e:
            print(f"Failed to insert {filename}: {e}")

conn.commit()
conn.close()

print(f"Inserted {images_added} rows into image_data")
