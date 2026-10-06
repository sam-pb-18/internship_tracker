from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value.strip()


def connection_string() -> str:
    """Accept Supabase's DATABASE_URL or the existing individual connection fields."""
    if url := os.getenv("DATABASE_URL"):
        return url.strip()
    return " ".join((
        f"host={os.getenv('SUPABASE_DB_HOST') or required('host')}",
        f"port={os.getenv('SUPABASE_DB_PORT') or required('port')}",
        f"dbname={os.getenv('SUPABASE_DB_NAME') or required('database')}",
        f"user={os.getenv('SUPABASE_DB_USER') or required('user')}",
        f"password={required('SUPABASE_DATABASE_PASSWORD')}", "sslmode=require",
    ))


# One connection per warm serverless instance; disable prepared statements for Supavisor.
POOL = ConnectionPool(conninfo=connection_string(), min_size=0, max_size=1, open=False,
                      kwargs={"row_factory": dict_row, "prepare_threshold": None})
API_TOKEN = required("TRACKER_API_TOKEN")

app = FastAPI(title="Field Notes API", version="1.1.0")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@contextmanager
def db():
    with POOL.connection() as conn:
        yield conn
        conn.commit()


def initialize() -> None:
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS attendance (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, day DATE UNIQUE NOT NULL,
                check_in TIMESTAMPTZ, check_out TIMESTAMPTZ, source TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS work_logs (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, day DATE NOT NULL,
                title TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS reports (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, start_date DATE NOT NULL,
                end_date DATE NOT NULL, report_type TEXT NOT NULL, content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS work_logs_day_idx ON work_logs (day DESC, created_at DESC);
        """)


@app.on_event("startup")
def startup() -> None:
    POOL.open()
    initialize()


def require_token(authorization: str | None = Header(default=None), x_tracker_token: str | None = Header(default=None)):
    if authorization != f"Bearer {API_TOKEN}" and x_tracker_token != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid access key")


class Entry(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=5000)
    day: date | None = None


class Source(BaseModel):
    source: str = "web"


class ReportRequest(BaseModel):
    start_date: date
    end_date: date
    report_type: str = "custom"


@app.get("/")
def home():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/dashboard")
def dashboard(_: None = Depends(require_token)):
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("SELECT * FROM attendance WHERE day = CURRENT_DATE")
        attendance = cursor.fetchone()
        cursor.execute("SELECT * FROM work_logs ORDER BY day DESC, created_at DESC LIMIT 8")
        entries = cursor.fetchall()
        cursor.execute("SELECT * FROM attendance ORDER BY day DESC LIMIT 7")
        recent = cursor.fetchall()
    return {"today": date.today(), "attendance": attendance, "entries": entries, "recent_attendance": recent}


def record_attendance(event: Literal["check_in", "check_out"], source: str):
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("SELECT * FROM attendance WHERE day = CURRENT_DATE FOR UPDATE")
        record = cursor.fetchone()
        if event == "check_in":
            if record and record["check_in"]:
                return {"success": True, "status": "already_checked_in", "timestamp": record["check_in"]}
            if record:
                cursor.execute("UPDATE attendance SET check_in = now(), source = %s WHERE day = CURRENT_DATE RETURNING check_in", (source,))
            else:
                cursor.execute("INSERT INTO attendance (day, check_in, source) VALUES (CURRENT_DATE, now(), %s) RETURNING check_in", (source,))
        else:
            if not record or not record["check_in"]:
                raise HTTPException(409, "Check in before checking out")
            if record["check_out"]:
                return {"success": True, "status": "already_checked_out", "timestamp": record["check_out"]}
            cursor.execute("UPDATE attendance SET check_out = now(), source = %s WHERE day = CURRENT_DATE RETURNING check_out", (source,))
        timestamp = cursor.fetchone()[event]
    return {"success": True, "status": event, "timestamp": timestamp}


@app.post("/api/attendance/check-in")
def check_in(payload: Source, _: None = Depends(require_token)):
    return record_attendance("check_in", payload.source)


@app.post("/api/attendance/check-out")
def check_out(payload: Source, _: None = Depends(require_token)):
    return record_attendance("check_out", payload.source)


@app.post("/api/manual/{event}")
def manual_attendance(event: Literal["check-in", "check-out"], _: None = Depends(require_token)):
    return record_attendance(event.replace("-", "_"), "web")


@app.get("/api/attendance")
def attendance(start_date: date | None = None, end_date: date | None = None, _: None = Depends(require_token)):
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("SELECT * FROM attendance WHERE day BETWEEN %s AND %s ORDER BY day DESC",
                       (start_date or date.today() - timedelta(days=30), end_date or date.today()))
        return cursor.fetchall()


@app.post("/api/work-logs")
def create_entry(entry: Entry, _: None = Depends(require_token)):
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("INSERT INTO work_logs (day, title, body) VALUES (%s, %s, %s) RETURNING *",
                       (entry.day or date.today(), entry.title.strip(), entry.body.strip()))
        return cursor.fetchone()


@app.put("/api/work-logs/{entry_id}")
def update_entry(entry_id: int, entry: Entry, _: None = Depends(require_token)):
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("UPDATE work_logs SET title=%s, body=%s, day=%s, updated_at=now() WHERE id=%s RETURNING *",
                       (entry.title.strip(), entry.body.strip(), entry.day or date.today(), entry_id))
        updated = cursor.fetchone()
    if not updated:
        raise HTTPException(404, "Entry not found")
    return updated


@app.delete("/api/work-logs/{entry_id}")
def delete_entry(entry_id: int, _: None = Depends(require_token)):
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("DELETE FROM work_logs WHERE id = %s", (entry_id,))
    return {"success": True}


@app.post("/api/reports")
def create_report(request: ReportRequest, _: None = Depends(require_token)):
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("SELECT day, title, body FROM work_logs WHERE day BETWEEN %s AND %s ORDER BY day, created_at",
                       (request.start_date, request.end_date))
        logs = cursor.fetchall()
        if not logs:
            raise HTTPException(422, "There are no work notes in this period yet.")
        grouped: dict[date, list[dict]] = {}
        for log in logs:
            grouped.setdefault(log["day"], []).append(log)
        lines = [f"Internship work summary · {request.start_date:%d %b}–{request.end_date:%d %b %Y}", "", "Overview",
                 "This summary is based only on the recorded work notes below.", "", "Day by day"]
        for day, records in grouped.items():
            lines.extend([f"{day:%A, %d %B}"] + [f"• {r['title']} — {r['body']}" for r in records] + [""])
        content = "\n".join(lines).strip()
        cursor.execute("INSERT INTO reports (start_date, end_date, report_type, content) VALUES (%s, %s, %s, %s) RETURNING id, created_at",
                       (request.start_date, request.end_date, request.report_type, content))
        saved = cursor.fetchone()
    return {"id": saved["id"], "content": content, "created_at": saved["created_at"]}
