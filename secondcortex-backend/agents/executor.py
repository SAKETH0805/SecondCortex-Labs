"""
Agent 3: The Executor (The Synthesizer)

Takes the retrieved context from the Planner and:
  1. Synthesizes a timeline / story of what happened.
  2. Runs an Internal Validation Loop — checks the draft against the original
     user prompt, flagging any discrepancies (e.g., "Slack says X, Git says Y").
  3. Formats the final output as a JSON execution array for the VS Code extension
     (Workspace Resurrection commands).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from agents.planner import PlanResult
from models.schemas import QueryResponse, ResurrectionCommand
from services.llm_client import create_groq_client, get_groq_model
from services.rate_limiter import rate_limited_call

logger = logging.getLogger("secondcortex.executor")

# Set to True to enable the internal validation loop (costs 1 extra LLM call per query)
ENABLE_VALIDATION = False

EXECUTOR_SYSTEM_PROMPT = """\
You are the SecondCortex Executor. Synthesize a brief, direct answer from retrieved snapshots.

Respond with ONLY valid JSON (no markdown, no prose):
{
  "summary": "Direct 1-2 sentence answer. Add 2-3 bullet facts if helpful. Max 200 chars.",
  "reasoning_log": ["Step 1: ...", "Step 2: ..."],
  "confidence": 0.7,
  "discrepancies": [],
  "commands": []
}

Rules:
- Summary: Answer FIRST sentence. Then optional bullets (- fact). Keep to <200 chars.
- For recency questions (latest/newest/most recent/recent snapshot), prefer this exact structure:
    Most recent snapshot:
    - Work context: ...
    - File: ...
    - Branch: ...
    - Time: ... (include timezone)
- confidence: 0.0-1.0. Low confidence = be explicit about uncertainty.
- reasoning_log: 2-3 short factual lines max.
- commands: [] unless explicitly helpful (resurrect branch, open file).
- Return JSON only. No wrapping markdown or extra prose.
"""

VALIDATION_PROMPT = """\
You are the SecondCortex Internal Validator. Compare the following draft answer \
against the original question and retrieved evidence. Check for:
1. Does the answer actually address the question?
2. Are there conflicting data points?
3. Is the confidence justified?

Respond with JSON:
{
  "is_valid": true | false,
  "issues": ["list of issues if any"],
  "revised_confidence": 0.0 to 1.0
}
"""


class ExecutorAgent:
    """Synthesizes answers and validates them internally."""

    def __init__(self) -> None:
        self.client = create_groq_client()

    async def synthesize(self, question: str, plan_result: PlanResult) -> QueryResponse:
        """
        Main entry point:
        1. Draft an answer from retrieved context.
        2. Validate internally.
        3. Return the final QueryResponse.
        """
        logger.info("Synthesizing answer for: %s", question)

        # ── Step 1: Build context string from retrieved snapshots ─
        context_parts: list[str] = []
        for i, ctx in enumerate(plan_result.retrieved_context[:10]):
            context_parts.append(
                f"[Snapshot {i + 1}]\n"
                f"  File: {ctx.get('active_file', 'N/A')}\n"
                f"  Branch: {ctx.get('git_branch', 'N/A')}\n"
                f"  Time: {ctx.get('timestamp', 'N/A')}\n"
                f"  Summary: {ctx.get('summary', 'N/A')}\n"
                f"  Code: {str(ctx.get('shadow_graph', ''))[:500]}\n"
            )
        context_block = "\n".join(context_parts) if context_parts else "No relevant context found."

        if _is_latest_lookup_question(question) and plan_result.retrieved_context:
            latest = plan_result.retrieved_context[0]
            return QueryResponse(
                summary=_build_latest_snapshot_bullet_summary(latest),
                reasoning_log=[
                    "Detected recency query in executor and normalized response format.",
                    f"Selected snapshot id={latest.get('id', 'unknown')} timestamp={latest.get('timestamp', 'unknown')}",
                ],
                commands=[],
            )

        # ── Step 2: Draft the answer ─────────────────────────────
        draft = await self._generate_draft(question, context_block)

        # ── Step 3: Internal Validation Loop (disabled to save API quota) ──
        confidence = draft.get("confidence", 0.5)
        if ENABLE_VALIDATION:
            validation = await self._validate_draft(question, draft, context_block)
            revised_confidence = validation.get("revised_confidence", confidence)
        else:
            validation = {"is_valid": True, "issues": [], "revised_confidence": confidence}
            revised_confidence = confidence

        # Log discrepancies visibly
        issues = validation.get("issues", [])
        discrepancies = draft.get("discrepancies", [])
        if issues:
            logger.warning("VALIDATION ISSUES: %s", issues)
            discrepancies.extend(issues)

        if revised_confidence < 0.85:
            logger.warning(
                "Low confidence (%.2f) — discrepancies: %s",
                revised_confidence, discrepancies
            )

        # ── Step 4: Build the response ───────────────────────────
        reasoning_log = draft.get("reasoning_log", [])
        if discrepancies:
            reasoning_log.append(f"⚠️ Discrepancies flagged: {discrepancies}")

        commands = []
        for cmd in draft.get("commands", []):
            try:
                commands.append(ResurrectionCommand(**cmd))
            except Exception as cmd_exc:
                logger.warning("Skipping malformed command %s: %s", cmd, cmd_exc)

        return QueryResponse(
            summary=draft.get("summary", "I could not determine a clear answer."),
            reasoning_log=reasoning_log,
            commands=commands,
        )


    async def _generate_draft(self, question: str, context: str) -> dict:
        """Call LLM to draft the answer."""
        try:
            response = await rate_limited_call(
                self.client.chat.completions.create,
                model=get_groq_model(),
                messages=[
                    {"role": "system", "content": EXECUTOR_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Question: {question}\n\nRetrieved Context:\n{context}"},
                ],
                temperature=0.3,
                max_tokens=1200,
            )
            raw = response.choices[0].message.content or "{}"
            return json.loads(raw)
        except Exception as exc:
            logger.error("Executor LLM draft call failed. Error: %s", exc, exc_info=True)
            return {"summary": f"Error generating answer: {str(exc)}", "confidence": 0.0}

    async def _validate_draft(self, question: str, draft: dict, context: str) -> dict:
        """Internal Validation Loop — checks draft against the evidence."""
        try:
            response = await rate_limited_call(
                self.client.chat.completions.create,
                model=get_groq_model(),
                messages=[
                    {"role": "system", "content": VALIDATION_PROMPT},
                    {
                        "role": "user",
                        "content": (
                            f"Original Question: {question}\n\n"
                            f"Draft Answer: {json.dumps(draft)}\n\n"
                            f"Evidence:\n{context}"
                        ),
                    },
                ],
                temperature=0.1,
                max_tokens=400,
            )
            raw = response.choices[0].message.content or "{}"
            return json.loads(raw)
        except Exception as exc:
            logger.error("Validator LLM call failed. Error: %s", exc, exc_info=True)
            return {"is_valid": True, "issues": [], "revised_confidence": 0.5}


def _is_latest_lookup_question(question: str) -> bool:
    q = (question or "").strip().lower()
    if not q:
        return False
    has_recency = bool(re.search(r"\b(latest|newest|most recent|recent|current|last|fetch latest)\b", q))
    has_snapshot_context = bool(re.search(r"\b(snapshot|snapshots|timeline|context|update|edited|editing|file|commit|branch)\b", q))
    return has_recency and has_snapshot_context


def _extract_work_context(snapshot: dict) -> str:
    for key in ("summary", "shadow_graph", "document"):
        value = str(snapshot.get(key) or "").strip()
        if value:
            normalized = " ".join(value.split())
            return normalized[:180]
    return "No work context available."


def _format_snapshot_timestamp_with_timezone(raw_timestamp: Any) -> str:
    if raw_timestamp is None:
        return "unknown time"

    dt: datetime | None = None
    if isinstance(raw_timestamp, (int, float)):
        ts = float(raw_timestamp)
        if ts > 1_000_000_000_000:
            ts /= 1000.0
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    elif isinstance(raw_timestamp, str):
        value = raw_timestamp.strip()
        if not value:
            return "unknown time"
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(value)
        except Exception:
            return str(raw_timestamp)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    else:
        return str(raw_timestamp)

    tz_name = dt.tzname() or "UTC"
    tz_offset = dt.strftime("%z")
    if len(tz_offset) == 5:
        tz_offset = f"{tz_offset[:3]}:{tz_offset[3:]}"
    elif not tz_offset:
        tz_offset = "+00:00"

    return f"{dt.isoformat()} ({tz_name} {tz_offset})"


def _build_latest_snapshot_bullet_summary(snapshot: dict) -> str:
    return "\n".join(
        [
            "Most recent snapshot:",
            f"- Work context: {_extract_work_context(snapshot)}",
            f"- File: {snapshot.get('active_file') or 'an unknown file'}",
            f"- Branch: {snapshot.get('git_branch') or 'unknown'}",
            f"- Time: {_format_snapshot_timestamp_with_timezone(snapshot.get('timestamp'))}",
        ]
    )
