import csv
import sqlite3
import asyncio
import edge_tts

LANGUAGE = 'spanish'

DB_PATH = "../langData/app.db"
CSV_PATH = f"../langData/{LANGUAGE}/1000Words/1000Words.csv"

BATCH_SIZE = 50

async def get_audio_bytes(text, voice):
    """Generates audio and returns the raw binary data (blob)."""
    if not text:
        return None
    communicate = edge_tts.Communicate(text, voice)
    audio_data = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data += chunk["data"]

    return audio_data

async def process_csv():
    # Define voices
    # Use 'en-US-GuyNeural' for English (Male)
    # Use 'es-ES-ElviraNeural' for Spanish (Female) - adjust based on your 'language' column
    EN_VOICE_MALE = "en-US-GuyNeural"
    EN_VOICE_FEMALE = "en-US-AvaNeural"
    FOREIGN_VOICE_MALE = "es-ES-AlvaroNeural"
    FOREIGN_VOICE_FEMALE = "es-ES-ElviraNeural"

    rows_to_update = []

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()

        counter = 0
        for row in reader:
            print(f"Generating audio for: {row['english_value']}...")
            
            # Generate audio blobs
            en_male_blob = await get_audio_bytes(row['english_value'], EN_VOICE_MALE)
            foreign_male_blob = await get_audio_bytes(row['foreign_value'], FOREIGN_VOICE_MALE)
            en_female_blob = await get_audio_bytes(row['english_value'], EN_VOICE_FEMALE)
            foreign_female_blob = await get_audio_bytes(row['foreign_value'], FOREIGN_VOICE_FEMALE)

            rows_to_update.append((
                en_male_blob,
                foreign_male_blob,
                en_female_blob,
                foreign_female_blob,
                row.get('foreign_value'),
                LANGUAGE
            ))

            counter += 1
            if counter % BATCH_SIZE == 0:

                # SQL Command
                update_sql = """
                UPDATE words_list 
                SET english_speech_male = ?, 
                    foreign_speech_male = ?, 
                    english_speech_female = ?,
                    foreign_speech_female = ?
                WHERE foreign_value = ? 
                AND language = ?;
                """
                
                # Database operations
                cur.executemany(update_sql, rows_to_update)
                conn.commit()
                print(f'Counter: {counter}')

    conn.close()

if __name__ == "__main__":
    asyncio.run(process_csv())
