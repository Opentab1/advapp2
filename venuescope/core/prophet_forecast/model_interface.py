"""
VenueScope — Forecast model interface.
Provides ProphetForecaster (default) and GradientBoostingForecaster (fallback).
Selected by FORECASTER=prophet|gbm environment variable.
"""
from __future__ import annotations
import os
import pickle
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

_MODEL_DIR = Path.home() / ".venuescope" / "models"

_S3_BUCKET = os.environ.get("S3_BUCKET", "")
_S3_MODEL_PREFIX = "venuescope-models"


def _ensure_model_dir() -> None:
    _MODEL_DIR.mkdir(parents=True, exist_ok=True)


def _model_path(venue_id: str) -> Path:
    return _MODEL_DIR / f"{venue_id}_forecaster.pkl"


def _s3_model_key(venue_id: str) -> str:
    return f"{_S3_MODEL_PREFIX}/{venue_id}_forecaster.pkl"


def _s3_client():
    import boto3
    return boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION", "us-east-2"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


# ── Abstract interface ────────────────────────────────────────────────────────

class ForecastModel(ABC):
    """Abstract base class for all VenueScope forecasters."""

    @abstractmethod
    def fit(self, df: pd.DataFrame) -> None:
        """
        Fit the model on historical occupancy data.

        df columns:
          ds                      datetime
          y                       headcount (int)
          temp                    float, °F
          precip                  float, in/hr
          wind                    float, mph
          competing_events_count  int
        """

    @abstractmethod
    def predict(self, future_df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate forecast for future_df (same column schema as fit df, except y).
        Returns DataFrame with columns: ds, yhat, yhat_lower, yhat_upper.
        """

    def save(self, venue_id: str) -> None:
        _ensure_model_dir()
        local_path = _model_path(venue_id)
        with open(local_path, "wb") as f:
            pickle.dump(self, f)
        logger.info("[model] Saved %s model locally to %s", type(self).__name__, local_path)

        # Upload to S3 if configured
        if _S3_BUCKET:
            try:
                s3 = _s3_client()
                s3.upload_file(str(local_path), _S3_BUCKET, _s3_model_key(venue_id))
                logger.info("[model] Uploaded model to s3://%s/%s", _S3_BUCKET, _s3_model_key(venue_id))
            except Exception as e:
                logger.warning("[model] S3 upload failed (local copy kept): %s", e)

    @classmethod
    def load(cls, venue_id: str) -> Optional["ForecastModel"]:
        local_path = _model_path(venue_id)

        # Try local first (fastest)
        if local_path.exists():
            try:
                with open(local_path, "rb") as f:
                    model = pickle.load(f)
                logger.info("[model] Loaded model from local cache: %s", local_path)
                return model
            except Exception as e:
                logger.warning("[model] Local load failed: %s — trying S3", e)
                local_path.unlink(missing_ok=True)

        # Fall back to S3
        if _S3_BUCKET:
            try:
                _ensure_model_dir()
                s3 = _s3_client()
                s3.download_file(_S3_BUCKET, _s3_model_key(venue_id), str(local_path))
                logger.info("[model] Downloaded model from S3: %s", _s3_model_key(venue_id))
                with open(local_path, "rb") as f:
                    return pickle.load(f)
            except Exception as e:
                logger.warning("[model] S3 download failed: %s", e)

        return None


# ── DOW indicator helper ──────────────────────────────────────────────────────

def _add_dow_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Add is_dow_0 through is_dow_6 boolean columns to df (Monday=0, Sunday=6)."""
    df = df.copy()
    dow = pd.to_datetime(df["ds"]).dt.dayofweek
    for i in range(7):
        df[f"is_dow_{i}"] = (dow == i)
    return df


# ── Prophet forecaster ────────────────────────────────────────────────────────

class ProphetForecaster(ForecastModel):
    """
    Prophet-based forecaster with per-DOW hourly seasonality and weather regressors.
    """

    def __init__(self):
        self._model = None

    def fit(self, df: pd.DataFrame) -> None:
        try:
            from prophet import Prophet
        except ImportError:
            raise ImportError(
                "prophet is not installed. Run: pip install prophet>=1.1.5"
            )

        df = _add_dow_indicators(df)

        m = Prophet(
            yearly_seasonality=10,
            weekly_seasonality=3,
            daily_seasonality=False,
            changepoint_prior_scale=0.05,
            seasonality_prior_scale=10.0,
            interval_width=0.80,
        )

        # Custom hourly seasonality per day-of-week (Monday=0 through Sunday=6)
        for i in range(7):
            m.add_seasonality(
                name=f"hourly_dow_{i}",
                period=1,           # 1 day
                fourier_order=5,
                condition_name=f"is_dow_{i}",
            )

        # Weather regressors
        m.add_regressor("temp")
        m.add_regressor("precip")
        m.add_regressor("wind")
        m.add_regressor("competing_events_count")

        # US public holidays
        m.add_country_holidays(country_name="US")

        m.fit(df)
        self._model = m
        logger.info("[ProphetForecaster] Fit complete on %d rows", len(df))

    def predict(self, future_df: pd.DataFrame) -> pd.DataFrame:
        if self._model is None:
            raise RuntimeError("Model has not been fit yet.")
        future_df = _add_dow_indicators(future_df)
        forecast = self._model.predict(future_df)
        # Clamp negatives — occupancy cannot be negative
        forecast["yhat"] = forecast["yhat"].clip(lower=0)
        forecast["yhat_lower"] = forecast["yhat_lower"].clip(lower=0)
        forecast["yhat_upper"] = forecast["yhat_upper"].clip(lower=0)
        return forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]]


# ── Gradient Boosting fallback ────────────────────────────────────────────────

class GradientBoostingForecaster(ForecastModel):
    """
    Sklearn GradientBoostingRegressor fallback. Simpler than Prophet but functional.
    No credible interval — uses ±20% of yhat as lower/upper band.
    """

    def __init__(self):
        self._model = None
        self._feature_cols = [
            "hour_of_day", "day_of_week", "month",
            "temp", "precip", "wind",
        ]

    def _build_features(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        ds = pd.to_datetime(df["ds"])
        df["hour_of_day"] = ds.dt.hour
        df["day_of_week"] = ds.dt.dayofweek
        df["month"] = ds.dt.month
        return df

    def fit(self, df: pd.DataFrame) -> None:
        from sklearn.ensemble import GradientBoostingRegressor

        df = self._build_features(df)
        X = df[self._feature_cols].fillna(0).values
        y = df["y"].values.astype(float)

        self._model = GradientBoostingRegressor(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            random_state=42,
        )
        self._model.fit(X, y)
        logger.info("[GBMForecaster] Fit complete on %d rows", len(df))

    def predict(self, future_df: pd.DataFrame) -> pd.DataFrame:
        if self._model is None:
            raise RuntimeError("Model has not been fit yet.")
        future_df = self._build_features(future_df)
        X = future_df[self._feature_cols].fillna(0).values
        yhat = self._model.predict(X).clip(min=0)
        result = pd.DataFrame({
            "ds": future_df["ds"].values,
            "yhat": yhat,
            "yhat_lower": (yhat * 0.8).clip(min=0),
            "yhat_upper": yhat * 1.2,
        })
        return result


# ── Factory ───────────────────────────────────────────────────────────────────

def get_forecaster() -> ForecastModel:
    """
    Return the appropriate ForecastModel based on the FORECASTER env var.
    Defaults to ProphetForecaster. Falls back to GradientBoostingForecaster
    if FORECASTER=gbm.
    """
    forecaster_type = os.environ.get("FORECASTER", "prophet").lower().strip()
    if forecaster_type == "gbm":
        logger.info("[model] Using GradientBoostingForecaster (FORECASTER=gbm)")
        return GradientBoostingForecaster()
    logger.info("[model] Using ProphetForecaster (FORECASTER=%s)", forecaster_type)
    return ProphetForecaster()
