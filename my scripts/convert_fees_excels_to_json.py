import os
import pandas as pd
import glob
import re

# ================================
#   Config
# ================================
TARGET_DIR = r"C:\Users\Chen\Desktop\code\Investments\myExcels"
OUTPUT_FILE = "all_transactions.json"

def extract_year_from_filename(filename):
    """
    מנסה לחלץ שנה מתוך שם הקובץ (למשל Fees_2023.xlsx -> 2023)
    אם לא מוצא, מחזיר את שם הקובץ המלא.
    """
    match = re.search(r'\d{4}', filename)
    if match:
        return int(match.group(0))
    return filename

def main():
    print("--- Starting Merge Script (All Excels -> Single JSON) ---")
    
    if not os.path.exists(TARGET_DIR):
        print(f"❌ Error: Directory not found: {TARGET_DIR}")
        return

    # חיפוש כל קבצי האקסל
    excel_files = glob.glob(os.path.join(TARGET_DIR, "*.xlsx")) + glob.glob(os.path.join(TARGET_DIR, "*.xls"))
    
    if not excel_files:
        print("ℹ No Excel files found.")
        return

    all_data_frames = []

    print(f"Found {len(excel_files)} files. Processing...")

    for file_path in excel_files:
        filename = os.path.basename(file_path)
        
        # דילוג על קבצים זמניים
        if filename.startswith("~$"):
            continue

        try:
            # קריאת הקובץ
            df = pd.read_excel(file_path)
            
            # === שלב קריטי: הוספת זיהוי מקור ===
            # מוסיף עמודה חדשה לכל שורה עם השנה/שם הקובץ
            # זה יאפשר לך בדשבורד לפלח לפי שנים למרות שזה קובץ אחד
            year = extract_year_from_filename(filename)
            df['Year'] = year
            df['SourceFile'] = filename # אופציונלי: למקרה תקלות
            
            all_data_frames.append(df)
            print(f"   ✅ Loaded: {filename} (Year: {year})")

        except Exception as e:
            print(f"   ❌ Error loading {filename}: {e}")

    # איחוד כל הטבלאות
    if all_data_frames:
        print("\nMerging all data...")
        full_df = pd.concat(all_data_frames, ignore_index=True)
        
        # נתיב לקובץ הסופי
        output_path = os.path.join(TARGET_DIR, OUTPUT_FILE)
        
        # שמירה ל-JSON אחד גדול
        full_df.to_json(output_path, orient='records', force_ascii=False, indent=4, date_format='iso')
        
        print(f"🎉 SUCCESS! All data merged into: {output_path}")
        print(f"📊 Total Rows: {len(full_df)}")
    else:
        print("❌ No data was loaded.")

if __name__ == "__main__":
    main()