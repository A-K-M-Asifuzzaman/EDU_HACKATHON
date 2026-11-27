from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Horizon = Literal[2, 3, 4]


class ForecastItem(BaseModel):
    ward_id: str
    city: str
    origin_date: str
    target_date: str
    horizon: int
    expected_cases: float = Field(description="conditional mean (resource planning)")
    median_cases: int = Field(description="conditional median (headline point forecast, MAE-optimal)")
    lower_80: int
    upper_80: int
    lower_90: int
    upper_90: int
    p_outbreak: float = Field(description="P(weekly cases >= training q90) under the calibrated distribution")
    outbreak_alert: bool
    risk_tier: Literal["Low", "Medium", "High", "Critical"]
    source: Literal["replay", "bundle"]
    in_sample: bool = Field(description="True if the model saw this target week's label during training (live bundle on origins <= 2024)")
    actual_cases: Optional[int] = Field(None, description="observed cases for the target week (development years only; never 2025)")
    outbreak_threshold: Optional[float] = None


class ChatTurn(BaseModel):
    """One earlier turn supplied by the client. Only user/assistant roles are accepted, so a client cannot inject a system turn."""
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1200)
    language: Literal["en", "bn"] = "en"
    ward_id: Optional[str] = Field(None, max_length=40)
    origin: Optional[str] = Field(None, max_length=10)
    horizon: Optional[Literal[2, 3, 4]] = None
    history: list[ChatTurn] = Field(default_factory=list, max_length=8)
