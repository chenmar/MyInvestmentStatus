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
import { db } from '../firebaseConfig';

// הפעלת אנימציות לאנדרואיד
if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

const SCREEN_WIDTH = Dimensions.get('window').width;

// --- MAPPINGS ---
const HEBREW_TO_ENGLISH_MONTHS: Record<string, string> = {
    "ינואר": "Jan", "פברואר": "Feb", "מרץ": "Mar", "אפריל": "Apr", 
    "מאי": "May", "יוני": "Jun", "יולי": "Jul", "אוגוסט": "Aug", 
    "ספטמבר": "Sep", "אוקטובר": "Oct", "נובמבר": "Nov", "דצמבר": "Dec",
    "ת. מצטברת": "Total", "ת. ממוצעת": "Avg", "ת. יומית": "Daily"
};

// --- HELPER: Data Logic (Safe) ---
const getSummaryForRange = (range: string, data: any) => {
    // הגנה מפני דאטה חסר
    if (!data || !data.Summary_By_Period) return {};

    // 1. טיפול בטווח 1M
    if (range === '1M') {
        const monthlyData = data.Monthly_Data || [];
        const lastMonth = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1] : {};
        
        return {
            Period: 'Last Month',
            User_Return: lastMonth.User_Monthly_Return || 0,
            SPX_Return: 3.2, 
            NDX_Return: 4.1,
            Total_Fees_Paid: lastMonth.Fees_Paid_This_Month || 0,
            SingleMonthData: lastMonth 
        };
    }

    // 2. טיפול בטווחים שנתיים
    const map: any = {
        'YTD': '2025',
        '1Y': '2024',
        '2Y': 'Last 2 Years',
        '3Y': 'Last 3 Years',
        '5Y': 'Last 5 Years',
        '10Y': 'Last 10 Years'
    };
    const key = map[range] || '2024';
    
    const summary = data.Summary_By_Period.find((p: any) => p.Period && p.Period.includes(key));
    
    // אם לא מצאנו את השנה המבוקשת, ננסה להחזיר את הראשונה או אובייקט ריק (ולא את 2024 בכוח)
    return summary || data.Summary_By_Period[0] || {};
};

// --- COMPONENT: Settings Modal ---
const SettingsModal = ({ visible, onClose, showNumbers, onToggleShowNumbers }: any) => {
    return (
        <Modal
            animationType="fade"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
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
const MiniTimeFrameSelector = ({ selected, onSelect, options }: { selected: string, onSelect: (tf: string) => void, options?: string[] }) => {
    const frames = options || ['1M', 'YTD', '1Y', '3Y', '5Y'];
    return (
        <View style={styles.miniTfContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {frames.map((frame) => (
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

// 1. PERFORMANCE CARD (Safe)
const PerformanceCard = ({ data, showNumbers }: { data: any, showNumbers: boolean }) => {
  const [range, setRange] = useState('1Y');
  const summaryData = getSummaryForRange(range, data);

  // שימוש בערכי ברירת מחדל אם הנתונים חסרים
  const userReturn = summaryData?.User_Return ?? 0;
  const spxReturn = summaryData?.SPX_Return ?? 0;
  const ndxReturn = summaryData?.NDX_Return ?? 0;

  const avgAum = summaryData?.Avg_AUM ?? 0;
  const totalMoneyMade = avgAum * (userReturn / 100);

  const isPositive = userReturn >= 0;
  const chartColor = isPositive ? '#4ADE80' : '#F87171';
  const gradientStart = isPositive ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)';
  const gradientEnd = isPositive ? 'rgba(74, 222, 128, 0.01)' : 'rgba(248, 113, 113, 0.01)';

  let chartData = [{value: 0}];
  const monthlyData = data?.Monthly_Data || [];

  if (['YTD', '1Y'].includes(range)) {
      const year = parseInt(range === 'YTD' ? '2025' : '2024');
      const months = monthlyData.filter((m: any) => m.Year === year);
      if (months.length > 0) {
          chartData = months.map((m: any) => ({
              value: m.User_Monthly_Return || 0,
              label: HEBREW_TO_ENGLISH_MONTHS[m.Month]?.[0] || "?",
              dataPointColor: (m.User_Monthly_Return || 0) >= 0 ? '#4ADE80' : '#F87171'
          }));
      }
  } else if (range === '1M') {
      chartData = [{value: 0}, {value: userReturn}];
  } else {
      // Fallback graph
      chartData = [{value: 0}, {value: userReturn * 0.5}, {value: userReturn}];
  }

  const values = chartData.map(d => d.value);
  const maxVal = Math.max(...values, 2);
  const minVal = Math.min(...values, -2);
  const yMax = maxVal + (Math.abs(maxVal) * 0.25);
  const yMin = minVal - (Math.abs(minVal) * 0.25);

  const formatPct = (val: number) => `${val > 0 ? '+' : ''}${val}%`;
  const getDiffColor = (val1: number, val2: number) => (val1 - val2) >= 0 ? '#4ADE80' : '#F87171';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View>
            <Text style={styles.cardTitle}>Performance</Text>
            <Text style={styles.cardSubtitle}>{summaryData?.Period || "No Data"}</Text>
        </View>
        <MiniTimeFrameSelector selected={range} onSelect={setRange} />
      </View>

      <View style={styles.mainStatContainer}>
          <Text style={styles.perfLabel}>My Return</Text>
          <Text style={[styles.mainPerfValue, {color: chartColor}]}>
              {formatPct(userReturn)}
          </Text>
          {showNumbers && totalMoneyMade !== 0 && (
              <Text style={[styles.moneyMadeText, {color: totalMoneyMade >= 0 ? '#4ADE80' : '#F87171'}]}>
                  {totalMoneyMade > 0 ? '+' : ''}₪{Math.round(totalMoneyMade).toLocaleString()}
              </Text>
          )}
      </View>

      <View style={styles.benchmarksContainer}>
          <View style={styles.benchmarkBox}>
              <Text style={styles.benchLabel}>vs S&P 500 ({formatPct(spxReturn)})</Text>
              <Text style={[styles.benchDiff, {color: getDiffColor(userReturn, spxReturn)}]}>
                  {formatPct(parseFloat((userReturn - spxReturn).toFixed(2)))}
              </Text>
          </View>
          <View style={styles.vertDivider} />
          <View style={styles.benchmarkBox}>
              <Text style={styles.benchLabel}>vs NDX 100 ({formatPct(ndxReturn)})</Text>
              <Text style={[styles.benchDiff, {color: getDiffColor(userReturn, ndxReturn)}]}>
                  {formatPct(parseFloat((userReturn - ndxReturn).toFixed(2)))}
              </Text>
          </View>
      </View>

      <View style={{marginTop: 16, alignItems: 'center'}}>
           <LineChart 
              data={chartData} 
              height={160} 
              width={SCREEN_WIDTH - 70}
              thickness={3}
              curved
              color={chartColor}
              startFillColor={gradientStart}
              endFillColor={gradientEnd}
              startOpacity={0.9}
              endOpacity={0.1}
              areaChart
              maxValue={yMax}
              minValue={yMin}
              hideRules
              yAxisThickness={0}
              xAxisThickness={1}
              xAxisColor="#333"
              yAxisTextStyle={{color: '#666', fontSize: 10}}
              xAxisLabelTextStyle={{color: '#999', fontSize: 10}}
              hideDataPoints={false}
              dataPointsColor={chartColor}
              dataPointsRadius={3}
           />
      </View>
    </View>
  );
};

// --- 2. FEAR & GREED (Safe) ---
const MOCK_HISTORY = [
    { date: 'Today', value: 24, label: 'Extreme Fear' },
    { date: 'Yesterday', value: 22, label: 'Extreme Fear' },
    { date: '1 Week Ago', value: 21, label: 'Extreme Fear' },
    { date: '1 Month Ago', value: 45, label: 'Fear' },
];

const FearGreedGauge = ({ value }: { value: number }) => {
    const score = value; 
    let label = "Neutral";
    let color = "#FACC15"; 
    
    if (score >= 75) { label = "Extreme Greed"; color = "#22c55e"; } 
    else if (score >= 55) { label = "Greed"; color = "#4ADE80"; }
    else if (score <= 25) { label = "Extreme Fear"; color = "#ef4444"; }
    else if (score <= 45) { label = "Fear"; color = "#F87171"; }

    return (
        <View style={{alignItems: 'center', marginVertical: 10}}>
            <Svg height="110" width="220" viewBox="0 0 200 110">
                <Path d="M20,100 A80,80 0 0,1 180,100" fill="none" stroke="#333" strokeWidth="12" strokeLinecap="round"/>
                <Path 
                    d="M20,100 A80,80 0 0,1 180,100" 
                    fill="none" stroke={color} strokeWidth="12" 
                    strokeDasharray={`${(score/100) * 251}, 251`} strokeLinecap="round"
                />
                 <G rotation={(score / 100) * 180 - 90} origin="100, 100">
                   <Path d="M100,100 L100,30" stroke="white" strokeWidth="4" />
                   <Circle cx="100" cy="100" r="6" fill="white" />
                </G>
            </Svg>
            <Text style={{color: color, fontSize: 32, fontWeight: 'bold', marginTop: -20}}>
                {value}
            </Text>
            <Text style={{color: '#AAA', fontSize: 16, fontWeight: '600', marginTop: 4}}>{label}</Text>
            <Text style={{color: '#666', fontSize: 12, marginTop: 4}}>Updated: Today</Text>
        </View>
    );
};

const FearGreedCard = ({ data }: { data: any }) => {
    const [expanded, setExpanded] = useState(false);
    // שימוש בברירת מחדל אם אין נתונים
    const currentVix = getSummaryForRange('YTD', data)?.Fear_Greed_Score || 24;

    const toggleExpand = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(!expanded);
    };

    return (
        <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Fear & Greed Index</Text>
                <Feather name="info" size={16} color="#666" />
            </View>
            
            <FearGreedGauge value={currentVix} />
            <View style={styles.separator} />
            
            <TouchableOpacity onPress={toggleExpand} style={styles.expandButton}>
                <Text style={styles.sectionLabel}>Historical Values</Text>
                <Feather name={expanded ? "chevron-up" : "chevron-down"} size={20} color="#888" />
            </TouchableOpacity>
            
            {expanded && (
                <View style={{marginTop: 12}}>
                    {MOCK_HISTORY.map((item, index) => (
                        <View key={index} style={styles.historyRowItem}>
                            <Text style={styles.historyDate}>{item.date}</Text>
                            <View style={{flexDirection:'row', alignItems:'center'}}>
                                <Text style={{color: 'white', marginRight: 8}}>{item.value}</Text>
                                <View style={[
                                    styles.historyTag, 
                                    {backgroundColor: item.value > 50 ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)'}
                                ]}>
                                    <Text style={[
                                        styles.historyTagText, 
                                        {color: item.value > 50 ? '#4ADE80' : '#F87171'}
                                    ]}>{item.label}</Text>
                                </View>
                            </View>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
};

// 3. COMMISSIONS CARD (Safe)
const CommissionsCard = ({ data, showNumbers }: { data: any, showNumbers: boolean }) => {
    const [range, setRange] = useState('1Y');
    const [expanded, setExpanded] = useState(false);
    
    const summaryData = getSummaryForRange(range, data);
    
    // הגנה אם אין נתונים
    const totalFees = summaryData?.Total_Fees_Paid ?? 0;
    const mgmtPercent = summaryData?.Management_Fee_Percent ?? 0;
    const periodLabel = summaryData?.Period ?? range;
    
    const isSingleYear = !periodLabel.includes("Last");
    let monthlyDetails: any[] = [];
    let barData: any[] = [];
    
    if (isSingleYear) {
        const year = parseInt(periodLabel.includes('Month') ? '2025' : periodLabel);
        const monthlyData = data?.Monthly_Data || [];
        
        if (range === '1M') {
             const lastMonth = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1] : null;
             if(lastMonth) monthlyDetails = [lastMonth];
        } else {
             monthlyDetails = monthlyData.filter((m: any) => m.Year === year);
        }
        
        barData = monthlyDetails.map((m: any) => ({
            value: m.Fees_Paid_This_Month || 0,
            label: HEBREW_TO_ENGLISH_MONTHS[m.Month]?.substring(0,3) || m.Month,
            frontColor: '#F87171'
        }));
    } else {
        const allYears = data?.Summary_By_Period?.filter((p: any) => /^\d{4}$/.test(p.Period)) || [];
        allYears.sort((a: any, b: any) => parseInt(a.Period) - parseInt(b.Period));

        const yearsCount = range === '10Y' ? 10 : (range === '5Y' ? 5 : 3);
        const relevantYears = allYears.slice(-yearsCount);

        barData = relevantYears.map((yearData: any) => ({
            value: yearData.Total_Fees_Paid || 0,
            label: yearData.Period.substring(2, 4), 
            frontColor: '#F87171',
            topLabelComponent: () => showNumbers ? (
                <Text style={{color: '#AAA', fontSize: 9, marginBottom: 2}}>
                    {yearData.Total_Fees_Paid > 1000 ? (yearData.Total_Fees_Paid/1000).toFixed(1)+'k' : Math.round(yearData.Total_Fees_Paid)}
                </Text>
            ) : null
        }));
    }

    const toggleExpand = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(!expanded);
    };

    return (
        <View style={styles.card}>
            <View style={styles.cardHeaderColumn}>
                <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>Fees & Commissions</Text>
                    <Text style={styles.cardSubtitle}>{periodLabel}</Text>
                </View>
                <View style={{marginTop: 12, width: '100%'}}>
                   <MiniTimeFrameSelector 
                        selected={range} 
                        onSelect={setRange} 
                        options={['1M', '1Y', '3Y', '5Y', '10Y']} 
                   />
                </View>
            </View>

            <View style={styles.statsContainer}>
                <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Total Paid</Text>
                    <Text style={[styles.statValue, {color: '#F87171'}]}>
                        {showNumbers ? `₪${totalFees.toLocaleString()}` : '****'}
                    </Text>
                </View>
                
                <View style={[styles.statBox, {marginLeft: 12}]}>
                    <Text style={styles.statLabel}>Avg Mgmt Fee %</Text>
                    <Text style={styles.statValue}>{mgmtPercent}%</Text>
                </View>
            </View>

            <View style={{marginTop: 20, height: 180, justifyContent: 'center', alignItems:'center'}}>
                {barData.length > 0 ? (
                    <BarChart 
                        data={barData}
                        barWidth={range === '1M' ? 40 : (isSingleYear ? 16 : 20)}
                        noOfSections={3}
                        barBorderRadius={4}
                        frontColor="#1F2937"
                        yAxisThickness={0}
                        xAxisThickness={0}
                        yAxisTextStyle={{color: '#666', fontSize: 10}}
                        xAxisLabelTextStyle={{color: '#999', fontSize: 10}}
                        height={130}
                        width={SCREEN_WIDTH * 0.75}
                        isAnimated
                        showYAxisIndices={false}
                        hideYAxisText={!showNumbers}
                    />
                ) : (
                    <Text style={{color: '#444', textAlign: 'center', fontStyle: 'italic'}}>
                        No data available
                    </Text>
                )}
            </View>

            {/* Monthly List */}
            {isSingleYear && monthlyDetails.length > 0 && (
                <View style={styles.monthlyListContainer}>
                    <View style={styles.separator} />
                    <TouchableOpacity onPress={toggleExpand} style={styles.expandButton}>
                        <Text style={styles.sectionLabel}>Monthly Breakdown</Text>
                        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={20} color="#888" />
                    </TouchableOpacity>
                    
                    {expanded && (
                        <View style={{marginTop: 12}}>
                             <View style={[styles.historyRowItem, {borderBottomWidth: 0, paddingBottom: 4}]}>
                                <Text style={[styles.historyDate, {color:'#888', fontSize: 10}]}>MONTH</Text>
                                <View style={{flexDirection:'row', width: 120, justifyContent:'space-between'}}>
                                    <Text style={{color:'#888', fontSize: 10}}>FEE %</Text>
                                    <Text style={{color:'#888', fontSize: 10}}>AMOUNT</Text>
                                </View>
                            </View>
                            {monthlyDetails.map((item: any, idx: number) => {
                                const feeAmount = item.Fees_Paid_This_Month || 0;
                                const accVal = item.Account_Value || 0;
                                const monthlyFeePct = accVal > 0 
                                    ? ((feeAmount / accVal) * 100).toFixed(3) 
                                    : "0.000";
                                    
                                return (
                                    <View key={idx} style={styles.historyRowItem}>
                                        <Text style={styles.historyDate}>
                                            {HEBREW_TO_ENGLISH_MONTHS[item.Month] || item.Month}
                                        </Text>
                                        <View style={{flexDirection:'row', width: 120, justifyContent:'space-between', alignItems:'center'}}>
                                            <Text style={{color: '#AAA', fontSize: 12}}>{monthlyFeePct}%</Text>
                                            <Text style={{color: feeAmount > 0 ? '#F87171' : '#666'}}>
                                                {showNumbers ? `₪${feeAmount.toLocaleString()}` : '****'}
                                            </Text>
                                        </View>
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

// 4. TIPS CARD
const ImprovementTipsCard = ({ summaryData }: { summaryData: any }) => {
    const mgmtFee = parseFloat(summaryData?.Management_Fee_Percent || "0");
    const isHighFees = mgmtFee > 0.5; 

    return (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                    <View style={[styles.iconBox, {backgroundColor: '#4ADE80'}]}>
                        <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color="black" />
                    </View>
                    <View style={{marginLeft: 10}}>
                        <Text style={styles.cardTitle}>AI Tips</Text>
                    </View>
                </View>
            </View>
            
            {isHighFees ? (
                <View style={styles.tipItem}>
                    <View style={styles.rowBetween}>
                        <Text style={styles.tipTitle}>Fee Optimization</Text>
                        <View style={[styles.tag, {backgroundColor: 'rgba(248, 113, 113, 0.2)'}]}>
                            <Text style={[styles.tagText, {color: '#F87171'}]}>High Impact</Text>
                        </View>
                    </View>
                    <Text style={styles.tipDesc}>
                        Management fees are {mgmtFee}%, above 0.5%. Consider negotiating.
                    </Text>
                </View>
            ) : (
                 <View style={styles.tipItem}>
                    <Text style={styles.tipTitle}>Great Fees!</Text>
                    <Text style={styles.tipDesc}>Your fees are low ({mgmtFee}%). Good job.</Text>
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
            // וודא שה-import של db ו-doc מוגדרים נכון
            const docRef = doc(db, "portfolio", "latest_report");
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                setReportData(docSnap.data());
            } else {
                console.log("No document!");
                // fallback for demo if empty
                setReportData({ Summary_By_Period: [], Monthly_Data: [] }); 
            }
        } catch (e) {
            console.error("Fetch error:", e);
        } finally {
            setLoading(false);
        }
    };
    fetchData();
  }, []);

  if (loading) {
      return (
          <View style={[styles.container, {justifyContent:'center', alignItems:'center'}]}>
              <ActivityIndicator size="large" color="#4ADE80" />
          </View>
      );
  }

  // Safe check if data exists
  const safeData = reportData || { Summary_By_Period: [], Monthly_Data: [] };
  const latestData = getSummaryForRange('1Y', safeData);

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
      
      <ScrollView style={styles.content} contentContainerStyle={{paddingBottom: 40}}>
        <View style={styles.grid}>
            <View style={styles.col}>
                <PerformanceCard data={safeData} showNumbers={showNumbers} />
                <ImprovementTipsCard summaryData={latestData} />
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
  benchValue: { color: 'white', fontSize: 15, fontWeight: 'bold', marginRight: 6 },
  benchDiff: { fontSize: 11, fontWeight: '600' },
  vertDivider: { width: 1, height: 30, backgroundColor: '#374151' },
  
  alphaBadge: { 
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', 
      paddingVertical: 8, borderRadius: 8, marginBottom: 10 
  },
  alphaText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
  separator: { height: 1, backgroundColor: '#27272A', marginVertical: 16 },
  sectionLabel: { color: '#888', fontSize: 12, fontWeight: 'bold' },
  expandButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  
  historyRowItem: { 
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', 
      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#27272A' 
  },
  historyDate: { color: '#DDD', fontSize: 13 },
  historyTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  historyTagText: { fontSize: 11, fontWeight: '600' },

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