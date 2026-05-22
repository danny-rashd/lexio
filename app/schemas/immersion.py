from datetime import datetime

from pydantic import BaseModel


class ImmersionLogCreate(BaseModel):
    language: str
    activity_type: str
    resource: str
    duration_minutes: int
    notes: str | None = None
    rating: int | None = None
    logged_at: datetime


class ImmersionLogResponse(BaseModel):
    id: int
    language: str
    activity_type: str
    resource: str
    duration_minutes: int
    notes: str | None
    rating: int | None
    logged_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}
