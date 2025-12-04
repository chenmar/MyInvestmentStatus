import threading
import subprocess
import sys
import time
import os

# ================================
#   CONFIG
# ================================
SCRIPT_IMPORT_FEES = "import_fees_excels.py"
SCRIPT_CONVERT_JSON = "convert_fees_excels_to_json.py"
SCRIPT_EARNINGS = "earnings-loses.py"
SCRIPT_REPORT = "full_report.py"

def run_script(script_name):
    """Helper to run a script and check for errors."""
    print(f"🔹 [START] {script_name}")
    try:
        # sys.executable ensures we use the same Python interpreter (venv/conda)
        result = subprocess.run([sys.executable, script_name], check=True)
        print(f"✅ [DONE] {script_name}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ [ERROR] {script_name} failed with exit code {e.returncode}")
        return False

def pipeline_fees():
    """Branch A: Import Fees -> Convert to JSON"""
    if run_script(SCRIPT_IMPORT_FEES):
        run_script(SCRIPT_CONVERT_JSON)
    else:
        print(f"⚠️ Skipping {SCRIPT_CONVERT_JSON} because import failed.")

def pipeline_yields():
    """Branch B: Earnings/Loses"""
    run_script(SCRIPT_EARNINGS)

def main():
    start_time = time.time()
    print("🚀 --- Starting Parallel Execution ---")

    # Create threads for parallel execution
    thread_fees = threading.Thread(target=pipeline_fees, name="FeesBranch")
    thread_yields = threading.Thread(target=pipeline_yields, name="YieldsBranch")

    # Start both threads
    thread_fees.start()
    thread_yields.start()

    # Wait for both to finish
    thread_fees.join()
    thread_yields.join()

    print("--------------------------------------")
    print("⏳ Parallel processing complete. Starting Final Report...")
    print("--------------------------------------")

    # Execute Final Report
    run_script(SCRIPT_REPORT)

    elapsed = time.time() - start_time
    print(f"🏁 Total Execution Time: {elapsed:.2f} seconds")

if __name__ == "__main__":
    main()