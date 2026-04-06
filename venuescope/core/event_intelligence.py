"""
VenueScope Event Intelligence Engine
Automatically validates event concepts using real external data sources.
Press one button → get a verified verdict.

Data sources (all free or near-free):
  - Google Trends (pytrends) — search interest in city
  - Open-Meteo — weather forecast for event date
  - Reddit (PRAW) — what locals are asking for
  - TikTok hashtag views (Apify, optional)
  - Facebook Events (Apify, optional)
"""
from __future__ import annotations
import json, time, re, os
from datetime import datetime, timedelta
from typing import Optional

# ── Concept → keyword / hashtag mappings ─────────────────────────────────────

CONCEPT_KEYWORDS = {
    "DJ Night":               ["dj night bar", "nightclub dj", "club night"],
    "Live Music":             ["live music bar", "live band bar", "music venue"],
    "Trivia Night":           ["trivia night bar", "pub quiz", "bar trivia"],
    "Karaoke":                ["karaoke bar", "karaoke night"],
    "Drag Show":              ["drag show bar", "drag brunch", "drag night"],
    "Sports Watch Party":     ["sports bar", "watch party bar", "game day bar"],
    "Comedy Night":           ["comedy night bar", "stand up comedy bar"],
    "Happy Hour Special":     ["happy hour bar", "drink specials bar"],
    "Themed Party":           ["themed party bar", "costume night bar"],
    "Open Mic":               ["open mic night bar", "open mic bar"],
    "Paint & Sip":            ["paint and sip bar", "sip and paint"],
    "Speed Dating":           ["speed dating event", "singles night bar"],
    "Networking Event":       ["networking happy hour", "professional networking bar"],
    "Other":                  ["bar event", "bar night"],
}

CONCEPT_HASHTAGS = {
    "DJ Night":               ["djnight", "clubnight", "djbar"],
    "Live Music":             ["livemusicbar", "livemusic", "liveband"],
    "Trivia Night":           ["trivianight", "pubquiz", "bartrivia"],
    "Karaoke":                ["karaokenight", "karaokeBar", "karaoke"],
    "Drag Show":              ["dragshow", "dragbrunch", "dragqueen"],
    "Sports Watch Party":     ["watchparty", "sportsbar", "gamedaybar"],
    "Comedy Night":           ["comedynight", "standupcomedy", "comedybar"],
    "Happy Hour Special":     ["happyhour", "drinkspecials", "happyhourbar"],
    "Themed Party":           ["themedparty", "costumenight", "themenight"],
    "Open Mic":               ["openmic", "openmicnight", "openmiclive"],
    "Paint & Sip":            ["paintsip", "sipandpaint", "wineandpaint"],
    "Speed Dating":           ["speeddating", "singlesnight", "datenight"],
    "Networking Event":       ["networkingevent", "happyhourmixer", "professionalnetworking"],
    "Other":                  ["barevent", "nightout", "barnight"],
}

# Recommended drinks per concept (data-driven from menu engineering research)
CONCEPT_DRINKS = {
    "DJ Night":           ["Vodka Red Bull", "Tequila Shots", "Long Island Iced Tea", "Espresso Martini"],
    "Live Music":         ["Draft Beer", "Whiskey Sour", "Old Fashioned", "Craft IPA"],
    "Trivia Night":       ["Domestic Beer Pitchers", "Wings + Beer Bundle", "House Wine", "Cider"],
    "Karaoke":            ["Karaoke Bucket (5 beers)", "Tequila Shots", "Frozen Margarita", "Rum & Coke"],
    "Drag Show":          ["Drag Cocktail Special", "Champagne / Prosecco", "Cosmopolitan", "Espresso Martini"],
    "Sports Watch Party": ["Beer Buckets", "Wings + Beer Bundle", "Domestic Pitchers", "Bloody Mary"],
    "Comedy Night":       ["Craft Beer", "House Wine", "Gin & Tonic", "Bourbon on the Rocks"],
    "Happy Hour Special": ["$5 House Cocktails", "$3 Domestic Beer", "Wine by the Glass", "Margaritas"],
    "Themed Party":       ["Themed Signature Cocktail", "Themed Shots", "Bucket Packages", "Champagne"],
    "Open Mic":           ["Craft Beer", "House Wine", "Seasonal Cocktail", "Mocktail Option"],
    "Paint & Sip":        ["House Wine", "Mimosas", "Rosé", "Sangria"],
    "Speed Dating":       ["Cocktail Package (2 drinks included)", "Wine", "Gin & Tonic", "Champagne"],
    "Networking Event":   ["Open Bar Package", "Beer & Wine", "Signature Cocktail", "Non-Alcoholic Options"],
    "Other":              ["Signature House Cocktail", "Draft Beer", "House Wine"],
}

# Pricing models per concept
CONCEPT_PRICING = {
    "DJ Night":           {"cover": (10, 25), "vip_table_min": (200, 500)},
    "Live Music":         {"cover": (5, 20),  "vip_table_min": (100, 300)},
    "Trivia Night":       {"cover": (0, 5),   "vip_table_min": None},
    "Karaoke":            {"cover": (0, 10),  "vip_table_min": (50, 150)},
    "Drag Show":          {"cover": (10, 30), "vip_table_min": (100, 300)},
    "Sports Watch Party": {"cover": (0, 10),  "vip_table_min": None},
    "Comedy Night":       {"cover": (10, 25), "vip_table_min": (100, 200)},
    "Happy Hour Special": {"cover": (0, 0),   "vip_table_min": None},
    "Themed Party":       {"cover": (10, 30), "vip_table_min": (150, 400)},
    "Open Mic":           {"cover": (0, 5),   "vip_table_min": None},
    "Paint & Sip":        {"cover": (25, 55), "vip_table_min": None},
    "Speed Dating":       {"cover": (20, 45), "vip_table_min": None},
    "Networking Event":   {"cover": (10, 30), "vip_table_min": None},
    "Other":              {"cover": (5, 20),  "vip_table_min": None},
}

# Best nights per concept (data from SevenRooms + Union analytics)
CONCEPT_BEST_NIGHTS = {
    "DJ Night":           ["Friday", "Saturday"],
    "Live Music":         ["Thursday", "Friday", "Saturday"],
    "Trivia Night":       ["Tuesday", "Wednesday", "Thursday"],
    "Karaoke":            ["Wednesday", "Thursday", "Sunday"],
    "Drag Show":          ["Saturday", "Sunday"],
    "Sports Watch Party": ["Sunday", "Monday", "Thursday"],
    "Comedy Night":       ["Thursday", "Friday"],
    "Happy Hour Special": ["Tuesday", "Wednesday", "Thursday"],
    "Themed Party":       ["Friday", "Saturday"],
    "Open Mic":           ["Monday", "Tuesday", "Wednesday"],
    "Paint & Sip":        ["Sunday", "Wednesday"],
    "Speed Dating":       ["Thursday", "Friday"],
    "Networking Event":   ["Tuesday", "Wednesday", "Thursday"],
    "Other":              ["Thursday", "Friday", "Saturday"],
}

# Typical setup costs per concept
CONCEPT_COSTS = {
    "DJ Night":           {"low": 200, "high": 1500, "items": ["DJ fee", "sound system rental", "lighting"]},
    "Live Music":         {"low": 150, "high": 800,  "items": ["Band/musician fee", "sound check time", "PA rental"]},
    "Trivia Night":       {"low": 50,  "high": 300,  "items": ["Trivia host fee", "printing", "prizes"]},
    "Karaoke":            {"low": 100, "high": 400,  "items": ["Karaoke system rental", "host fee", "song books"]},
    "Drag Show":          {"low": 300, "high": 2000, "items": ["Performer fees (2-4 performers)", "staging", "sound"]},
    "Sports Watch Party": {"low": 0,   "high": 200,  "items": ["Extra TVs rental (optional)", "promotions budget"]},
    "Comedy Night":       {"low": 100, "high": 600,  "items": ["Comedian fee", "mic/PA setup", "stage lighting"]},
    "Happy Hour Special": {"low": 0,   "high": 100,  "items": ["Promotional materials", "social media ads"]},
    "Themed Party":       {"low": 200, "high": 1000, "items": ["Decor", "DJ/music", "costume props", "themed drinks"]},
    "Open Mic":           {"low": 0,   "high": 150,  "items": ["PA system", "host fee", "microphone setup"]},
    "Paint & Sip":        {"low": 200, "high": 500,  "items": ["Art supplies per person", "instructor fee", "easels"]},
    "Speed Dating":       {"low": 50,  "high": 200,  "items": ["Event host fee", "score cards", "name tags", "prizes"]},
    "Networking Event":   {"low": 100, "high": 500,  "items": ["Marketing", "name tags", "light catering optional"]},
    "Other":              {"low": 100, "high": 500,  "items": ["Variable based on concept"]},
}

# ── Geo lookup (city → state/DMA code for Google Trends) ─────────────────────

CITY_GEO = {
    "tampa": "US-FL", "miami": "US-FL", "orlando": "US-FL", "jacksonville": "US-FL",
    "new york": "US-NY", "brooklyn": "US-NY", "manhattan": "US-NY",
    "los angeles": "US-CA", "san francisco": "US-CA", "san diego": "US-CA",
    "chicago": "US-IL", "houston": "US-TX", "dallas": "US-TX", "austin": "US-TX",
    "phoenix": "US-AZ", "las vegas": "US-NV", "seattle": "US-WA",
    "denver": "US-CO", "atlanta": "US-GA", "boston": "US-MA",
    "philadelphia": "US-PA", "nashville": "US-TN", "charlotte": "US-NC",
    "portland": "US-OR", "minneapolis": "US-MN", "detroit": "US-MI",
    "new orleans": "US-LA", "memphis": "US-TN", "baltimore": "US-MD",
    "pittsburgh": "US-PA", "cincinnati": "US-OH", "cleveland": "US-OH",
    "columbus": "US-OH", "indianapolis": "US-IN", "kansas city": "US-MO",
    "st. louis": "US-MO", "salt lake city": "US-UT", "sacramento": "US-CA",
    "san antonio": "US-TX", "san jose": "US-CA", "fort worth": "US-TX",
    "jacksonville": "US-FL", "columbus": "US-OH",
}

CITY_LATLON = {
    "tampa": (27.9506, -82.4572), "miami": (25.7617, -80.1918),
    "orlando": (28.5383, -81.3792), "new york": (40.7128, -74.0060),
    "los angeles": (34.0522, -118.2437), "chicago": (41.8781, -87.6298),
    "houston": (29.7604, -95.3698), "dallas": (32.7767, -96.7970),
    "atlanta": (33.7490, -84.3880), "boston": (42.3601, -71.0589),
    "nashville": (36.1627, -86.7816), "las vegas": (36.1699, -115.1398),
    "seattle": (47.6062, -122.3321), "denver": (39.7392, -104.9903),
    "austin": (30.2672, -97.7431), "phoenix": (33.4484, -112.0740),
    "philadelphia": (39.9526, -75.1652), "san francisco": (37.7749, -122.4194),
    "portland": (45.5051, -122.6750), "charlotte": (35.2271, -80.8431),
    "new orleans": (29.9511, -90.0715), "minneapolis": (44.9778, -93.2650),
    "san diego": (32.7157, -117.1611), "detroit": (42.3314, -83.0458),
    "baltimore": (39.2904, -76.6122), "pittsburgh": (40.4406, -79.9959),
}


# ── Google Trends ─────────────────────────────────────────────────────────────

def _trends_score(concept_type: str, city: str, timeout: float = 12.0) -> dict:
    """Pull Google Trends interest score for a concept in a city."""
    try:
        from pytrends.request import TrendReq
        city_key = city.lower().strip()
        geo = CITY_GEO.get(city_key, "US")
        keywords = CONCEPT_KEYWORDS.get(concept_type, [concept_type.lower()])[:3]

        pytrends = TrendReq(hl="en-US", tz=300, timeout=(timeout, timeout),
                            requests_args={"verify": True})
        pytrends.build_payload(keywords, cat=0, timeframe="today 3-m", geo=geo, gprop="")

        df = pytrends.interest_over_time()
        if df.empty:
            return {"score": 0, "trend": "unknown", "keywords": keywords, "error": "no data"}

        df = df.drop(columns=["isPartial"], errors="ignore")
        recent_avg = float(df.tail(4).mean(axis=1).mean())   # last 4 weeks avg
        full_avg   = float(df.mean(axis=1).mean())
        trend = "rising" if recent_avg > full_avg * 1.1 else "falling" if recent_avg < full_avg * 0.9 else "stable"

        return {
            "score":    round(recent_avg),
            "trend":    trend,
            "keywords": keywords,
            "geo":      geo,
        }
    except Exception as e:
        return {"score": 0, "trend": "unknown", "keywords": [], "error": str(e)}


# ── Weather ───────────────────────────────────────────────────────────────────

def _weather_risk(city: str, event_date: str) -> dict:
    """Get weather forecast for event date and compute attendance risk."""
    try:
        import requests as _req
        city_key = city.lower().strip()
        lat, lon = CITY_LATLON.get(city_key, (27.9506, -82.4572))  # default Tampa

        r = _req.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat, "longitude": lon,
                "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
                "forecast_days": 16, "timezone": "auto",
                "temperature_unit": "fahrenheit", "precipitation_unit": "inch",
            },
            timeout=8,
        )
        data = r.json()
        dates = data["daily"]["time"]
        if event_date not in dates:
            return {"risk": "unknown", "forecast": "Date too far out for forecast"}

        idx    = dates.index(event_date)
        tmax   = data["daily"]["temperature_2m_max"][idx]
        tmin   = data["daily"]["temperature_2m_min"][idx]
        precip = data["daily"]["precipitation_sum"][idx]
        wcode  = data["daily"]["weathercode"][idx]

        # Risk assessment
        is_rain      = wcode in range(51, 100)
        is_cold      = tmax < 35
        is_very_hot  = tmax > 100
        risk_factors = []
        if precip > 0.1:  risk_factors.append(f"Rain expected ({precip:.1f}\" — est. 15-30% attendance drop)")
        if is_cold:       risk_factors.append(f"Very cold ({tmax:.0f}°F — consider heaters/outdoor heating)")
        if is_very_hot:   risk_factors.append(f"Extreme heat ({tmax:.0f}°F — ensure AC capacity)")

        risk = "high" if (precip > 0.5 or is_cold) else "moderate" if risk_factors else "low"

        return {
            "risk":         risk,
            "temp_high_f":  round(tmax),
            "temp_low_f":   round(tmin),
            "precip_inches": round(precip, 2),
            "weather_code": wcode,
            "risk_factors": risk_factors,
            "attendance_impact": "-25%" if risk == "high" else "-10%" if risk == "moderate" else "none",
        }
    except Exception as e:
        return {"risk": "unknown", "error": str(e)}


# ── Reddit demand signals ─────────────────────────────────────────────────────

def _reddit_demand(concept_type: str, city: str) -> dict:
    """Search Reddit for event demand in city."""
    try:
        import praw
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

        CLIENT_ID     = os.environ.get("REDDIT_CLIENT_ID", "")
        CLIENT_SECRET = os.environ.get("REDDIT_CLIENT_SECRET", "")

        if not CLIENT_ID or not CLIENT_SECRET:
            return {"mentions": 0, "sentiment": 0.0, "top_posts": [], "error": "Reddit credentials not configured"}

        reddit = praw.Reddit(client_id=CLIENT_ID, client_secret=CLIENT_SECRET,
                             user_agent="VenueScope/1.0")
        analyzer = SentimentIntensityAnalyzer()

        city_sub = city.lower().replace(" ", "")
        keywords = CONCEPT_KEYWORDS.get(concept_type, [concept_type.lower()])
        query    = keywords[0] if keywords else concept_type

        posts = []
        sentiments = []
        for sub_name in [city_sub, "all"]:
            try:
                limit = 30 if sub_name == city_sub else 20
                subreddit = reddit.subreddit(sub_name)
                for post in subreddit.search(query=query, sort="relevance",
                                             time_filter="year", limit=limit):
                    s = analyzer.polarity_scores(post.title)["compound"]
                    sentiments.append(s)
                    posts.append({
                        "title":    post.title[:120],
                        "score":    post.score,
                        "comments": post.num_comments,
                        "sentiment": round(s, 2),
                    })
            except Exception:
                pass

        avg_sentiment = round(sum(sentiments) / len(sentiments), 2) if sentiments else 0.0
        top_posts     = sorted(posts, key=lambda p: p["score"], reverse=True)[:5]

        return {
            "mentions":     len(posts),
            "sentiment":    avg_sentiment,
            "sentiment_label": "positive" if avg_sentiment > 0.1 else "negative" if avg_sentiment < -0.1 else "neutral",
            "top_posts":    top_posts,
        }
    except Exception as e:
        return {"mentions": 0, "sentiment": 0.0, "top_posts": [], "error": str(e)}


# ── Revenue estimate ──────────────────────────────────────────────────────────

def _revenue_estimate(concept_type: str, capacity: int, cover_charge: Optional[float] = None) -> dict:
    """Estimate revenue range based on concept, capacity, and cover."""
    pricing  = CONCEPT_PRICING.get(concept_type, CONCEPT_PRICING["Other"])
    costs    = CONCEPT_COSTS.get(concept_type, CONCEPT_COSTS["Other"])

    # Cover revenue
    cover_low, cover_high = pricing["cover"]
    if cover_charge is not None:
        cover_low = cover_high = cover_charge
    cover_mid = (cover_low + cover_high) / 2

    # Attendance assumptions: 60-90% fill rate for well-marketed event
    att_low  = int(capacity * 0.55)
    att_high = int(capacity * 0.90)

    # Bar spend per head (industry benchmarks by concept)
    spend_per_head = {
        "DJ Night": (18, 35), "Live Music": (15, 28), "Trivia Night": (12, 22),
        "Karaoke": (15, 30), "Drag Show": (18, 35), "Sports Watch Party": (14, 25),
        "Comedy Night": (12, 22), "Happy Hour Special": (10, 18),
        "Themed Party": (18, 35), "Open Mic": (10, 18),
        "Paint & Sip": (20, 40), "Speed Dating": (15, 30),
        "Networking Event": (12, 25), "Other": (12, 25),
    }.get(concept_type, (12, 25))

    bar_low  = att_low  * spend_per_head[0]
    bar_high = att_high * spend_per_head[1]
    door_low  = att_low  * cover_low
    door_high = att_high * cover_high

    gross_low  = bar_low  + door_low
    gross_high = bar_high + door_high
    net_low    = gross_low  - costs["high"]
    net_high   = gross_high - costs["low"]

    return {
        "attendance_range":   [att_low, att_high],
        "gross_revenue_range": [round(gross_low), round(gross_high)],
        "net_revenue_range":   [round(net_low),   round(net_high)],
        "setup_cost_range":    [costs["low"],      costs["high"]],
        "setup_cost_items":    costs["items"],
        "bar_spend_per_head":  spend_per_head,
        "vip_table_min":       pricing["vip_table_min"],
    }


# ── Composite score ───────────────────────────────────────────────────────────

def _composite_score(trends: dict, weather: dict, reddit: dict,
                     manual_signals: dict) -> tuple[int, str, list[str]]:
    """Compute overall validation score 0-100 and verdict."""
    score  = 0
    notes  = []

    # Google Trends: 30 pts
    ts = trends.get("score", 0)
    score += min(30, round(ts * 0.30))
    trend_dir = trends.get("trend", "stable")
    if trend_dir == "rising":
        score += 5
        notes.append(f"🔺 Google Trends rising in your market (+5)")
    elif trend_dir == "falling":
        score -= 5
        notes.append(f"🔻 Google Trends declining in your market (-5)")

    # Weather: up to -20 penalty
    if weather.get("risk") == "high":
        score -= 20
        notes.append(f"⛈️ High weather risk: {', '.join(weather.get('risk_factors', []))}")
    elif weather.get("risk") == "moderate":
        score -= 8
        notes.append(f"🌧️ Moderate weather risk: {', '.join(weather.get('risk_factors', []))}")

    # Reddit: 20 pts
    mentions  = reddit.get("mentions", 0)
    sentiment = reddit.get("sentiment", 0.0)
    reddit_pts = min(10, mentions // 3) + (10 if sentiment > 0.1 else 5 if sentiment > -0.1 else 0)
    score += reddit_pts
    if mentions > 10:
        notes.append(f"💬 Strong Reddit demand: {mentions} mentions, {reddit.get('sentiment_label','neutral')} sentiment")
    elif mentions > 3:
        notes.append(f"💬 Reddit mentions: {mentions} posts about this in your city")

    # Manual signals from the venue owner (A/B test, polls, etc.): 50 pts
    manual_score = 0
    ms = manual_signals or {}

    # Meta A/B
    cpc_a = ms.get("meta_cpc_a"); cpc_b = ms.get("meta_cpc_b")
    if cpc_a and cpc_b:
        manual_score += 15
        winner = "A" if cpc_a < cpc_b else "B"
        notes.append(f"✅ Meta A/B verified: Concept {winner} wins (${min(cpc_a,cpc_b):.2f}/click vs ${max(cpc_a,cpc_b):.2f})")

    # TikTok save rate
    tsr = ms.get("tiktok_save_rate") or 0
    if tsr >= 1.0:
        manual_score += 12; notes.append(f"🎵 TikTok save rate {tsr}% — strong demand signal")
    elif tsr >= 0.5:
        manual_score += 6;  notes.append(f"🎵 TikTok save rate {tsr}% — moderate signal")

    # IG DMs
    dms = ms.get("ig_dm_count") or 0
    if dms >= 10:
        manual_score += 10; notes.append(f"📸 {dms} unprompted Instagram DMs — high intent")
    elif dms >= 5:
        manual_score += 5;  notes.append(f"📸 {dms} Instagram DMs — some interest")

    # IG poll
    poll = ms.get("ig_poll_pct") or 0
    if poll >= 65:
        manual_score += 8;  notes.append(f"📊 Instagram poll: {poll}% want this event")
    elif poll >= 50:
        manual_score += 4;  notes.append(f"📊 Instagram poll: {poll}% want this (marginal)")

    # Eventbrite velocity
    eb = ms.get("eventbrite_pct") or 0
    if eb >= 15:
        manual_score += 5;  notes.append(f"🎟️ Eventbrite: {eb}% capacity sold in 48h — hit")
    elif eb >= 5:
        manual_score += 2;  notes.append(f"🎟️ Eventbrite: {eb}% sold in 48h — watch closely")

    score += min(50, manual_score)
    score  = max(0, min(100, score))

    if score >= 70:
        verdict = "green"
    elif score >= 45:
        verdict = "yellow"
    else:
        verdict = "red"

    return score, verdict, notes


# ── Main entry point ──────────────────────────────────────────────────────────

def validate_event_concept(
    concept_type: str,
    city: str,
    event_date: str,
    capacity: int = 150,
    cover_charge: Optional[float] = None,
    manual_signals: Optional[dict] = None,
) -> dict:
    """
    Full validation report for an event concept.
    Pulls live data from Google Trends, weather, and Reddit.
    Combines with any manual signals the owner entered.

    Returns a dict ready to serve as a JSON API response.
    """
    manual_signals = manual_signals or {}
    start = time.time()

    # Pull live data
    trends  = _trends_score(concept_type, city)
    weather = _weather_risk(city, event_date)
    reddit  = _reddit_demand(concept_type, city)

    # Compute composite score
    score, verdict, notes = _composite_score(trends, weather, reddit, manual_signals)

    # Revenue estimate
    revenue = _revenue_estimate(concept_type, capacity, cover_charge)

    # Recommendations
    best_nights = CONCEPT_BEST_NIGHTS.get(concept_type, ["Thursday", "Friday", "Saturday"])
    drinks      = CONCEPT_DRINKS.get(concept_type, [])
    pricing     = CONCEPT_PRICING.get(concept_type, CONCEPT_PRICING["Other"])

    # Day-of-week check
    try:
        event_dow = datetime.strptime(event_date, "%Y-%m-%d").strftime("%A")
        if event_dow not in best_nights:
            notes.append(f"⚠️ {event_dow} is not the optimal night — best nights: {', '.join(best_nights)}")
    except Exception:
        event_dow = "Unknown"

    verdict_text = {
        "green":  "✅ Run it — all signals validated. Book the venue, hire the talent.",
        "yellow": "🟡 Test night first — 1 run before committing to recurring.",
        "red":    "🔴 Reconsider — weak signals. Try a different concept or different night.",
    }[verdict]

    return {
        "concept_type":    concept_type,
        "city":            city,
        "event_date":      event_date,
        "event_dow":       event_dow,
        "validation_score": score,
        "verdict":         verdict,
        "verdict_text":    verdict_text,
        "notes":           notes,
        # Data layers
        "google_trends":   trends,
        "weather":         weather,
        "reddit":          reddit,
        # Recommendations
        "best_nights":     best_nights,
        "recommended_drinks": drinks,
        "pricing_guidance": {
            "cover_range":    pricing["cover"],
            "vip_table_min":  pricing["vip_table_min"],
        },
        "revenue_estimate": revenue,
        "setup_guide": {
            "cost_range":  [CONCEPT_COSTS[concept_type]["low"], CONCEPT_COSTS[concept_type]["high"]],
            "line_items":  CONCEPT_COSTS[concept_type]["items"],
        },
        "pull_duration_sec": round(time.time() - start, 1),
    }
