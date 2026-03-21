import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from main import app

    return TestClient(app)


def test_full_team_workflow(client):
    """
    E2E test: Create team -> Join with 2nd user -> Get members/info/summaries -> Verify access control
    """
    lead_email = f"lead{uuid.uuid4().hex[:8]}@test.com"
    lead_signup = client.post(
        "/api/v1/auth/signup",
        json={"email": lead_email, "password": "pass123", "display_name": "Team Lead"},
    )
    assert lead_signup.status_code == 200
    lead_token = lead_signup.json()["token"]
    lead_headers = {"Authorization": f"Bearer {lead_token}"}

    create_team = client.post(
        "/api/v1/teams",
        headers=lead_headers,
        json={"name": "Full Stack Squad"},
    )
    assert create_team.status_code == 200
    team_data = create_team.json()
    team_id = team_data["team_id"]
    invite_code = team_data["invite_code"]

    member_email = f"member{uuid.uuid4().hex[:8]}@test.com"
    member_signup = client.post(
        "/api/v1/auth/signup",
        json={"email": member_email, "password": "pass123", "display_name": "Team Member"},
    )
    assert member_signup.status_code == 200
    member_token = member_signup.json()["token"]
    member_headers = {"Authorization": f"Bearer {member_token}"}

    join_team = client.post(
        "/api/v1/teams/join",
        headers=member_headers,
        json={"invite_code": invite_code},
    )
    assert join_team.status_code == 200
    assert join_team.json()["team_id"] == team_id

    members = client.get(
        f"/api/v1/teams/{team_id}/members",
        headers=lead_headers,
    )
    assert members.status_code == 200
    member_list = members.json()
    assert len(member_list) == 2

    team_info = client.get(
        f"/api/v1/teams/{team_id}",
        headers=lead_headers,
    )
    assert team_info.status_code == 200
    assert team_info.json()["member_count"] == 2

    daily_summary = client.get(
        f"/api/v1/summaries/team/{team_id}/daily",
        headers=lead_headers,
    )
    assert daily_summary.status_code == 200
    daily_data = daily_summary.json()
    assert daily_data["team_id"] == team_id
    assert daily_data["period"] == "daily"
    assert len(daily_data["members"]) == 2

    weekly_summary = client.get(
        f"/api/v1/summaries/team/{team_id}/weekly",
        headers=lead_headers,
    )
    assert weekly_summary.status_code == 200
    weekly_data = weekly_summary.json()
    assert weekly_data["period"] == "weekly"
    assert "daily_breakdown" in weekly_data

    other_email = f"other{uuid.uuid4().hex[:8]}@test.com"
    other_signup = client.post(
        "/api/v1/auth/signup",
        json={"email": other_email, "password": "pass123", "display_name": "Other User"},
    )
    assert other_signup.status_code == 200
    other_token = other_signup.json()["token"]
    other_headers = {"Authorization": f"Bearer {other_token}"}

    denied = client.get(
        f"/api/v1/teams/{team_id}/members",
        headers=other_headers,
    )
    assert denied.status_code == 403
