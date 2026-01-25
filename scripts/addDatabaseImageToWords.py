import sqlite3

DB_NAME = "../langData/app.db"

# --- Configuration ---
# Format: (english_word_in_words_list, description_in_image_data)
DATA_TO_LINK = [
    ("dark", "night"),
]

def link_words_to_images():
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()

        for word, description in DATA_TO_LINK:
            # 1. Fetch the ID from image_data using the description
            cursor.execute(
                "SELECT id FROM image_data WHERE image_description = ?", 
                (description,)
            )
            result = cursor.fetchone()

            if result:
                image_id = result[0]
                
                # 2. Update words_list where the english_value matches the word
                cursor.execute(
                    "UPDATE words_list SET image_id = ? WHERE english_value = ?",
                    (image_id, word)
                )
                
                if cursor.rowcount > 0:
                    print(f"Linked '{word}' to Image ID {image_id} '{description}'")
                else:
                    print(f"Image found, but no entry for '{word}' exists in words_list.")
            else:
                print(f"Error: No image found with description '{description}'")

        conn.commit()
        print("\nUpdate process complete.")

    except sqlite3.Error as e:
        print(f"An error occurred: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    link_words_to_images()