"""
Team API routes: create, join, get members, generate invite codes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from threading import Lock
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from auth.database import UserDB
from auth.jwt_handler import get_current_principal, get_current_user
from projects.routes import project_db
from services.summary_service import SummaryService
from services.vector_db import VectorDBService

logger = logging.getLogger("secondcortex.teams.routes")

router = APIRouter(prefix="/api/v1/teams", tags=["teams"])
user_db = UserDB()
vector_db = VectorDBService()
summary_service = SummaryService()
_PM_BOOTSTRAP_CACHE_TTL_SECONDS = 45
_pm_bootstrap_cache: dict[str, tuple[float, dict]] = {}
_pm_bootstrap_cache_lock = Lock()


class CreateTeamRequest(BaseModel):
    name: str


class CreateTeamResponse(BaseModel):
    team_id: str
    name: str
    invite_code: str


class JoinTeamRequest(BaseModel):
    invite_code: str


class JoinTeamResponse(BaseModel):
    team_id: str
    name: str


class TeamMemberInfo(BaseModel):
    id: str
    email: str
    display_name: str
    created_at: str


class TeamInfo(BaseModel):
    id: str
    name: str
    team_lead_id: str
    member_count: int


class MemberSnapshot(BaseModel):
    id: str
    user_id: str
    team_id: str | None = None
    project_id: str | None = None
    workspace: str
    active_file: str
    git_branch: str | None = None
    terminal_commands: list[str]
    summary: str
    enriched_context: dict
    timestamp: int
    synced: int


class PMBootstrapResponse(BaseModel):
    team_id: str
    members: list[TeamMemberInfo]
    snapshots_by_member: dict[str, list[MemberSnapshot]]
    daily_summary: dict
    weekly_summary: dict
    generated_at: str


def _cache_get_pm_bootstrap(cache_key: str) -> dict | None:
    with _pm_bootstrap_cache_lock:
        hit = _pm_bootstrap_cache.get(cache_key)
        if not hit:
            return None

        expires_at, payload = hit
        if expires_at <= time.time():
            _pm_bootstrap_cache.pop(cache_key, None)
            return None

        return payload


def _cache_set_pm_bootstrap(cache_key: str, payload: dict) -> None:
    with _pm_bootstrap_cache_lock:
        _pm_bootstrap_cache[cache_key] = (time.time() + _PM_BOOTSTRAP_CACHE_TTL_SECONDS, payload)


def _parse_timestamp_to_epoch_seconds(value: object) -> int:
    if isinstance(value, (int, float)):
        numeric = int(value)
        return numeric // 1000 if numeric > 1_000_000_000_000 else numeric

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return 0
        try:
            numeric = int(float(raw))
            return numeric // 1000 if numeric > 1_000_000_000_000 else numeric
        except Exception:
            pass
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return int(parsed.timestamp())
        except Exception:
            return 0

    return 0


def _authorize_team_read(team_id: str, principal: dict, user_db: UserDB) -> None:
    """Allow team read for same-team users or restricted pm_guest tokens."""
    role = str(principal.get("role") or "user")
    if role == "pm_guest":
        scopes = principal.get("scopes") or []
        if isinstance(scopes, str):
            scopes = [scopes]
        if "pm:read" not in set(str(scope) for scope in scopes):
            raise HTTPException(status_code=403, detail="PM guest token lacks read scope.")
        guest_team_id = str(principal.get("team_id") or "")
        if guest_team_id != team_id:
            raise HTTPException(status_code=403, detail="PM guest token is not authorized for this team.")
        return

    user_id = str(principal.get("sub") or "")
    user = user_db.get_user_by_id(user_id)
    if not user or user.get("team_id") != team_id:
        raise HTTPException(status_code=403, detail="You are not a member of this team")


@router.post("", response_model=CreateTeamResponse)
async def create_team(req: CreateTeamRequest, user_id: str = Depends(get_current_user)):
    """Create a new team with the current user as team lead."""
    team_id = str(uuid.uuid4())
    
    try:
        user_db.create_team(team_id, req.name, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Generate initial invite code
    try:
        invite_code = user_db.generate_invite_code(team_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    logger.info(f"Team created: {team_id} by {user_id}")
    
    return CreateTeamResponse(
        team_id=team_id,
        name=req.name,
        invite_code=invite_code,
    )


@router.post("/join", response_model=JoinTeamResponse)
async def join_team(req: JoinTeamRequest, user_id: str = Depends(get_current_user)):
    """Join a team using an invite code."""
    success = user_db.join_team_with_code(user_id, req.invite_code)
    
    if not success:
        raise HTTPException(status_code=400, detail="Invalid or already used invite code")
    
    # Get team info
    # First, fetch updated user to get team_id
    user = user_db.get_user_by_id(user_id)
    team_id = user.get("team_id")
    
    if not team_id:
        raise HTTPException(status_code=400, detail="Failed to join team")
    
    team_info = user_db.get_team_info(team_id)
    if not team_info:
        raise HTTPException(status_code=404, detail="Team not found")
    
    logger.info(f"User {user_id} joined team {team_id}")
    
    return JoinTeamResponse(
        team_id=team_id,
        name=team_info["name"],
    )


@router.get("/{team_id}/members", response_model=list[TeamMemberInfo])
async def get_team_members(team_id: str, principal: dict = Depends(get_current_principal)):
    """Get all members of a team. User must be in the team."""
    _authorize_team_read(team_id, principal, user_db)
    members = user_db.get_team_members(team_id)
    return [TeamMemberInfo(**m) for m in members]


@router.get("/{team_id}", response_model=TeamInfo)
async def get_team_info(team_id: str, principal: dict = Depends(get_current_principal)):
    """Get team info. User must be in the team."""
    _authorize_team_read(team_id, principal, user_db)
    team_info = user_db.get_team_info(team_id)
    if not team_info:
        raise HTTPException(status_code=404, detail="Team not found")
    
    return TeamInfo(**team_info)


@router.post("/{team_id}/invite-code", response_model=dict)
async def generate_new_invite_code(team_id: str, user_id: str = Depends(get_current_user)):
    """Generate a new invite code for a team. Only team lead can do this."""
    team_info = user_db.get_team_info(team_id)
    
    if not team_info:
        raise HTTPException(status_code=404, detail="Team not found")
    
    if team_info["team_lead_id"] != user_id:
        raise HTTPException(status_code=403, detail="Only team lead can generate invite codes")
    
    try:
        code = user_db.generate_invite_code(team_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    logger.info(f"New invite code generated for team {team_id} by {user_id}")
    
    return {"invite_code": code}


@router.get("/{team_id}/members/{member_id}/snapshots", response_model=list[MemberSnapshot])
async def get_member_snapshots(
    team_id: str,
    member_id: str,
    limit: int = 1000,
    projectId: str | None = None,
    principal: dict = Depends(get_current_principal),
):
    """
    Return full IDE snapshot history for one team member.
    User must belong to the same team.
    """
    member = user_db.get_user_by_id(member_id)

    if not member:
        raise HTTPException(status_code=404, detail="User not found")

    member_team = member.get("team_id")
    _authorize_team_read(team_id, principal, user_db)
    if member_team != team_id:
        raise HTTPException(status_code=403, detail="Target member is not part of this team")

    if projectId:
        role = str(principal.get("role") or "user")
        if role == "pm_guest":
            guest_team_id = str(principal.get("team_id") or "")
            project = project_db.get_project_by_id(projectId)
            if not project or project.get("visibility") != "team" or project.get("team_id") != guest_team_id:
                raise HTTPException(status_code=403, detail="Not authorized to access this project")
        else:
            requester_user_id = str(principal.get("sub") or "")
            requester = user_db.get_user_by_id(requester_user_id) if requester_user_id else None
            requester_team_id = requester.get("team_id") if requester else None
            if not project_db.user_can_access_project(
                user_id=requester_user_id,
                team_id=requester_team_id,
                project_id=projectId,
            ):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")

    # Source of truth: vector timeline (fresh snapshots from Retriever ingestion).
    timeline = await vector_db.get_snapshot_timeline(limit=limit, user_id=member_id)
    snapshots: list[MemberSnapshot] = []

    if timeline:
        for row in timeline:
            row_project_id = row.get("project_id")
            if projectId and str(row_project_id or "") != projectId:
                continue

            commands_raw = row.get("terminal_commands") or "[]"
            commands: list[str] = []
            if isinstance(commands_raw, list):
                commands = [str(cmd) for cmd in commands_raw]
            elif isinstance(commands_raw, str):
                try:
                    parsed = json.loads(commands_raw)
                    if isinstance(parsed, list):
                        commands = [str(cmd) for cmd in parsed]
                except Exception:
                    commands = []

            snapshots.append(
                MemberSnapshot(
                    id=str(row.get("id") or ""),
                    user_id=member_id,
                    team_id=member_team,
                    project_id=str(row_project_id) if row_project_id else None,
                    workspace=str(row.get("workspace_folder") or ""),
                    active_file=str(row.get("active_file") or ""),
                    git_branch=str(row.get("git_branch") or "") or None,
                    terminal_commands=commands,
                    summary=str(row.get("summary") or ""),
                    enriched_context={},
                    timestamp=_parse_timestamp_to_epoch_seconds(row.get("timestamp")),
                    synced=1,
                )
            )

        return snapshots

    # Fallback: legacy synced snapshots table.
    rows = user_db.get_user_snapshots(member_id, limit=limit)

    for row in rows:
        commands_raw = row.get("terminal_commands") or "[]"
        commands: list[str] = []
        if isinstance(commands_raw, list):
            commands = [str(cmd) for cmd in commands_raw]
        elif isinstance(commands_raw, str):
            try:
                parsed = json.loads(commands_raw)
                if isinstance(parsed, list):
                    commands = [str(cmd) for cmd in parsed]
            except Exception:
                commands = []

        enriched_raw = row.get("enriched_context") or "{}"
        enriched_context: dict = {}
        if isinstance(enriched_raw, dict):
            enriched_context = enriched_raw
        elif isinstance(enriched_raw, str):
            try:
                parsed_context = json.loads(enriched_raw)
                if isinstance(parsed_context, dict):
                    enriched_context = parsed_context
            except Exception:
                enriched_context = {}

        snapshots.append(
            MemberSnapshot(
                id=str(row.get("id")),
                user_id=str(row.get("user_id")),
                team_id=row.get("team_id"),
                project_id=row.get("project_id"),
                workspace=str(row.get("workspace") or ""),
                active_file=str(row.get("active_file") or ""),
                git_branch=row.get("git_branch"),
                terminal_commands=commands,
                summary=str(row.get("summary") or ""),
                enriched_context=enriched_context,
                timestamp=int(row.get("timestamp") or 0),
                synced=int(row.get("synced") or 0),
            )
        )

    if projectId:
        return [snapshot for snapshot in snapshots if snapshot.project_id == projectId]

    return snapshots


@router.get("/{team_id}/pm/bootstrap", response_model=PMBootstrapResponse)
async def get_pm_bootstrap(
    team_id: str,
    snapshotLimit: int = 100,
    projectId: str | None = None,
    principal: dict = Depends(get_current_principal),
):
    """
    Aggregated PM bootstrap payload to reduce frontend fan-out.
    Includes members, compact member snapshot previews, and daily/weekly summaries.
    """
    _authorize_team_read(team_id, principal, user_db)
    role = str(principal.get("role") or "user")

    if projectId:
        if role == "pm_guest":
            guest_team_id = str(principal.get("team_id") or "")
            project = project_db.get_project_by_id(projectId)
            if not project or project.get("visibility") != "team" or project.get("team_id") != guest_team_id:
                raise HTTPException(status_code=403, detail="Not authorized to access this project")
        else:
            requester_user_id = str(principal.get("sub") or "")
            requester = user_db.get_user_by_id(requester_user_id) if requester_user_id else None
            requester_team_id = requester.get("team_id") if requester else None
            if not project_db.user_can_access_project(
                user_id=requester_user_id,
                team_id=requester_team_id,
                project_id=projectId,
            ):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")

    capped_limit = max(10, min(snapshotLimit, 200))
    cache_key = f"{team_id}::{projectId or 'all'}::{capped_limit}"
    cached = _cache_get_pm_bootstrap(cache_key)
    if cached:
        return cached

    members = user_db.get_team_members(team_id)
    member_ids = [str(member.get("id") or "") for member in members if member.get("id")]

    async def _member_snapshots(member_id: str) -> tuple[str, list[MemberSnapshot]]:
        timeline = await vector_db.get_snapshot_timeline(limit=capped_limit, user_id=member_id, project_id=projectId)
        previews: list[MemberSnapshot] = []
        for row in timeline:
            commands_raw = row.get("terminal_commands") or "[]"
            commands: list[str] = []
            if isinstance(commands_raw, list):
                commands = [str(cmd) for cmd in commands_raw]
            elif isinstance(commands_raw, str):
                try:
                    parsed = json.loads(commands_raw)
                    if isinstance(parsed, list):
                        commands = [str(cmd) for cmd in parsed]
                except Exception:
                    commands = []

            previews.append(
                MemberSnapshot(
                    id=str(row.get("id") or ""),
                    user_id=member_id,
                    team_id=team_id,
                    project_id=str(row.get("project_id") or "") or None,
                    workspace=str(row.get("workspace_folder") or ""),
                    active_file=str(row.get("active_file") or ""),
                    git_branch=str(row.get("git_branch") or "") or None,
                    terminal_commands=commands,
                    summary=str(row.get("summary") or ""),
                    enriched_context={},
                    timestamp=_parse_timestamp_to_epoch_seconds(row.get("timestamp")),
                    synced=1,
                )
            )
        return member_id, previews

    snapshot_entries = await asyncio.gather(*[_member_snapshots(member_id) for member_id in member_ids])
    snapshots_by_member = {member_id: snapshots for member_id, snapshots in snapshot_entries}

    payload = PMBootstrapResponse(
        team_id=team_id,
        members=[TeamMemberInfo(**member) for member in members],
        snapshots_by_member=snapshots_by_member,
        daily_summary=summary_service.generate_daily_summary(team_id),
        weekly_summary=summary_service.generate_weekly_summary(team_id),
        generated_at=datetime.now(timezone.utc).isoformat(),
    ).model_dump()
    _cache_set_pm_bootstrap(cache_key, payload)
    return payload
