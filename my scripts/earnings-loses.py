import os, time, json, logging
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.common.exceptions import TimeoutException, ElementClickInterceptedException, NoSuchElementException, StaleElementReferenceException

# ================================
#   CONFIG & CREDENTIALS
# ================================
# 👇 הזן כאן את הפרטים אם תרצה שהם יהיו שמורים בקוד
MY_USERNAME = ""  
MY_PASSWORD = ""  

TARGET_DIR = r"C:\Users\Chen\Desktop\code\Investments\myExcels"
LOG_DIR = os.path.join(TARGET_DIR, "logs")
OUTPUT_JSON = os.path.join(TARGET_DIR, "yields_data.json")

os.makedirs(LOG_DIR, exist_ok=True)

# ================================
#   LOGGING
# ================================
logging.basicConfig(
    filename=os.path.join(LOG_DIR, "yields_log.txt"),
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)

def wait_for_loader(driver):
    """Waits for the spinner/loader to disappear."""
    try:
        loader_loc = (By.CSS_SELECTOR, ".waiting, .loader, .loading-mask")
        if len(driver.find_elements(*loader_loc)) > 0:
             print("   ⏳ Loading data...")
             WebDriverWait(driver, 15).until(EC.invisibility_of_element_located(loader_loc))
    except:
        pass

def scrape_table_data(driver, year):
    """
    Scrapes the ui-grid table data for the specific year.
    Returns a list of dictionaries.
    """
    data = []
    try:
        # Locate rows in the ui-grid
        rows = driver.find_elements(By.CSS_SELECTOR, ".ui-grid-row")
        
        if not rows:
            print(f"   ⚠️ No rows found for year {year}")
            return []

        print(f"   📊 Found {len(rows)} rows in table.")

        for row in rows:
            try:
                # Find cells within the row
                cells = row.find_elements(By.CSS_SELECTOR, ".ui-grid-cell-contents")
                
                # Based on your HTML, we expect 6 columns:
                # 0: Month, 1: Account Value, 2: Nominal, 3: Real, 4: USD Adj, 5: Deposit/Withdrawal
                if len(cells) >= 6:
                    month_name = cells[0].text.strip()
                    
                    # Optional: Skip summary rows if strictly needed
                    # if "ת." in month_name: continue 

                    row_data = {
                        "Year": year,
                        "Month": month_name,
                        "AccountValue": cells[1].text.strip(),
                        "NominalReturn": cells[2].text.strip(),
                        "RealReturn": cells[3].text.strip(),
                        "USDAdjusted": cells[4].text.strip(),
                        "DepositWithdrawal": cells[5].text.strip()
                    }
                    data.append(row_data)
            except Exception as e:
                logging.warning(f"Error parsing row: {e}")

    except Exception as e:
        logging.error(f"Error reading table: {e}")
        print(f"   ❌ Error reading table: {e}")
    
    return data

# ================================
#   MAIN SCRIPT
# ================================

print("--- Starting Yields Export Script (JSON) ---")

if not MY_USERNAME:
    username_input = input("Username: ")
else:
    username_input = MY_USERNAME

if not MY_PASSWORD:
    password_input = input("Password: ")
else:
    password_input = MY_PASSWORD

# Chrome Options
chrome_options = Options()
script_profile_dir = os.path.join(TARGET_DIR, "chrome_profile")
chrome_options.add_argument(f"--user-data-dir={script_profile_dir}")
chrome_options.add_argument("--log-level=3") 
chrome_options.add_argument("--silent")

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
wait = WebDriverWait(driver, 60)
short_wait = WebDriverWait(driver, 10)
fast_wait = WebDriverWait(driver, 2)

driver.maximize_window()

all_years_data = []

try:
    print("🚀 Connecting to site...")
    driver.get("https://sparkmeitav.ordernet.co.il/#/auth")
    
    # --- Login ---
    try:
        user_field = wait.until(EC.visibility_of_element_located((By.NAME, "username")))
        user_field.clear()
        user_field.send_keys(username_input)
        
        pass_field = driver.find_element(By.NAME, "password")
        pass_field.clear()
        pass_field.send_keys(password_input)
        
        driver.find_element(By.ID, "btnSubmit").click()
    except:
        print("ℹ Already logged in or input error.")

    # --- Popups Handling (Robost Version) ---
    print("🛡️ Handling popups...")
    
    # 1. "Enter System" Popup
    try:
        if short_wait.until(EC.presence_of_element_located((By.CLASS_NAME, "connection-details-popup"))):
            btn = short_wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'כניסה למערכת')]")))
            driver.execute_script("arguments[0].click();", btn)
            
            # Critical: Wait for it to disappear!
            wait.until(EC.invisibility_of_element_located((By.CLASS_NAME, "connection-details-popup")))
            print("   ✅ Entered system (Popup cleared)")
    except TimeoutException:
        pass # Popup didn't appear, moving on
    except Exception as e:
        print(f"   ⚠️ Warning with system popup: {e}")

    # 2. "Statement/Close & Continue" Popup (Aggressive Loop)
    while True:
        try:
            # Look for "סגור והמשך"
            btn = fast_wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'סגור והמשך')]")))
            driver.execute_script("arguments[0].click();", btn)
            print("   ✅ Closed a statement popup")
            time.sleep(1) # Wait a bit for the next one or for removal
        except (TimeoutException, StaleElementReferenceException):
            break # No more popups found

    # --- Navigation to Yields ---
    print("👉 Navigating to 'Yields' tab...")
    
    # 1. Click "My Account" using JS to bypass any invisible overlays
    try:
        my_account_tab = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "a[aria-label='החשבון שלי']")))
        driver.execute_script("arguments[0].click();", my_account_tab)
    except Exception as e:
        print(f"❌ Error clicking My Account: {e}")

    # 2. Click "Yields" Tab (Avoiding "Yield Graph")
    try:
        # XPath looks for 'Yields' in the heading attribute but excludes 'Graph'
        xpath_yields = "//li[contains(@heading, 'תשואות') and not(contains(@heading, 'גרף'))]/a"
        yield_tab = wait.until(EC.presence_of_element_located((By.XPATH, xpath_yields)))
        driver.execute_script("arguments[0].click();", yield_tab)
    except Exception as e:
        print(f"❌ Error clicking Yields tab: {e}")
        driver.get("https://sparkmeitav.ordernet.co.il/#/tab/yields") 

    time.sleep(5) 

    # --- Setup View (Monthly) ---
    print("⚙️ Setting view to 'Monthly'...")
    try:
        view_select_loc = (By.CSS_SELECTOR, "select[ng-model='yieldsVM.options.selectedView']")
        view_el = wait.until(EC.presence_of_element_located(view_select_loc))
        Select(view_el).select_by_value("string:monthly")
        wait_for_loader(driver)
        time.sleep(3)
    except Exception as e:
        print(f"❌ Error setting monthly view: {e}")

    # --- Iterate Years ---
    print("📅 Scanning years...")
    
    # Find the year select element to get available options
    year_select_loc = (By.CSS_SELECTOR, "select[ng-model='yieldsVM.selectedYear']")
    year_el = wait.until(EC.presence_of_element_located(year_select_loc))
    year_options = Select(year_el).options
    
    # Extract year text strings
    years_list = [opt.text.strip() for opt in year_options]
    # Sort newest to oldest
    years_list.sort(reverse=True)
    
    print(f"   Found years: {years_list}")

    for year_str in years_list:
        try:
            print(f"🔽 Processing year: {year_str}")
            
            # Re-locate element (DOM updates)
            year_el = driver.find_element(*year_select_loc)
            Select(year_el).select_by_visible_text(year_str)
            
            # Wait for data load
            time.sleep(3)
            wait_for_loader(driver)
            
            # Scrape
            year_data = scrape_table_data(driver, year_str)
            
            if year_data:
                all_years_data.extend(year_data)
                print(f"   ✅ Saved {len(year_data)} records.")
            else:
                print(f"   ⚠️ No data found for {year_str}")
            
        except Exception as e:
            print(f"   ❌ Error processing year {year_str}: {e}")

    # --- Save JSON ---
    if all_years_data:
        print(f"💾 Saving JSON file ({len(all_years_data)} total records)...")
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(all_years_data, f, ensure_ascii=False, indent=4)
        print(f"🎉 Done! File saved at:\n{OUTPUT_JSON}")
    else:
        print("⚠️ No data collected.")

except Exception as main_e:
    print(f"🔥 Critical Error: {main_e}")
    logging.error(main_e)

finally:
    input("Press Enter to close...")
    driver.quit()