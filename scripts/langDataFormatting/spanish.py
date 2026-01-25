import pandas as pd

def transform_csv(input_file, output_file):
    df = pd.read_csv(input_file)
    
    df_transformed = df[['Word', 'Translation']].rename(columns={
        'Word': 'foreign_value',
        'Translation': 'english_value'
    })

    # Fix spelling mistake in data source
    df_transformed.loc[df_transformed['english_value'] == 'msiter', 'english_value'] = 'mister'

    # Make everything lowercase
    df_transformed[['foreign_value', 'english_value']] = df_transformed[['foreign_value', 'english_value']].apply(lambda x: x.str.lower())

    # Save only the top 1000 entries
    df_transformed.head(1000).to_csv(output_file, index=False)
    print(f"Successfully transformed '{input_file}' to '{output_file}'")

if __name__ == "__main__":
    # Change these filenames to match your local files
    INPUT_FILENAME = '../../langData/spanish/1000Words/DataSource.csv'
    OUTPUT_FILENAME = '../../langData/spanish/1000Words/1000Words.csv'
    
    transform_csv(INPUT_FILENAME, OUTPUT_FILENAME)