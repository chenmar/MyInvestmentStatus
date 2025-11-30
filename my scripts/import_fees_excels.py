import os, time, shutil, hashlib, logging
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
MY_USERNAME = ""  
MY_PASSWORD = ""  

DOWNLOAD_DIR = r"C:\Users\Chen\Downloads"
TARGET_DIR = r"C:\Users\Chen\Desktop\code\Investments\myExcels"
LOG_DIR = os.path.join(TARGET_DIR, "logs")
YEARS = [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]

os.makedirs(LOG_DIR, exist_ok=True)

# ================================
#   LOGGING
# ================================
log_file = os.path.join(LOG_DIR, "export_log.txt")
logging.basicConfig(
    filename=log_file,
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logging.info("=== Script started ===")

# ================================
#   UTILS
# ================================
def file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            h.update(chunk)
    return h.hexdigest()

def move_excel_with_hash(target_name):
    print("   ⏳ Waiting for file download...")
    
    downloaded_file = None
    # Wait up to 30 seconds for download
    for i in range(30):
        files = [f for f in os.listdir(DOWNLOAD_DIR) if f.endswith(".xlsx") or f.endswith(".xls")]
        if files:
            latest = max(files, key=lambda f: os.path.getctime(os.path.join(DOWNLOAD_DIR, f)))
            # Ensure download is complete (no temp extensions)
            if "crdownload" not in latest and ".tmp" not in latest:
                downloaded_file = latest
                break
        time.sleep(1)

    if not downloaded_file:
        logging.error(f"❌ No Excel file found for {target_name}")
        print("   ❌ Error: No Excel file found in downloads folder")
        return

    src = os.path.join(DOWNLOAD_DIR, downloaded_file)
    dst = os.path.join(TARGET_DIR, target_name)

    if os.path.exists(dst):
        if file_hash(src) == file_hash(dst):
            logging.info(f"ℹ File {target_name} is identical. Skipping.")
            print(f"   ℹ File {target_name} is identical. Skipping.")
            os.remove(src)
            return
        else:
            logging.info(f"🔄 Updating {target_name}...")
            print(f"   🔄 Updating file: {target_name}")
            os.remove(dst)

    shutil.move(src, dst)
    logging.info(f"✅ Saved: {target_name}")
    print(f"   ✅ Successfully saved: {target_name}")

def wait_for_loader(driver):
    """Waits for the spinner/loader to disappear"""
    try:
        loader_loc = (By.CSS_SELECTOR, ".waiting, .loader, .loading-mask")
        if len(driver.find_elements(*loader_loc)) > 0:
             print("   ⏳ Waiting for data load...")
             WebDriverWait(driver, 15).until(EC.invisibility_of_element_located(loader_loc))
    except:
        pass 

def export_excel(target_name, driver):
    logging.info(f"👉 Exporting: {target_name}")
    print(f"   📤 Attempting to export: {target_name}")
    
    wait_for_loader(driver)
    
    try:
        # 1. Open settings menu
        settings_btn = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, ".tab-module-settings-button .dropdown-toggle")))
        driver.execute_script("arguments[0].click();", settings_btn)
        
        # 2. Click Excel
        excel_btn = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "li.export.excel")))
        driver.execute_script("arguments[0].click();", excel_btn)

        move_excel_with_hash(target_name)

    except Exception as e:
        logging.error(f"❌ Export failed for {target_name}: {e}")
        print(f"   ❌ Export failed: {e}")

# ================================
#   MAIN
# ================================

print("--- Script Started ---")

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
os.makedirs(script_profile_dir, exist_ok=True)
chrome_options.add_argument(f"--user-data-dir={script_profile_dir}")
chrome_options.add_argument("--log-level=3") 
chrome_options.add_argument("--silent")

# Critical settings for automatic downloads without prompt
chrome_options.add_experimental_option("prefs", {
    "download.default_directory": DOWNLOAD_DIR,
    "download.prompt_for_download": False,
    "download.directory_upgrade": True,
    "safebrowsing.enabled": True,
    "profile.default_content_setting_values.automatic_downloads": 1  # Allow multiple downloads
})

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
wait = WebDriverWait(driver, 60)
short_wait = WebDriverWait(driver, 10)
fast_wait = WebDriverWait(driver, 2)

driver.maximize_window()

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

    # --- Popups ---
    print("🛡️ Checking for popups...")
    
    # Enter System Popup
    try:
        if short_wait.until(EC.presence_of_element_located((By.CLASS_NAME, "connection-details-popup"))):
            # Searching for Hebrew text "Entrance to system"
            btn = short_wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'כניסה למערכת')]")))
            driver.execute_script("arguments[0].click();", btn)
            wait.until(EC.invisibility_of_element_located((By.CLASS_NAME, "connection-details-popup")))
            print("   ✅ Entered system")
    except:
        pass

    # Statement (Fast Close)
    while True:
        try:
            # Searching for Hebrew text "Close and Continue"
            btn = fast_wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'סגור והמשך')]")))
            driver.execute_script("arguments[0].click();", btn)
            time.sleep(0.5)
        except:
            break

    # --- Navigation ---
    print("👉 Navigating to Transactions...")
    try:
        # Searching for "My Account"
        wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "a[aria-label='החשבון שלי']"))).click()
        # Searching for "Transactions" text
        wait.until(EC.element_to_be_clickable((By.XPATH, "//a[contains(text(), 'תנועות')]"))).click()
    except:
        driver.execute_script("document.querySelector(\"a[aria-label='החשבון שלי']\").click()")
        time.sleep(1)
        driver.execute_script("document.evaluate(\"//a[contains(text(), 'תנועות')]\", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click()")

    time.sleep(5) 

    # --- Export Logic ---
    print("📊 Starting selection and export process...")
    
    def select_option(select_locator, value_to_select):
        """Selects option safely"""
        el = wait.until(EC.presence_of_element_located(select_locator))
        select = Select(el)
        select.select_by_value(value_to_select)
        time.sleep(4)

    filter_select_loc = (By.CSS_SELECTOR, "select[ng-model='accountTransactionsVM.selectedFilter']")

    # A. Beginning of Year
    try:
        print("📅 Selecting: Beginning of year")
        select_option(filter_select_loc, "beginYear")
        wait_for_loader(driver)
        export_excel("Fees_CurrentYear.xlsx", driver)
    except Exception as e:
        print(f"❌ Error in beginning of year: {e}")

    # B. Previous Years
    try:
        print("📅 Moving to previous years...")
        select_option(filter_select_loc, "prevYears")
        
        year_select_loc = (By.CSS_SELECTOR, "select[ng-model='accountTransactionsVM.selectedYear']")

        for y in YEARS:
            try:
                print(f"   🔽 Loading year: {y}")
                el = wait.until(EC.presence_of_element_located(year_select_loc))
                select_year = Select(el)
                select_year.select_by_visible_text(str(y))
                
                time.sleep(4)
                wait_for_loader(driver)
                
                export_excel(f"Fees_{y}.xlsx", driver)
            
            except Exception as inner_e:
                print(f"   ⚠️ Skipping year {y} (Error: {inner_e})")
                continue 

    except Exception as e:
        print(f"❌ General error in previous years: {e}")

except Exception as main_e:
    print(f"🔥 Critical Error: {main_e}")

finally:
    print("✔ Script finished.")
    input("Press Enter to exit...")
    driver.quit()