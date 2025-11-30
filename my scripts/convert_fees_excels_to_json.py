import os, pandas as pd, glob, re, json

# ================================
#   CONFIG
# ================================
# Get the directory where this script is currently located
current_script_dir = os.path.dirname(os.path.abspath(__file__))
# Set target directory to the 'temp' folder inside that directory
TEMP_DIR = os.path.join(current_script_dir, "temp")
OUTPUT_FILE = "all_transactions.json"

def extract_year_from_filename(filename):
    match = re.search(r'\d{4}', filename)
    return int(match.group(0)) if match else 2025

def main():
    print("--- Converting Excels to JSON ---")
    print(f"📂 Working Directory: {TEMP_DIR}")

    if not os.path.exists(TEMP_DIR): 
        print(f"❌ Error: 'temp' folder not found at {TEMP_DIR}")
        return
    
    # Look for Excel files
    files = glob.glob(os.path.join(TEMP_DIR, "*.xls*"))
    if not files:
        print("ℹ No Excel files found in temp folder.")
        return

    all_df = []
    print(f"🔍 Found {len(files)} files. Processing...")

    for f in files:
        # Skip temporary Excel lock files
        if os.path.basename(f).startswith("~$"): 
            continue
            
        try:
            df = pd.read_excel(f)
            df['SourceFile'] = os.path.basename(f)
            all_df.append(df)
            print(f"   ✅ Loaded: {os.path.basename(f)}")
        except Exception as e: 
            print(f"   ❌ Failed to load {os.path.basename(f)}: {e}")

    if all_df:
        full = pd.concat(all_df, ignore_index=True)
        
        # Ensure dates are strings for JSON serialization
        if 'תאריך' in full.columns: 
            full['תאריך'] = full['תאריך'].astype(str)
        
        # Define output path (inside the temp folder)
        out_path = os.path.join(TEMP_DIR, OUTPUT_FILE)
        
        full.to_json(out_path, orient='records', force_ascii=False, indent=4)
        print(f"🎉 Success! JSON saved at: {out_path}")
    else:
        print("⚠️ No data was processed.")

if __name__ == "__main__":
    main()