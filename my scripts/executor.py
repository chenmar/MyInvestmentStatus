import subprocess
import sys
import os
import time

# מזהה את התיקייה שבה הסקריפט רץ כדי למצוא את האחרים
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def run_script(script_name):
    """מריץ סקריפט פייתון ומחכה שיסתיים"""
    script_path = os.path.join(BASE_DIR, script_name)
    print(f"🚀 מפעיל את: {script_name}...")
    
    if not os.path.exists(script_path):
        print(f"❌ שגיאה: הקובץ {script_name} לא נמצא בתיקייה {BASE_DIR}")
        return False

    try:
        # הרצת הסקריפט והמתנה לסיום (check=True זורק שגיאה אם הסקריפט נכשל)
        subprocess.run([sys.executable, script_path], check=True)
        print(f"✅ {script_name} הסתיים בהצלחה.\n")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {script_name} נכשל או הופסק (קוד שגיאה: {e.returncode}).")
        return False
    except Exception as e:
        print(f"❌ שגיאה לא צפויה בהרצת {script_name}: {e}")
        return False

def main():
    print("=== 🏁 מתחיל תהליך אוטומציה מלא ===\n")

    # --- שלב 1: איסוף נתונים (Scrapers) ---
    # מריצים אותם אחד אחרי השני כדי לאפשר הזנת סיסמה אם צריך
    print("--- שלב 1: הורדת נתונים מהאתר ---")
    
    if not run_script("import_fees_excels.py"):
        print("⛔ התהליך נעצר עקב כישלון ב-import_fees_excels.")
        return

    if not run_script("earnings-loses.py"):
        print("⛔ התהליך נעצר עקב כישלון ב-earnings-loses.")
        return

    # --- שלב 2: עיבוד נתונים ---
    print("--- שלב 2: המרה ל-JSON ---")
    if not run_script("convert_fees_excels_to_json.py"):
        print("⛔ התהליך נעצר עקב כישלון בהמרה.")
        return

    # --- שלב 3: יצירת דוח והעלאה ---
    print("--- שלב 3: יצירת דוח סופי והעלאה לענן ---")
    if not run_script("full_report.py"):
        print("⛔ התהליך נעצר עקב כישלון ביצירת הדוח.")
        return

    print("\n✨✨✨ כל המשימות הושלמו בהצלחה! ✨✨✨")

if __name__ == "__main__":
    main()