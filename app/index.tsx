import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    LayoutAnimation,
    Modal,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    UIManager,
    View
} from 'react-native';
import { BarChart, LineChart } from "react-native-gifted-charts";
import Svg, { Circle, G, Path } from 'react-native-svg';

// Firebase Imports
import { doc, getDoc } from "firebase/firestore";
// Ensure this points to your actual config file location
import { db } from '../firebaseConfig';

// Android Animation Setup
if (Platform.OS === 'android') {
    if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
    }
}

const SCREEN_WIDTH = Dimensions.get('window').width;

// --- MAPPINGS ---
// Critical: Exact spelling matching your Firestore screenshot
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

// --- DATA PROCESSING ENGINE (FIXED) ---
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
            Fear_Greed_Score: 24
        };
    }

    // 2. Sort Data (Oldest -> Newest) using Year and Hebrew Month
    let sortedData = [...rawData.Monthly_Data];
    sortedData.sort((a, b) => {
        if (a.Year !== b.Year) return a.Year - b.Year;
        const monthA = HEBREW_MONTH_ORDER[a.Month] || 0;
        const monthB = HEBREW_MONTH_ORDER[b.Month] || 0;
        return monthA - monthB;
    });

    // 3. Determine "Current Year" dynamically from data (Fixes the 2025 vs 2024 issue)
    const years = sortedData.map(d => d.Year);
    const maxYear = Math.max(...years);

    // 4. Filter logic based on data availability
    let filteredData = [];

    if (range === '1M') {
        // Last available month
        filteredData = [sortedData[sortedData.length - 1]];
    } else if (range === 'YTD') {
        // All months matching the max year found in DB
        filteredData = sortedData.filter(d => d.Year === maxYear);
    } else if (range === '1Y') {
        // Last 12 entries, regardless of year
        filteredData = sortedData.slice(-12);
    } else {
        // All data for longer ranges
        filteredData = sortedData;
    }

    // 5. Calculate Totals
    let totalReturn = 0;
    let totalFees = 0;
    let latestAccountValue = 0;
    let managementFeePct = 0;

    if (filteredData.length > 0) {
        totalFees = filteredData.reduce((acc, curr) => acc + (curr.Fees_Paid_This_Month || 0), 0);
        
        // Sum returns for the period
        totalReturn = filteredData.reduce((acc, curr) => acc + (curr.User_Monthly_Return || 0), 0);
        
        // Get latest value
        const lastItem = filteredData[filteredData.length - 1];
        latestAccountValue = lastItem.Account_Value || 0;
        
        // Calculate Fee % based on the last month in the selection
        if (latestAccountValue > 0 && lastItem.Fees_Paid_This_Month) {
            managementFeePct = parseFloat(((lastItem.Fees_Paid_This_Month / latestAccountValue) * 100).toFixed(3));
        }
    }

    return {
        Period: range === '1M' ? 'Last Month' : (range === 'YTD' ? `${maxYear} YTD` : range),
        User_Return: parseFloat(totalReturn.toFixed(2)),
        SPX_Return: 3.2, // Static benchmark
        NDX_Return: 4.1, // Static benchmark
        Total_Fees_Paid: Math.round(totalFees),
        Management_Fee_Percent: managementFeePct,
        Avg_AUM: latestAccountValue,
        FilteredData: filteredData,
        Fear_Greed_Score: 24 
    };
};

// --- COMPONENT: Settings Modal ---
const SettingsModal = ({ visible, onClose, showNumbers, onToggleShowNumbers }: any) => {
    return (
        <Modal animationType="fade" transparent={true} visible={visible} onRequestClose={onClose}>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.modalOverlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.modalContent}>
                            <Text style={styles.modalTitle}>Settings</Text>
                            <View style={styles.settingRow}>
                                <View>
                                    <Text style={styles.settingLabel}>Show Numbers</Text>
                                    <Text style={styles.settingDesc}>Reveal monetary values</Text>
                                </View>
                                <Switch
                                    trackColor={{ false: "#3F3F46", true: "#4ADE80" }}
                                    thumbColor={"#FFF"}
                                    onValueChange={onToggleShowNumbers}
                                    value={showNumbers}
                                />
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

// --- COMPONENT: Mini Selector ---
const MiniTimeFrameSelector = ({ selected, onSelect, options }: any) => {
    const frames = options || ['1M', 'YTD', '1Y', 'Max'];
    return (
        <View style={styles.miniTfContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {frames.map((frame: string) => (
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
};

// --- 1. PERFORMANCE CARD ---
const PerformanceCard = ({ data, showNumbers }: { data: any, showNumbers: boolean }) => {
    const [range, setRange] = useState('YTD');
    const stats = processDataForRange(range, data);

    const userReturn = stats.User_Return;
    const spxReturn = stats.SPX_Return;
    const ndxReturn = stats.NDX_Return;
    const totalMoneyMade = stats.Avg_AUM * (userReturn / 100);

    const isPositive = userReturn >= 0;
    const chartColor = isPositive ? '#4ADE80' : '#F87171';
    
    // Prepare Chart Data
    let chartData = [{ value: 0 }];
    if (stats.FilteredData.length > 0) {
        chartData = stats.FilteredData.map((m: any) => ({
            value: m.User_Monthly_Return || 0,
            label: HEBREW_TO_ENGLISH_MONTHS[m.Month] || "?",
            dataPointColor: (m.User_Monthly_Return || 0) >= 0 ? '#4ADE80' : '#F87171'
        }));
    } else {
        // Fallback so chart doesn't crash
        chartData = [{ value: 0 }, { value: 0 }]; 
    }

    const formatPct = (val: number) => `${val > 0 ? '+' : ''}${val}%`;
    const getDiffColor = (val1: number, val2: number) => (val1 - val2) >= 0 ? '#4ADE80' : '#F87171';

    return (
        <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
                <View>
                    <Text style={styles.cardTitle}>Performance</Text>
                    <Text style={styles.cardSubtitle}>{stats.Period}</Text>
                </View>
                <MiniTimeFrameSelector selected={range} onSelect={setRange} />
            </View>

            <View style={styles.mainStatContainer}>
                <Text style={styles.perfLabel}>Return ({range})</Text>
                <Text style={[styles.mainPerfValue, { color: chartColor }]}>
                    {formatPct(userReturn)}
                </Text>
                {showNumbers && (
                    <Text style={[styles.moneyMadeText, { color: totalMoneyMade >= 0 ? '#4ADE80' : '#F87171' }]}>
                        {totalMoneyMade > 0 ? '+' : ''}₪{Math.round(totalMoneyMade).toLocaleString()}
                    </Text>
                )}
            </View>

            <View style={styles.benchmarksContainer}>
                <View style={styles.benchmarkBox}>
                    <Text style={styles.benchLabel}>vs S&P 500 ({formatPct(spxReturn)})</Text>
                    <Text style={[styles.benchDiff, { color: getDiffColor(userReturn, spxReturn) }]}>
                        {formatPct(parseFloat((userReturn - spxReturn).toFixed(2)))}
                    </Text>
                </View>
                <View style={styles.vertDivider} />
                <View style={styles.benchmarkBox}>
                    <Text style={styles.benchLabel}>vs NDX 100 ({formatPct(ndxReturn)})</Text>
                    <Text style={[styles.benchDiff, { color: getDiffColor(userReturn, ndxReturn) }]}>
                        {formatPct(parseFloat((userReturn - ndxReturn).toFixed(2)))}
                    </Text>
                </View>
            </View>

            <View style={{ marginTop: 16, alignItems: 'center' }}>
                <LineChart
                    data={chartData}
                    height={160}
                    width={SCREEN_WIDTH - 70}
                    thickness={3}
                    curved
                    color={chartColor}
                    startFillColor={isPositive ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)'}
                    endFillColor={isPositive ? 'rgba(74, 222, 128, 0.01)' : 'rgba(248, 113, 113, 0.01)'}
                    startOpacity={0.9}
                    endOpacity={0.1}
                    areaChart
                    hideRules
                    yAxisThickness={0}
                    xAxisThickness={1}
                    xAxisColor="#333"
                    yAxisTextStyle={{ color: '#666', fontSize: 10 }}
                    xAxisLabelTextStyle={{ color: '#999', fontSize: 10 }}
                    hideDataPoints={false}
                    dataPointsColor={chartColor}
                    dataPointsRadius={4}
                />
            </View>
        </View>
    );
};

// --- 2. FEAR & GREED ---
const FearGreedGauge = ({ value }: { value: number }) => {
    const score = value;
    let label = "Neutral";
    let color = "#FACC15";

    if (score >= 75) { label = "Extreme Greed"; color = "#22c55e"; }
    else if (score >= 55) { label = "Greed"; color = "#4ADE80"; }
    else if (score <= 25) { label = "Extreme Fear"; color = "#ef4444"; }
    else if (score <= 45) { label = "Fear"; color = "#F87171"; }

    return (
        <View style={{ alignItems: 'center', marginVertical: 10 }}>
            <Svg height="110" width="220" viewBox="0 0 200 110">
                <Path d="M20,100 A80,80 0 0,1 180,100" fill="none" stroke="#333" strokeWidth="12" strokeLinecap="round" />
                <Path
                    d="M20,100 A80,80 0 0,1 180,100"
                    fill="none" stroke={color} strokeWidth="12"
                    strokeDasharray={`${(score / 100) * 251}, 251`} strokeLinecap="round"
                />
                <G rotation={(score / 100) * 180 - 90} origin="100, 100">
                    <Path d="M100,100 L100,30" stroke="white" strokeWidth="4" />
                    <Circle cx="100" cy="100" r="6" fill="white" />
                </G>
            </Svg>
            <Text style={{ color: color, fontSize: 32, fontWeight: 'bold', marginTop: -20 }}>
                {value}
            </Text>
            <Text style={{ color: '#AAA', fontSize: 16, fontWeight: '600', marginTop: 4 }}>{label}</Text>
        </View>
    );
};

const FearGreedCard = ({ data }: { data: any }) => {
    return (
        <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Fear & Greed Index</Text>
                <Feather name="info" size={16} color="#666" />
            </View>
            <FearGreedGauge value={24} />
        </View>
    );
};

// --- 3. COMMISSIONS CARD ---
const CommissionsCard = ({ data, showNumbers }: { data: any, showNumbers: boolean }) => {
    const [range, setRange] = useState('YTD');
    const [expanded, setExpanded] = useState(false);

    const stats = processDataForRange(range, data);
    
    // Reverse for list view so newest is top
    const listData = [...stats.FilteredData].reverse();
    
    const barData = stats.FilteredData.map((m: any) => ({
        value: m.Fees_Paid_This_Month || 0,
        label: HEBREW_TO_ENGLISH_MONTHS[m.Month]?.substring(0, 3) || m.Month,
        frontColor: '#F87171'
    }));

    const toggleExpand = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(!expanded);
    };

    return (
        <View style={styles.card}>
            <View style={styles.cardHeaderColumn}>
                <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>Fees & Commissions</Text>
                    <Text style={styles.cardSubtitle}>{stats.Period}</Text>
                </View>
                <View style={{ marginTop: 12, width: '100%' }}>
                    <MiniTimeFrameSelector
                        selected={range}
                        onSelect={setRange}
                        options={['1M', 'YTD', '1Y']}
                    />
                </View>
            </View>

            <View style={styles.statsContainer}>
                <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Total Paid</Text>
                    <Text style={[styles.statValue, { color: '#F87171' }]}>
                        {showNumbers ? `₪${stats.Total_Fees_Paid.toLocaleString()}` : '****'}
                    </Text>
                </View>

                <View style={[styles.statBox, { marginLeft: 12 }]}>
                    <Text style={styles.statLabel}>Est. Mgmt Fee %</Text>
                    <Text style={styles.statValue}>{stats.Management_Fee_Percent}%</Text>
                </View>
            </View>

            <View style={{ marginTop: 20, height: 180, justifyContent: 'center', alignItems: 'center' }}>
                {barData.length > 0 ? (
                    <BarChart
                        data={barData}
                        barWidth={20}
                        noOfSections={3}
                        barBorderRadius={4}
                        frontColor="#1F2937"
                        yAxisThickness={0}
                        xAxisThickness={0}
                        yAxisTextStyle={{ color: '#666', fontSize: 10 }}
                        xAxisLabelTextStyle={{ color: '#999', fontSize: 10 }}
                        height={130}
                        width={SCREEN_WIDTH * 0.75}
                        isAnimated
                        showYAxisIndices={false}
                        hideYAxisText={!showNumbers}
                    />
                ) : (
                    <Text style={{ color: '#444' }}>No Data for this range</Text>
                )}
            </View>

            {/* Monthly List */}
            {listData.length > 0 && (
                <View style={styles.monthlyListContainer}>
                    <View style={styles.separator} />
                    <TouchableOpacity onPress={toggleExpand} style={styles.expandButton}>
                        <Text style={styles.sectionLabel}>Monthly Breakdown</Text>
                        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={20} color="#888" />
                    </TouchableOpacity>

                    {expanded && (
                        <View style={{ marginTop: 12 }}>
                            {listData.map((item: any, idx: number) => {
                                const feeAmount = item.Fees_Paid_This_Month || 0;
                                return (
                                    <View key={idx} style={styles.historyRowItem}>
                                        <Text style={styles.historyDate}>
                                            {HEBREW_TO_ENGLISH_MONTHS[item.Month] || item.Month} {item.Year}
                                        </Text>
                                        <Text style={{ color: feeAmount > 0 ? '#F87171' : '#666' }}>
                                            {showNumbers ? `₪${feeAmount.toLocaleString()}` : '****'}
                                        </Text>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>
            )}
        </View>
    );
};

// --- 4. TIPS CARD ---
const ImprovementTipsCard = ({ stats }: { stats: any }) => {
    const mgmtFee = stats.Management_Fee_Percent || 0;
    const isHighFees = mgmtFee > 0.5;

    return (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[styles.iconBox, { backgroundColor: '#4ADE80' }]}>
                        <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color="black" />
                    </View>
                    <View style={{ marginLeft: 10 }}>
                        <Text style={styles.cardTitle}>AI Tips</Text>
                    </View>
                </View>
            </View>

            {isHighFees ? (
                <View style={styles.tipItem}>
                    <View style={styles.rowBetween}>
                        <Text style={styles.tipTitle}>Fee Optimization</Text>
                        <View style={[styles.tag, { backgroundColor: 'rgba(248, 113, 113, 0.2)' }]}>
                            <Text style={[styles.tagText, { color: '#F87171' }]}>High Impact</Text>
                        </View>
                    </View>
                    <Text style={styles.tipDesc}>
                        Calculated fees are approx {mgmtFee}%. This is above 0.5%.
                    </Text>
                </View>
            ) : (
                <View style={styles.tipItem}>
                    <Text style={styles.tipTitle}>Great Fees!</Text>
                    <Text style={styles.tipDesc}>Your fees are low (~{mgmtFee}%). Good job.</Text>
                </View>
            )}
        </View>
    );
};

// --- HEADER & MAIN ---
const Header = ({ onOpenSettings }: { onOpenSettings: () => void }) => (
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

export default function Index() {
    const [showNumbers, setShowNumbers] = useState(false);
    const [settingsVisible, setSettingsVisible] = useState(false);
    const [reportData, setReportData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // --- FETCH DATA FROM FIREBASE ---
    useEffect(() => {
        const fetchData = async () => {
            try {
                // IMPORTANT: Ensure this path matches exactly: collection "portfolio", doc "latest_report"
                const docRef = doc(db, "portfolio", "latest_report");
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    setReportData(docSnap.data());
                } else {
                    console.log("DEBUG: Document not found. Check Firestore permissions or ID.");
                    // Set empty array so app doesn't crash but shows 0
                    setReportData({ Monthly_Data: [] });
                }
            } catch (e) {
                console.error("DEBUG: Firebase Fetch Error:", e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    if (loading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color="#4ADE80" />
            </View>
        );
    }

    const safeData = reportData || { Monthly_Data: [] };
    // Pass 'YTD' stats for the tips card
    const ytdStats = processDataForRange('YTD', safeData);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" />
            <Header onOpenSettings={() => setSettingsVisible(true)} />

            <SettingsModal
                visible={settingsVisible}
                onClose={() => setSettingsVisible(false)}
                showNumbers={showNumbers}
                onToggleShowNumbers={setShowNumbers}
            />

            <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
                {/* DEBUGGING TEXT - If this shows empty array [], the fetch failed */}
                {(!safeData.Monthly_Data || safeData.Monthly_Data.length === 0) && (
                     <View style={{backgroundColor: '#333', padding: 10, borderRadius: 8, marginBottom: 10}}>
                        <Text style={{color: 'orange', textAlign: 'center'}}>
                            No Data Found. Check Console Logs.
                        </Text>
                     </View>
                )}

                <View style={styles.grid}>
                    <View style={styles.col}>
                        <PerformanceCard data={safeData} showNumbers={showNumbers} />
                        <ImprovementTipsCard stats={ytdStats} />
                    </View>
                    <View style={styles.col}>
                        <CommissionsCard data={safeData} showNumbers={showNumbers} />
                        <FearGreedCard data={safeData} />
                    </View>
                </View>
            </ScrollView>
        </View>
    );
}

// --- STYLES ---
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212', paddingTop: 50 },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 20, marginBottom: 15,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center' },
    logoContainer: {
        width: 40, height: 40, backgroundColor: '#4ADE80', borderRadius: 12,
        justifyContent: 'center', alignItems: 'center', marginRight: 12,
    },
    headerTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' },
    headerSubtitle: { color: '#888', fontSize: 12 },
    profileIcon: {
        width: 36, height: 36, borderRadius: 18, backgroundColor: '#1F2937',
        justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#374151'
    },
    content: { flex: 1, paddingHorizontal: 16 },
    grid: { flexDirection: 'column', gap: 16 },
    col: { width: '100%' },

    card: {
        backgroundColor: '#18181B', borderRadius: 16, padding: 16, marginBottom: 16,
        borderWidth: 1, borderColor: '#27272A',
    },
    cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
    cardHeaderColumn: { flexDirection: 'column', marginBottom: 16 },
    cardHeader: { marginBottom: 12 }, 
    cardTitle: { color: 'white', fontSize: 16, fontWeight: 'bold' },
    cardSubtitle: { color: '#888', fontSize: 12, marginTop: 2 },

    miniTfContainer: { flexDirection: 'row', backgroundColor: '#27272A', borderRadius: 8, padding: 4 },
    miniTfButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, marginRight: 4 },
    miniTfButtonActive: { backgroundColor: '#3F3F46' },
    miniTfText: { color: '#888', fontSize: 11, fontWeight: '600' },
    miniTfTextActive: { color: '#FFF' },

    perfLabel: { color: '#AAA', fontSize: 12, marginBottom: 4 },
    mainPerfValue: { fontSize: 36, fontWeight: 'bold', marginBottom: 12 },
    moneyMadeText: { fontSize: 14, fontWeight: '600', marginBottom: 12 },
    mainStatContainer: { alignItems: 'center', marginBottom: 20 },

    benchmarksContainer: {
        flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#1F2937',
        padding: 12, borderRadius: 12, marginBottom: 16
    },
    benchmarkBox: { alignItems: 'center', flex: 1 },
    benchLabel: { color: '#9CA3AF', fontSize: 12, marginBottom: 2 },
    benchDiff: { fontSize: 11, fontWeight: '600' },
    vertDivider: { width: 1, height: 30, backgroundColor: '#374151' },

    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
    separator: { height: 1, backgroundColor: '#27272A', marginVertical: 16 },
    sectionLabel: { color: '#888', fontSize: 12, fontWeight: 'bold' },
    expandButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

    historyRowItem: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#27272A'
    },
    historyDate: { color: '#DDD', fontSize: 13 },

    statsContainer: { flexDirection: 'row', marginTop: 0 },
    statBox: { flex: 1, backgroundColor: '#1F2937', borderRadius: 12, padding: 12 },
    statLabel: { color: '#AAA', fontSize: 12, marginBottom: 4 },
    statValue: { color: 'white', fontSize: 18, fontWeight: 'bold' },
    monthlyListContainer: { marginTop: 10 },

    iconBox: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    tipItem: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#27272A', paddingTop: 12 },
    tipTitle: { color: 'white', fontSize: 14, fontWeight: '600' },
    tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    tagText: { fontSize: 10, fontWeight: 'bold' },
    tipDesc: { color: '#888', fontSize: 12, marginTop: 4 },

    // Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { backgroundColor: '#18181B', width: '80%', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#333' },
    modalTitle: { color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 20 },
    settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    settingLabel: { color: 'white', fontSize: 16 },
    settingDesc: { color: '#888', fontSize: 12, marginTop: 2 },
});