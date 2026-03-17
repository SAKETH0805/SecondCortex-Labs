"""
SecondCortex Backend — FastAPI Main Server

Endpoints:
  POST /api/v1/auth/signup  — Create a new account.
  POST /api/v1/auth/login   — Log in and get a JWT token.
  POST /api/v1/snapshot     — Receives sanitized IDE snapshots.
  POST /api/v1/query        — User question → Planner → Executor pipeline.
  POST /api/v1/resurrect    — Generate resurrection commands.
  GET  /api/v1/events       — Poll recent snapshots for the Live Graph.
  GET  /health              — Health check.
"""

import logging
import sys
import os
import re
from datetime import datetime
from typing import Any

# ── Force Python to see the local directories (fixes Azure ModuleNotFoundError) ──────────
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# ── ChromaDB Compatibility Patch for Azure (Older SQLite3) ────────────────────────────────
try:
    __import__('pysqlite3')
    import sys
    sys.modules['sqlite3'] = sys.modules.pop('pysqlite3')
except ImportError:
    pass

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, Body
from fastapi.responses import JSONResponse
import traceback
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from agents.executor import ExecutorAgent
from agents.planner import PlannerAgent
from agents.retriever import RetrieverAgent
from agents.simulator import SimulatorAgent
from auth.jwt_handler import get_current_user
from auth.routes import router as auth_router
from config import settings
from models import schemas
from models.schemas import (
    QueryRequest,
    QueryResponse,
    ResurrectionRequest,
    ResurrectionResponse,
    ResurrectionCommand,
    SafetyReport,
    SnapshotPayload,
    ChatMessage,
    ChatHistoryResponse,
)
from auth.routes import user_db
from services.vector_db import VectorDBService

# ── Logging setup ───────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-30s | %(levelname)-7s | %(message)s",
)
logger = logging.getLogger("secondcortex.main")

# ── Application ─────────────────────────────────────────────────
app = FastAPI(
    title="SecondCortex API",
    description="Multi-Agent Orchestrator for IDE Context Memory",
    version="0.3.1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://sc-frontend-suhaan.azurewebsites.net",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    err_msg = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    logger.error("GLOBAL EXCEPTION: %s", err_msg)
    
    # Attempt to write to a visible place in persistence if possible
    try:
        with open("/home/backend_error.log", "a") as f:
            f.write(f"\n--- {datetime.now()} ---\n")
            f.write(err_msg)
            f.write("\n")
    except:
        pass
        
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "traceback": err_msg if settings.host == "0.0.0.0" else "hidden"},
    )

# ── Include auth routes ─────────────────────────────────────────
app.include_router(auth_router)

# ── MCP Server Mount ──────────────────────────
from mcp_server import mcp

app.mount("/mcp", mcp.sse_app())

# ── Service & Agent Initialization ──────────────────────────────
vector_db = VectorDBService()
retriever = RetrieverAgent(vector_db)
planner = PlannerAgent(vector_db)
executor = ExecutorAgent()
simulator = SimulatorAgent()

# Most recently received raw snapshot per user, updated immediately on /snapshot ingest.
_latest_ingested_snapshot: dict[str, dict[str, Any]] = {}


def _is_latest_snapshot_question(question: str) -> bool:
    q = (question or "").strip().lower()
    if not q:
        return False
    has_recency = bool(re.search(r"\b(latest|newest|most recent|current|last|fetch latest)\b", q))
    has_context = bool(re.search(r"\b(snapshot|snapshots|timeline|context|edited|editing|file|commit|branch)\b", q))
    return has_recency and has_context


def _question_wants_main_branch(question: str) -> bool:
    q = (question or "").lower()
    return ("main branch" in q) or bool(re.search(r"\bon\s+main\b", q))


def _build_latest_snapshot_summary(snapshot: dict, wants_main: bool) -> str:
    ts = snapshot.get("timestamp", "unknown time")
    file_path = snapshot.get("active_file") or "an unknown file"
    branch = snapshot.get("git_branch") or "unknown"
    summary = snapshot.get("summary") or "No summary available."

    if wants_main:
        return (
            f"The latest snapshot on the main branch is from {ts}, "
            f"editing {file_path}. Summary: {summary}"
        )

    return (
        f"The latest snapshot is from {ts}, editing {file_path} on branch {branch}. "
        f"Summary: {summary}"
    )


def _parse_iso_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Handle trailing Z if present.
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _pick_newer_snapshot(a: dict | None, b: dict | None) -> dict | None:
    if a is None:
        return b
    if b is None:
        return a

    ta = _parse_iso_timestamp(a.get("timestamp"))
    tb = _parse_iso_timestamp(b.get("timestamp"))

    if ta and tb:
        return a if ta >= tb else b
    if ta and not tb:
        return a
    if tb and not ta:
        return b
    return a


def _parse_terminal_commands(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        try:
            import json
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(v).strip() for v in parsed if str(v).strip()]
        except Exception:
            return []
    return []


def _is_snapshot_id(target: str) -> bool:
    return bool(re.match(r"^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", target.strip().lower()))


def _is_safe_resurrection_command(command: str) -> bool:
    normalized = (command or "").strip().lower()
    if not normalized:
        return False
    blocked_prefixes = (
        "rm ", "del ", "rmdir ", "format ", "shutdown ", "reboot ",
        "git reset --hard", "git clean -fd", "dropdb ", "sudo ", "powershell -c",
    )
    if normalized.startswith(blocked_prefixes):
        return False
    allowed_prefixes = (
        "npm ", "pnpm ", "yarn ", "python ", "pytest ", "uvicorn ", "poetry ",
        "pip ", "make ", "cargo ", "go ", "dotnet ",
    )
    return normalized.startswith(allowed_prefixes)


def _workspaces_match(current_workspace: str | None, target_workspace: str | None) -> bool:
    if not current_workspace or not target_workspace:
        return False
    left = os.path.normcase(os.path.abspath(current_workspace))
    right = os.path.normcase(os.path.abspath(target_workspace))
    return left == right


async def _resolve_resurrection_snapshot(target: str, user_id: str) -> dict | None:
    normalized_target = (target or "").strip()
    if not normalized_target:
        return None

    if _is_snapshot_id(normalized_target):
        by_id = await vector_db.get_snapshot_by_id(snapshot_id=normalized_target, user_id=user_id)
        if by_id:
            return by_id

    timeline = await vector_db.get_snapshot_timeline(limit=1000, user_id=user_id)
    if not timeline:
        return None

    target_lower = normalized_target.lower()

    branch_matches = [
        s for s in timeline
        if str(s.get("git_branch", "")).strip().lower() == target_lower
    ]
    if branch_matches:
        return branch_matches[-1]

    path_or_summary_matches = [
        s for s in timeline
        if target_lower in str(s.get("active_file", "")).lower()
        or target_lower in str(s.get("summary", "")).lower()
    ]
    if path_or_summary_matches:
        return path_or_summary_matches[-1]

    return None


def _build_resurrection_plan(snapshot: dict, target: str, current_workspace: str | None) -> tuple[list[ResurrectionCommand], str, SafetyReport]:
    commands: list[ResurrectionCommand] = []

    workspace_dir = str(snapshot.get("workspace_folder") or "").strip() or None
    active_file = str(snapshot.get("active_file") or "").strip() or None
    branch = str(snapshot.get("git_branch") or "").strip() or None
    timestamp = str(snapshot.get("timestamp") or "unknown time")
    summary = str(snapshot.get("summary") or "No summary available.")

    should_open_workspace = bool(workspace_dir and not _workspaces_match(current_workspace, workspace_dir))
    if should_open_workspace and workspace_dir:
        commands.append(ResurrectionCommand(type="open_workspace", filePath=workspace_dir))

    commands.append(ResurrectionCommand(type="git_stash"))
    if branch:
        commands.append(ResurrectionCommand(type="git_checkout", branch=branch))

    if active_file:
        commands.append(ResurrectionCommand(type="open_file", filePath=active_file, viewColumn=1))

    terminal_commands = _parse_terminal_commands(snapshot.get("terminal_commands"))
    last_safe_terminal_command = next((cmd for cmd in reversed(terminal_commands) if _is_safe_resurrection_command(cmd)), None)
    if last_safe_terminal_command:
        commands.append(ResurrectionCommand(type="split_terminal", command=last_safe_terminal_command))

    plan_summary = (
        f"Resolved target '{target}' to snapshot at {timestamp}. "
        f"Will stash local changes, checkout branch {branch or 'current'}, "
        f"open {active_file or 'the captured file'}, and restore a safe terminal command. "
        f"Snapshot summary: {summary}"
    )

    estimated_risk = "medium" if branch or should_open_workspace else "low"
    impact = SafetyReport(
        conflicts=[],
        unstashed_changes=True,
        estimated_risk=estimated_risk,
    )
    return commands, plan_summary, impact




# ── Redirects ───────────────────────────────────────────────────

@app.get("/signup")
@app.post("/signup")
async def signup_redirect():
    """Redirect to the correct auth endpoint."""
    return {"detail": "Please use /api/v1/auth/signup for sign up requests."}


@app.get("/login")
@app.post("/login")
async def login_redirect():
    """Redirect to the correct auth endpoint."""
    return {"detail": "Please use /api/v1/auth/login for login requests."}


# ── Endpoints ───────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Simple health check for load balancers and monitoring."""
    return {"status": "ok", "service": "secondcortex-backend", "version": "0.3.0"}


@app.post("/api/v1/snapshot", status_code=200)
async def receive_snapshot(
    payload: SnapshotPayload,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    """
    Receive a sanitized IDE snapshot from the VS Code extension.
    Returns 200 OK instantly, then processes asynchronously via Retriever.
    """
    logger.info("Received snapshot for file: %s (user=%s)", payload.active_file, user_id)

    # Immediate cache update so latest queries can reflect ingest instantly,
    # even if async retrieval/vector indexing is still in progress.
    _latest_ingested_snapshot[user_id] = {
        "id": "pending",
        "timestamp": payload.timestamp.isoformat() if hasattr(payload.timestamp, "isoformat") else str(payload.timestamp),
        "active_file": payload.active_file,
        "git_branch": payload.git_branch,
        "summary": f"Capture received: editing {payload.active_file}",
    }

    background_tasks.add_task(retriever.process_snapshot, payload, user_id)
    return {"status": "accepted", "message": "Snapshot queued for processing."}


@app.get("/api/v1/events")
async def get_events(user_id: str = Depends(get_current_user)):
    """
    Endpoint for the Next.js React Flow to poll recent snapshots.
    Scoped to the authenticated user's collection.
    """
    results = await vector_db.get_recent_snapshots(limit=10, user_id=user_id)

    events = []
    for r in results:
        events.append({
            "id": r.get("id"),
            "timestamp": r.get("timestamp"),
            "active_file": r.get("active_file"),
            "git_branch": r.get("git_branch"),
            "summary": r.get("summary"),
            "entities": r.get("entities", "").split(",") if r.get("entities") else [],
            "relations": []
        })

    return {"events": events}


@app.get("/api/v1/snapshots/timeline")
async def get_snapshot_timeline(
    limit: int = 200,
    user_id: str = Depends(get_current_user),
):
    """Timeline feed for Shadow Graph time-travel (oldest -> newest)."""
    capped_limit = max(1, min(limit, 1000))
    results = await vector_db.get_snapshot_timeline(limit=capped_limit, user_id=user_id)

    timeline = []
    for r in results:
        timeline.append({
            "id": r.get("id"),
            "timestamp": r.get("timestamp"),
            "active_file": r.get("active_file"),
            "git_branch": r.get("git_branch"),
            "summary": r.get("summary"),
            "entities": r.get("entities", "").split(",") if r.get("entities") else [],
        })

    return {"timeline": timeline}


@app.get("/api/v1/snapshots/{snapshot_id}")
async def get_snapshot_by_id(
    snapshot_id: str,
    user_id: str = Depends(get_current_user),
):
    """Detailed metadata lookup for a single snapshot, used by VS Code preview."""
    snapshot = await vector_db.get_snapshot_by_id(snapshot_id=snapshot_id, user_id=user_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    return {
        "snapshot": {
            "id": snapshot.get("id"),
            "timestamp": snapshot.get("timestamp"),
            "workspace_folder": snapshot.get("workspace_folder"),
            "active_file": snapshot.get("active_file"),
            "git_branch": snapshot.get("git_branch"),
            "summary": snapshot.get("summary"),
            "entities": snapshot.get("entities", "").split(",") if snapshot.get("entities") else [],
            "shadow_graph": snapshot.get("document") or snapshot.get("shadow_graph") or "",
        }
    }



@app.get("/api/v1/chat/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    session_id: str | None = None,
    user_id: str = Depends(get_current_user)
):
    """Retrieve chat history for the current user, optionally filtered by session."""
    history = user_db.get_chat_history(user_id, session_id=session_id)
    return {"messages": history}


@app.get("/api/v1/chat/sessions", response_model=schemas.ChatSessionsResponse)
async def get_chat_sessions(
    user_id: str = Depends(get_current_user)
):
    """List all unique chat sessions for the current user."""
    sessions = user_db.get_chat_sessions(user_id)
    return {"sessions": sessions}


@app.delete("/api/v1/chat/history")
async def clear_chat_history(
    session_id: str | None = None,
    user_id: str = Depends(get_current_user)
):
    """Clear chat history (single session or all)."""
    user_db.delete_chat_history(user_id, session_id=session_id)
    return {"message": "History cleared"}


@app.post("/api/v1/chat/sessions")
async def create_chat_session(
    req: dict = Body(...),
    user_id: str = Depends(get_current_user)
):
    """Create a new chat session for the current user."""
    session_id = user_db.create_chat_session(user_id, title=req.get("title", "New Chat"))
    return {"session_id": session_id}


@app.post("/api/v1/query", response_model=QueryResponse)
async def handle_query(
    req: QueryRequest,
    session_id: str | None = None,
    user_id: str = Depends(get_current_user)
):
    """
    Main entry point for SecondCortex queries.
    Combines retrieval, planning, and execution logic.
    """
    try:
        logger.info("Query received: %s (user=%s, session=%s)", req.question, user_id, session_id)

        # Deterministic fast-path for recency questions.
        # Avoids LLM choosing semantically similar but older snapshots.
        if _is_latest_snapshot_question(req.question):
            wants_main = _question_wants_main_branch(req.question)
            timeline = await vector_db.get_snapshot_timeline(limit=50, user_id=user_id)
            recent = list(reversed(timeline))
            latest_ingested = _latest_ingested_snapshot.get(user_id)

            if wants_main:
                recent = [r for r in recent if str(r.get("git_branch", "")).strip().lower() == "main"]
                if latest_ingested and str(latest_ingested.get("git_branch", "")).strip().lower() != "main":
                    latest_ingested = None

            latest_stored = recent[0] if recent else None
            latest = _pick_newer_snapshot(latest_ingested, latest_stored)

            if latest:
                response = QueryResponse(
                    summary=_build_latest_snapshot_summary(latest, wants_main),
                    reasoningLog=[
                        "Detected latest-snapshot query and used recency retrieval.",
                        f"Selected snapshot id={latest.get('id', 'unknown')} timestamp={latest.get('timestamp', 'unknown')}",
                    ],
                    commands=[],
                )
            else:
                response = QueryResponse(
                    summary=(
                        "No matching snapshots were found for that latest query. "
                        "Try again after a new snapshot is captured."
                    ),
                    reasoningLog=["Recency retrieval returned no snapshots."],
                    commands=[],
                )

            user_db.save_chat_message(user_id, "user", req.question, session_id=session_id)
            user_db.save_chat_message(user_id, "assistant", response.summary, session_id=session_id)
            return response

        # Step 1: Plan — break the question into search tasks
        plan_result = await planner.plan(req.question, user_id=user_id)

        # Step 2: Execute — synthesize and validate
        response = await executor.synthesize(req.question, plan_result)

        # Step 3: Persist history
        user_db.save_chat_message(user_id, "user", req.question, session_id=session_id)
        user_db.save_chat_message(user_id, "assistant", response.summary, session_id=session_id)

        logger.info("Query answered: %s", response.summary[:100])
        return response
    except Exception as exc:
        import traceback
        err = traceback.format_exc()
        exc_str = str(exc)

        # Handle Gemini 429 rate limit errors gracefully
        if "429" in exc_str or "RESOURCE_EXHAUSTED" in exc_str:
            logger.warning("QUERY RATE LIMITED: %s", exc_str[:200])
            raise HTTPException(
                status_code=429,
                detail="Rate limit reached. The Gemini API free tier quota has been exhausted. Please wait a minute and try again."
            )

        logger.error("QUERY PIPELINE CRASH: %s\n%s", exc, err)
        raise HTTPException(status_code=500, detail=f"Query pipeline error: {str(exc)}")



@app.post("/api/v1/resurrect", response_model=ResurrectionResponse)
async def handle_resurrection(
    request: ResurrectionRequest,
    user_id: str = Depends(get_current_user),
):
    """
    Generate a Workspace Resurrection plan for a given target branch/snapshot.
    """
    logger.info("Resurrection requested for target: %s (user=%s)", request.target, user_id)

    snapshot = await _resolve_resurrection_snapshot(request.target, user_id)
    if not snapshot:
        raise HTTPException(
            status_code=404,
            detail=(
                "No matching snapshot found for that target. "
                "Try a valid branch name, file hint, or exact snapshot ID from Shadow Graph."
            ),
        )

    commands, plan_summary, impact = _build_resurrection_plan(
        snapshot=snapshot,
        target=request.target,
        current_workspace=request.current_workspace,
    )

    return ResurrectionResponse(
        commands=commands,
        impact_analysis=impact,
        planSummary=plan_summary,
    )


# ── Run server ──────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        log_level="info",
    )
