from __future__ import annotations

import asyncio

from agents.executor import ExecutorAgent
from agents.planner import PlanResult


def test_executor_uses_fast_path_for_latest_snapshot_plan():
    agent = ExecutorAgent()
    plan = PlanResult(
        intent="Fetch latest 3 snapshots",
        search_queries=["latest_3_snapshots"],
        temporal_scope="all_time",
        retrieved_context=[
            {
                "active_file": "src/a.ts",
                "git_branch": "main",
                "timestamp": "2026-03-20T10:00:00+00:00",
                "summary": "Edited A",
            },
            {
                "active_file": "src/b.ts",
                "git_branch": "main",
                "timestamp": "2026-03-20T09:00:00+00:00",
                "summary": "Edited B",
            },
        ],
    )

    result = asyncio.run(agent.synthesize("recent snapshots", plan))

    assert result.summary.startswith("Latest snapshots:")
    assert "Most recent snapshot:" not in result.summary
    assert "src/a.ts" in result.summary
    assert "src/b.ts" in result.summary
