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
    View,
    LayoutAnimation
} from 'react-native';
import { BarChart, LineChart } from "react-native-gifted-charts";
import Svg, { Path, Circle, G } from 'react-native-svg';
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
    "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4,
    "מאי": 5, "יוני": 6, "יולי": 7, "אוגוסט": 8,
    "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12
};

// --- DATA PROCESSING ENGINE ---
const processDataForRange = (range: string, rawData: any) => {
    // 1. Safety Check
    if (!rawData || !rawData.Monthly_Data || rawData.Monthly_Data.length === 0) {
        return {
            Period: "No Data",
            User_Return: 0,
            SPX_Return: 0,
            NDX_Return: 0,
            Total_Fees_Paid: 0,
            Management_Fee_Percent: 0,
            Avg_AUM: 0,
            FilteredData: [],
            Fear_Greed_Score: rawData?.Fear_Greed_Score || 50,
            currentBalance: 0
        };
    }

    // 2. Sort Data (Oldest -> Newest)
    let sortedData = [...rawData.Monthly_Data];
    sortedData.sort((a, b) => {
        if (a.Year !== b.Year) return a.Year - b.Year;
        const monthA = HEBREW_MONTH_ORDER[a.Month] || 0;
        const monthB = HEBREW_MONTH_ORDER[b.Month] || 0;
        return monthA - monthB;
    });

    // 3. Determine "Current Year" dynamically
    const years = sortedData.map(d => d.Year);
    const maxYear = Math.max(...years);

    // 4. Filter logic
    let filteredData = [];
    if (range === '1M') {
        filteredData = [sortedData[sortedData.length - 1]];
    } else if (range === 'YTD') {
        filteredData = sortedData.filter(d => d.Year === maxYear);
        if (filteredData.length === 0) filteredData = sortedData.filter(d => d.Year === maxYear - 1);
    } else if (range === '1Y') {
        filteredData = sortedData.slice(-12);
    } else {
        filteredData = sortedData;
    }

    // 5. Calculate Totals
    let totalFees = 0;
    let latestAccountValue = 0;
    let managementFeePct = 0;
    
    // Geometric Return Calculation (TWR)
    // Start at 1.0 (100%), multiply by (1 + monthly_return)
    let userCompound = 1.0;
    let spxCompound = 1.0;
    let ndxCompound = 1.0;

    if (filteredData.length > 0) {
        totalFees = filteredData.reduce((acc, curr) => acc + (curr.Fees_Paid_This_Month || 0), 0);
        
        filteredData.forEach(item => {
            // User Return
            const uRet = item.User_Monthly_Return || 0;
            userCompound *= (1 + uRet / 100);

            // SPX Return
            const sRet = item.SPX_Monthly_Return || 0;
            spxCompound *= (1 + sRet / 100);

            // NDX Return
            const nRet = item.NDX_Monthly_Return || 0;
            ndxCompound *= (1 + nRet / 100);
        });

        // Get latest value
        const lastItem = filteredData[filteredData.length - 1];
        latestAccountValue = lastItem.Account_Value || 0;
        
        // --- ORIGINAL FEE CALCULATION RESTORED ---
        // Total Fees / Current Balance
        if (latestAccountValue > 0) {
            managementFeePct = parseFloat(((totalFees / latestAccountValue) * 100).toFixed(3));
        }
    }

    const userTotalReturn = (userCompound - 1) * 100;
    const spxTotalReturn = (spxCompound - 1) * 100;
    const ndxTotalReturn = (ndxCompound - 1) * 100;

    return {
        Period: range === '1M' ? 'Last Month' : (range === 'YTD' ? `${maxYear} YTD` : range),
        User_Return: parseFloat(userTotalReturn.toFixed(2)),
        SPX_Return: parseFloat(spxTotalReturn.toFixed(2)),
        NDX_Return: parseFloat(ndxTotalReturn.toFixed(2)),
        Total_Fees_Paid: Math.round(totalFees),
        Management_Fee_Percent: managementFeePct,
        currentBalance: latestAccountValue,
        FilteredData: filteredData,
        Fear_Greed_Score: rawData?.Fear_Greed_Score || 27 
    };
};

const calculateStockPerformance = (transactions: any[], range: string) => {
    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) return { gainers: [], losers: [] };
    // Simple Date Filter
    const now = new Date();
    let limitDate = new Date(2000, 0, 1);
    if(range === '1M') limitDate = new Date(now.getFullYear(), now.getMonth()-1, now.getDate());
    if(range === 'YTD') limitDate = new Date(now.getFullYear(), 0, 1);
    if(range === '1Y') limitDate = new Date(now.getFullYear()-1, now.getMonth(), now.getDate());

    const stockMap: Record<string, { profit: number, cost: number }> = {};
    
    const parseDate = (d:string) => {
        const parts = d.split('/');
        return new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
    };
    const cleanNum = (v:any) => typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : (v||0);

    transactions.forEach((t: any) => {
        const tDate = parseDate(t['תאריך']);
        if (tDate >= limitDate) {
            const name = t['שם נייר'];
            if (['מגן מס', 'מס ששולם', 'מס עתידי', 'מס לשלם', 'העברה', 'הפקדה', 'ריבית', 'דמי ניהול', 'דמי טפול'].some(x => name?.includes(x))) return;
            
            const tax = cleanNum(t['אומדן מס רווחי הון']);
            if (name && tax !== 0) {
                if (!stockMap[name]) stockMap[name] = { profit: 0, cost: 0 };
                const estimatedProfit = tax * 4;
                stockMap[name].profit += estimatedProfit;
            }
        }
    });

    const stocksArray = Object.keys(stockMap).map(key => ({
        ticker: key, 
        total_return_ils: stockMap[key].profit, 
    }));

    const gainers = stocksArray.filter(s => s.total_return_ils > 0).sort((a, b) => b.total_return_ils - a.total_return_ils);
    const losers = stocksArray.filter(s => s.total_return_ils < 0).sort((a, b) => a.total_return_ils - b.total_return_ils);
    return { gainers, losers };
};

const fetchFearGreedData = async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return 27; 
};

// --- COMPONENTS ---

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
    const stats = useMemo(() => processDataForRange(range, data), [data, range]);

    if (!stats || stats.FilteredData.length === 0) return (
        <View style={styles.card}>
             <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Performance</Text>
                <MiniTimeFrameSelector selected={range} onSelect={setRange} options={['1M', 'YTD', '1Y', 'Max']} />
            </View>
            <View style={{padding: 20, alignItems: 'center'}}><Text style={{color:'#666'}}>No Data</Text></View>
        </View>
    );

    const isPositive = stats.User_Return >= 0;
    const color = isPositive ? '#4ADE80' : '#F87171';
    
    // --- GRAPH DATA GENERATION ---
    // We need to construct the cumulative curves for User, SPX, NDX
    // starting from the first data point in the filtered range.
    
    // Start everything at the initial Account Value for comparison
    const initialBalance = stats.FilteredData[0].Account_Value;
    
    const lineDataUser: any[] = [];
    const lineDataSPX: any[] = [];
    const lineDataNDX: any[] = [];

    // Helper for cumulative calc
    let userRunning = initialBalance;
    let spxRunning = initialBalance;
    let ndxRunning = initialBalance;

    stats.FilteredData.forEach((d:any, i:number) => {
        const label = i % 2 === 0 ? (HEBREW_TO_ENGLISH_MONTHS[d.Month] || d.Month) : '';
        
        // User Data is absolute value
        lineDataUser.push({
            value: d.Account_Value,
            label: label,
            dataPointText: `${d.User_Monthly_Return.toFixed(1)}%`
        });

        // Benchmark Data is relative change applied to base
        const spxChg = d.SPX_Monthly_Return || 0;
        const ndxChg = d.NDX_Monthly_Return || 0;
        
        if (i > 0) {
            spxRunning = spxRunning * (1 + spxChg/100);
            ndxRunning = ndxRunning * (1 + ndxChg/100);
        }

        lineDataSPX.push({
            value: spxRunning,
            dataPointText: `${spxChg.toFixed(1)}%`
        });
        lineDataNDX.push({
            value: ndxRunning,
            dataPointText: `${ndxChg.toFixed(1)}%`
        });
    });

    const spxDiff = stats.User_Return - stats.SPX_Return;
    const ndxDiff = stats.User_Return - stats.NDX_Return;

    const dataSet = [
        {
            data: lineDataUser,
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
            data: lineDataSPX,
            color: '#94A3B8',
            thickness: 2,
            strokeDashArray: [4,4],
            hideDataPoints: false,
            textColor: '#94A3B8',
            dataPointLabelShiftY: -10,
            dataPointTextColor: '#94A3B8'
        },
        {
            data: lineDataNDX,
            color: '#F59E0B',
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
                    {isPositive ? '+' : ''}{stats.User_Return.toFixed(2)}% ({range})
                </Text>
            </View>
            
            <View style={styles.comparisonContainer}>
                <View style={styles.comparisonItem}>
                    <Text style={styles.comparisonLabel}>
                        vs S&P 500 ({stats.SPX_Return > 0 ? '+' : ''}{stats.SPX_Return.toFixed(1)}%)
                    </Text>
                    <Text style={[styles.comparisonValue, { color: spxDiff >= 0 ? '#4ADE80' : '#F87171' }]}>
                        {spxDiff >= 0 ? '+' : ''}{spxDiff.toFixed(2)}%
                    </Text>
                </View>
                <View style={styles.comparisonSeparator} />
                <View style={styles.comparisonItem}>
                    <Text style={styles.comparisonLabel}>
                        vs NDX 100 ({stats.NDX_Return > 0 ? '+' : ''}{stats.NDX_Return.toFixed(1)}%)
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
    const stats = useMemo(() => processDataForRange(range, data), [data, range]);

    if (!stats) return null;

    // Prepare Bar Data
    const barData = stats.FilteredData.map((m: any) => ({
        value: m.Fees_Paid_This_Month || 0,
        label: HEBREW_TO_ENGLISH_MONTHS[m.Month] || m.Month,
        frontColor: '#F87171',
        topLabelComponent: () => <Text style={{color: '#F87171', fontSize: 10, marginBottom: 2}}>{Math.round(m.Fees_Paid_This_Month)}</Text>
    }));

    // Dynamic Max Value for visual scaling
    const maxFee = Math.max(...barData.map((d:any) => d.value), 50);

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
                        {showNumbers ? `₪${Math.round(stats.Total_Fees_Paid).toLocaleString()}` : '****'}
                    </Text>
                </View>
                <View style={styles.feeSummaryBox}>
                    <Text style={styles.feeSummaryLabel}>Est. Mgmt Fee %</Text>
                    <Text style={[styles.feeSummaryValue, { color: 'white' }]}>
                        {stats.Management_Fee_Percent}%
                    </Text>
                </View>
            </View>

            <View style={{alignItems: 'center'}}>
                <BarChart
                    data={barData}
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
                    maxValue={maxFee * 1.5} 
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
    
    // Dynamic Text Logic
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
                    // Use live score from DB if available, else fetch/fallback
                    if(data.Fear_Greed_Score) setFearGreedScore(data.Fear_Greed_Score);
                }
            } catch (e) { console.error("DB Error:", e); }

            const fg = await fetchFearGreedData();
            // Only override if not present in DB
            if(!portfolioData.Fear_Greed_Score) setFearGreedScore(fg);
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