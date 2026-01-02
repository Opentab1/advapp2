# Pulse Dashboard Rebuild Specification

**Version:** 1.0  
**Date:** December 31, 2024  
**Status:** AWAITING APPROVAL  

---

## Design Philosophy

**"Calm Surface, Intense Depth"**

- **Layer 0:** 3-second glance — score, status, one action
- **Layer 1:** 10-second understanding — why this action, with data
- **Layer 2:** 2-minute deep dive — full breakdowns, trends
- **Layer 3:** 15-minute analytics — charts, exports, historical

Each layer is opt-in. The user controls the depth.

---

## Navigation Structure

### Before (5 tabs, confusing)
```
[ Pulse+ ] [ At a Glance ] [ Songs ] [ Reports ] [ Settings ]
```

### After (4 tabs, clear hierarchy)
```
[ Pulse ] [ History ] [ Songs ] [ Settings ]
```

| Tab | Icon | Purpose |
|-----|------|---------|
| **Pulse** | ⚡ (Zap) | THE home. Score, action, progressive disclosure |
| **History** | 📊 (BarChart2) | Trends, charts, comparisons, exports |
| **Songs** | 🎵 (Music) | Song log (keep as-is) |
| **Settings** | ⚙️ (Settings) | Settings (keep as-is) |

---

## Component Architecture

### App Shell

```
src/
├── App.tsx                    # Router (simplified)
├── layouts/
│   └── DashboardLayout.tsx    # Header + Tab Navigation + Content
├── pages/
│   ├── Pulse.tsx              # NEW: Main home (replaces Dashboard + PulsePlus)
│   ├── History.tsx            # NEW: Analytics/Charts (replaces Reports + LiveView historical)
│   ├── Songs.tsx              # KEEP: Rename from SongLog.tsx
│   ├── Settings.tsx           # KEEP
│   └── Login.tsx              # KEEP
└── components/
    └── [see below]
```

---

## Pulse Tab (The Home)

### Layer 0: The Glance

**File:** `src/pages/Pulse.tsx`  
**Max Lines:** ~200 (orchestration only, delegates to components)

```
┌─────────────────────────────────────────┐
│  Ferg's St. Pete              ● Live    │  ← Minimal header
├─────────────────────────────────────────┤
│                                         │
│              ┌─────────┐                │
│              │   72    │                │
│              │  Good   │                │  ← PulseScoreHero
│              └─────────┘                │
│                                         │
│    ┌─────┐    ┌─────┐    ┌─────┐       │
│    │ 42m │    │ 4.3★│    │  28 │       │  ← SupportingRings
│    │Dwell│    │ Rep │    │Crowd│       │
│    └─────┘    └─────┘    └─────┘       │
│                                         │
├─────────────────────────────────────────┤
│  ⚡ NEXT ACTION                         │
│  🔊 Turn down the music                 │  ← ActionHero
│  Sound is 86 dB — guests can't talk     │
│                                         │
│  [ See Why ] [ ✓ Done ]                 │
├─────────────────────────────────────────┤
│  Tonight: 🏈 2 games  •  📅 NYE tomorrow│  ← ContextBar (compact)
└─────────────────────────────────────────┘
```

**Components:**

| Component | File | Responsibility |
|-----------|------|----------------|
| `PulseScoreHero` | `components/pulse/PulseScoreHero.tsx` | Main ring, tappable |
| `SupportingRings` | `components/pulse/SupportingRings.tsx` | Dwell, Reputation, Crowd |
| `ActionHero` | `components/pulse/ActionHero.tsx` | Current action card |
| `ContextBar` | `components/pulse/ContextBar.tsx` | Games, holidays, weather |

---

### Layer 1: Action Detail (Modal)

**Trigger:** Tap "See Why" on ActionHero  
**File:** `components/pulse/ActionDetailModal.tsx`

```
┌─────────────────────────────────────────┐
│  🔊 TURN DOWN THE MUSIC            [X]  │
├─────────────────────────────────────────┤
│                                         │
│  CURRENT          TARGET                │
│  ┌─────────┐  →   ┌─────────┐          │
│  │  86 dB  │      │ 70-78dB │          │
│  └─────────┘      └─────────┘          │
│                                         │
├─────────────────────────────────────────┤
│  WHY THIS MATTERS                       │
│                                         │
│  • Above 82 dB, conversation becomes    │
│    difficult — guests leave 23% sooner  │
│                                         │
│  • Sound elevated for 40 min            │
│                                         │
│  • Last Saturday 9pm: 74 dB, 15%        │
│    longer dwell time                    │
│                                         │
├─────────────────────────────────────────┤
│  SOUND LEVEL (LAST 2 HOURS)             │
│  ┌─────────────────────────────────┐    │
│  │ ▁▂▃▅▆██████████████             │    │  ← MiniChart
│  │ ─────────────── 78 dB optimal   │    │
│  └─────────────────────────────────┘    │
│                                         │
├─────────────────────────────────────────┤
│  [ ✓ I Did It — Track Results ]        │
│  [ Dismiss — Not Now ]                  │
└─────────────────────────────────────────┘
```

**Data Requirements:**
- Current value (from live sensor data)
- Target range (from optimal ranges)
- Historical comparison (same day/time last week)
- 2-hour trend data (for mini chart)
- Impact statement (from recommendations engine)

---

### Layer 2: Ring Breakdown (Modal)

**Trigger:** Tap any ring (Pulse, Dwell, Reputation, Crowd)  
**Files:** 
- `components/pulse/PulseBreakdownModal.tsx`
- `components/pulse/DwellBreakdownModal.tsx`
- `components/pulse/ReputationBreakdownModal.tsx`
- `components/pulse/CrowdBreakdownModal.tsx`

#### Pulse Score Breakdown

```
┌─────────────────────────────────────────┐
│  PULSE SCORE                       [X]  │
├─────────────────────────────────────────┤
│              ┌─────────┐                │
│              │   72    │                │
│              │  Good   │                │
│              └─────────┘                │
│                                         │
├─────────────────────────────────────────┤
│  FACTORS                                │
│                                         │
│  🔊 Sound            58    ████████░░░░ │
│     86 dB (optimal: 70-78)              │
│     Weight: 60%                         │
│                                         │
│  💡 Light            91    ██████████░░ │
│     185 lux (optimal: 50-350)           │
│     Weight: 40%                         │
│                                         │
├─────────────────────────────────────────┤
│  CALCULATION                            │
│  (58 × 0.60) + (91 × 0.40) = 72         │
│                                         │
├─────────────────────────────────────────┤
│  VS LAST WEEK                           │
│  Last Saturday 9pm: 81 (+9 better)      │
│  Main difference: Sound was 74 dB       │
│                                         │
├─────────────────────────────────────────┤
│  YOUR VENUE'S LEARNED RANGES            │
│  Based on 847 hours of data:            │
│  • Sound: 68-76 dB works best           │
│  • Light: 80-220 lux works best         │
│                                         │
│  [ View Full History → ]                │
└─────────────────────────────────────────┘
```

#### Crowd Breakdown

```
┌─────────────────────────────────────────┐
│  CROWD                             [X]  │
├─────────────────────────────────────────┤
│              ┌─────────┐                │
│              │   28    │                │
│              │ Current │                │
│              └─────────┘                │
│                                         │
├─────────────────────────────────────────┤
│  TONIGHT                                │
│                                         │
│  Entries        142                     │
│  Exits          114                     │
│  Current        28                      │
│  Peak           67 @ 8:45pm             │
│                                         │
├─────────────────────────────────────────┤
│  DWELL TIME                             │
│  Average: 42 min (Good)                 │
│  Guests staying longer than usual       │
│                                         │
├─────────────────────────────────────────┤
│  VS TYPICAL SATURDAY                    │
│  Usually 35 people at 9pm               │
│  You're 20% below average tonight       │
│                                         │
│  [ View Full History → ]                │
└─────────────────────────────────────────┘
```

---

### Layer 3: History Tab

**File:** `src/pages/History.tsx`

```
┌─────────────────────────────────────────┐
│  History                    [Export ↓]  │
├─────────────────────────────────────────┤
│  [ Today ] [ 7D ] [ 30D ] [ 90D ]       │  ← TimeRangeSelector
├─────────────────────────────────────────┤
│                                         │
│  PULSE SCORE TREND                      │
│  ┌─────────────────────────────────┐    │
│  │         📈 Chart               │    │
│  └─────────────────────────────────┘    │
│                                         │
│  OCCUPANCY TREND                        │
│  ┌─────────────────────────────────┐    │
│  │         📈 Chart               │    │
│  └─────────────────────────────────┘    │
│                                         │
│  SOUND LEVEL TREND                      │
│  ┌─────────────────────────────────┐    │
│  │         📈 Chart               │    │
│  └─────────────────────────────────┘    │
│                                         │
├─────────────────────────────────────────┤
│  WEEKLY SUMMARY                         │
│  • Total visitors: 1,247                │
│  • Peak day: Saturday (312)             │
│  • Avg Pulse Score: 74                  │
│  • Actions completed: 12                │
│                                         │
│  [ Generate Full Report ]               │
└─────────────────────────────────────────┘
```

---

## Component Tree

```
src/
├── App.tsx                              # Simplified router
├── main.tsx                             # Entry point (keep)
├── index.css                            # Global styles (simplify)
│
├── layouts/
│   └── DashboardLayout.tsx              # NEW: Shell with nav
│
├── pages/
│   ├── Login.tsx                        # KEEP
│   ├── Pulse.tsx                        # NEW: Main home
│   ├── History.tsx                      # NEW: Analytics
│   ├── Songs.tsx                        # RENAME from SongLog.tsx
│   ├── Settings.tsx                     # KEEP (simplify)
│   └── admin/                           # KEEP admin portal as-is
│
├── components/
│   ├── common/
│   │   ├── Header.tsx                   # NEW: Simple header
│   │   ├── TabNav.tsx                   # NEW: Bottom navigation
│   │   ├── Modal.tsx                    # NEW: Reusable modal wrapper
│   │   ├── MiniChart.tsx                # NEW: Compact sparkline chart
│   │   ├── Ring.tsx                     # KEEP: PulseRing.tsx renamed
│   │   └── LoadingState.tsx             # NEW: Skeleton loaders
│   │
│   ├── pulse/
│   │   ├── PulseScoreHero.tsx           # NEW: Main ring display
│   │   ├── SupportingRings.tsx          # NEW: Dwell, Rep, Crowd
│   │   ├── ActionHero.tsx               # NEW: Current action card
│   │   ├── ActionDetailModal.tsx        # NEW: "See Why" modal
│   │   ├── ActionQueue.tsx              # NEW: Additional actions list
│   │   ├── PulseBreakdownModal.tsx      # NEW: Pulse score detail
│   │   ├── DwellBreakdownModal.tsx      # NEW: Dwell time detail
│   │   ├── ReputationBreakdownModal.tsx # NEW: Rating detail
│   │   ├── CrowdBreakdownModal.tsx      # NEW: Occupancy detail
│   │   └── ContextBar.tsx               # NEW: Games, holidays, weather
│   │
│   └── history/
│       ├── TimeRangeSelector.tsx        # KEEP: Simplified
│       ├── TrendChart.tsx               # NEW: Full-size chart
│       ├── WeeklySummary.tsx            # NEW: Stats summary
│       └── ExportButton.tsx             # KEEP
│
├── hooks/
│   ├── usePulseData.tsx                 # NEW: Consolidated data hook
│   ├── useActions.tsx                   # NEW: Action generation + tracking
│   └── useHistoricalData.tsx            # KEEP: Simplified
│
├── services/
│   ├── api.service.ts                   # KEEP
│   ├── auth.service.ts                  # KEEP
│   ├── dynamodb.service.ts              # KEEP
│   └── recommendations.service.ts       # NEW: Consolidated from 3 files
│
├── utils/
│   ├── scoring.ts                       # NEW: Pulse score calculation
│   ├── formatting.ts                    # KEEP: Consolidated
│   └── constants.ts                     # NEW: Optimal ranges, thresholds
│
└── types/
    └── index.ts                         # KEEP (simplify)
```

---

## Files to DELETE

### Pages (4 files)
```
src/pages/Dashboard.tsx              # 1,277 lines → replaced by Pulse.tsx
src/pages/PulsePlus.tsx              # 1,279 lines → replaced by Pulse.tsx
src/pages/Insights.tsx               # 947 lines → merged into breakdowns
src/pages/Reports.tsx                # → merged into History.tsx
src/pages/PulseRecommendations.tsx   # → merged into ActionHero
src/pages/AIInsights.tsx             # → if exists, merge into History
```

### Components (20+ files)
```
src/components/ScoreRings.tsx        # 671 lines → replaced by pulse/ components
src/components/PulseScore.tsx        # 253 lines → replaced by PulseScoreHero
src/components/PulseScoreLive.tsx    # → replaced by PulseScoreHero
src/components/PulseScoreDropdown.tsx
src/components/LiveView.tsx          # → merged into Pulse.tsx
src/components/LiveMetricsPanel.tsx  # → merged into breakdown modals
src/components/LiveContext.tsx       # → merged into ContextBar
src/components/ComfortGauge.tsx      # → not used in new design
src/components/ComfortBreakdown.tsx  # → merged into PulseBreakdownModal
src/components/MetricCard.tsx        # → replaced by breakdown rows
src/components/DataChart.tsx         # → replaced by TrendChart
src/components/TimeRangeToggle.tsx   # → replaced by TimeRangeSelector
src/components/AnimatedBackground.tsx # → removed (clean design)
src/components/TopBar.tsx            # → replaced by Header
src/components/Sidebar.tsx           # → replaced by TabNav
src/components/ConnectionStatus.tsx  # → simplified into Header
src/components/TermsModal.tsx        # → move to Settings or simplify
src/components/DemoModeBanner.tsx    # → simplify into Header
src/components/SportsWidget.tsx      # → merged into ContextBar
src/components/HolidayCalendarWidget.tsx # → merged into ContextBar
src/components/GoogleReviewsWidget.tsx   # → merged into ReputationBreakdownModal
src/components/HistoricalComparison.tsx  # → merged into breakdown modals
src/components/ROIDashboard.tsx      # → move to History tab
src/components/ShiftSummary.tsx      # → simplify, optional feature
src/components/WelcomeBack.tsx       # → remove (feature creep)
src/components/Attribution.tsx       # → merge into PulseBreakdownModal
src/components/TimeContext.tsx       # → merge into ContextBar
src/components/DataFreshness.tsx     # → simplify into Header
src/components/PulseExplainer.tsx    # → merge into PulseBreakdownModal
src/components/ActionFeedback.tsx    # → merge into ActionHero
```

### Hooks (consolidate)
```
src/hooks/usePulseScore.ts           # → merge into usePulseData
src/hooks/useRealTimeData.ts         # → merge into usePulseData
src/hooks/useStagedLoading.ts        # → merge into usePulseData
src/hooks/useROITracking.ts          # → move to History or remove
src/hooks/useSessionMemory.ts        # → remove (feature creep)
src/hooks/useShiftTracking.ts        # → optional, simplify
src/hooks/useTimeContext.ts          # → merge into usePulseData
```

### Services (consolidate)
```
src/services/pulse-recommendations.service.ts  # → merge into recommendations.service.ts
src/services/pulse-learning.service.ts         # → merge into recommendations.service.ts
src/services/ai-report.service.ts              # → keep if needed, move to History
src/services/historical-cache.service.ts       # → merge into api.service.ts
```

---

## Files to CREATE

### Layouts (1 file)
```
src/layouts/DashboardLayout.tsx      # ~100 lines
```

### Pages (2 files)
```
src/pages/Pulse.tsx                  # ~200 lines (orchestration only)
src/pages/History.tsx                # ~150 lines
```

### Components (15 files)
```
src/components/common/Header.tsx              # ~50 lines
src/components/common/TabNav.tsx              # ~60 lines
src/components/common/Modal.tsx               # ~40 lines
src/components/common/MiniChart.tsx           # ~80 lines
src/components/common/LoadingState.tsx        # ~30 lines

src/components/pulse/PulseScoreHero.tsx       # ~80 lines
src/components/pulse/SupportingRings.tsx      # ~60 lines
src/components/pulse/ActionHero.tsx           # ~120 lines
src/components/pulse/ActionDetailModal.tsx    # ~150 lines
src/components/pulse/ActionQueue.tsx          # ~80 lines
src/components/pulse/PulseBreakdownModal.tsx  # ~180 lines
src/components/pulse/DwellBreakdownModal.tsx  # ~120 lines
src/components/pulse/ReputationBreakdownModal.tsx # ~100 lines
src/components/pulse/CrowdBreakdownModal.tsx  # ~140 lines
src/components/pulse/ContextBar.tsx           # ~100 lines

src/components/history/TimeRangeSelector.tsx  # ~40 lines
src/components/history/TrendChart.tsx         # ~100 lines
src/components/history/WeeklySummary.tsx      # ~80 lines
```

### Hooks (2 files)
```
src/hooks/usePulseData.ts            # ~150 lines (consolidated)
src/hooks/useActions.ts              # ~100 lines
```

### Services (1 file)
```
src/services/recommendations.service.ts  # ~200 lines (consolidated)
```

### Utils (2 files)
```
src/utils/scoring.ts                 # ~80 lines
src/utils/constants.ts               # ~50 lines
```

---

## Line Count Comparison

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| Total component files | 47 | 22 | 53% fewer |
| Dashboard.tsx | 1,277 | 200 | 84% smaller |
| PulsePlus.tsx | 1,279 | (deleted) | 100% |
| Total lines (estimate) | ~12,000 | ~3,500 | 71% reduction |

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        usePulseData()                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Live Sensor  │  │  Occupancy   │  │   Reviews    │       │
│  │    Data      │  │   Metrics    │  │    Data      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                 │                 │                │
│         └─────────────────┼─────────────────┘                │
│                           ▼                                  │
│                  ┌────────────────┐                         │
│                  │ Pulse Score    │                         │
│                  │ Calculation    │                         │
│                  └────────────────┘                         │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐               │
│         ▼                 ▼                 ▼               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   pulseScore │  │  supporting  │  │   actions    │      │
│  │   + status   │  │    rings     │  │    queue     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       Pulse.tsx                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    PulseScoreHero                       │ │
│  │                    (tappable → modal)                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   SupportingRings                       │ │
│  │              (each tappable → modal)                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                     ActionHero                          │ │
│  │              (See Why → modal, Done → track)            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                     ContextBar                          │ │
│  │                 (games, holidays, etc)                  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Order

### Phase 1: Foundation (Day 1)
1. Create `DashboardLayout.tsx` with new nav structure
2. Create `src/components/common/` utilities
3. Create `usePulseData.ts` hook (consolidate data fetching)
4. Create simplified `Header.tsx` and `TabNav.tsx`

### Phase 2: Pulse Tab (Day 2-3)
1. Create `Pulse.tsx` page shell
2. Create `PulseScoreHero.tsx`
3. Create `SupportingRings.tsx`
4. Create `ActionHero.tsx`
5. Create `ContextBar.tsx`

### Phase 3: Modals (Day 3-4)
1. Create `Modal.tsx` wrapper
2. Create `ActionDetailModal.tsx` with data reasoning
3. Create `PulseBreakdownModal.tsx`
4. Create other breakdown modals

### Phase 4: History Tab (Day 4-5)
1. Create `History.tsx` page
2. Create `TrendChart.tsx`
3. Create `WeeklySummary.tsx`
4. Wire up exports

### Phase 5: Cleanup (Day 5-6)
1. Delete deprecated files
2. Update App.tsx routing
3. Test all flows
4. Mobile polish

---

## Open Questions for Approval

1. **Songs tab:** Keep as-is, or simplify?
2. **Settings tab:** Any features to cut?
3. **Admin portal:** Leave untouched for now?
4. **Shift tracking:** Keep as optional feature, or remove?
5. **ROI Dashboard:** Move to History tab, or remove entirely?

---

## Approval Checklist

- [ ] Navigation structure approved (4 tabs)
- [ ] Layer 0 (Glance) design approved
- [ ] Layer 1 (Action Detail) design approved
- [ ] Layer 2 (Ring Breakdowns) design approved
- [ ] Layer 3 (History Tab) design approved
- [ ] File deletion list approved
- [ ] File creation list approved
- [ ] Implementation order approved

---

**Ready to execute on your approval.**
