# 🎯 Pulse Score System - Complete Technical Breakdown

## Executive Summary

The **Pulse Score** is a dynamic, machine-learning-powered metric (0-100) that measures venue atmosphere optimization. Unlike traditional static formulas, it **progressively learns** each venue's unique "success conditions" based on historical performance data (customer dwell time, occupancy, revenue).

**Key Innovation:** The score starts with generic industry standards and smoothly transitions to venue-specific learned patterns over time, ensuring it's always functional while continuously improving accuracy.

---

## 📊 Core Philosophy

### Traditional Approach (OLD) ❌
```
"300+ lux is always good"
"72-76°F is always optimal"  
"≤75 dB is always comfortable"
```
**Problem:** A nightclub and fine dining restaurant have completely different optimal conditions!

### Progressive Learning Approach (NEW) ✅
```
"What environmental conditions led to YOUR customers staying longest?"
"When did YOUR venue perform best?"
"What's YOUR unique success formula?"
```
**Solution:** Learn venue-specific patterns while maintaining a safety baseline.

---

## 🧮 The Formula

### **Final Pulse Score Calculation**

```typescript
PulseScore = (GenericScore × GenericWeight) + (LearnedScore × LearnedWeight)

Where:
  GenericWeight = 1 - LearningConfidence  (100% → 10%)
  LearnedWeight = LearningConfidence      (0% → 90%)
  
  Always: GenericWeight + LearnedWeight = 100%
```

### **Score Range:** 0-100

### **Status Categories:**
| Score | Status | Color | Meaning |
|-------|--------|-------|---------|
| 80-100 | Excellent | 🟢 Green | Optimal atmosphere |
| 60-79 | Good | 🔵 Cyan | Comfortable environment |
| 40-59 | Fair | 🟡 Yellow | Needs improvement |
| 0-39 | Poor | 🔴 Red | Suboptimal conditions |

---

## 📈 Progressive Learning Timeline

### **Phase 1: Cold Start (Day 1-7)**
```
Learning Confidence: 0-10%
Formula Blend: 90-100% Generic + 0-10% Learned

Status: "Learning your venue..."
Behavior: Uses industry standard ranges
- Temperature: 72-76°F
- Light: ≥300 lux
- Sound: ≤75 dB  
- Humidity: 40-60%
```

**Example:**
```
Nightclub on Day 3:
  Current: 68°F, 150 lux, 85 dB
  Generic Score: 55 (thinks it's too loud, too dark, too cool)
  Learned Score: N/A
  Final Score: 55 × 100% = 55
```

---

### **Phase 2: Early Learning (Day 8-30)**
```
Learning Confidence: 10-30%
Formula Blend: 70-90% Generic + 10-30% Learned

Status: "Analyzing patterns..."
Behavior: Beginning to blend venue-specific data
```

**Example:**
```
Nightclub on Day 15:
  Current: 68°F, 150 lux, 85 dB
  Generic Score: 55
  Learned Score: 72 (starting to see these conditions work!)
  Confidence: 20%
  Final Score: (55 × 0.80) + (72 × 0.20) = 44 + 14.4 = 58
```

---

### **Phase 3: Active Learning (Day 31-60)**
```
Learning Confidence: 30-60%
Formula Blend: 40-70% Generic + 30-60% Learned

Status: "Refining optimal ranges..."
Behavior: Balanced blend of generic and learned
```

**Example:**
```
Nightclub on Day 45:
  Current: 68°F, 150 lux, 85 dB
  Generic Score: 55
  Learned Score: 88 (knows these conditions = packed dance floor!)
  Confidence: 45%
  Final Score: (55 × 0.55) + (88 × 0.45) = 30.25 + 39.6 = 70
```

---

### **Phase 4: Advanced Learning (Day 61-90)**
```
Learning Confidence: 60-90%
Formula Blend: 10-40% Generic + 60-90% Learned

Status: "High confidence in your data"
Behavior: Mostly learned, minimal generic baseline
```

**Example:**
```
Nightclub on Day 75:
  Current: 68°F, 150 lux, 85 dB
  Generic Score: 55
  Learned Score: 92 (perfect conditions for YOUR venue!)
  Confidence: 75%
  Final Score: (55 × 0.25) + (92 × 0.75) = 13.75 + 69 = 83
```

---

### **Phase 5: Fully Optimized (Day 91+)**
```
Learning Confidence: 90% (capped)
Formula Blend: 10% Generic + 90% Learned

Status: "Optimized for your venue"
Behavior: Fully venue-specific with safety baseline
```

**Example:**
```
Nightclub on Day 120:
  Current: 68°F, 150 lux, 85 dB
  Generic Score: 55
  Learned Score: 95 (knows this is YOUR optimal atmosphere!)
  Confidence: 90%
  Final Score: (55 × 0.10) + (95 × 0.90) = 5.5 + 85.5 = 91 ✅
```

---

## 🔬 Detailed Component Breakdown

### **1. Generic Score (Baseline Formula)**

Uses industry-standard environmental ranges:

```typescript
GenericScore = Average of 4 factors:
  1. Temperature Score (25%)
  2. Light Score (25%)
  3. Sound Score (25%)
  4. Humidity Score (25%)
```

#### **Temperature Score:**
```
Optimal: 72-76°F → 100 points
Acceptable: 68-80°F → Scaled (100 - distance × 12.5)
Poor: <68°F or >80°F → 0 points

Example:
  74°F → 100 points (in optimal range)
  78°F → 100 - (2 × 12.5) = 75 points
  68°F → 100 - (4 × 12.5) = 50 points
```

#### **Light Score:**
```
Optimal: ≥300 lux → 100 points
Below: <300 lux → (current / 300) × 100

Example:
  350 lux → 100 points
  250 lux → (250 / 300) × 100 = 83 points
  150 lux → (150 / 300) × 100 = 50 points
```

#### **Sound Score:**
```
Optimal: ≤75 dB → 100 points
Above: >75 dB → 100 - ((dB - 75) × 2)

Example:
  72 dB → 100 points
  80 dB → 100 - (5 × 2) = 90 points
  90 dB → 100 - (15 × 2) = 70 points
```

#### **Humidity Score:**
```
Optimal: 40-60% → 100 points
Acceptable: 30-70% → Scaled (100 - distance × 5)
Poor: <30% or >70% → 0 points

Example:
  50% → 100 points
  65% → 100 - (5 × 5) = 75 points
  75% → 0 points
```

---

### **2. Learned Score (Venue-Specific Formula)**

Based on historical analysis of top 20% performance hours:

```typescript
LearnedScore = Weighted Average:
  (TempScore × TempWeight) +
  (LightScore × LightWeight) +
  (SoundScore × SoundWeight) +
  (HumidityScore × HumidityWeight)

Where weights are learned from correlation analysis
```

#### **Learning Process:**

**Step 1: Data Collection**
```typescript
For each hour of operation, store:
{
  timestamp: "2024-12-09T20:00:00Z",
  environmental: {
    temperature: 68.5,
    light: 210,
    sound: 82,
    humidity: 48
  },
  performance: {
    avgDwellTimeMinutes: 145,  // How long customers stayed
    avgOccupancy: 87,           // Average people count
    entryCount: 134,
    exitCount: 128,
    retentionRate: 0.955,       // % who stayed vs left
    revenue: 4250               // Optional POS data
  }
}
```

**Step 2: Identify Top Performers**
```typescript
Sort all hours by performance metric (dwell time or revenue)
Take top 20% of hours
Extract environmental conditions during those hours
```

**Step 3: Calculate Optimal Ranges**
```typescript
For each environmental factor:
  - Calculate mean of top 20% hours
  - Calculate standard deviation
  - Optimal Range = mean ± (0.75 × std dev)
  
Example for Nightclub Temperature:
  Top 20% hours: [68, 67, 69, 68, 70, 67, 69, 68, ...]
  Mean: 68.2°F
  Std Dev: 1.3°F
  Optimal Range: 67.2 - 69.2°F (rounded to 67-70°F)
```

**Step 4: Calculate Factor Weights**
```typescript
Analyze variance of each factor in top-performing hours
Factors with higher variance = more important
Normalize to sum = 1.0

Example Nightclub Weights:
  temperature: 0.22  (consistent, less critical)
  light: 0.26        (moderate variation)
  sound: 0.38        (highest variation = most important!)
  humidity: 0.14     (low variation, less controllable)
```

**Step 5: Score Current Conditions**
```typescript
For each factor:
  If value is WITHIN learned optimal range:
    Score = 100
  
  If value is OUTSIDE learned optimal range:
    Calculate deviation from range
    Apply tolerance (20% of range width)
    Score = 100 - (deviation / tolerance) × 100
    Minimum = 0

Example:
  Learned Optimal Temperature: 67-70°F
  Current Temperature: 68°F
  Score: 100 (within range) ✅
  
  Current Temperature: 72°F
  Range width: 3°F, Tolerance: 0.6°F
  Deviation: 2°F
  Score: 100 - (2 / 0.6) × 100 = 0 (exceeded tolerance)
```

---

## 🎯 Real-World Examples

### **Example 1: High-Energy Nightclub**

**After 90 Days of Learning:**

**Learned Optimal Ranges:**
- Temperature: 66-69°F (cool, energetic)
- Light: 100-180 lux (dark, moody atmosphere)
- Sound: 85-95 dB (loud music, energetic)
- Humidity: 40-50%

**Learned Weights:**
- Sound: 40% (most important for vibe)
- Light: 30% (creates mood)
- Temperature: 20% (keeps people comfortable while dancing)
- Humidity: 10% (less controllable)

**Current Conditions:**
```
Temperature: 67°F
Light: 150 lux
Sound: 88 dB
Humidity: 45%

Generic Score: 62 (thinks it's too loud, too dark)
Learned Score: 96 (knows this is perfect for YOUR club!)

Confidence: 90%
Final Score: (62 × 0.10) + (96 × 0.90) = 6.2 + 86.4 = 93 🎉

Status: Excellent - "Your atmosphere is optimized for peak engagement"
```

---

### **Example 2: Fine Dining Restaurant**

**After 90 Days of Learning:**

**Learned Optimal Ranges:**
- Temperature: 72-75°F (comfortable, relaxed)
- Light: 250-350 lux (warm, visible)
- Sound: 65-72 dB (conversational)
- Humidity: 45-55%

**Learned Weights:**
- Temperature: 35% (critical for comfort during long meals)
- Light: 30% (ambiance and food presentation)
- Sound: 25% (allows conversation)
- Humidity: 10%

**Current Conditions:**
```
Temperature: 74°F
Light: 300 lux
Sound: 68 dB
Humidity: 50%

Generic Score: 98 (industry standards match restaurant well)
Learned Score: 95 (confirms these work for YOUR diners)

Confidence: 90%
Final Score: (98 × 0.10) + (95 × 0.90) = 9.8 + 85.5 = 95 ✅

Status: Excellent - "Exceptional atmosphere!"
```

---

### **Example 3: Sports Bar**

**After 60 Days of Learning:**

**Learned Optimal Ranges:**
- Temperature: 69-73°F (moderate)
- Light: 200-280 lux (bright enough to see TVs)
- Sound: 75-82 dB (moderate, allows group conversation)
- Humidity: 42-52%

**Learned Weights:**
- Light: 35% (TV visibility critical)
- Sound: 30% (balance between TVs and conversation)
- Temperature: 25% (active crowd)
- Humidity: 10%

**Current Conditions:**
```
Temperature: 71°F
Light: 240 lux
Sound: 78 dB
Humidity: 48%

Generic Score: 88 (pretty close to standards)
Learned Score: 92 (slightly better for YOUR sports bar)

Confidence: 60%
Final Score: (88 × 0.40) + (92 × 0.60) = 35.2 + 55.2 = 90 ✅

Status: Excellent - "Your atmosphere is optimized!"
```

---

## 💾 Data Architecture

### **DynamoDB Tables**

#### **1. VenuePerformanceHistory**
```typescript
{
  venueId: "venue123",           // Partition Key
  timestamp: "2024-12-09T20:00", // Sort Key
  hour: 20,                      // 0-23
  dayOfWeek: 2,                  // 0-6 (Sunday=0)
  
  environmental: {
    temperature: 68.5,
    light: 210,
    sound: 82,
    humidity: 48
  },
  
  performance: {
    avgDwellTimeMinutes: 145,
    avgOccupancy: 87,
    peakOccupancy: 92,
    entryCount: 134,
    exitCount: 128,
    retentionRate: 0.955,
    revenue: 4250.00            // Optional
  }
}
```

**Storage:** ~1440 records per venue (90 days × 16 hours/day)

---

#### **2. VenueOptimalRanges**
```typescript
{
  venueId: "venue123",           // Partition Key
  lastCalculated: "2024-12-09",
  dataPointsAnalyzed: 1440,
  learningConfidence: 0.75,      // 0-0.90
  
  optimalRanges: {
    temperature: { min: 67, max: 70, confidence: 0.82 },
    light: { min: 160, max: 210, confidence: 0.78 },
    sound: { min: 78, max: 86, confidence: 0.85 },
    humidity: { min: 42, max: 52, confidence: 0.68 }
  },
  
  weights: {
    temperature: 0.22,
    light: 0.26,
    sound: 0.38,
    humidity: 0.14
  },
  
  benchmarks: {
    avgDwellTimeTop20: 185,      // minutes
    avgOccupancyTop20: 94,       // people
    avgRevenueTop20: 5850        // dollars
  }
}
```

**Storage:** 1 record per venue (updated nightly)

---

## 🚀 Implementation Details

### **Frontend (Real-Time Calculation)**

```typescript
// src/utils/comfort.ts
export async function calculatePulseScore(
  venueId: string,
  currentData: SensorData
): Promise<PulseScoreResult> {
  
  // Step 1: Calculate generic baseline
  const genericScore = calculateGenericScore(currentData);
  
  // Step 2: Get learning confidence
  const confidence = await pulseLearningService
    .calculateLearningConfidence(venueId);
  
  // Step 3: Get learned ranges (if available)
  let learnedScore = null;
  if (confidence > 0) {
    const ranges = await pulseLearningService
      .getOptimalRanges(venueId);
    
    if (ranges) {
      learnedScore = pulseLearningService
        .calculateLearnedScore(currentData, ranges);
    }
  }
  
  // Step 4: Blend scores
  const weights = pulseLearningService.calculateWeights(confidence);
  const finalScore = learnedScore !== null
    ? Math.round(
        (genericScore * weights.genericWeight) + 
        (learnedScore * weights.learnedWeight)
      )
    : genericScore;
  
  // Step 5: Return result with metadata
  return {
    score: finalScore,
    confidence,
    status: getStatus(confidence),
    statusMessage: getStatusMessage(confidence),
    breakdown: {
      genericScore,
      learnedScore,
      weights,
      optimalRanges,
      factorScores
    }
  };
}
```

---

### **Backend (Learning Job - AWS Lambda)**

**Schedule:** Nightly at 2 AM (low traffic)

```typescript
// lambda/pulse-learning-job.ts
export async function handler(event: any) {
  // Get all venues that need recalculation
  const venues = await getActiveVenues();
  
  for (const venue of venues) {
    try {
      // Fetch last 90 days of performance data
      const performanceData = await dynamoDB
        .query({
          TableName: 'VenuePerformanceHistory',
          KeyConditionExpression: 'venueId = :vid AND timestamp > :cutoff',
          ExpressionAttributeValues: {
            ':vid': venue.venueId,
            ':cutoff': getDate90DaysAgo()
          }
        });
      
      // Require minimum 24 hours of data
      if (performanceData.length < 24) {
        continue;
      }
      
      // Analyze and extract optimal ranges
      const optimalRanges = analyzePerformanceData(performanceData);
      
      // Save to VenueOptimalRanges table
      await dynamoDB.put({
        TableName: 'VenueOptimalRanges',
        Item: optimalRanges
      });
      
      console.log(`Updated ranges for ${venue.venueId}`);
      
    } catch (error) {
      console.error(`Error processing ${venue.venueId}:`, error);
    }
  }
  
  return { statusCode: 200, body: 'Learning job complete' };
}
```

---

### **Data Collection (Hourly Aggregation - AWS Lambda)**

**Schedule:** Every hour

```typescript
// lambda/aggregate-performance.ts
export async function handler(event: any) {
  const now = new Date();
  const hourStart = new Date(now.setMinutes(0, 0, 0));
  const hourEnd = new Date(hourStart.getTime() + 3600000);
  
  const venues = await getActiveVenues();
  
  for (const venue of venues) {
    // Get all sensor readings for the past hour
    const sensorData = await getSensorDataForHour(
      venue.venueId, 
      hourStart, 
      hourEnd
    );
    
    if (sensorData.length === 0) continue;
    
    // Calculate hourly averages
    const environmental = {
      temperature: average(sensorData.map(d => d.indoorTemp)),
      light: average(sensorData.map(d => d.light)),
      sound: average(sensorData.map(d => d.decibels)),
      humidity: average(sensorData.map(d => d.humidity))
    };
    
    // Calculate performance metrics
    const performance = calculatePerformanceMetrics(sensorData);
    
    // Store aggregated record
    await dynamoDB.put({
      TableName: 'VenuePerformanceHistory',
      Item: {
        venueId: venue.venueId,
        timestamp: hourStart.toISOString(),
        hour: hourStart.getHours(),
        dayOfWeek: hourStart.getDay(),
        environmental,
        performance
      }
    });
  }
  
  return { statusCode: 200 };
}
```

---

## 📱 UI Display

### **Pulse Score Component**

**Shows:**
1. **Score Display** - Large circular gauge (0-100)
2. **Learning Status Badge** - Progress indicator
3. **Score Blend Info** - Shows generic vs learned contribution
4. **Factor Breakdown** - Individual scores for temp, light, sound, humidity

**Learning Status Indicators:**

```tsx
// Day 1-30: Yellow badge
<Badge color="yellow">
  <Clock /> Learning your venue... 15% complete
</Badge>

// Day 31-70: Blue badge
<Badge color="blue">
  <TrendingUp /> Refining ranges... 55% confidence
</Badge>

// Day 71+: Green badge
<Badge color="green">
  <CheckCircle /> Optimized for your venue - 85%
</Badge>
```

**Score Blend Display:**

```tsx
{pulseScoreResult.confidence > 0 && (
  <div className="blend-info">
    <Sparkles /> Progressive Learning Active
    
    Generic Baseline: 62 × 10% = 6.2
    Your Venue Data: 95 × 90% = 85.5
    ────────────────────────────
    Final Score: 92
  </div>
)}
```

---

## 🔧 Configuration & Tuning

### **Adjustable Parameters:**

```typescript
// In pulse-learning.service.ts

LEARNING_CAP = 0.90              // Max learned weight (90%)
MIN_DATA_POINTS = 24             // Minimum hours before learning
TOP_PERFORMANCE_PERCENTILE = 0.20 // Top 20% of hours
TOLERANCE_RANGE = 0.20            // 20% tolerance outside optimal
STD_DEV_MULTIPLIER = 0.75         // Range width calculation
```

### **Why These Values?**

- **90% Cap:** Always keep 10% generic baseline as safety net
- **24 Hours Min:** Need at least 1 day of data for meaningful analysis
- **Top 20%:** Focus on best performance, not average
- **20% Tolerance:** Allow some flexibility outside optimal range
- **0.75 Std Dev:** Captures ~55% of data (focused on peak, not outliers)

---

## ✅ Benefits of This System

### **1. Always Functional**
- Score available from Day 1
- Never breaks or shows errors
- Graceful degradation if learning fails

### **2. Continuously Improving**
- Gets more accurate every day
- Automatically adapts to seasonal changes
- No manual recalibration needed

### **3. Venue-Specific**
- Learns each venue's unique "success formula"
- Accounts for business type differences
- Considers local customer preferences

### **4. Transparent**
- Users see learning progress
- Shows blend of generic vs learned
- Displays confidence level

### **5. Data-Driven**
- Based on actual performance (dwell time, revenue)
- Not arbitrary industry standards
- Proven correlation with business success

### **6. Self-Correcting**
- Bad data gets washed out by good data
- Continuous recalculation prevents drift
- 10% generic baseline prevents going off-track

---

## 🎓 Key Takeaways

1. **Progressive Learning:** Score transitions from 100% generic → 90% learned over 90+ days

2. **Performance-Based:** Learns from hours when customers stayed longest / spent most

3. **Venue-Specific:** Nightclub optimal ≠ Restaurant optimal ≠ Sports Bar optimal

4. **Always Functional:** Never requires "training period" - works from Day 1

5. **Weighted Factors:** Learns which environmental factors matter most for YOUR venue

6. **Transparent:** Shows users the learning progress and score breakdown

7. **Safe:** 10% generic baseline prevents complete reliance on potentially bad data

---

## 📊 Success Metrics

### **How to Know It's Working:**

1. **Score Accuracy:** Does high Pulse Score correlate with high dwell time/revenue?
2. **Learning Progress:** Does confidence increase steadily over time?
3. **User Trust:** Do venue managers understand and trust the score?
4. **Action Items:** Does a low score lead to actionable insights?
5. **Business Impact:** Do venues see improvement after optimizing for Pulse Score?

---

## 🚀 Future Enhancements

### **Phase 2 Features:**
- **Time-of-Day Learning:** Different optimal ranges for lunch vs dinner vs late night
- **Day-of-Week Learning:** Weekend vs weekday patterns
- **Event Detection:** Special handling for concerts, sports games, holidays
- **Predictive Scoring:** "If you adjust X, score will likely increase by Y"
- **A/B Testing:** "Try this temperature range tonight and compare"

### **Phase 3 Features:**
- **Multi-Location Learning:** Chain restaurants share insights
- **Genre-Based Learning:** "Venues like yours perform best at..."
- **Weather Integration:** Adjust expectations based on outdoor conditions
- **Real-Time Recommendations:** Push notifications when score drops

---

## 📞 Support & Questions

**Technical Questions:** Contact dev team  
**Business Logic Questions:** Contact product team  
**Data Science Questions:** Contact analytics team

---

**Document Version:** 1.0  
**Last Updated:** December 9, 2024  
**Author:** Pulse Development Team  
**Status:** ✅ Implemented & Active
