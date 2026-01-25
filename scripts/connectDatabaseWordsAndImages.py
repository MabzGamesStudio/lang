import sqlite3

DB_NAME = "../langData/app.db"

def link_words_to_images():
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()

        # 1. Get all images and their descriptions
        cursor.execute("SELECT id, image_description FROM image_data")
        images = cursor.fetchall()

        if not images:
            print("No images found in image_data.")
            return

        total_updated = 0

        for image_id, description in images:
            # 2. Update words_list where english_value matches the description
            # We use the description directly as the search key
            cursor.execute(
                "UPDATE words_list SET image_id = ? WHERE english_value = ?",
                (image_id, description)
            )
            
            rows_affected = cursor.rowcount
            if rows_affected > 0:
                total_updated += rows_affected

        conn.commit()
        print(f"\nFinished. Total rows updated: {total_updated}")

    except sqlite3.Error as e:
        print(f"An error occurred: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    link_words_to_images()