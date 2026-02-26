"""
Web backend for F1 Race Replay. Serves the browser UI and exposes APIs
for session list and replay data (track + frames). Run with:
  uvicorn web_server:app --reload --host 0.0.0.0 --port 8000
Then open http://localhost:8000 in your browser.
"""
import json
import os
import sys
from pathlib import Path

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.f1_data import (
    enable_cache,
    get_race_telemetry,
    get_race_weekends_by_year,
    get_circuit_rotation,
    load_session,
)


def _build_track_from_example_lap(example_lap, track_width=200):
    """Build track geometry (no arcade dependency). Returns JSON-serializable dict."""
    import numpy as np
    plot_x_ref = np.asarray(example_lap["X"])
    plot_y_ref = np.asarray(example_lap["Y"])
    dx = np.gradient(plot_x_ref)
    dy = np.gradient(plot_y_ref)
    norm = np.sqrt(dx**2 + dy**2)
    norm[norm == 0] = 1.0
    dx /= norm
    dy /= norm
    nx = -dy
    ny = dx
    x_outer = plot_x_ref + nx * (track_width / 2)
    y_outer = plot_y_ref + ny * (track_width / 2)
    x_inner = plot_x_ref - nx * (track_width / 2)
    y_inner = plot_y_ref - ny * (track_width / 2)
    x_min = float(min(plot_x_ref.min(), x_inner.min(), x_outer.min()))
    x_max = float(max(plot_x_ref.max(), x_inner.max(), x_outer.max()))
    y_min = float(min(plot_y_ref.min(), y_inner.min(), y_outer.min()))
    y_max = float(max(plot_y_ref.max(), y_inner.max(), y_outer.max()))
    # DRS zones
    drs_zones = []
    drs_vals = np.asarray(example_lap["DRS"]) if "DRS" in example_lap.columns else np.zeros(len(plot_x_ref))
    drs_start = None
    for i, val in enumerate(drs_vals):
        if val in (10, 12, 14):
            if drs_start is None:
                drs_start = i
        else:
            if drs_start is not None:
                drs_end = i - 1
                drs_zones.append({
                    "start": {"x": float(plot_x_ref[drs_start]), "y": float(plot_y_ref[drs_start])},
                    "end": {"x": float(plot_x_ref[drs_end]), "y": float(plot_y_ref[drs_end])},
                })
                drs_start = None
    if drs_start is not None:
        drs_end = len(drs_vals) - 1
        drs_zones.append({
            "start": {"x": float(plot_x_ref[drs_start]), "y": float(plot_y_ref[drs_start])},
            "end": {"x": float(plot_x_ref[drs_end]), "y": float(plot_y_ref[drs_end])},
        })
    return {
        "center_x": plot_x_ref.tolist(),
        "center_y": plot_y_ref.tolist(),
        "inner_x": x_inner.tolist(),
        "inner_y": y_inner.tolist(),
        "outer_x": x_outer.tolist(),
        "outer_y": y_outer.tolist(),
        "x_min": x_min,
        "x_max": x_max,
        "y_min": y_min,
        "y_max": y_max,
        "drs_zones": drs_zones,
    }


def _rgb_to_hex(rgb):
    if rgb is None or len(rgb) != 3:
        return "#808080"
    return "#{:02x}{:02x}{:02x}".format(int(rgb[0]), int(rgb[1]), int(rgb[2]))


app = FastAPI(title="F1 Race Replay Web")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files from web/ (frontend)
WEB_DIR = Path(__file__).resolve().parent / "web"
if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
async def index():
    """Serve the main page."""
    index_path = WEB_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend not found (web/index.html)")
    return FileResponse(index_path)


@app.get("/api/years")
async def api_years():
    """Return list of years that have schedule data (e.g. 2018–current)."""
    from datetime import date
    current = date.today().year
    return list(range(2019, current + 1))


@app.get("/api/rounds")
async def api_rounds(year: int = Query(..., ge=2018, le=2030)):
    """Return list of race weekends for the given year."""
    enable_cache()
    try:
        weekends = get_race_weekends_by_year(year)
        return weekends
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/session")
async def api_session(
    year: int = Query(..., ge=2018, le=2030),
    round_number: int = Query(..., ge=1, le=30),
    session_type: str = Query("R", pattern="^(R|S|Q|SQ)$"),
):
    """
    Load session and return everything needed for the web replay:
    session_info, track (geometry), frames, driver_colors, track_statuses, total_laps, drivers.
    """
    enable_cache()
    try:
        session = load_session(year, round_number, session_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load session: {e}")

    if session_type in ("Q", "SQ"):
        raise HTTPException(
            status_code=501,
            detail="Qualifying replay is not yet supported in the web viewer. Use Race or Sprint.",
        )

    try:
        race_telemetry = get_race_telemetry(session, session_type=session_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get telemetry: {e}")

    # Example lap for track layout (same logic as main.py)
    example_lap = None
    try:
        quali_session = load_session(year, round_number, "Q")
        if quali_session is not None and len(quali_session.laps) > 0:
            fastest_quali = quali_session.laps.pick_fastest()
            if fastest_quali is not None:
                qt = fastest_quali.get_telemetry()
                if "DRS" in qt.columns:
                    example_lap = qt
    except Exception:
        pass
    if example_lap is None:
        fastest_lap = session.laps.pick_fastest()
        if fastest_lap is not None:
            example_lap = fastest_lap.get_telemetry()
    if example_lap is None:
        raise HTTPException(status_code=500, detail="No valid laps for track layout")

    circuit_rotation = get_circuit_rotation(session)
    circuit_length_m = None
    if "Distance" in example_lap.columns:
        circuit_length_m = float(example_lap["Distance"].max())

    session_info = {
        "event_name": session.event.get("EventName", ""),
        "circuit_name": session.event.get("Location", ""),
        "country": session.event.get("Country", ""),
        "year": year,
        "round": round_number,
        "date": "",
        "total_laps": race_telemetry["total_laps"],
        "circuit_length_m": circuit_length_m,
        "circuit_rotation": circuit_rotation,
    }
    if session.event.get("EventDate"):
        session_info["date"] = session.event["EventDate"].strftime("%B %d, %Y")

    track = _build_track_from_example_lap(example_lap)
    frames = race_telemetry["frames"]
    driver_colors = {
        code: _rgb_to_hex(rgb)
        for code, rgb in (race_telemetry.get("driver_colors") or {}).items()
    }
    drivers = list(session.drivers)
    driver_info = {}
    for num in session.drivers:
        try:
            info = session.get_driver(num)
            driver_info[info["Abbreviation"]] = {
                "number": num,
                "abbreviation": info["Abbreviation"],
                "first_name": info.get("FirstName", ""),
                "last_name": info.get("LastName", ""),
            }
        except Exception:
            pass

    return {
        "session_info": session_info,
        "track": track,
        "frames": frames,
        "driver_colors": driver_colors,
        "track_statuses": race_telemetry.get("track_statuses") or [],
        "total_laps": race_telemetry["total_laps"],
        "drivers": drivers,
        "driver_info": driver_info,
    }
