import json
import os
import shutil
import pandas as pd
import yfinance as yf
import requests
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime

# ================================
#   Settings & Paths
# ================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMP_DIR = os.path.join(BASE_DIR, "temp")

YIELDS_FILE = os.path.join(TEMP_DIR, "yields_data.json")
TRANS_FILE = os.path.join(TEMP_DIR, "all_transactions.json")

# Ensure this matches your actual key file name
FIREBASE_KEY_FILE = os.path.join(BASE_DIR, "myinvestmentstatus-6cd1e-firebase-adminsdk-fbsvc-b032b1cb8e.json")

hebrew_months = {
    "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
    "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12
}

# ================================
#   Logic
# ================================
def get_cnn_fear_greed_index():
    print("⏳ Fetching LIVE Fear & Greed Index from CNN...")
    try:
        # Specific headers to act like a real browser
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.cnn.com/",
            "Origin": "https://www.cnn.com",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9"
        }
        url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
        
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            data = r.json()
            score = int(data['fear_and_greed_historical']['data'][-1]['y'])
            print(f"   ✅ Live Score: {score}")
            return score
        else:
            print(f"   ⚠️ API returned status {r.status_code}")
    except Exception as e:
        print(f"   ⚠️ Connection failed ({e}). Defaulting to fallback.")
    
    return 27 # Fallback to the value you saw if live fetch fails

def get_benchmarks_data(start_year=2023):
    print("⏳ Fetching real monthly benchmark data from Yahoo Finance...")
    tickers = {"SPX": "^GSPC", "NDX": "^NDX"}
    
    annual_data = {}
    monthly_data = {} 

    try:
        # Fetch monthly data
        data = yf.download(list(tickers.values()), start=f"{start_year-1}-01-01", interval="1mo", progress=False)['Adj Close']
        
        # 1. Calculate Monthly % Change
        pct_change = data.pct_change() * 100
        
        for index, row in pct_change.iterrows():
            year = index.year
            month = index.month
            spx_val = row.get(tickers["SPX"], 0.0)
            ndx_val = row.get(tickers["NDX"], 0.0)

            monthly_data[(year, month)] = {
                "SPX": round(spx_val if pd.notnull(spx_val) else 0.0, 2),
                "NDX": round(ndx_val if pd.notnull(ndx_val) else 0.0, 2)
            }

        # 2. Calculate Accurate YTD for Current Year
        # Get the last available closing price
        current_price = data.iloc[-1]
        
        # Get the closing price of the last day of the PREVIOUS year
        last_year_str = str(datetime.now().year - 1)
        prev_year_data = data.loc[last_year_str]
        if not prev_year_data.empty:
            last_close_prev_year = prev_year_data.iloc[-1]
            ytd = ((current_price / last_close_prev_year) - 1) * 100
            
            current_year = datetime.now().year
            annual_data[current_year] = {
                "SPX": round(ytd[tickers["SPX"]], 2),
                "NDX": round(ytd[tickers["NDX"]], 2)
            }
            print(f"   ✅ Calculated YTD: SPX {annual_data[current_year]['SPX']}%, NDX {annual_data[current_year]['NDX']}%")
        else:
            print("   ⚠️ Could not calculate YTD, missing previous year data.")

        return annual_data, monthly_data

    except Exception as e:
        print(f"⚠️ Warning: Failed to fetch benchmarks ({e}).")
        return {}, {}

def clean_num(x):
    if isinstance(x, (int, float)): return x
    if isinstance(x, str):
        try: return float(x.replace(',', '').replace('%', ''))
        except: return 0.0
    return 0.0

def parse_date_parts(date_str):
    try:
        parts = date_str.split('/')
        return int(parts[1]), int(parts[2])
    except: return 0, 0

def main():
    if not os.path.exists(YIELDS_FILE) or not os.path.exists(TRANS_FILE):
        print("❌ Error: JSON files not found in temp.")
        return

    print("📂 Loading Data...")
    with open(YIELDS_FILE, 'r', encoding='utf-8') as f: yields_data = json.load(f)
    with open(TRANS_FILE, 'r', encoding='utf-8') as f: trans_data = json.load(f)

    # 1. Fetch Real Data
    annual_benchmarks, monthly_benchmarks = get_benchmarks_data(start_year=2023)
    current_fear_greed = get_cnn_fear_greed_index()

    # 2. Process Yields
    df_yields = pd.DataFrame(yields_data)
    df_yields = df_yields[df_yields['Month'].isin(hebrew_months.keys())].copy()
    df_yields['MonthNum'] = df_yields['Month'].map(hebrew_months)
    df_yields['Year'] = df_yields['Year'].astype(int)
    df_yields['AccountValue'] = df_yields['AccountValue'].apply(clean_num)
    df_yields['NominalReturn'] = df_yields['NominalReturn'].apply(clean_num)

    user_yearly_returns = {}
    for year, group in df_yields.groupby('Year'):
        cum = 1.0
        for r in group['NominalReturn']: cum *= (1 + r / 100.0)
        user_yearly_returns[year] = (cum - 1.0) * 100.0

    # 3. Process Transactions
    df_trans = pd.DataFrame(trans_data)
    df_trans[['MonthNum', 'RealYear']] = df_trans['תאריך'].apply(lambda x: pd.Series(parse_date_parts(x)))
    
    # Clean Numbers
    df_trans['Commission'] = df_trans['עמלת פעולה'].apply(clean_num)
    df_trans['OtherFees'] = df_trans['עמלות נלוות'].apply(clean_num)
    df_trans['TotalTradeFees'] = df_trans['Commission'] + df_trans['OtherFees']
    
    # --- FEE FILTER ---
    # Only counts explicit management fees
    df_trans['IsMgmtFee'] = df_trans['שם נייר'].str.contains('דמי טיפול|דמי ניהול|Management Fee', na=False)
    df_trans['MgmtFeeAmount'] = df_trans.apply(lambda x: abs(clean_num(x['תמורה בשקלים'])) if x['IsMgmtFee'] else 0, axis=1)

    fees_by_year = df_trans.groupby('RealYear')[['TotalTradeFees', 'MgmtFeeAmount']].sum()

    # 4. Build Monthly Data
    monthly_details = []
    all_years = sorted(list(set(list(user_yearly_returns.keys()) + list(fees_by_year.index))))
    current_years_desc = sorted([y for y in all_years if y > 0], reverse=True)
    
    for year in current_years_desc:
        for m in range(12, 0, -1):
            yield_row = df_yields[(df_yields['Year'] == year) & (df_yields['MonthNum'] == m)]
            mask = (df_trans['RealYear'] == year) & (df_trans['MonthNum'] == m)
            m_fees = df_trans[mask]['TotalTradeFees'].sum() + df_trans[mask]['MgmtFeeAmount'].sum()
            
            if not yield_row.empty or m_fees > 0:
                user_ret = yield_row['NominalReturn'].values[0] if not yield_row.empty else 0.0
                acc_val = yield_row['AccountValue'].values[0] if not yield_row.empty else 0.0
                h_month = [k for k,v in hebrew_months.items() if v == m][0]
                
                bench_month = monthly_benchmarks.get((year, m), {"SPX": 0.0, "NDX": 0.0})

                monthly_details.append({
                    "Year": int(year),
                    "Month": h_month,
                    "User_Monthly_Return": float(user_ret),
                    "Fees_Paid_This_Month": round(m_fees, 2),
                    "Account_Value": float(acc_val),
                    # INJECT REAL BENCHMARK MONTHLY DATA
                    "SPX_Monthly_Return": bench_month["SPX"],
                    "NDX_Monthly_Return": bench_month["NDX"]
                })

    # 5. Final Output
    final_output = {
        "Fear_Greed_Score": current_fear_greed, # Explicitly adding this to root
        "Monthly_Data": monthly_details,
        "Transactions": trans_data
    }

    # Upload
    if not os.path.exists(FIREBASE_KEY_FILE):
        print(f"❌ Error: Key not found: {FIREBASE_KEY_FILE}")
        return

    try:
        if not firebase_admin._apps:
            cred = credentials.Certificate(FIREBASE_KEY_FILE)
            firebase_admin.initialize_app(cred)
        
        db = firestore.client()
        print(f"☁️ Uploading portfolio data to Firebase...")
        db.collection('portfolio').document('MjoPi7mrlERKoVDCMhzjzuxgN4F2').set(final_output)
        print("✅ Upload Successful!")
        
        print("🧹 Cleaning temp...")
        if os.path.exists(TEMP_DIR):
            shutil.rmtree(TEMP_DIR)
        print("✅ Done.")
        
    except Exception as e:
        print(f"❌ Upload Failed: {e}")

if __name__ == "__main__":
    main()