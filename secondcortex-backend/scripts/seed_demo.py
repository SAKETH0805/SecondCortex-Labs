"""
Demo Data Seeder — populates the vector DB with realistic mock snapshots
for the onboarding tour and demo mode (?demo=true).

Usage:
    cd secondcortex-backend
    python scripts/seed_demo.py
"""

from __future__ import annotations

import asyncio
import sys
import os
import uuid
import random
from datetime import datetime, timedelta

# Ensure the parent directory is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from models.schemas import StoredSnapshot, MemoryMetadata, MemoryOperation  # noqa: E402


DEMO_USER_ID = "demo_user"

# ── Realistic snapshot templates ──────────────────────────────────

MOCK_TEMPLATES = [
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "src/components/Dashboard.tsx",
        "language_id": "typescriptreact",
        "git_branch": "feature/dashboard-redesign",
        "summary": "Refactored Dashboard stat cards to use a reusable StatCard component with icon support.",
        "entities": ["Dashboard", "StatCard", "MonoIcon"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/main.py",
        "language_id": "python",
        "git_branch": "main",
        "summary": "Added snapshot timeline endpoint with chronological sorting for the shadow graph.",
        "entities": ["FastAPI", "timeline", "VectorDBService"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/services/vector_db.py",
        "language_id": "python",
        "git_branch": "main",
        "summary": "Implemented semantic search with per-user collection isolation in ChromaDB.",
        "entities": ["ChromaDB", "embeddings", "semantic_search"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "src/app/page.tsx",
        "language_id": "typescriptreact",
        "git_branch": "feature/landing-page",
        "summary": "Designed hero section with animated floating squares and gradient typography.",
        "entities": ["HeroSection", "FloatingSquares", "Next.js"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-vscode/src/extension.ts",
        "language_id": "typescript",
        "git_branch": "feature/vscode-sidebar",
        "summary": "Wired up the VS Code sidebar webview to display live context graph from backend.",
        "entities": ["VSCode", "webview", "sidebar", "extension"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/agents/planner.py",
        "language_id": "python",
        "git_branch": "main",
        "summary": "Reduced planner MAX_STEPS from 3 to 1 to conserve API quota on the free tier.",
        "entities": ["PlannerAgent", "rate_limiting", "Groq"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/auth/routes.py",
        "language_id": "python",
        "git_branch": "feature/auth",
        "summary": "Implemented JWT-based signup/login with bcrypt password hashing and MCP key generation.",
        "entities": ["JWT", "bcrypt", "auth_router", "MCP"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "src/components/ContextGraph.tsx",
        "language_id": "typescriptreact",
        "git_branch": "feature/live-graph",
        "summary": "Built the React Flow-powered live context graph with auto-refresh every 5 seconds.",
        "entities": ["ReactFlow", "ContextGraph", "polling"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "docker-compose.yml",
        "language_id": "yaml",
        "git_branch": "main",
        "summary": "Configured multi-container Docker setup with backend, frontend, and ChromaDB services.",
        "entities": ["Docker", "docker-compose", "ChromaDB"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/mcp_server.py",
        "language_id": "python",
        "git_branch": "feature/mcp",
        "summary": "Mounted MCP SSE endpoint and connected tool handlers for snapshot recall and resurrection.",
        "entities": ["MCP", "SSE", "FastMCP", "tools"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "src/app/globals.css",
        "language_id": "css",
        "git_branch": "feature/dark-theme",
        "summary": "Applied dark glassmorphism theme with CSS custom properties and smooth transitions.",
        "entities": ["CSS", "glassmorphism", "dark-theme"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/agents/executor.py",
        "language_id": "python",
        "git_branch": "main",
        "summary": "Built the Executor agent to synthesize Planner output into a final summary with resurrection commands.",
        "entities": ["ExecutorAgent", "synthesis", "commands"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "README.md",
        "language_id": "markdown",
        "git_branch": "main",
        "summary": "Updated README with architecture diagram, setup instructions, and tech stack overview.",
        "entities": ["README", "documentation"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/services/rate_limiter.py",
        "language_id": "python",
        "git_branch": "fix/rate-limits",
        "summary": "Implemented token bucket rate limiter with 429 backoff to prevent Groq rate limit crashes.",
        "entities": ["RateLimiter", "token_bucket", "429", "backoff"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "src/components/AuthForm.tsx",
        "language_id": "typescriptreact",
        "git_branch": "feature/auth",
        "summary": "Created login/signup form with validation, error states, and animated transitions.",
        "entities": ["AuthForm", "login", "signup", "validation"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/agents/retriever.py",
        "language_id": "python",
        "git_branch": "main",
        "summary": "Retriever agent extracts entities and relations from snapshots using structured LLM output.",
        "entities": ["RetrieverAgent", "NLP", "entity_extraction"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-vscode/package.json",
        "language_id": "json",
        "git_branch": "feature/vscode-packaging",
        "summary": "Configured VS Code extension manifest with activation events, commands, and sidebar contribution.",
        "entities": ["VSCode", "package.json", "extension", "manifest"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/models/schemas.py",
        "language_id": "python",
        "git_branch": "main",
        "summary": "Defined Pydantic schemas for SnapshotPayload, QueryResponse, and ResurrectionCommand.",
        "entities": ["Pydantic", "schemas", "SnapshotPayload", "QueryResponse"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/agents/simulator.py",
        "language_id": "python",
        "git_branch": "feature/resurrection",
        "summary": "SimulatorAgent analyzes workspace impact before resurrection to detect conflicts and risks.",
        "entities": ["SimulatorAgent", "impact_analysis", "safety"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "src/app/layout.tsx",
        "language_id": "typescriptreact",
        "git_branch": "main",
        "summary": "Set up Next.js root layout with Inter font, metadata for SEO, and global CSS imports.",
        "entities": ["Next.js", "layout", "Inter", "metadata"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/config.py",
        "language_id": "python",
        "git_branch": "main",
        "summary": "Centralized application settings with pydantic-settings for GitHub Models, Groq, and Azure OpenAI.",
        "entities": ["Settings", "pydantic", "env_vars"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "src/components/landing/FeatureCards.tsx",
        "language_id": "typescriptreact",
        "git_branch": "feature/landing-page",
        "summary": "Built animated feature cards with hover effects showcasing Memory, Resurrection, and MCP.",
        "entities": ["FeatureCards", "animation", "landing"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-backend/auth/jwt_handler.py",
        "language_id": "python",
        "git_branch": "feature/auth",
        "summary": "Implemented JWT token creation and verification with HS256 signing and 7-day expiry.",
        "entities": ["JWT", "HS256", "token_verify"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "secondcortex-vscode/src/panels/SidebarProvider.ts",
        "language_id": "typescript",
        "git_branch": "feature/vscode-sidebar",
        "summary": "Created SidebarProvider to render the SecondCortex webview panel with context injection.",
        "entities": ["SidebarProvider", "webview", "VSCode"],
    },
    {
        "workspace_folder": "/home/dev/SecondCortexLabs",
        "active_file": "setup_demo.bat",
        "language_id": "bat",
        "git_branch": "main",
        "summary": "Wrote Windows batch script for one-click local development setup with dependency installation.",
        "entities": ["setup", "batch_script", "development"],
    },
]


def _generate_mock_snapshots(count: int = 25) -> list[StoredSnapshot]:
    """Generate realistic mock snapshots spread over the last 5 days."""
    snapshots = []
    now = datetime.utcnow()

    for i in range(count):
        template = MOCK_TEMPLATES[i % len(MOCK_TEMPLATES)]
        # Spread snapshots over 5 days with some randomness
        hours_ago = random.uniform(1, 120)  # 0-5 days
        ts = now - timedelta(hours=hours_ago)

        snap = StoredSnapshot(
            id=str(uuid.uuid4()),
            timestamp=ts,
            workspace_folder=template["workspace_folder"],
            active_file=template["active_file"],
            language_id=template["language_id"],
            shadow_graph=f"// Shadow graph for {template['active_file']}\n{template['summary']}",
            git_branch=template["git_branch"],
            terminal_commands=["git status", "npm run dev"] if "tsx" in template["language_id"] else ["pytest", "git log -1"],
            metadata=MemoryMetadata(
                operation=MemoryOperation.ADD,
                entities=template["entities"],
                relations=[],
                summary=template["summary"],
            ),
            embedding=None,  # Will be generated during upsert
        )
        snapshots.append(snap)

    return snapshots


async def seed_demo_data():
    """Insert mock snapshots into the vector DB under the demo_user profile."""
    from services.vector_db import VectorDBService

    print(f"🧠 SecondCortex Demo Seeder")
    print(f"   Generating {len(MOCK_TEMPLATES)} realistic snapshots for user '{DEMO_USER_ID}'...")

    vector_db = VectorDBService()
    snapshots = _generate_mock_snapshots(count=25)

    for i, snap in enumerate(snapshots):
        # Generate embedding from the shadow graph
        text_for_embedding = f"{snap.active_file} {snap.metadata.summary if snap.metadata else ''}"
        embedding = await vector_db.generate_embedding(text_for_embedding)
        snap.embedding = embedding

        await vector_db.upsert_snapshot(snap, user_id=DEMO_USER_ID)
        print(f"   [{i+1}/{len(snapshots)}] ✅ {snap.active_file} ({snap.language_id})")

    print(f"\n🎉 Done! Seeded {len(snapshots)} snapshots for demo_user.")
    print(f"   Launch the frontend with ?demo=true to start the guided tour.")


if __name__ == "__main__":
    asyncio.run(seed_demo_data())
