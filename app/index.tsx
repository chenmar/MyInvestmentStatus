import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Modal,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    UIManager,
    View
} from 'react-native';
import { BarChart, LineChart } from "react-native-gifted-charts";
import Svg, { Path } from 'react-native-svg';
import { auth, db } from '../firebaseConfig';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREEN_WIDTH = Dimensions.get('window').width;

// --- MAPPINGS ---
const HEBREW_TO_ENGLISH_MONTHS: Record<string, string> = {
    "ינואר": "Jan", "פברואר": "Feb", "מרץ": "Mar", "אפריל": "Apr",
    "מאי": "May", "יוני": "Jun", "יולי": "Jul", "אוגוסט": "Aug",
    "ספטמבר": "Sep", "אוקטובר": "Oct", "נובמבר": "Nov", "דצמבר": "Dec"
};

const HEBREW_MONTH_ORDER: Record<string, number> = {
    "ינואר": 0, "פברואר": 1, "מרץ": 2, "אפריל": 3,
    "מאי": 4, "יוני": 5, "יולי": 6, "אוגוסט": 7,
    "ספטמבר": 8, "אוקטובר": 9, "נובמבר": 10, "דצמבר": 11
};

const parseHebrewDate = (dateStr: string) => {
    if (!dateStr || typeof dateStr !== 'string') return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length !== 3) return new Date(0);
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
};

const cleanNumber = (val: any) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const cleaned = val.replace(/,/g, '');
        return parseFloat(cleaned) || 0;
    }
    return 0;
};

const getStartDateForRange = (range: string) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    now.setHours(0,0,0,0);

    switch (range) {
        case '1M': 
            let mDate = new Date(now);
            mDate.setMonth(now.getMonth() - 1);
            return mDate;
        case 'YTD': return new Date(currentYear, 0, 1);
        case '1Y': 
            let yDate = new Date(now);
            yDate.setFullYear(currentYear - 1);
            return yDate;
        case '5Y': 
             let y5Date = new Date(now);
             y5Date.setFullYear(currentYear - 5);
             return y5Date;
        case '10Y': 
             let y10Date = new Date(now);
             y10Date.setFullYear(currentYear - 10);
             return y10Date;
        case 'Max': default: return new Date(2000, 0, 1);
    }
};

// --- 2. CALCULATION LOGIC ---

// 2.1 Stock Performance
const calculateStockPerformance = (transactions: any[], range: string) => {
    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
        return { gainers: [], losers: [] };
    }
    
    const startDate = range === 'YTD' ? new Date(2024, 0, 1) : getStartDateForRange(range);
    const stockMap: Record<string, { profit: number, cost: number }> = {};

    transactions.forEach((t: any) => {
        const tDate = parseHebrewDate(t['תאריך']);
        if (tDate >= startDate) {
            const name = t['שם נייר'];
            if (['מגן מס', 'מס ששולם', 'מס עתידי', 'מס לשלם', 'העברה', 'הפקדה', 'ריבית', 'דמי ניהול', 'דמי טפול'].some(x => name?.includes(x))) return;

            const tax = cleanNumber(t['אומדן מס רווחי הון']);
            if (name && tax !== 0) {
                if (!stockMap[name]) stockMap[name] = { profit: 0, cost: 0 };
                const estimatedProfit = tax * 4;
                stockMap[name].profit += estimatedProfit;
                const saleAmount = cleanNumber(t['תמורה בשקלים']);
                const impliedCost = Math.abs(saleAmount) - estimatedProfit;
                if (impliedCost > 0) stockMap[name].cost += impliedCost;
            }
        }
    });

    const stocksArray = Object.keys(stockMap).map(key => {
        const profit = stockMap[key].profit;
        const cost = stockMap[key].cost;
        const percent = cost > 0 ? (profit / cost) * 100 : 0;
        return { ticker: key, total_return_ils: profit, return_pct: percent };
    });

    const gainers = stocksArray.filter(s => s.total_return_ils > 0).sort((a, b) => b.total_return_ils - a.total_return_ils);
    const losers = stocksArray.filter(s => s.total_return_ils < 0).sort((a, b) => a.total_return_ils - b.total_return_ils);
    return { gainers, losers };
};

// 2.2 Graph Data Processing
const processGraphData = (portfolioData: any, range: string) => {
    const monthlyData = portfolioData.Monthly_Data || [];
    const transactions = portfolioData.Transactions || [];
    
    // Sort
    const sortedData = [...monthlyData].sort((a:any, b:any) => {
        if (a.Year !== b.Year) return a.Year - b.Year;
        return HEBREW_MONTH_ORDER[a.Month] - HEBREW_MONTH_ORDER[b.Month];
    });

    // Filter
    let filteredData = sortedData;
    if (range === 'YTD') {
        filteredData = sortedData.filter((d:any) => d.Year === 2025);
        if(filteredData.length === 0) filteredData = sortedData.filter((d:any) => d.Year === 2024);
    } else if (range === '1Y') {
        filteredData = sortedData.slice(-12);
    } else if (range === '1M') {
        filteredData = sortedData.slice(-1);
    }

    if (filteredData.length === 0 && sortedData.length > 0) filteredData = sortedData; 

    // --- Variables ---
    let currentBalance = 0;
    let totalCommissions = 0;
    let totalMgmtFees = 0;
    let allTimeMgmtFees = 0;
    let totalRangeProfit = 0;
    let accumulatedPct = 0; 

    const lineDataUser: any[] = [];
    const lineDataSPX: any[] = [];
    const lineDataNDX: any[] = [];
    const barDataFees: any[] = [];
    const feeValues: number[] = [];

    // Base value for benchmarks (Start from user's first balance point)
    const startBalance = filteredData.length > 0 ? cleanNumber(filteredData[0].Account_Value) : 0;

    // --- 1. Process Monthly Data ---
    filteredData.forEach((d:any, i:number) => {
        currentBalance = cleanNumber(d.Account_Value);
        
        const monthlyReturn = cleanNumber(d.User_Monthly_Return);
        const returnDecimal = monthlyReturn / 100;
        const previousValueImplied = currentBalance / (1 + returnDecimal);
        
        totalRangeProfit += (currentBalance - previousValueImplied);
        accumulatedPct += monthlyReturn;

        const fee = cleanNumber(d.Fees_Paid_This_Month);
        totalCommissions += fee;
        feeValues.push(fee);

        const monthName = HEBREW_TO_ENGLISH_MONTHS[d.Month] || d.Month;
        const label = i % 2 === 0 ? monthName : '';

        // --- GRAPH: User Line ---
        lineDataUser.push({ 
            value: currentBalance, 
            label: label, 
            dataPointText: `${monthlyReturn.toFixed(1)}%` 
        });

        // --- BENCHMARKS: From Firebase Data ---
        // Default to 0 if data is missing (e.g., Python script didn't run yet)
        const spxPct = d.SPX_Monthly_Return ?? 0;
        const ndxPct = d.NDX_Monthly_Return ?? 0;

        // Compounding Logic
        const prevSPX = i === 0 ? startBalance : lineDataSPX[i-1].value;
        const prevNDX = i === 0 ? startBalance : lineDataNDX[i-1].value;

        lineDataSPX.push({ 
            value: prevSPX * (1 + spxPct/100),
            dataPointText: `${spxPct.toFixed(1)}%`
        });

        lineDataNDX.push({ 
            value: prevNDX * (1 + ndxPct/100),
            dataPointText: `${ndxPct.toFixed(1)}%`
        });

        barDataFees.push({ 
            value: fee, 
            label: label, 
            frontColor: '#F87171',
            topLabelComponent: () => <Text style={{color: '#F87171', fontSize: 10, marginBottom: 2}}>{Math.round(fee)}</Text>
        });
    });

    // --- 2. Calculate Management Fees ---
    // We look at all historical fees to get a valid "Annual Expense Ratio"
    transactions.forEach((t:any) => {
        const name = t['שם נייר'] || "";
        if (name.includes("דמי ניהול") || name.includes("דמי טפול")) {
             const val = Math.abs(cleanNumber(t['תמורה בשקלים']));
             if(val > 0) allTimeMgmtFees += val;
             
             // Current Range Sum
             const tDate = parseHebrewDate(t['תאריך']);
             const startDate = getStartDateForRange(range);
             if (tDate >= startDate) {
                 totalMgmtFees += val;
             }
        }
    });

    // FIX: Mgmt Fee Ratio = (Total Historical Fees / Current Balance) * 100
    // This ensures a non-zero result if you've paid fees in the past
    const mgmtFeeRatio = currentBalance > 0 ? (allTimeMgmtFees / currentBalance) * 100 : 0;

    // --- Comparison Totals ---
    const spxTotalGrowth = startBalance > 0 ? ((lineDataSPX[lineDataSPX.length-1]?.value - startBalance) / startBalance) * 100 : 0;
    const ndxTotalGrowth = startBalance > 0 ? ((lineDataNDX[lineDataNDX.length-1]?.value - startBalance) / startBalance) * 100 : 0;
    const userTotalGrowth = startBalance > 0 ? ((currentBalance - startBalance) / startBalance) * 100 : 0;

    const maxFee = Math.max(...feeValues, 50);
    const totalFees = totalCommissions + totalMgmtFees;

    return {
        userTotalGrowth,
        spxTotalGrowth,
        ndxTotalGrowth,
        currentBalance,
        totalRangeProfit,
        totalFees,
        mgmtFeeRatio, 
        maxFee, 
        lineDataUser,
        lineDataSPX,
        lineDataNDX,
        barDataFees
    };
};

const fetchFearGreedData = async () => {
    // Attempt to fetch or simulate
    return 27; 
};

// --- 4. COMPONENTS ---

const Header = ({ onOpenSettings }: any) => (
    <View style={styles.header}>
        <View style={styles.headerLeft}>
            <View style={styles.logoContainer}>
                <MaterialCommunityIcons name="chart-line-variant" size={24} color="black" />
            </View>
            <View>
                <Text style={styles.headerTitle}>InvestTrack</Text>
                <Text style={styles.headerSubtitle}>My Portfolio</Text>
            </View>
        </View>
        <TouchableOpacity style={styles.profileIcon} onPress={onOpenSettings}>
            <Feather name="user" size={20} color="white" />
        </TouchableOpacity>
    </View>
);

const MiniTimeFrameSelector = ({ selected, onSelect, options }: any) => (
    <View style={styles.miniTfContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {options.map((frame: string) => (
                <TouchableOpacity
                    key={frame}
                    style={[styles.miniTfButton, selected === frame && styles.miniTfButtonActive]}
                    onPress={() => onSelect(frame)}
                >
                    <Text style={[styles.miniTfText, selected === frame && styles.miniTfTextActive]}>
                        {frame}
                    </Text>
                </TouchableOpacity>
            ))}
        </ScrollView>
    </View>
);

const PerformanceCard = ({ data, showNumbers }: any) => {
    const [range, setRange] = useState('YTD');
    const stats = useMemo(() => processGraphData(data, range), [data, range]);

    if (!stats || stats.lineDataUser.length === 0) return (
        <View style={styles.card}>
             <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Performance</Text>
                <MiniTimeFrameSelector selected={range} onSelect={setRange} options={['1M', 'YTD', '1Y', 'Max']} />
            </View>
            <View style={{padding: 20, alignItems: 'center'}}><Text style={{color:'#666'}}>No Data</Text></View>
        </View>
    );

    const isPositive = stats.userTotalGrowth >= 0;
    const color = isPositive ? '#4ADE80' : '#F87171';
    
    // Comparisons
    const spxDiff = stats.userTotalGrowth - stats.spxTotalGrowth;
    const ndxDiff = stats.userTotalGrowth - stats.ndxTotalGrowth;

    const dataSet = [
        {
            data: stats.lineDataUser,
            color: color,
            thickness: 3,
            dataPointsColor: color,
            hideDataPoints: false, 
            textColor: color, 
            startFillColor: isPositive ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)',
            endFillColor: isPositive ? 'rgba(74, 222, 128, 0.01)' : 'rgba(248, 113, 113, 0.01)',
            areaChart: true,
            dataPointLabelShiftY: -20,
            dataPointTextColor: color
        },
        {
            data: stats.lineDataSPX,
            color: '#94A3B8', // Gray
            thickness: 2,
            strokeDashArray: [4,4],
            hideDataPoints: false,
            textColor: '#94A3B8',
            dataPointLabelShiftY: -10,
            dataPointTextColor: '#94A3B8'
        },
        {
            data: stats.lineDataNDX,
            color: '#F59E0B', // Amber
            thickness: 2,
            strokeDashArray: [4,4],
            hideDataPoints: false,
            textColor: '#F59E0B',
            dataPointLabelShiftY: 10,
            dataPointTextColor: '#F59E0B'
        }
    ];

    return (
        <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Performance</Text>
                <MiniTimeFrameSelector 
                    selected={range} 
                    onSelect={setRange} 
                    options={['1M', 'YTD', '1Y', '5Y', 'Max']} 
                />
            </View>

            <View style={styles.mainStatContainer}>
                <Text style={{color: '#AAA'}}>Current Balance</Text>
                <Text style={{color: 'white', fontSize: 32, fontWeight: 'bold'}}>
                    {showNumbers ? `₪${Math.round(stats.currentBalance).toLocaleString()}` : '****'}
                </Text>
                <Text style={{color: color, fontSize: 16, marginTop: 4, fontWeight: '600'}}>
                    {isPositive ? '+' : ''}{stats.userTotalGrowth.toFixed(2)}% ({range})
                </Text>
            </View>
            
            {/* Comparison Text Block */}
            <View style={styles.comparisonContainer}>
                <View style={styles.comparisonItem}>
                    <Text style={styles.comparisonLabel}>
                        vs S&P 500 ({stats.spxTotalGrowth > 0 ? '+' : ''}{stats.spxTotalGrowth.toFixed(1)}%)
                    </Text>
                    <Text style={[styles.comparisonValue, { color: spxDiff >= 0 ? '#4ADE80' : '#F87171' }]}>
                        {spxDiff >= 0 ? '+' : ''}{spxDiff.toFixed(2)}%
                    </Text>
                </View>
                <View style={styles.comparisonSeparator} />
                <View style={styles.comparisonItem}>
                    <Text style={styles.comparisonLabel}>
                        vs NDX 100 ({stats.ndxTotalGrowth > 0 ? '+' : ''}{stats.ndxTotalGrowth.toFixed(1)}%)
                    </Text>
                    <Text style={[styles.comparisonValue, { color: ndxDiff >= 0 ? '#4ADE80' : '#F87171' }]}>
                        {ndxDiff >= 0 ? '+' : ''}{ndxDiff.toFixed(2)}%
                    </Text>
                </View>
            </View>

            <View style={styles.benchmarksContainer}>
                <View style={styles.legendItem}>
                    <View style={{width:8, height:8, borderRadius:4, backgroundColor: color, marginRight:4}} />
                    <Text style={styles.benchText}>You</Text>
                </View>
                <View style={styles.legendItem}>
                    <View style={{width:8, height:8, borderRadius:4, backgroundColor: '#94A3B8', marginRight:4}} />
                    <Text style={styles.benchText}>S&P 500</Text>
                </View>
                <View style={styles.legendItem}>
                    <View style={{width:8, height:8, borderRadius:4, backgroundColor: '#F59E0B', marginRight:4}} />
                    <Text style={styles.benchText}>NDX 100</Text>
                </View>
            </View>

            <View style={{ marginTop: 10, alignItems: 'center', overflow: 'hidden' }}>
                <LineChart
                    dataSet={dataSet}
                    height={180}
                    width={SCREEN_WIDTH - 60}
                    spacing={50}
                    initialSpacing={20}
                    thickness={3}
                    hideRules
                    yAxisThickness={0}
                    xAxisThickness={1}
                    xAxisColor="#333"
                    yAxisTextStyle={{color: '#666', fontSize: 10}}
                    xAxisLabelTextStyle={{color: '#999', fontSize: 10}}
                    curved
                />
            </View>
        </View>
    );
};

const FeesAndCommissionsCard = ({ data, showNumbers }: any) => {
    const [range, setRange] = useState('YTD');
    const stats = useMemo(() => processGraphData(data, range), [data, range]);

    if (!stats) return null;

    return (
        <View style={styles.card}>
            <View style={styles.cardHeaderColumn}>
                <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>Fees & Commissions</Text>
                </View>
                <View style={{ marginTop: 12, width: '100%' }}>
                     <MiniTimeFrameSelector 
                        selected={range} 
                        onSelect={setRange} 
                        options={['1M', 'YTD', '1Y', '5Y', 'Max']} 
                    />
                </View>
            </View>
            
            <View style={styles.feesSummaryContainer}>
                <View style={styles.feeSummaryBox}>
                    <Text style={styles.feeSummaryLabel}>Total Paid</Text>
                    <Text style={[styles.feeSummaryValue, { color: '#F87171' }]}>
                        {showNumbers ? `₪${Math.round(stats.totalFees).toLocaleString()}` : '****'}
                    </Text>
                </View>
                <View style={styles.feeSummaryBox}>
                    <Text style={styles.feeSummaryLabel}>Est. Mgmt Fee %</Text>
                    <Text style={[styles.feeSummaryValue, { color: 'white' }]}>
                        {stats.mgmtFeeRatio.toFixed(3)}%
                    </Text>
                </View>
            </View>

            <View style={{alignItems: 'center'}}>
                <BarChart
                    data={stats.barDataFees}
                    barWidth={20}
                    spacing={20}
                    barBorderRadius={4}
                    frontColor="#F87171"
                    yAxisThickness={0}
                    xAxisThickness={0}
                    hideRules
                    height={120}
                    width={SCREEN_WIDTH - 60}
                    isAnimated
                    showValuesOnTop={showNumbers} 
                    yAxisTextStyle={{color: '#666', fontSize: 10}}
                    xAxisLabelTextStyle={{color: '#999', fontSize: 10}}
                    maxValue={stats.maxFee * 1.5} 
                />
            </View>
        </View>
    );
};

const FearGreedGauge = ({ value }: { value: number }) => {
    const score = value;
    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    const progress = score / 100;
    let color = "#FACC15";
    if (score <= 25) color = "#F87171";
    else if (score >= 75) color = "#4ADE80";
    return (
        <View style={{ alignItems: 'center', marginVertical: 10 }}>
            <Svg height="120" width="140" viewBox="0 0 140 80">
                <Path d="M10,70 A60,60 0 0,1 130,70" stroke="#333" strokeWidth="12" fill="none" strokeLinecap="round" />
                <Path d="M10,70 A60,60 0 0,1 130,70" stroke={color} strokeWidth="12" fill="none" strokeDasharray={`${circumference / 2}`} strokeDashoffset={circumference / 2 * (1 - progress)} strokeLinecap="round" />
            </Svg>
        </View>
    );
};

const FearGreedCard = ({ score }: any) => {
    let color = "#FACC15";
    let label = "Neutral";
    
    // Dynamic Text
    if (score <= 25) { color = "#F87171"; label = "Extreme Fear"; }
    else if (score < 45) { color = "#F97316"; label = "Fear"; }
    else if (score < 55) { color = "#FACC15"; label = "Neutral"; }
    else if (score < 75) { color = "#A3E635"; label = "Greed"; }
    else { color = "#4ADE80"; label = "Extreme Greed"; }

    return (
        <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Fear & Greed</Text>
                <Feather name="info" size={16} color="#666" />
            </View>
            <View style={{alignItems: 'center'}}>
                <FearGreedGauge value={score} />
                <Text style={{color: color, fontSize: 28, fontWeight: 'bold', marginTop: -20}}>{score}</Text>
                <Text style={{color: '#AAA', fontSize: 12}}>{label}</Text>
            </View>
        </View>
    );
};

const StockList = ({ stocks, title, showNumbers }: any) => {
    if (stocks.length === 0) return <View style={styles.stockListContainer}><Text style={{color:'#666'}}>No data for this period</Text></View>;
    return (
        <View style={styles.stockListContainer}>
            <Text style={styles.stockListTitle}>{title} ({stocks.length})</Text>
            <View style={{ marginTop: 10 }}>
                {stocks.slice(0, 10).map((stock: any, index: number) => {
                    const isPositive = stock.total_return_ils >= 0;
                    const color = isPositive ? '#4ADE80' : '#F87171';
                    
                    let displayValue = "P/L";
                    if (showNumbers) {
                        displayValue = `₪${Math.round(Math.abs(stock.total_return_ils)).toLocaleString()}`;
                    }

                    return (
                        <View key={stock.ticker} style={styles.stockRowItem}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={styles.stockRank}>{index + 1}.</Text>
                                <Text style={styles.stockTicker}>{stock.ticker}</Text>
                            </View>
                            <Text style={{ color, fontWeight: 'bold' }}>
                                {isPositive ? '+' : '-'}{displayValue}
                            </Text>
                        </View>
                    );
                })}
            </View>
        </View>
    );
};

const GainLossStocksCard = ({ transactions, showNumbers }: any) => {
    const [range, setRange] = useState('YTD'); 
    
    const safeTransactions = Array.isArray(transactions) ? transactions : [];
    const { gainers, losers } = useMemo(() => calculateStockPerformance(safeTransactions, range), [range, safeTransactions]);
    return (
        <View style={styles.card}>
            <View style={styles.cardHeaderColumn}>
                <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>Top Gainers/Losers 📊</Text>
                </View>
                <View style={{ marginTop: 12, width: '100%' }}>
                    <MiniTimeFrameSelector selected={range} onSelect={setRange} options={['1M', 'YTD', '1Y', '5Y', '10Y', 'Max']} />
                </View>
            </View>
            {safeTransactions.length > 0 ? (
                <>
                    <StockList stocks={gainers} title="Highest Profit" showNumbers={showNumbers} />
                    <View style={styles.separator} />
                    <StockList stocks={losers} title="Highest Loss" showNumbers={showNumbers} />
                </>
            ) : ( <View style={{padding:20, alignItems:'center'}}><Text style={{color:'#666'}}>No Transactions Found</Text></View> )}
        </View>
    );
};

const SettingsModal = ({ visible, onClose, showNumbers, onToggle, onLogout }: any) => (
    <Modal transparent visible={visible} animationType="fade">
        <TouchableWithoutFeedback onPress={onClose}>
            <View style={styles.modalOverlay}>
                <TouchableWithoutFeedback>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Settings</Text>
                        <View style={styles.rowBetween}>
                            <Text style={{color: 'white'}}>Show Numbers</Text>
                            <Switch value={showNumbers} onValueChange={onToggle} trackColor={{true: '#4ADE80'}}/>
                        </View>
                        <TouchableOpacity onPress={onLogout} style={{marginTop: 20}}>
                            <Text style={{color: '#F87171'}}>Logout</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableWithoutFeedback>
            </View>
        </TouchableWithoutFeedback>
    </Modal>
);

// --- LOGIN/SIGNUP ---
const LoginScreen = ({ onNavigateToSignup }: any) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const handleLogin = async () => {
        setError(''); setLoading(true);
        try { await signInWithEmailAndPassword(auth, email, password); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
    };
    return (
        <View style={[styles.container, styles.authContainer]}>
            <Text style={styles.authTitle}>Welcome</Text>
            <Text style={styles.authSubtitle}>Sign in to InvestTrack</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#999" value={email} onChangeText={setEmail} autoCapitalize="none" />
            <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#999" value={password} onChangeText={setPassword} secureTextEntry />
            <TouchableOpacity style={styles.authButton} onPress={handleLogin} disabled={loading}>
                {loading ? <ActivityIndicator color="#121212"/> : <Text style={styles.authButtonText}>Login</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={{marginTop:20}} onPress={onNavigateToSignup}><Text style={styles.navText}>No account? <Text style={{color:'#4ADE80'}}>Sign Up</Text></Text></TouchableOpacity>
        </View>
    );
};
const SignupScreen = ({ onNavigateToLogin }: any) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const handleSignup = async () => {
        setError(''); setLoading(true);
        try {
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await setDoc(doc(db, "portfolio", cred.user.uid), { Transactions: [], Monthly_Data: [] });
        } catch (e: any) { setError(e.message); } finally { setLoading(false); }
    };
    return (
        <View style={[styles.container, styles.authContainer]}>
            <Text style={styles.authTitle}>Sign Up</Text>
            <Text style={styles.authSubtitle}>Create your account</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#999" value={email} onChangeText={setEmail} autoCapitalize="none" />
            <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#999" value={password} onChangeText={setPassword} secureTextEntry />
            <TouchableOpacity style={styles.authButton} onPress={handleSignup} disabled={loading}>
                {loading ? <ActivityIndicator color="#121212"/> : <Text style={styles.authButtonText}>Create Account</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={{marginTop:20}} onPress={onNavigateToLogin}><Text style={styles.navText}>Have an account? <Text style={{color:'#4ADE80'}}>Login</Text></Text></TouchableOpacity>
        </View>
    );
};

// --- MAIN ---
export default function Index() {
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [showNumbers, setShowNumbers] = useState(false);
    const [settingsVisible, setSettingsVisible] = useState(false);
    const [isSigningUp, setIsSigningUp] = useState(false);
    
    // Default state must be empty arrays to prevent crash
    const [portfolioData, setPortfolioData] = useState<any>({ Monthly_Data: [], Transactions: [] });
    const [fearGreedScore, setFearGreedScore] = useState(24); 

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setLoading(false);
        });
        return unsub;
    }, []);

    useEffect(() => {
        const loadData = async () => {
            if (!user) return;
            try {
                const docRef = doc(db, "portfolio", user.uid); 
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setPortfolioData({
                        Monthly_Data: data.Monthly_Data || [],
                        Transactions: data.Transactions || []
                    });
                }
            } catch (e) { console.error("DB Error:", e); }

            const fg = await fetchFearGreedData();
            setFearGreedScore(fg);
        };
        loadData();
    }, [user]);

    const handleLogout = () => { setSettingsVisible(false); signOut(auth); };

    if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#4ADE80"/></View>;
    if (!user) {
        if (isSigningUp) return <SignupScreen onNavigateToLogin={() => setIsSigningUp(false)} />;
        return <LoginScreen onNavigateToSignup={() => setIsSigningUp(true)} />;
    }

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" />
            <Header onOpenSettings={() => setSettingsVisible(true)} />
            
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.colContainer}>
                    <View style={styles.grid}>
                        <View style={styles.col}>
                            <PerformanceCard data={portfolioData} showNumbers={showNumbers} />
                        </View>
                        <View style={styles.col}>
                            <FeesAndCommissionsCard data={portfolioData} showNumbers={showNumbers} />
                            <FearGreedCard score={fearGreedScore} /> 
                        </View>
                    </View>
                    <GainLossStocksCard transactions={portfolioData.Transactions} showNumbers={showNumbers} />
                </View>
            </ScrollView>

            <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} showNumbers={showNumbers} onToggle={() => setShowNumbers(!showNumbers)} onLogout={handleLogout} />
        </View>
    );
}

// --- STYLES ---
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212', paddingTop: 50 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' },
    scrollContent: { paddingBottom: 40, paddingHorizontal: 16 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 15 },
    headerLeft: { flexDirection: 'row', alignItems: 'center' },
    logoContainer: { width: 40, height: 40, backgroundColor: '#4ADE80', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    headerTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' },
    headerSubtitle: { color: '#888', fontSize: 12 },
    profileIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1F2937', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#374151' },
    
    grid: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 16 },
    col: { width: '48%', gap: 16 }, 
    colContainer: { width: '100%' },

    card: { backgroundColor: '#18181B', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#27272A', width: '100%' },
    cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    cardHeaderColumn: { flexDirection: 'column', marginBottom: 16 },
    cardTitle: { color: 'white', fontSize: 16, fontWeight: 'bold' },
    
    mainStatContainer: { alignItems: 'center', marginBottom: 20 },
    benchmarksContainer: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginBottom: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center' },
    benchText: { color: '#888', fontSize: 11 },
    
    statsContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
    statLabel: { color: '#AAA', fontSize: 12 },
    
    miniTfContainer: { flexDirection: 'row', backgroundColor: '#27272A', borderRadius: 8, padding: 4 },
    miniTfButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, marginRight: 4 },
    miniTfButtonActive: { backgroundColor: '#3F3F46' },
    miniTfText: { color: '#888', fontSize: 11, fontWeight: '600' },
    miniTfTextActive: { color: '#FFF' },

    stockListContainer: { marginBottom: 0 },
    stockListTitle: { color: 'white', fontSize: 16, fontWeight: 'bold', marginBottom: 8, paddingHorizontal: 8 },
    stockRowItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8 },
    stockRank: { color: '#9CA3AF', fontSize: 14, fontWeight: 'bold', marginRight: 8 },
    stockTicker: { color: 'white', fontSize: 14, fontWeight: '600' },
    separator: { height: 1, backgroundColor: '#27272A', marginVertical: 16 },
    
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { backgroundColor: '#18181B', width: '80%', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#333' },
    modalTitle: { color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 20 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    
    authContainer: { justifyContent: 'center', paddingHorizontal: 40, paddingTop: 0 },
    authTitle: { color: 'white', fontSize: 28, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
    authSubtitle: { color: '#888', fontSize: 14, marginBottom: 30, textAlign: 'center' },
    input: { backgroundColor: '#1F2937', color: 'white', borderRadius: 8, paddingHorizontal: 15, paddingVertical: 12, marginBottom: 15, fontSize: 16, borderWidth: 1, borderColor: '#374151' },
    authButton: { backgroundColor: '#4ADE80', borderRadius: 8, padding: 15, alignItems: 'center', marginTop: 10 },
    authButtonText: { color: '#121212', fontSize: 16, fontWeight: 'bold' },
    errorText: { color: '#F87171', marginBottom: 10, textAlign: 'center' },
    navText: { color: '#999', textAlign: 'center' },

    // New styles for comparisons and fees
    comparisonContainer: { flexDirection: 'row', backgroundColor: '#1E293B', borderRadius: 8, padding: 12, marginBottom: 16, alignItems: 'center' },
    comparisonItem: { flex: 1, alignItems: 'center' },
    comparisonLabel: { color: '#94A3B8', fontSize: 11, marginBottom: 4 },
    comparisonValue: { fontSize: 16, fontWeight: 'bold' },
    comparisonSeparator: { width: 1, height: 30, backgroundColor: '#334155', marginHorizontal: 8 },
    
    feesSummaryContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
    feeSummaryBox: { flex: 0.48, backgroundColor: '#1E293B', borderRadius: 8, padding: 12 },
    feeSummaryLabel: { color: '#94A3B8', fontSize: 12, marginBottom: 4 },
    feeSummaryValue: { fontSize: 18, fontWeight: 'bold' }
});