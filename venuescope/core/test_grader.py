"""
Worker Tester — grading engine.

Takes per-feature detected/expected counts plus the worker's stability
snapshot and produces a structured A-F grade with human-readable notes
the admin UI can render.

Two-axis output:
  - accuracyGrade: how close detected count was to ground truth
  - stabilityGrade: did the worker stay healthy during the run

When stability is "unstable" (OOM, swap, errors, dropped frames), the
accuracy grade is capped at C — a perfectly-detected count from a
worker that was thrashing isn't a credible result.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any


# Configurable thresholds. Lower bounds for each grade letter (inclusive).
# A perfect 0% error gets A; >50% error gets F.
DEFAULT_RUBRIC = (
    (0.05, "A"),
    (0.15, "B"),
    (0.25, "C"),
    (0.50, "D"),
)

GRADE_ORDER = "ABCDF"

# Some features are inherently noisier — relax thresholds for them so a
# B grade on people_count means roughly the same operational quality as
# a B on drink_count. These overrides slot in via per-feature rubric.
PER_FEATURE_RUBRIC: Dict[str, tuple] = {
    # people_count's "peak concurrent" varies a lot across short windows
    "people_count": (
        (0.10, "A"),
        (0.25, "B"),
        (0.40, "C"),
        (0.65, "D"),
    ),
    # table_service is reported as a mean of response times — small N
    # makes a few outliers swing the mean dramatically
    "table_service": (
        (0.10, "A"),
        (0.20, "B"),
        (0.35, "C"),
        (0.55, "D"),
    ),
}


@dataclass
class FeatureResult:
    feature:   str
    detected:  int
    expected:  Optional[int]
    errorPct:  Optional[float]   # |detected - expected| / max(expected, 1)
    grade:     Optional[str]     # None when no ground truth
    notes:     List[str] = field(default_factory=list)


@dataclass
class GradedRun:
    perFeature:     Dict[str, FeatureResult]
    overallGrade:   Optional[str]
    stabilityGrade: str           # "stable" | "unstable"
    accuracyCapped: bool          # True if stability dragged accuracy down
    notes:          List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "perFeature": {
                f: {
                    "detected": r.detected,
                    "expected": r.expected,
                    "errorPct": r.errorPct,
                    "grade":    r.grade,
                    "notes":    r.notes,
                } for f, r in self.perFeature.items()
            },
            "overallGrade":   self.overallGrade,
            "stabilityGrade": self.stabilityGrade,
            "accuracyCapped": self.accuracyCapped,
            "notes":          self.notes,
        }


# ── Single-feature grading ──────────────────────────────────────────────

def grade_for_error(error_pct: float, *, feature: str = "") -> str:
    """Map an error fraction to a letter grade. Picks per-feature rubric
    if one exists, otherwise the default."""
    rubric = PER_FEATURE_RUBRIC.get(feature, DEFAULT_RUBRIC)
    for cap, letter in rubric:
        if error_pct <= cap:
            return letter
    return "F"


def cap_grade_at(grade: str, ceiling: str) -> str:
    """Return the WORSE of (grade, ceiling). Used to enforce stability cap."""
    if grade is None:
        return grade
    return grade if GRADE_ORDER.index(grade) >= GRADE_ORDER.index(ceiling) else ceiling


def worst_grade(grades: List[str]) -> Optional[str]:
    """Return the lexically-worst grade in the list."""
    grades = [g for g in grades if g]
    if not grades:
        return None
    return max(grades, key=lambda g: GRADE_ORDER.index(g))


# ── Full run grading ────────────────────────────────────────────────────

def grade_run(
    feature_counts: Dict[str, int],
    ground_truth: Dict[str, Any],
    *,
    stability: str = "stable",
    stability_notes: Optional[List[str]] = None,
    requested_features: Optional[List[str]] = None,
) -> GradedRun:
    """Produce a full graded run.

    Args:
      feature_counts:     {feature_name: int detected}
      ground_truth:       {feature_name: int expected}  (missing keys = no GT)
      stability:          "stable" or "unstable" from worker_health.derive_stability
      stability_notes:    Strings to surface alongside the grade
      requested_features: Features the operator asked us to test. If a
                          feature is requested but produced zero detections,
                          that's a flag-worthy note even if no GT was set.
    """
    notes: List[str] = list(stability_notes or [])
    accuracyCapped = False

    # Decide which features to grade. Union of (counts, GT, requested).
    feats = set(feature_counts.keys()) | set(ground_truth.keys()) | set(requested_features or [])
    perFeature: Dict[str, FeatureResult] = {}

    for f in sorted(feats):
        detected = int(feature_counts.get(f, 0))
        expected = ground_truth.get(f)
        per_notes: List[str] = []

        if expected is None:
            grade = None
            err   = None
            per_notes.append("no ground truth set — grade not computable")
            if requested_features and f in requested_features and detected == 0:
                per_notes.append("zero detections — verify camera + zone config")
        else:
            try:
                exp_int = int(expected)
            except (TypeError, ValueError):
                exp_int = 0
            if exp_int == 0:
                # Either bartender knew it was a slow shift or wrong GT.
                # Treat detected==0 as A; detected>0 as F.
                err = 1.0 if detected > 0 else 0.0
                grade = "A" if detected == 0 else "F"
                if detected == 0:
                    per_notes.append("expected 0, detected 0 — confirmed empty")
                else:
                    per_notes.append(f"expected 0 but detected {detected} — false positives")
            else:
                err = abs(detected - exp_int) / float(exp_int)
                grade = grade_for_error(err, feature=f)
                if grade != "A":
                    per_notes.append(_diff_note(detected, exp_int, f))

        perFeature[f] = FeatureResult(
            feature=f, detected=detected, expected=expected,
            errorPct=(round(err, 3) if err is not None else None),
            grade=grade, notes=per_notes,
        )

    # Apply stability cap. "Unstable" worker = accuracy can't be A or B —
    # cap at C. Document it so the UI can show "graded down due to OOM".
    if stability == "unstable":
        for f, r in perFeature.items():
            if r.grade and GRADE_ORDER.index(r.grade) < GRADE_ORDER.index("C"):
                old = r.grade
                r.grade = "C"
                r.notes.append(f"capped at C due to worker instability (was {old})")
                accuracyCapped = True

    overall = worst_grade([r.grade for r in perFeature.values() if r.grade])

    if accuracyCapped:
        notes.append("Some features were capped at C grade due to worker instability "
                     "(OOM, swap pressure, or dropped frames). Re-run after addressing.")

    return GradedRun(
        perFeature=perFeature,
        overallGrade=overall,
        stabilityGrade=stability,
        accuracyCapped=accuracyCapped,
        notes=notes,
    )


def _diff_note(detected: int, expected: int, feature: str) -> str:
    diff = detected - expected
    direction = "over" if diff > 0 else "under"
    pct = abs(diff) / max(expected, 1) * 100
    return f"{direction}-counted by {abs(diff)} ({pct:.0f}%) — detected {detected}, expected {expected}"
