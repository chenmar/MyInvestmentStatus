import json
import os
import pandas as pd
import yfinance as yf
from datetime import datetime

# ================================
#   Settings & Reference Data
# ================================

# 👇 נתיב התיקייה שבו נמצאים הקבצים שלך
TARGET_DIR = r"C:\Users\Chen\Desktop\code\Investments\myExcels"
REPORT_FILE = os.path.join(TARGET_DIR, "final_report.json")

hebrew_months = {
    "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
    "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12
}

def get_dynamic_benchmarks(start_year=2014):
    """
    Fetches yearly returns for S&P 500, Nasdaq 100, and the VIX (Fear Index) from Yahoo Finance.
    """
    print("⏳ Fetching benchmark data (SPX, NDX, VIX) from Yahoo Finance...")
    
    tickers = {
        "SPX": "^GSPC", 
        "NDX": "^NDX",
        "VIX": "^VIX" 
    }
    
    benchmarks_data = {}
    current_year = datetime.now().year
    
    try:
        start_date = f"{start_year-1}-12-25"
        data = yf.download(list(tickers.values()), start=start_date, progress=False)['Adj Close']
        
        yearly_prices = data.resample('YE').last()
        yearly_returns = yearly_prices[[tickers["SPX"], tickers["NDX"]]].pct_change() * 100
        yearly_vix = yearly_prices[tickers["VIX"]]
        
        for date, row in yearly_returns.iterrows():
            year = date.year
            if year < start_year: continue
            if year == current_year: continue

            benchmarks_data[year] = {
                "SPX": round(row[tickers["SPX"]], 2),
                "NDX": round(row[tickers["NDX"]], 2),
                "VIX_Fear_Index": round(yearly_vix.loc[date], 2)
            }
            
        # YTD Calculation
        last_year_close = yearly_prices.iloc[-2]
        current_price = data.iloc[-1]
        
        ytd_return = ((current_price / last_year_close) - 1) * 100
        
        benchmarks_data[current_year] = {
            "SPX": round(ytd_return[tickers["SPX"]], 2),
            "NDX": round(ytd_return[tickers["NDX"]], 2),
            "VIX_Fear_Index": round(current_price[tickers["VIX"]], 2)
        }
        
        print("✅ Benchmark data updated successfully.")
        return benchmarks_data

    except Exception as e:
        print(f"⚠️ Error fetching data from Yahoo Finance: {e}")
        return {
            2020: {"SPX": 18.40, "NDX": 47.58, "VIX_Fear_Index": 22.75},
            2021: {"SPX": 28.71, "NDX": 26.63, "VIX_Fear_Index": 17.22},
            2022: {"SPX": -18.11, "NDX": -32.97, "VIX_Fear_Index": 21.67},
            2023: {"SPX": 26.29, "NDX": 53.81, "VIX_Fear_Index": 12.45},
            2024: {"SPX": 25.02, "NDX": 24.88, "VIX_Fear_Index": 12.00},
            2025: {"SPX": 17.81, "NDX": 21.05, "VIX_Fear_Index": 15.00} 
        }

benchmarks_yearly = get_dynamic_benchmarks(start_year=2014)

def clean_num(x):
    if isinstance(x, (int, float)): return x
    if isinstance(x, str):
        try:
            return float(x.replace(',', '').replace('%', ''))
        except:
            return 0.0
    return 0.0

def calculate_cumulative_return(years_list, yearly_returns):
    cumulative = 1.0
    for y in years_list:
        r = yearly_returns.get(y, 0.0)
        cumulative *= (1 + r / 100.0)
    return (cumulative - 1.0) * 100.0

# ================================
#   Load Data (FIXED PATHS)
# ================================
try:
    print(f"📂 Loading JSON files from: {TARGET_DIR}")
    
    yields_path = os.path.join(TARGET_DIR, 'yields_data.json')
    transactions_path = os.path.join(TARGET_DIR, 'all_transactions.json')

    with open(yields_path, 'r', encoding='utf-8') as f:
        yields_data = json.load(f)
    with open(transactions_path, 'r', encoding='utf-8') as f:
        transactions_data = json.load(f)
        
    print("✅ Files loaded successfully.")

except FileNotFoundError as e:
    print(f"❌ Error: Could not find files in {TARGET_DIR}")
    print(f"   Details: {e}")
    exit()

# --- Process Yields Data ---
print("⚙️ Processing performance data...")
df_yields = pd.DataFrame(yields_data)
df_yields = df_yields[df_yields['Month'].isin(hebrew_months.keys())].copy()
df_yields['MonthNum'] = df_yields['Month'].map(hebrew_months)
df_yields['Year'] = df_yields['Year'].astype(int)
df_yields['AccountValue'] = df_yields['AccountValue'].apply(clean_num)
df_yields['NominalReturn'] = df_yields['NominalReturn'].apply(clean_num)

user_yearly_returns = {}
grouped_years = df_yields.groupby('Year')
for year, group in grouped_years:
    cum_year = 1.0
    for r in group['NominalReturn']:
        cum_year *= (1 + r / 100.0)
    user_yearly_returns[year] = (cum_year - 1.0) * 100.0

# --- Process Transaction/Fee Data ---
print("⚙️ Processing fees data...")
df_trans = pd.DataFrame(transactions_data)
df_trans['Year'] = df_trans['Year'].astype(int)

# Extract month
df_trans['MonthNum'] = df_trans['תאריך'].apply(lambda x: int(x.split('/')[1]) if isinstance(x, str) and '/' in x else 0)

# Convert fee columns
df_trans['Commission'] = df_trans['עמלת פעולה'].apply(clean_num)
df_trans['OtherFees'] = df_trans['עמלות נלוות'].apply(clean_num)
df_trans['TotalTradeFees'] = df_trans['Commission'] + df_trans['OtherFees']

# Identify Management Fees
df_trans['IsMgmtFee'] = df_trans['שם נייר'].str.contains('דמי טיפול|דמי ניהול|Management Fee', na=False)
df_trans['MgmtFeeAmount'] = df_trans.apply(lambda x: abs(clean_num(x['תמורה בשקלים'])) if x['IsMgmtFee'] else 0, axis=1)

fees_by_year = df_trans.groupby('Year')[['TotalTradeFees', 'MgmtFeeAmount']].sum()

# ================================
#   Generate Report
# ================================
yearly_summary = []
years = sorted(list(user_yearly_returns.keys()))

# 1. Annual Summary
print("📊 Generating Annual Summary...")
for year in years:
    user_ret = user_yearly_returns.get(year, 0.0)
    
    bench = benchmarks_yearly.get(year, {"SPX": 0.0, "NDX": 0.0, "VIX_Fear_Index": 0.0})
    spx_ret = bench.get("SPX", 0.0)
    ndx_ret = bench.get("NDX", 0.0)
    vix_val = bench.get("VIX_Fear_Index", 0.0)
    
    if year in fees_by_year.index:
        trade_fees = fees_by_year.loc[year, 'TotalTradeFees']
        mgmt_fees = fees_by_year.loc[year, 'MgmtFeeAmount']
    else:
        trade_fees = 0.0
        mgmt_fees = 0.0
        
    total_fees = trade_fees + mgmt_fees
    
    avg_aum = df_yields[df_yields['Year'] == year]['AccountValue'].mean()
    if pd.isna(avg_aum) or avg_aum == 0:
        mgmt_fee_pct = 0.0
    else:
        mgmt_fee_pct = (mgmt_fees / avg_aum) * 100.0

    yearly_summary.append({
        "Period": str(year),
        "User_Return": round(user_ret, 2),
        "SPX_Return": spx_ret,
        "NDX_Return": ndx_ret,
        "VIX_Fear_Index_YearEnd": vix_val,
        "Total_Fees_Paid": round(total_fees, 2),
        "Management_Fees_Only": round(mgmt_fees, 2),
        "Management_Fee_Percent": round(mgmt_fee_pct, 3),
        "Avg_AUM": round(avg_aum, 2)
    })

# 2. Trailing Periods
print("📊 Generating Trailing Periods Summary...")
current_years_desc = sorted(years, reverse=True)
periods = [2, 3, 5, 10]

for p in periods:
    selected_years = current_years_desc[:p]
    if len(selected_years) < p:
        continue 
        
    period_label = f"Last {p} Years ({min(selected_years)}-{max(selected_years)})"
    
    user_cum = calculate_cumulative_return(selected_years, user_yearly_returns)
    
    spx_yearly_flat = {y: benchmarks_yearly.get(y, {}).get("SPX", 0) for y in selected_years}
    ndx_yearly_flat = {y: benchmarks_yearly.get(y, {}).get("NDX", 0) for y in selected_years}
    
    spx_cum = calculate_cumulative_return(selected_years, spx_yearly_flat)
    ndx_cum = calculate_cumulative_return(selected_years, ndx_yearly_flat)
    
    vix_vals = [benchmarks_yearly.get(y, {}).get("VIX_Fear_Index", 0) for y in selected_years]
    avg_vix = round(sum(vix_vals) / len(vix_vals), 2) if vix_vals else 0

    total_fees_period = 0
    for y in selected_years:
        if y in fees_by_year.index:
            total_fees_period += fees_by_year.loc[y, 'TotalTradeFees'] + fees_by_year.loc[y, 'MgmtFeeAmount']

    yearly_summary.append({
        "Period": period_label,
        "User_Return": round(user_cum, 2),
        "SPX_Return": round(spx_cum, 2),
        "NDX_Return": round(ndx_cum, 2),
        "VIX_Avg_Fear_Index": avg_vix,
        "Total_Fees_Paid": round(total_fees_period, 2),
        "Management_Fee_Percent": "N/A"
    })

# 3. Monthly Details
print("📊 Generating Monthly Details...")
monthly_details = []
df_yields_sorted = df_yields.sort_values(by=['Year', 'MonthNum'])

for index, row in df_yields_sorted.iterrows():
    y = int(row['Year'])
    m = int(row['MonthNum'])
    
    mask_month = (df_trans['Year'] == y) & (df_trans['MonthNum'] == m)
    month_fees = df_trans[mask_month]['TotalTradeFees'].sum() + df_trans[mask_month]['MgmtFeeAmount'].sum()
    
    monthly_details.append({
        "Year": y,
        "Month": row['Month'],
        "User_Monthly_Return": row['NominalReturn'],
        "Fees_Paid_This_Month": round(month_fees, 2),
        "Account_Value": row['AccountValue']
    })

# ================================
#   Save to File
# ================================
final_output = {
    "Summary_By_Period": yearly_summary,
    "Monthly_Data": monthly_details
}

with open(REPORT_FILE, 'w', encoding='utf-8') as f:
    json.dump(final_output, f, ensure_ascii=False, indent=4)

print(f"✅ Successfully created report at: {REPORT_FILE}")