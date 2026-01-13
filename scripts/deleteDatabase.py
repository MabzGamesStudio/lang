import sqlite3

DB_PATH = "../langData/app.db"

response = input(f'Are you sure you want to delete the database? (YES)\n')
if response != 'YES':
    print('Aborting')
    exit()

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

cur.execute("""DROP TABLE IF EXISTS words_list;""")

conn.commit()
conn.close()