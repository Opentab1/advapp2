"""
VenueScope — Comparative Analysis v1
Compare two completed jobs side-by-side: metrics, timelines, per-bartender tables.
Supports drink_count and people_count analysis modes.
"""
import json
from pathlib import Path
import streamlit as st
import pandas as pd

from core.database import list_jobs, get_job
from core.config   import RESULT_DIR, ANALYSIS_MODES

st.set_page_config(page_title="Compare Jobs · VenueScope", layout="wide")
st.markdown("""<style>
.stApp,[data-testid="stSidebar"]{background:#0f172a;}
h1,h2,h3,label,p,.stMarkdown{color:#f1f5f9!important;}
div[data-testid="metric-container"]{background:#1e293b;border-radius:10px;padding:12px;border:1px solid #334155;}
.stButton>button{background:#f97316;color:#fff;border:none;border-radius:8px;font-weight:600;}
.hero-number{font-size:3em;font-weight:800;color:#f97316;line-height:1.1;}
.hero-label{font-size:0.95em;color:#94a3b8;margin-top:0;}
.delta-pos{background:#14532d;border:1px solid #16a34a;border-radius:8px;
  padding:12px 18px;color:#86efac;font-weight:700;font-size:1.1em;}
.delta-neg{background:#7f1d1d;border:1px solid #dc2626;border-radius:8px;
  padding:12px 18px;color:#fca5a5;font-weight:700;font-size:1.1em;}
.delta-neutral{background:#1e293b;border:1px solid #475569;border-radius:8px;
  padding:12px 18px;color:#cbd5e1;font-weight:700;font-size:1.1em;}
.section-header{color:#f97316!important;font-weight:700;font-size:1.15em;
  border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:10px;}
</style>""", unsafe_allow_html=True)

st.markdown("## 🔀 Comparative Analysis")
st.caption("Compare two completed jobs side-by-side to spot trends across shifts, nights, or bartenders.")

# ── Load eligible jobs ────────────────────────────────────────────────────────
COMPARABLE_MODES = {"drink_count", "people_count"}
all_jobs = [j for j in list_jobs(200)
            if j["status"] == "done" and j.get("analysis_mode") in COMPARABLE_MODES]

if len(all_jobs) < 2:
    st.info("You need at least **2 completed drink_count or people_count jobs** to compare. "
            "Go to **▶️ Run Analysis** to process more videos.")
    st.stop()


def _job_label(j: dict) -> str:
    mode_icon = "🍺" if j.get("analysis_mode") == "drink_count" else "🚶"
    label = j.get("clip_label") or j["job_id"]
    return f"{mode_icon} {label}  [{j['job_id']}]"


job_opts = {_job_label(j): j["job_id"] for j in all_jobs}
labels   = list(job_opts.keys())

# ── Job selectors ─────────────────────────────────────────────────────────────
sel_col1, sel_col2 = st.columns(2)
with sel_col1:
    label_a = st.selectbox("Job A", labels, index=0, key="cmp_job_a")
with sel_col2:
    # Default Job B to a different job than A
    default_b_idx = 1 if len(labels) > 1 else 0
    label_b = st.selectbox("Job B", labels, index=default_b_idx, key="cmp_job_b")

if label_a == label_b:
    st.warning("Please select two different jobs to compare.")
    st.stop()

id_a = job_opts[label_a]
id_b = job_opts[label_b]

job_a = get_job(id_a)
job_b = get_job(id_b)

mode_a = job_a.get("analysis_mode", "drink_count")
mode_b = job_b.get("analysis_mode", "drink_count")


def _load_summary(job: dict) -> dict:
    rdir = Path(job.get("result_dir") or Path(RESULT_DIR) / job["job_id"])
    sumf = rdir / "summary.json"
    if sumf.exists():
        try:
            return json.loads(sumf.read_text())
        except Exception:
            pass
    # Fall back to inline summary_json from DB
    raw = job.get("summary_json")
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass
    return {}


sum_a = _load_summary(job_a)
sum_b = _load_summary(job_b)

st.divider()

# ─────────────────────────────────────────────────────────────────────────────
# DRINK COUNT comparison
# ─────────────────────────────────────────────────────────────────────────────
if mode_a == "drink_count" and mode_b == "drink_count":
    barts_a = sum_a.get("bartenders", {})
    barts_b = sum_b.get("bartenders", {})

    dur_a = max(sum_a.get("video_seconds", 1), 1)
    dur_b = max(sum_b.get("video_seconds", 1), 1)

    total_a = sum(d.get("total_drinks", 0) for d in barts_a.values())
    total_b = sum(d.get("total_drinks", 0) for d in barts_b.values())

    rate_a  = total_a / (dur_a / 3600)
    rate_b  = total_b / (dur_b / 3600)

    clip_a  = job_a.get("clip_label") or id_a
    clip_b  = job_b.get("clip_label") or id_b

    # ── Side-by-side hero numbers ─────────────────────────────────────────────
    st.markdown('<div class="section-header">Key Metrics</div>', unsafe_allow_html=True)
    col_a, col_div, col_b = st.columns([5, 1, 5])

    with col_a:
        st.markdown(f"**{clip_a}**")
        m1, m2, m3 = st.columns(3)
        m1.markdown(f'<div class="hero-number">{total_a}</div>'
                    f'<div class="hero-label">Total Drinks</div>', unsafe_allow_html=True)
        m2.markdown(f'<div class="hero-number">{rate_a:.0f}</div>'
                    f'<div class="hero-label">Drinks / hr</div>', unsafe_allow_html=True)
        m3.markdown(f'<div class="hero-number">{dur_a/60:.0f}m</div>'
                    f'<div class="hero-label">Clip Length</div>', unsafe_allow_html=True)

    with col_div:
        st.markdown("<br><br><br><div style='text-align:center;font-size:2em;color:#475569;'>vs</div>",
                    unsafe_allow_html=True)

    with col_b:
        st.markdown(f"**{clip_b}**")
        m4, m5, m6 = st.columns(3)
        m4.markdown(f'<div class="hero-number">{total_b}</div>'
                    f'<div class="hero-label">Total Drinks</div>', unsafe_allow_html=True)
        m5.markdown(f'<div class="hero-number">{rate_b:.0f}</div>'
                    f'<div class="hero-label">Drinks / hr</div>', unsafe_allow_html=True)
        m6.markdown(f'<div class="hero-number">{dur_b/60:.0f}m</div>'
                    f'<div class="hero-label">Clip Length</div>', unsafe_allow_html=True)

    # ── Delta summary ─────────────────────────────────────────────────────────
    st.divider()
    st.markdown('<div class="section-header">Delta Summary</div>', unsafe_allow_html=True)
    delta = total_b - total_a
    pct   = (delta / max(total_a, 1)) * 100

    if delta > 0:
        direction = "more"
        css_class = "delta-pos"
        sign = "+"
    elif delta < 0:
        direction = "fewer"
        css_class = "delta-neg"
        sign = ""
    else:
        direction = "the same number of"
        css_class = "delta-neutral"
        sign = ""

    if delta != 0:
        summary_text = (f"Job B had <strong>{abs(delta)}</strong> {direction} drinks "
                        f"({sign}{pct:.1f}%) compared to Job A")
    else:
        summary_text = "Job B had <strong>the same number</strong> of drinks as Job A"

    rate_delta     = rate_b - rate_a
    rate_direction = "faster" if rate_delta > 0 else "slower"
    rate_text      = (f"  &nbsp;·&nbsp;  Service rate {abs(rate_delta):.1f} drinks/hr {rate_direction}"
                      if abs(rate_delta) > 0.5 else "")

    st.markdown(f'<div class="{css_class}">{summary_text}{rate_text}</div>',
                unsafe_allow_html=True)

    # ── Timeline overlay ──────────────────────────────────────────────────────
    st.divider()
    st.markdown('<div class="section-header">Timeline Overlay (time-normalized to 0–100% of clip)</div>',
                unsafe_allow_html=True)
    st.caption("Both clips are normalized so 0% = start and 100% = end, making clips of different lengths comparable.")

    bin_count = 20
    bins      = [i * (100 / bin_count) for i in range(bin_count)]
    bin_labels = [f"{int(b)}%" for b in bins]

    def _ts_to_normalized_bins(barts: dict, dur_secs: float) -> list:
        counts = [0] * bin_count
        for bdata in barts.values():
            for ts in bdata.get("drink_timestamps", []):
                pct_pos = min(ts / max(dur_secs, 1) * 100, 99.99)
                bucket  = int(pct_pos / (100 / bin_count))
                counts[bucket] += 1
        return counts

    bins_a = _ts_to_normalized_bins(barts_a, dur_a)
    bins_b = _ts_to_normalized_bins(barts_b, dur_b)

    tl_df = pd.DataFrame({
        "Time %":  bin_labels,
        clip_a:    bins_a,
        clip_b:    bins_b,
    }).set_index("Time %")

    # Only show chart if there's actual timestamp data
    if total_a > 0 or total_b > 0:
        st.bar_chart(tl_df, use_container_width=True)
    else:
        st.info("No drink timestamp data available for timeline overlay.")

    # ── Per-bartender comparison table ────────────────────────────────────────
    all_names = sorted(set(list(barts_a.keys()) + list(barts_b.keys())))
    if all_names:
        st.divider()
        st.markdown('<div class="section-header">Per-Bartender Comparison</div>',
                    unsafe_allow_html=True)

        rows = []
        for name in all_names:
            da = barts_a.get(name, {})
            db = barts_b.get(name, {})
            drinks_a_n  = da.get("total_drinks", 0)
            drinks_b_n  = db.get("total_drinks", 0)
            rate_a_n    = round(da.get("drinks_per_hour", 0), 1)
            rate_b_n    = round(db.get("drinks_per_hour", 0), 1)
            diff        = drinks_b_n - drinks_a_n
            diff_str    = f"+{diff}" if diff > 0 else str(diff)
            rows.append({
                "Bartender":          name,
                f"Drinks (A)":        drinks_a_n,
                f"Drinks/hr (A)":     rate_a_n,
                f"Drinks (B)":        drinks_b_n,
                f"Drinks/hr (B)":     rate_b_n,
                "Delta (B−A)":        diff_str,
            })

        cmp_df = pd.DataFrame(rows)
        st.dataframe(cmp_df, use_container_width=True, hide_index=True)

        # Bar chart of drinks per bartender for both jobs
        if len(all_names) > 0:
            chart_rows = []
            for name in all_names:
                chart_rows.append({
                    "Bartender": name,
                    clip_a:      barts_a.get(name, {}).get("total_drinks", 0),
                    clip_b:      barts_b.get(name, {}).get("total_drinks", 0),
                })
            chart_df = pd.DataFrame(chart_rows).set_index("Bartender")
            st.bar_chart(chart_df, use_container_width=True)

# ─────────────────────────────────────────────────────────────────────────────
# PEOPLE COUNT comparison
# ─────────────────────────────────────────────────────────────────────────────
elif mode_a == "people_count" and mode_b == "people_count":
    ppl_a = sum_a.get("people", {})
    ppl_b = sum_b.get("people", {})

    clip_a = job_a.get("clip_label") or id_a
    clip_b = job_b.get("clip_label") or id_b

    entries_a = ppl_a.get("total_entries", 0)
    entries_b = ppl_b.get("total_entries", 0)
    exits_a   = ppl_a.get("total_exits", 0)
    exits_b   = ppl_b.get("total_exits", 0)
    peak_a    = ppl_a.get("peak_occupancy", 0)
    peak_b    = ppl_b.get("peak_occupancy", 0)

    st.markdown('<div class="section-header">Key Metrics</div>', unsafe_allow_html=True)
    col_a, col_div, col_b = st.columns([5, 1, 5])

    with col_a:
        st.markdown(f"**{clip_a}**")
        m1, m2, m3 = st.columns(3)
        m1.markdown(f'<div class="hero-number">{entries_a}</div>'
                    f'<div class="hero-label">Entries</div>', unsafe_allow_html=True)
        m2.markdown(f'<div class="hero-number">{exits_a}</div>'
                    f'<div class="hero-label">Exits</div>', unsafe_allow_html=True)
        m3.markdown(f'<div class="hero-number">{peak_a}</div>'
                    f'<div class="hero-label">Peak Occupancy</div>', unsafe_allow_html=True)

    with col_div:
        st.markdown("<br><br><br><div style='text-align:center;font-size:2em;color:#475569;'>vs</div>",
                    unsafe_allow_html=True)

    with col_b:
        st.markdown(f"**{clip_b}**")
        m4, m5, m6 = st.columns(3)
        m4.markdown(f'<div class="hero-number">{entries_b}</div>'
                    f'<div class="hero-label">Entries</div>', unsafe_allow_html=True)
        m5.markdown(f'<div class="hero-number">{exits_b}</div>'
                    f'<div class="hero-label">Exits</div>', unsafe_allow_html=True)
        m6.markdown(f'<div class="hero-number">{peak_b}</div>'
                    f'<div class="hero-label">Peak Occupancy</div>', unsafe_allow_html=True)

    # ── Delta summary ─────────────────────────────────────────────────────────
    st.divider()
    st.markdown('<div class="section-header">Delta Summary</div>', unsafe_allow_html=True)
    delta_e = entries_b - entries_a
    pct_e   = (delta_e / max(entries_a, 1)) * 100
    sign_e  = "+" if delta_e >= 0 else ""

    delta_p  = peak_b - peak_a
    sign_p   = "+" if delta_p >= 0 else ""

    if delta_e > 0:
        css_e = "delta-pos"
    elif delta_e < 0:
        css_e = "delta-neg"
    else:
        css_e = "delta-neutral"

    entry_text = (f"Job B had <strong>{sign_e}{delta_e}</strong> entries ({sign_e}{pct_e:.1f}%) "
                  f"vs Job A  &nbsp;·&nbsp;  Peak occupancy delta: <strong>{sign_p}{delta_p}</strong>")
    st.markdown(f'<div class="{css_e}">{entry_text}</div>', unsafe_allow_html=True)

    # ── Side-by-side metrics table ────────────────────────────────────────────
    st.divider()
    cmp_data = {
        "Metric":      ["Total Entries", "Total Exits", "Peak Occupancy", "Net (still inside)"],
        clip_a:        [entries_a, exits_a, peak_a, ppl_a.get("net_occupancy", 0)],
        clip_b:        [entries_b, exits_b, peak_b, ppl_b.get("net_occupancy", 0)],
        "Delta (B−A)": [
            f"{'+' if entries_b-entries_a >= 0 else ''}{entries_b-entries_a}",
            f"{'+' if exits_b-exits_a >= 0 else ''}{exits_b-exits_a}",
            f"{'+' if peak_b-peak_a >= 0 else ''}{peak_b-peak_a}",
            f"{'+' if ppl_b.get('net_occupancy',0)-ppl_a.get('net_occupancy',0) >= 0 else ''}"
            f"{ppl_b.get('net_occupancy',0)-ppl_a.get('net_occupancy',0)}",
        ],
    }
    st.dataframe(pd.DataFrame(cmp_data), use_container_width=True, hide_index=True)

    # ── Occupancy overlay chart ───────────────────────────────────────────────
    occ_a = sum_a.get("occupancy_log", [])
    occ_b = sum_b.get("occupancy_log", [])
    dur_a = max(sum_a.get("video_seconds", 1), 1)
    dur_b = max(sum_b.get("video_seconds", 1), 1)

    if occ_a or occ_b:
        st.divider()
        st.markdown('<div class="section-header">Occupancy Over Time (time-normalized to 0–100%)</div>',
                    unsafe_allow_html=True)

        bin_count = 20

        def _occ_bins(log: list, dur: float) -> list:
            counts = [0.0] * bin_count
            tally  = [0]   * bin_count
            for entry in log:
                if isinstance(entry, (list, tuple)) and len(entry) >= 2:
                    t_sec, occ = entry[0], entry[1]
                elif isinstance(entry, dict):
                    t_sec, occ = entry.get("t_sec", 0), entry.get("occupancy", 0)
                else:
                    continue
                pct_pos = min(t_sec / max(dur, 1) * 100, 99.99)
                bucket  = int(pct_pos / (100 / bin_count))
                counts[bucket] += occ
                tally[bucket]  += 1
            return [counts[i] / max(tally[i], 1) for i in range(bin_count)]

        bin_labels = [f"{int(i * 100 / bin_count)}%" for i in range(bin_count)]
        occ_df = pd.DataFrame({
            "Time %":  bin_labels,
            clip_a:    _occ_bins(occ_a, dur_a),
            clip_b:    _occ_bins(occ_b, dur_b),
        }).set_index("Time %")
        st.line_chart(occ_df, use_container_width=True)

# ─────────────────────────────────────────────────────────────────────────────
# MIXED MODE: one drink_count, one people_count
# ─────────────────────────────────────────────────────────────────────────────
else:
    st.info(
        "The two selected jobs use different analysis modes "
        f"(**{ANALYSIS_MODES.get(mode_a, mode_a)}** vs **{ANALYSIS_MODES.get(mode_b, mode_b)}**). "
        "Full side-by-side comparison is only available when both jobs use the same mode. "
        "Below is a summary of each job individually."
    )

    col_a, col_b = st.columns(2)

    def _render_summary_card(col, job: dict, summary: dict, mode: str):
        clip = job.get("clip_label") or job["job_id"]
        with col:
            st.markdown(f"**{clip}** — {ANALYSIS_MODES.get(mode, mode)}")
            if mode == "drink_count":
                barts = summary.get("bartenders", {})
                total = sum(d.get("total_drinks", 0) for d in barts.values())
                dur   = max(summary.get("video_seconds", 1), 1)
                rate  = total / (dur / 3600)
                st.metric("Total Drinks", total)
                st.metric("Drinks / hr",  f"{rate:.1f}")
                st.metric("Bartenders",   len(barts))
            elif mode == "people_count":
                ppl = summary.get("people", {})
                st.metric("Entries",         ppl.get("total_entries", 0))
                st.metric("Exits",           ppl.get("total_exits", 0))
                st.metric("Peak Occupancy",  ppl.get("peak_occupancy", 0))

    _render_summary_card(col_a, job_a, sum_a, mode_a)
    _render_summary_card(col_b, job_b, sum_b, mode_b)

# ── Raw job metadata ──────────────────────────────────────────────────────────
st.divider()
with st.expander("Job metadata"):
    mc1, mc2 = st.columns(2)
    with mc1:
        st.caption(f"**Job A:** `{id_a}`")
        st.json({
            "mode":    mode_a,
            "profile": job_a.get("model_profile"),
            "clip":    job_a.get("clip_label"),
            "dur_s":   sum_a.get("video_seconds"),
        })
    with mc2:
        st.caption(f"**Job B:** `{id_b}`")
        st.json({
            "mode":    mode_b,
            "profile": job_b.get("model_profile"),
            "clip":    job_b.get("clip_label"),
            "dur_s":   sum_b.get("video_seconds"),
        })
