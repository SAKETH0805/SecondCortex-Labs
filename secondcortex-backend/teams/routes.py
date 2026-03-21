"""
Team API routes: create, join, get members, generate invite codes.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from auth.database import UserDB
from auth.jwt_handler import get_current_user

logger = logging.getLogger("secondcortex.teams.routes")

router = APIRouter(prefix="/api/v1/teams", tags=["teams"])
user_db = UserDB()


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
async def get_team_members(team_id: str, user_id: str = Depends(get_current_user)):
    """Get all members of a team. User must be in the team."""
    user = user_db.get_user_by_id(user_id)
    
    # Verify user is in this team
    if user.get("team_id") != team_id:
        raise HTTPException(status_code=403, detail="You are not a member of this team")
    
    members = user_db.get_team_members(team_id)
    return [TeamMemberInfo(**m) for m in members]


@router.get("/{team_id}", response_model=TeamInfo)
async def get_team_info(team_id: str, user_id: str = Depends(get_current_user)):
    """Get team info. User must be in the team."""
    user = user_db.get_user_by_id(user_id)
    
    # Verify user is in this team
    if user.get("team_id") != team_id:
        raise HTTPException(status_code=403, detail="You are not a member of this team")
    
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
