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

# המפתח עם השם הספציפי שביקשת
FIREBASE_KEY_FILE = os.path.join(BASE_DIR, "myinvestmentstatus-6cd1e-firebase-adminsdk-fbsvc-b032b1cb8e.json")

hebrew_months = {
    "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
    "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12
}

# ================================
#   Logic
# ================================
def get_cnn_fear_greed_index():
    try:
        url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=5)
        if r.status_code == 200:
            return int(r.json()['fear_and_greed_historical']['data'][-1]['y'])
    except: pass
    return 24 # Fallback

def get_dynamic_benchmarks(start_year=2014):
    print("⏳ Fetching benchmarks...")
    tickers = {"SPX": "^GSPC", "NDX": "^NDX"}
    benchmarks = {}
    try:
        data = yf.download(list(tickers.values()), start=f"{start_year-1}-12-25", progress=False)['Adj Close']
        yearly = data.resample('YE').last().pct_change() * 100
        
        current_year = datetime.now().year
        for date, row in yearly.iterrows():
            if date.year < start_year or date.year == current_year: continue
            benchmarks[date.year] = {
                "SPX": round(row[tickers["SPX"]], 2),
                "NDX": round(row[tickers["NDX"]], 2)
            }
        
        # YTD
        last_close = data.resample('YE').last().iloc[-2]
        curr_price = data.iloc[-1]
        ytd = ((curr_price / last_close) - 1) * 100
        benchmarks[current_year] = {
            "SPX": round(ytd[tickers["SPX"]], 2),
            "NDX": round(ytd[tickers["NDX"]], 2)
        }
        return benchmarks
    except:
        return { 2024: {"SPX": 25.02, "NDX": 24.88}, 2025: {"SPX": 17.81, "NDX": 8.31} }

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

def calculate_cumulative(years_list, yearly_returns):
    cum = 1.0
    for y in years_list:
        r = yearly_returns.get(y, 0.0)
        cum *= (1 + r / 100.0)
    return (cum - 1.0) * 100.0

# ================================
#   Main
# ================================
def main():
    if not os.path.exists(YIELDS_FILE) or not os.path.exists(TRANS_FILE):
        print("❌ Error: JSON files not found in temp.")
        return

    print("📂 Loading Data...")
    with open(YIELDS_FILE, 'r', encoding='utf-8') as f: yields_data = json.load(f)
    with open(TRANS_FILE, 'r', encoding='utf-8') as f: trans_data = json.load(f)

    benchmarks_yearly = get_dynamic_benchmarks()
    current_fear_greed = get_cnn_fear_greed_index()

    # Process Yields
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

    # Process Transactions
    df_trans = pd.DataFrame(trans_data)
    df_trans[['MonthNum', 'RealYear']] = df_trans['תאריך'].apply(lambda x: pd.Series(parse_date_parts(x)))
    df_trans['Commission'] = df_trans['עמלת פעולה'].apply(clean_num)
    df_trans['OtherFees'] = df_trans['עמלות נלוות'].apply(clean_num)
    df_trans['TotalTradeFees'] = df_trans['Commission'] + df_trans['OtherFees']
    df_trans['IsMgmtFee'] = df_trans['שם נייר'].str.contains('דמי טיפול|דמי ניהול|Management Fee', na=False)
    df_trans['MgmtFeeAmount'] = df_trans.apply(lambda x: abs(clean_num(x['תמורה בשקלים'])) if x['IsMgmtFee'] else 0, axis=1)

    fees_by_year = df_trans.groupby('RealYear')[['TotalTradeFees', 'MgmtFeeAmount']].sum()

    # Generate Report
    yearly_summary = []
    all_years = sorted(list(set(list(user_yearly_returns.keys()) + list(fees_by_year.index))))

    # A. Annual
    for year in all_years:
        if year == 0: continue
        bench = benchmarks_yearly.get(year, {"SPX": 0, "NDX": 0})
        trade_fees = fees_by_year.loc[year, 'TotalTradeFees'] if year in fees_by_year.index else 0
        mgmt_fees = fees_by_year.loc[year, 'MgmtFeeAmount'] if year in fees_by_year.index else 0
        
        avg_aum = 0
        if year in df_yields['Year'].values:
            avg_aum = df_yields[df_yields['Year'] == year]['AccountValue'].mean()
        
        mgmt_pct = (mgmt_fees / avg_aum * 100) if avg_aum > 0 else 0.0

        yearly_summary.append({
            "Period": str(year),
            "User_Return": round(user_yearly_returns.get(year, 0), 2),
            "SPX_Return": bench["SPX"],
            "NDX_Return": bench["NDX"],
            "Fear_Greed_Score": current_fear_greed,
            "Total_Fees_Paid": round(trade_fees + mgmt_fees, 2),
            "Management_Fees_Only": round(mgmt_fees, 2),
            "Management_Fee_Percent": round(mgmt_pct, 3),
            "Avg_AUM": round(avg_aum, 2)
        })

    # B. Trailing
    current_years_desc = sorted([y for y in all_years if y > 0], reverse=True)
    for p in [2, 3, 5, 10]:
        selected = current_years_desc[:p]
        if len(selected) < p: continue
        
        user_cum = calculate_cumulative(selected, user_yearly_returns)
        spx_cum = calculate_cumulative(selected, {y: benchmarks_yearly.get(y, {}).get("SPX", 0) for y in selected})
        ndx_cum = calculate_cumulative(selected, {y: benchmarks_yearly.get(y, {}).get("NDX", 0) for y in selected})
        
        total_fees = 0
        for y in selected:
            if y in fees_by_year.index:
                total_fees += fees_by_year.loc[y, 'TotalTradeFees'] + fees_by_year.loc[y, 'MgmtFeeAmount']

        yearly_summary.append({
            "Period": f"Last {p} Years",
            "User_Return": round(user_cum, 2),
            "SPX_Return": round(spx_cum, 2),
            "NDX_Return": round(ndx_cum, 2),
            "Fear_Greed_Score": current_fear_greed,
            "Total_Fees_Paid": round(total_fees, 2),
            "Management_Fee_Percent": "N/A"
        })

    # C. Monthly
    monthly_details = []
    for year in current_years_desc:
        for m in range(12, 0, -1):
            yield_row = df_yields[(df_yields['Year'] == year) & (df_yields['MonthNum'] == m)]
            user_ret = yield_row['NominalReturn'].values[0] if not yield_row.empty else 0.0
            acc_val = yield_row['AccountValue'].values[0] if not yield_row.empty else 0.0
            
            mask = (df_trans['RealYear'] == year) & (df_trans['MonthNum'] == m)
            m_fees = df_trans[mask]['TotalTradeFees'].sum() + df_trans[mask]['MgmtFeeAmount'].sum()
            
            if not yield_row.empty or m_fees > 0:
                h_month = [k for k,v in hebrew_months.items() if v == m][0]
                monthly_details.append({
                    "Year": int(year),
                    "Month": h_month,
                    "User_Monthly_Return": float(user_ret),
                    "Fees_Paid_This_Month": round(m_fees, 2),
                    "Account_Value": float(acc_val)
                })

    final_output = {
        "Summary_By_Period": yearly_summary,
        "Monthly_Data": monthly_details
    }

    # 5. Upload
    if not os.path.exists(FIREBASE_KEY_FILE):
        print(f"❌ Error: Key not found: {FIREBASE_KEY_FILE}")
        return

    try:
        if not firebase_admin._apps:
            cred = credentials.Certificate(FIREBASE_KEY_FILE)
            firebase_admin.initialize_app(cred)
        
        db = firestore.client()
        print("☁️ Uploading to Firebase...")
        db.collection('portfolio').document('latest_report').set(final_output)
        print("✅ Upload Successful!")
        
        # 6. Cleanup
        print("🧹 Cleaning up temp...")
        shutil.rmtree(TEMP_DIR)
        print("✅ Cleaned.")
        
    except Exception as e:
        print(f"❌ Upload Failed: {e}")

if __name__ == "__main__":
    main()