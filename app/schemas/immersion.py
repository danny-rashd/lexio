from datetime import datetime

from pydantic import BaseModel


class ImmersionLogCreate(BaseModel):
    language: str
    activity_type: str
    resource: str | None = None
    resource_type: str | None = None
    resource_creator: str | None = None
    resource_detail: str | None = None
    duration_minutes: int
    notes: str | None = None
    rating: int | None = None
    logged_at: datetime


class ImmersionLogResponse(BaseModel):
    id: int
    language: str
    activity_type: str
    resource: str | None
    resource_type: str | None
    resource_creator: str | None
    resource_detail: str | None
    duration_minutes: int
    notes: str | None
    rating: int | None
    logged_at: datetime
    created_at: datetime
    word_count: int = 0

    model_config = {"from_attributes": True}
