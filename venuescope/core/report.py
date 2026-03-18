"""
VenueScope — Professional PDF shift report.
Multi-page with cover, executive summary, theft flags, timeline chart, confidence score.
"""
from __future__ import annotations
import io
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, KeepTogether, PageBreak
    )
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.graphics.shapes import Drawing, Rect, String, Line
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics import renderPDF
    REPORTLAB_OK = True
except ImportError:
    REPORTLAB_OK = False

from core.confidence import compute_confidence_score

# ── Brand colours ─────────────────────────────────────────────────────────────
ORANGE  = colors.HexColor("#f97316")
DARK    = colors.HexColor("#0f172a")
SLATE   = colors.HexColor("#475569")
LIGHT   = colors.HexColor("#f1f5f9")
RED     = colors.HexColor("#ef4444")
GREEN   = colors.HexColor("#22c55e")
YELLOW  = colors.HexColor("#eab308")
BLUE    = colors.HexColor("#3b82f6")
MUTED   = colors.HexColor("#94a3b8")
ROWALT  = colors.HexColor("#f8fafc")


def _page_footer(canvas, doc):
    """Draw footer and page number on every page (except cover)."""
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(SLATE)
    canvas.drawCentredString(letter[0] / 2, 0.35 * inch,
                             "Powered by VenueScope  ·  Confidential  ·  Not for distribution")
    canvas.drawRightString(letter[0] - 0.6 * inch, 0.35 * inch,
                           f"Page {doc.page}")
    canvas.restoreState()


def _cover_footer(canvas, doc):
    """Cover page footer only."""
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(letter[0] / 2, 0.35 * inch,
                             "CONFIDENTIAL — VenueScope Analytics  ·  Not for distribution")
    canvas.restoreState()


def _tbl(data, col_widths, stripe=True):
    s = [
        ("BACKGROUND",   (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 8),
        ("FONTNAME",     (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",     (0, 1), (-1, -1), 8),
        ("GRID",         (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",   (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
        ("LEFTPADDING",  (0, 0), (-1, -1), 7),
    ]
    if stripe:
        s.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ROWALT]))
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle(s))
    return t


def _conf_badge_table(score: int, color_str: str, W: float):
    """Return a one-row table that looks like a confidence badge."""
    badge_color = {"green": GREEN, "yellow": YELLOW, "red": RED}.get(color_str, SLATE)
    label = f"Detection Reliability: {score}%"
    sub   = ("Excellent" if score >= 85 else "Acceptable" if score >= 70 else "Low — review footage")
    data  = [[f"{label}  ·  {sub}"]]
    t = Table(data, colWidths=[W])
    t.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (0, 0), badge_color),
        ("TEXTCOLOR",    (0, 0), (0, 0), colors.white),
        ("FONTNAME",     (0, 0), (0, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (0, 0), 10),
        ("ALIGN",        (0, 0), (0, 0), "CENTER"),
        ("TOPPADDING",   (0, 0), (0, 0), 8),
        ("BOTTOMPADDING",(0, 0), (0, 0), 8),
        ("ROUNDEDCORNERS", [4]),
    ]))
    return t


def _timeline_chart(drink_timestamps, total_sec: float, W_pts: float) -> Optional[object]:
    """Build a 15-minute bucket bar chart using reportlab graphics."""
    if not drink_timestamps:
        return None
    bucket_sec = 900  # 15 minutes
    n_buckets  = max(int(total_sec / bucket_sec) + 1, 1)
    buckets    = [0] * n_buckets
    for t in drink_timestamps:
        b = int(t / bucket_sec)
        if b < n_buckets:
            buckets[b] += 1
    if max(buckets) == 0:
        return None

    d = Drawing(W_pts, 140)
    bc = VerticalBarChart()
    bc.x = 30; bc.y = 20
    bc.width  = W_pts - 60
    bc.height = 100
    bc.data   = [buckets]
    bc.bars[0].fillColor = ORANGE
    bc.valueAxis.valueMin      = 0
    bc.valueAxis.valueMax      = max(buckets) + 1
    bc.valueAxis.valueStep     = max(1, max(buckets) // 4)
    bc.categoryAxis.labels.fontSize = 6
    bc.categoryAxis.categoryNames  = [
        f"{int(i * 15)}m" for i in range(n_buckets)
    ]
    bc.categoryAxis.labels.angle = 30 if n_buckets > 8 else 0
    bc.valueAxis.labels.fontSize = 6
    d.add(bc)
    return d


def _people_section(story, people: dict, styles, W_pts):
    """PDF section for people_count mode."""
    from reportlab.platypus import HRFlowable
    H1 = ParagraphStyle("_pH1", fontSize=14, fontName="Helvetica-Bold",
                         textColor=DARK, spaceBefore=14, spaceAfter=5)
    BD = ParagraphStyle("_pBD", fontSize=9, fontName="Helvetica",
                        textColor=DARK, spaceAfter=4)

    story.append(Paragraph("People Count & Occupancy", H1))
    story.append(HRFlowable(width=W_pts, thickness=1.5, color=ORANGE, spaceAfter=10))

    total_entries  = people.get("total_entries", 0)
    total_exits    = people.get("total_exits", 0)
    peak_occupancy = people.get("peak_occupancy", 0)

    stat_data = [
        ["Total Entries", "Total Exits", "Peak Occupancy"],
        [str(total_entries), str(total_exits), str(peak_occupancy)],
    ]
    col_w = W_pts / 3
    st = Table(stat_data, colWidths=[col_w, col_w, col_w])
    st.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 1), (-1, -1), 14),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("BACKGROUND",    (0, 1), (-1, 1), LIGHT),
        ("TEXTCOLOR",     (0, 1), (-1, 1), DARK),
    ]))
    story.append(st)
    story.append(Spacer(1, 12))

    hourly_entries = people.get("hourly_entries", [])
    if hourly_entries:
        story.append(Paragraph("Hourly Breakdown", ParagraphStyle(
            "_pH2", fontSize=11, fontName="Helvetica-Bold",
            textColor=DARK, spaceBefore=8, spaceAfter=4)))
        hrows = [["Hour", "Entries", "Exits"]]
        for row in hourly_entries:
            if isinstance(row, dict):
                hrows.append([
                    str(row.get("hour", "")),
                    str(row.get("entries", 0)),
                    str(row.get("exits", 0)),
                ])
            elif isinstance(row, (list, tuple)) and len(row) >= 3:
                hrows.append([str(row[0]), str(row[1]), str(row[2])])
        story.append(_tbl(hrows, [W_pts * 0.33, W_pts * 0.33, W_pts * 0.34]))
        story.append(Spacer(1, 12))

    per_line = people.get("per_line", {})
    if per_line:
        story.append(Paragraph("Per-Entrance Breakdown", ParagraphStyle(
            "_pH2b", fontSize=11, fontName="Helvetica-Bold",
            textColor=DARK, spaceBefore=8, spaceAfter=4)))
        erows = [["Entrance", "Entries", "Exits"]]
        for entrance, data in per_line.items():
            if isinstance(data, dict):
                erows.append([
                    str(entrance),
                    str(data.get("entries", 0)),
                    str(data.get("exits", 0)),
                ])
            elif isinstance(data, (list, tuple)) and len(data) >= 2:
                erows.append([str(entrance), str(data[0]), str(data[1])])
        story.append(_tbl(erows, [W_pts * 0.40, W_pts * 0.30, W_pts * 0.30]))
        story.append(Spacer(1, 12))


def _table_section(story, tables: dict, styles, W_pts):
    """PDF section for table_turns mode."""
    from reportlab.platypus import HRFlowable
    H1 = ParagraphStyle("_tH1", fontSize=14, fontName="Helvetica-Bold",
                         textColor=DARK, spaceBefore=14, spaceAfter=5)

    story.append(Paragraph("Table Analytics", H1))
    story.append(HRFlowable(width=W_pts, thickness=1.5, color=ORANGE, spaceAfter=10))

    table_data = tables.get("tables", tables)  # allow flat dict or nested
    if not isinstance(table_data, dict):
        table_data = {}

    rows_raw = []
    for tbl_id, tdata in table_data.items():
        if not isinstance(tdata, dict):
            continue
        turn_count  = tdata.get("turn_count", tdata.get("turns", 0))
        avg_dwell   = tdata.get("avg_dwell_min", tdata.get("avg_dwell", 0))
        max_dwell   = tdata.get("max_dwell_min", tdata.get("max_dwell", 0))
        revenue_idx = int(turn_count) * 10
        rows_raw.append((str(tbl_id), int(turn_count), float(avg_dwell),
                         float(max_dwell), revenue_idx))

    # Sort descending by turn_count
    rows_raw.sort(key=lambda r: r[1], reverse=True)
    top_idx = 1 if rows_raw else None  # row index of top performer (1-based, header=0)

    trows = [["Table", "Turns", "Avg Dwell (min)", "Max Dwell (min)", "Revenue Index"]]
    for tbl_id, turns, avg_d, max_d, rev_idx in rows_raw:
        trows.append([tbl_id, str(turns), f"{avg_d:.1f}", f"{max_d:.1f}", str(rev_idx)])

    col_w = [W_pts * 0.20, W_pts * 0.12, W_pts * 0.22, W_pts * 0.22, W_pts * 0.24]
    base_styles = [
        ("BACKGROUND",    (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 8),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 7),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, ROWALT]),
    ]
    if top_idx is not None and len(trows) > 1:
        base_styles.append(("FONTNAME",   (0, top_idx), (-1, top_idx), "Helvetica-Bold"))
        base_styles.append(("BACKGROUND", (0, top_idx), (-1, top_idx),
                             colors.HexColor("#fef9c3")))  # light yellow highlight

    tt = Table(trows, colWidths=col_w)
    tt.setStyle(TableStyle(base_styles))
    story.append(tt)
    story.append(Spacer(1, 12))


def _staff_section(story, staff: dict, styles, W_pts):
    """PDF section for staff_activity mode."""
    from reportlab.platypus import HRFlowable
    H1 = ParagraphStyle("_sH1", fontSize=14, fontName="Helvetica-Bold",
                         textColor=DARK, spaceBefore=14, spaceAfter=5)
    BD = ParagraphStyle("_sBD", fontSize=9, fontName="Helvetica",
                        textColor=DARK, spaceAfter=4)

    story.append(Paragraph("Staff Activity", H1))
    story.append(HRFlowable(width=W_pts, thickness=1.5, color=ORANGE, spaceAfter=10))

    tracks = staff.get("tracks", staff) if isinstance(staff, dict) else {}
    if not isinstance(tracks, dict):
        tracks = {}

    total_tracked = len(tracks)
    peak_headcount = staff.get("peak_headcount", staff.get("peak_staff", 0)) \
        if isinstance(staff, dict) else 0

    idle_pcts = []
    for td in tracks.values():
        if isinstance(td, dict):
            ip = td.get("idle_pct", td.get("idle_percent", None))
            if ip is None:
                active = td.get("active_min", 0)
                idle   = td.get("idle_min", 0)
                total  = active + idle
                ip = (idle / total * 100) if total > 0 else 0
            idle_pcts.append(float(ip))
    avg_idle = (sum(idle_pcts) / len(idle_pcts)) if idle_pcts else 0.0

    summary_data = [
        ["Total Staff Tracked", "Peak Headcount", "Avg Idle %"],
        [str(total_tracked), str(peak_headcount), f"{avg_idle:.1f}%"],
    ]
    col_w = W_pts / 3
    ss = Table(summary_data, colWidths=[col_w, col_w, col_w])
    ss.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 1), (-1, -1), 14),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("BACKGROUND",    (0, 1), (-1, 1), LIGHT),
        ("TEXTCOLOR",     (0, 1), (-1, 1), DARK),
    ]))
    story.append(ss)
    story.append(Spacer(1, 12))

    if tracks:
        detail_rows = [["Track ID", "On Screen (min)", "Active (min)", "Idle (min)", "Idle %"]]
        high_idle_rows = []  # 1-based indices of rows with idle_pct > 40%
        for track_id, td in tracks.items():
            if not isinstance(td, dict):
                continue
            on_screen = td.get("on_screen_min", td.get("total_min", 0))
            active    = td.get("active_min", 0)
            idle      = td.get("idle_min", 0)
            ip        = td.get("idle_pct", td.get("idle_percent", None))
            if ip is None:
                total_t = active + idle
                ip = (idle / total_t * 100) if total_t > 0 else 0.0
            else:
                ip = float(ip)
            row_idx = len(detail_rows)  # 1-based (header is 0)
            detail_rows.append([
                str(track_id),
                f"{float(on_screen):.1f}",
                f"{float(active):.1f}",
                f"{float(idle):.1f}",
                f"{ip:.1f}%",
            ])
            if ip > 40.0:
                high_idle_rows.append(row_idx)

        col_w2 = [W_pts * 0.20, W_pts * 0.20, W_pts * 0.20, W_pts * 0.20, W_pts * 0.20]
        detail_style = [
            ("BACKGROUND",    (0, 0), (-1, 0), DARK),
            ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
            ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 8),
            ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
            ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 7),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, ROWALT]),
        ]
        for ri in high_idle_rows:
            detail_style.append(("BACKGROUND", (0, ri), (-1, ri),
                                  colors.HexColor("#fef2f2")))  # light red
            detail_style.append(("TEXTCOLOR",  (4, ri), (4, ri), RED))
            detail_style.append(("FONTNAME",   (4, ri), (4, ri), "Helvetica-Bold"))

        dt = Table(detail_rows, colWidths=col_w2)
        dt.setStyle(TableStyle(detail_style))
        story.append(dt)
        story.append(Spacer(1, 12))


def generate_shift_report(summary: Dict[str, Any],
                           job_id: str,
                           clip_label: str,
                           mode: str,
                           pos_data: Optional[Dict] = None,
                           venue_name: str = "") -> bytes:
    if not REPORTLAB_OK:
        raise RuntimeError("reportlab not installed: pip install reportlab")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.65 * inch, rightMargin=0.65 * inch,
        topMargin=0.6 * inch, bottomMargin=0.65 * inch,
        title=f"VenueScope Shift Report — {venue_name or clip_label}",
        author="VenueScope Analytics",
    )
    W = letter[0] - 1.3 * inch

    styles = getSampleStyleSheet()
    H1  = ParagraphStyle("H1",  fontSize=14, fontName="Helvetica-Bold",
                          textColor=DARK, spaceBefore=14, spaceAfter=5)
    H2  = ParagraphStyle("H2",  fontSize=11, fontName="Helvetica-Bold",
                          textColor=DARK, spaceBefore=10, spaceAfter=4)
    BD  = ParagraphStyle("BD",  fontSize=9,  fontName="Helvetica",
                          textColor=DARK, spaceAfter=4)
    SM  = ParagraphStyle("SM",  fontSize=7,  fontName="Helvetica",
                          textColor=SLATE, spaceAfter=2)
    RD  = ParagraphStyle("RD",  fontSize=9,  fontName="Helvetica-Bold",
                          textColor=RED, spaceAfter=4)
    CTR = ParagraphStyle("CTR", fontSize=9, fontName="Helvetica",
                          textColor=DARK, alignment=TA_CENTER)
    now = datetime.now()

    score, score_color, _ = compute_confidence_score(summary)
    quality = summary.get("quality", {})

    story = []

    # ── COVER PAGE ────────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.8 * inch))

    # Orange accent bar
    story.append(Table([[""]], colWidths=[W],
                        style=TableStyle([
                            ("BACKGROUND", (0,0),(0,0), ORANGE),
                            ("TOPPADDING", (0,0),(0,0), 4),
                            ("BOTTOMPADDING", (0,0),(0,0), 4),
                        ])))
    story.append(Spacer(1, 0.2 * inch))

    _vname = venue_name.strip() or "Your Venue"
    story.append(Paragraph(
        f'<font size="30" color="#0f172a"><b>VenueScope</b></font>',
        ParagraphStyle("cov1", alignment=TA_LEFT, spaceAfter=4)))
    story.append(Paragraph(
        f'<font size="18" color="#f97316"><b>Bar Analytics Report</b></font>',
        ParagraphStyle("cov2", alignment=TA_LEFT, spaceAfter=16)))

    cover_data = [
        ["Venue",      _vname],
        ["Clip",       clip_label or job_id],
        ["Date",       now.strftime("%B %d, %Y")],
        ["Time",       now.strftime("%I:%M %p")],
        ["Duration",   f"{summary.get('video_seconds', 0):.0f} seconds"],
        ["Job ID",     job_id],
    ]
    ct = Table(cover_data, colWidths=[W * 0.25, W * 0.75])
    ct.setStyle(TableStyle([
        ("FONTNAME",  (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME",  (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE",  (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (-1, -1), DARK),
        ("TOPPADDING",(0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#e2e8f0")),
    ]))
    story.append(ct)
    story.append(Spacer(1, 0.3 * inch))

    # Confidence badge on cover
    story.append(_conf_badge_table(score, score_color, W))
    story.append(Spacer(1, 0.4 * inch))

    story.append(Paragraph(
        "CONFIDENTIAL — For authorized personnel only.",
        ParagraphStyle("conf_label", fontSize=8, fontName="Helvetica-Bold",
                       textColor=SLATE, alignment=TA_LEFT)))
    story.append(Paragraph(
        "This report was generated automatically by VenueScope computer vision analytics. "
        "Drink counts are estimates based on YOLO person detection and bar-line crossing logic. "
        "Always cross-reference with POS data before taking disciplinary action.",
        ParagraphStyle("disc", fontSize=7, fontName="Helvetica",
                       textColor=SLATE, alignment=TA_LEFT, spaceAfter=6)))

    story.append(PageBreak())

    # ── PAGE 2: EXECUTIVE SUMMARY ─────────────────────────────────────────────
    story.append(Paragraph("Executive Summary", H1))
    story.append(HRFlowable(width=W, thickness=1.5, color=ORANGE, spaceAfter=10))

    if mode == "drink_count":
        bartenders  = summary.get("bartenders", {})
        drink_total = sum(b.get("total_drinks", 0) for b in bartenders.values())
        top_name    = max(bartenders, key=lambda n: bartenders[n].get("total_drinks", 0), default="N/A")
        bot_name    = min(bartenders, key=lambda n: bartenders[n].get("total_drinks", 0), default="N/A")
        top_ct      = bartenders.get(top_name, {}).get("total_drinks", 0)
        bot_ct      = bartenders.get(bot_name, {}).get("total_drinks", 0)

        exec_data = [
            ["Total Drinks Detected",  str(drink_total)],
            ["Top Performer",          f"{top_name}  ({top_ct} drinks)"],
            ["Lowest Count",           f"{bot_name}  ({bot_ct} drinks)"],
            ["Unassigned Serves",      str(summary.get("drink_quality", {}).get("unassigned_serves", 0))],
        ]
        et = Table(exec_data, colWidths=[W * 0.45, W * 0.55])
        et.setStyle(TableStyle([
            ("FONTNAME",     (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE",     (0, 0), (-1, -1), 10),
            ("TEXTCOLOR",    (0, 0), (-1, -1), DARK),
            ("TOPPADDING",   (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 7),
            ("LINEBELOW",    (0, 0), (-1, -2), 0.25, colors.HexColor("#e2e8f0")),
            ("BACKGROUND",   (0, 0), (0, 0), DARK),
            ("TEXTCOLOR",    (0, 0), (0, 0), colors.white),
            ("BACKGROUND",   (1, 0), (1, 0), DARK),
            ("TEXTCOLOR",    (1, 0), (1, 0), colors.white),
            ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ]))
        story.append(et)
        story.append(Spacer(1, 16))

        # ── THEFT RISK ──────────────────────────────────────────────────────
        story.append(Paragraph("Theft Risk Assessment", H1))
        story.append(HRFlowable(width=W, thickness=1.5, color=ORANGE, spaceAfter=10))

        if pos_data:
            theft_rows = [["Bartender", "CV Count", "POS Rings", "Delta", "Risk Flag"]]
            any_flag = False
            for name, bd in bartenders.items():
                cv  = bd.get("total_drinks", 0)
                pos = pos_data.get(name, 0)
                delta = cv - pos
                if pos > 0:
                    pct_diff = (cv - pos) / pos * 100
                else:
                    pct_diff = 0
                if abs(pct_diff) > 20 and pos > 0:
                    flag = "⚠ REVIEW"
                    any_flag = True
                elif abs(pct_diff) > 10 and pos > 0:
                    flag = "CHECK"
                else:
                    flag = "OK"
                theft_rows.append([name, str(cv), str(pos), f"{delta:+d}", flag])

            tt = Table(theft_rows, colWidths=[W*0.25, W*0.15, W*0.15, W*0.15, W*0.3])
            ts = TableStyle([
                ("BACKGROUND",   (0, 0), (-1, 0), DARK),
                ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
                ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE",     (0, 0), (-1, -1), 8),
                ("FONTNAME",     (0, 1), (-1, -1), "Helvetica"),
                ("GRID",         (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
                ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING",   (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
                ("LEFTPADDING",  (0, 0), (-1, -1), 7),
                ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, ROWALT]),
            ])
            for i, (name, bd) in enumerate(bartenders.items(), start=1):
                cv  = bd.get("total_drinks", 0)
                pos = pos_data.get(name, 0)
                pct_diff = (cv - pos) / pos * 100 if pos > 0 else 0
                if abs(pct_diff) > 20 and pos > 0:
                    ts.add("TEXTCOLOR",    (4, i), (4, i), RED)
                    ts.add("FONTNAME",     (4, i), (4, i), "Helvetica-Bold")
                    ts.add("BACKGROUND",   (0, i), (-1, i), colors.HexColor("#fef2f2"))
                elif abs(pct_diff) > 10 and pos > 0:
                    ts.add("TEXTCOLOR",    (4, i), (4, i), YELLOW)
                    ts.add("FONTNAME",     (4, i), (4, i), "Helvetica-Bold")
            tt.setStyle(ts)
            story.append(tt)
            if any_flag:
                story.append(Spacer(1, 6))
                story.append(Paragraph(
                    "⚠  One or more bartenders show >20% variance vs POS. "
                    "Review verification snapshots and cross-reference with POS reports before action.",
                    RD))
        else:
            story.append(Paragraph(
                "No POS data provided. Enter POS ring counts in the Results page "
                "and regenerate to enable theft risk comparison.",
                BD))

        story.append(Spacer(1, 14))

        # ── PER-BARTENDER BREAKDOWN ──────────────────────────────────────────
        story.append(Paragraph("Per-Bartender Performance", H1))
        story.append(HRFlowable(width=W, thickness=1.5, color=ORANGE, spaceAfter=10))

        brows = [["Bartender", "Station", "Total", "Drinks/hr", "Peak Period", "Timestamps"]]
        for name, bd in bartenders.items():
            hc      = bd.get("hourly_counts", {})
            peak_hr = max(hc, key=lambda k: hc[k], default="—")
            peak_lb = f"Hour {peak_hr}" if peak_hr != "—" else "—"
            ts_list = bd.get("drink_timestamps", [])
            ts_str  = ", ".join(f"{t:.0f}s" for t in ts_list[:6])
            if len(ts_list) > 6:
                ts_str += f" +{len(ts_list)-6} more"
            brows.append([
                name,
                bd.get("station_id", ""),
                str(bd.get("total_drinks", 0)),
                f"{bd.get('drinks_per_hour', 0):.1f}",
                peak_lb,
                ts_str or "—",
            ])
        bt = Table(brows, colWidths=[W*0.18, W*0.10, W*0.08, W*0.10, W*0.12, W*0.42])
        bts = TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0), DARK),
            ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
            ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 7.5),
            ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
            ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, ROWALT]),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ])
        bt.setStyle(bts)
        story.append(bt)
        story.append(Spacer(1, 14))

        # ── TIMELINE CHART ───────────────────────────────────────────────────
        story.append(Paragraph("Drinks per 15-Minute Interval", H1))
        story.append(HRFlowable(width=W, thickness=1.5, color=ORANGE, spaceAfter=8))

        all_timestamps = []
        for bd in bartenders.values():
            all_timestamps.extend(bd.get("drink_timestamps", []))

        chart = _timeline_chart(all_timestamps, summary.get("video_seconds", 0), W * 72 / inch)
        if chart:
            story.append(chart)
        else:
            story.append(Paragraph("No drinks detected — chart unavailable.", BD))

        story.append(Spacer(1, 14))

    elif mode == "people_count":
        _people_section(story, summary.get("people", summary), styles, W)

    elif mode == "table_turns":
        _table_section(story, summary.get("tables", summary), styles, W)

    elif mode == "staff_activity":
        _staff_section(story, summary.get("staff", summary), styles, W)

    # ── CONFIDENCE SCORE (detail) ─────────────────────────────────────────────
    story.append(Paragraph("Detection Confidence Details", H1))
    story.append(HRFlowable(width=W, thickness=1.5, color=ORANGE, spaceAfter=8))

    conf_rows = [
        ["Metric", "Value", "Status"],
        ["Avg Detection Confidence",
         f"{quality.get('avg_detection_conf', 0):.1%}",
         "Good" if quality.get('avg_detection_conf', 0) >= 0.5 else "Low"],
        ["Tracking Stability (ID switches/frame)",
         f"{quality.get('tracking_switch_rate', 0):.3f}",
         "Good" if quality.get('tracking_switch_rate', 0) < 0.05 else "High"],
        ["Frames Processed",
         str(quality.get("processed_frames", 0)),
         ""],
        ["Overall Reliability Score",
         f"{score}%",
         "Excellent" if score >= 85 else "Acceptable" if score >= 70 else "Low"],
    ]
    ct2 = Table(conf_rows, colWidths=[W*0.50, W*0.25, W*0.25])
    cts = TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 8),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, ROWALT]),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 7),
    ])
    # Colour the "Low" status cells red
    for i, row in enumerate(conf_rows[1:], start=1):
        if "Low" in row[2] or "High" in row[2]:
            cts.add("TEXTCOLOR", (2, i), (2, i), RED)
            cts.add("FONTNAME",  (2, i), (2, i), "Helvetica-Bold")
        elif "Good" in row[2] or "Excellent" in row[2] or "Acceptable" in row[2]:
            cts.add("TEXTCOLOR", (2, i), (2, i), GREEN)
    ct2.setStyle(cts)
    story.append(ct2)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Reliability score factors: YOLO detection confidence (45%), "
        "tracking stability (35%), detection viability (20%).",
        SM))

    # Quality warnings
    warns = quality.get("warnings", [])
    if mode == "drink_count":
        warns = warns + summary.get("drink_quality", {}).get("warnings", [])
    if warns:
        story.append(Spacer(1, 8))
        story.append(Paragraph("Quality Warnings", H2))
        for w in warns:
            story.append(Paragraph(f"⚠  {w}", RD))

    doc.build(story, onFirstPage=_cover_footer, onLaterPages=_page_footer)
    return buf.getvalue()


def generate_combined_report(
    job_summaries: list,   # list of {"job_id", "mode", "summary", "clip_label"}
    venue_name: str = "",
    pos_data: Optional[Dict[str, Any]] = None,
) -> bytes:
    """Generate a multi-mode combined shift report PDF.

    Parameters
    ----------
    job_summaries:
        List of dicts, each with keys: job_id, mode, summary, clip_label.
        Supported modes: drink_count, people_count, table_turns, staff_activity.
    venue_name:
        Display name for the venue (shown on cover and header).

    Returns
    -------
    bytes
        Raw PDF bytes.
    """
    if not REPORTLAB_OK:
        raise RuntimeError("reportlab not installed: pip install reportlab")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.65 * inch, rightMargin=0.65 * inch,
        topMargin=0.6 * inch, bottomMargin=0.65 * inch,
        title=f"VenueScope — Combined Shift Report — {venue_name or 'Multi-Mode'}",
        author="VenueScope Analytics",
    )
    W = letter[0] - 1.3 * inch

    styles = getSampleStyleSheet()
    H1  = ParagraphStyle("_cH1", fontSize=14, fontName="Helvetica-Bold",
                          textColor=DARK, spaceBefore=14, spaceAfter=5)
    H2  = ParagraphStyle("_cH2", fontSize=11, fontName="Helvetica-Bold",
                          textColor=DARK, spaceBefore=10, spaceAfter=4)
    BD  = ParagraphStyle("_cBD", fontSize=9,  fontName="Helvetica",
                          textColor=DARK, spaceAfter=4)
    SM  = ParagraphStyle("_cSM", fontSize=7,  fontName="Helvetica",
                          textColor=SLATE, spaceAfter=2)

    now = datetime.now()
    _vname = venue_name.strip() or "Your Venue"

    story = []

    # ── COVER PAGE ────────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.8 * inch))

    story.append(Table([[""]], colWidths=[W],
                        style=TableStyle([
                            ("BACKGROUND",    (0, 0), (0, 0), ORANGE),
                            ("TOPPADDING",    (0, 0), (0, 0), 4),
                            ("BOTTOMPADDING", (0, 0), (0, 0), 4),
                        ])))
    story.append(Spacer(1, 0.2 * inch))

    story.append(Paragraph(
        '<font size="30" color="#0f172a"><b>VenueScope</b></font>',
        ParagraphStyle("_covT", alignment=TA_LEFT, spaceAfter=4)))
    story.append(Paragraph(
        '<font size="18" color="#f97316"><b>Combined Shift Report</b></font>',
        ParagraphStyle("_covS", alignment=TA_LEFT, spaceAfter=16)))

    cover_data = [
        ["Venue",   _vname],
        ["Date",    now.strftime("%B %d, %Y")],
        ["Time",    now.strftime("%I:%M %p")],
        ["Jobs",    str(len(job_summaries))],
    ]
    ct = Table(cover_data, colWidths=[W * 0.25, W * 0.75])
    ct.setStyle(TableStyle([
        ("FONTNAME",      (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME",      (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 0), (-1, -1), 10),
        ("TEXTCOLOR",     (0, 0), (-1, -1), DARK),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW",     (0, 0), (-1, -2), 0.25, colors.HexColor("#e2e8f0")),
    ]))
    story.append(ct)
    story.append(Spacer(1, 0.4 * inch))

    story.append(Paragraph(
        "CONFIDENTIAL — For authorized personnel only.",
        ParagraphStyle("_covC", fontSize=8, fontName="Helvetica-Bold",
                       textColor=SLATE, alignment=TA_LEFT)))
    story.append(Paragraph(
        "This report was generated automatically by VenueScope computer vision analytics. "
        "Results are estimates — always cross-reference with operational records.",
        ParagraphStyle("_covD", fontSize=7, fontName="Helvetica",
                       textColor=SLATE, alignment=TA_LEFT, spaceAfter=6)))

    story.append(PageBreak())

    # ── CONFIDENCE OVERVIEW TABLE ─────────────────────────────────────────────
    story.append(Paragraph("Confidence Overview", H1))
    story.append(HRFlowable(width=W, thickness=1.5, color=ORANGE, spaceAfter=10))

    conf_overview_rows = [["Job ID", "Mode", "Clip", "Score", "Rating"]]
    for job in job_summaries:
        j_summary    = job.get("summary", {})
        j_mode       = job.get("mode", "")
        j_id         = job.get("job_id", "")
        j_label      = job.get("clip_label", j_id)
        j_score, j_color, _ = compute_confidence_score(j_summary)
        rating = ("Excellent" if j_score >= 85
                  else "Acceptable" if j_score >= 70
                  else "Low")
        conf_overview_rows.append([j_id, j_mode, j_label, f"{j_score}%", rating])

    ov_col_w = [W * 0.22, W * 0.18, W * 0.28, W * 0.12, W * 0.20]
    ov_style = [
        ("BACKGROUND",    (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 8),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("GRID",          (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 7),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, ROWALT]),
    ]
    # Colour Rating cells
    for i, job in enumerate(job_summaries, start=1):
        j_score, j_color, _ = compute_confidence_score(job.get("summary", {}))
        clr = {"green": GREEN, "yellow": YELLOW, "red": RED}.get(j_color, SLATE)
        ov_style.append(("TEXTCOLOR",  (4, i), (4, i), clr))
        ov_style.append(("FONTNAME",   (4, i), (4, i), "Helvetica-Bold"))

    ov_tbl = Table(conf_overview_rows, colWidths=ov_col_w)
    ov_tbl.setStyle(TableStyle(ov_style))
    story.append(ov_tbl)
    story.append(Spacer(1, 14))

    # ── PER-JOB SECTIONS ─────────────────────────────────────────────────────
    _section_builders = {
        "people_count":  _people_section,
        "table_turns":   _table_section,
        "staff_activity": _staff_section,
    }

    for job_idx, job in enumerate(job_summaries):
        j_id      = job.get("job_id", f"job_{job_idx}")
        j_mode    = job.get("mode", "")
        j_label   = job.get("clip_label", j_id)
        j_summary = job.get("summary", {})

        story.append(Paragraph(
            f'<font size="12" color="#f97316"><b>Job:</b></font>'
            f' <font size="12" color="#0f172a">{j_label}</font>'
            f'  <font size="9" color="#475569">({j_mode})</font>',
            ParagraphStyle("_jobH", spaceBefore=8, spaceAfter=4)))
        story.append(HRFlowable(width=W, thickness=0.75, color=SLATE, spaceAfter=8))

        j_score, j_color, _ = compute_confidence_score(j_summary)
        story.append(_conf_badge_table(j_score, j_color, W))
        story.append(Spacer(1, 10))

        if j_mode == "drink_count":
            # Inline drink_count summary (condensed — no theft section)
            bartenders  = j_summary.get("bartenders", {})
            drink_total = sum(b.get("total_drinks", 0) for b in bartenders.values())
            brows = [["Bartender", "Station", "Total Drinks", "Drinks/hr"]]
            for name, bd in bartenders.items():
                brows.append([
                    name,
                    bd.get("station_id", ""),
                    str(bd.get("total_drinks", 0)),
                    f"{bd.get('drinks_per_hour', 0):.1f}",
                ])
            story.append(Paragraph(
                f"Drink Count — Total: {drink_total}",
                ParagraphStyle("_dcH", fontSize=11, fontName="Helvetica-Bold",
                               textColor=DARK, spaceAfter=4)))
            story.append(_tbl(brows, [W * 0.35, W * 0.20, W * 0.20, W * 0.25]))
            story.append(Spacer(1, 12))

        elif j_mode in _section_builders:
            # Determine which sub-key to pass to the section builder
            data_key_map = {
                "people_count":   "people",
                "table_turns":    "tables",
                "staff_activity": "staff",
            }
            data_key = data_key_map[j_mode]
            section_data = j_summary.get(data_key, j_summary)
            _section_builders[j_mode](story, section_data, styles, W)

        else:
            story.append(Paragraph(
                f"No section builder available for mode '{j_mode}'.", BD))
            story.append(Spacer(1, 12))

        # Page break between jobs (but not after the last one)
        if job_idx < len(job_summaries) - 1:
            story.append(PageBreak())

    doc.build(story, onFirstPage=_cover_footer, onLaterPages=_page_footer)
    return buf.getvalue()
