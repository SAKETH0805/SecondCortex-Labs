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

from agents.planner import PlanResult
from models.schemas import QueryResponse, ResurrectionCommand
from services.llm_client import task_chat_completion

logger = logging.getLogger("secondcortex.executor")

# Set to True to enable the internal validation loop (costs 1 extra LLM call per query)
ENABLE_VALIDATION = False

EXECUTOR_SYSTEM_PROMPT = """\
You are the SecondCortex Executor. Synthesize a brief, direct answer from retrieved snapshots.

Respond with ONLY valid JSON (no markdown, no prose):
{
    "summary": "Direct answer with concrete evidence. Use short bullets when needed.",
  "reasoning_log": ["Step 1: ...", "Step 2: ..."],
  "confidence": 0.7,
  "discrepancies": [],
  "commands": []
}

Rules:
- Always answer the user's explicit intent (explain/summarize/list/compare).
- For latest/recent snapshot requests, explain findings in natural language.
- Prefer concise narrative over rigid field templates.
- Do NOT collapse a multi-snapshot request into a single snapshot.
- Do NOT start answers with labels like "Most recent snapshot:".
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
        pass

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

        # ── Step 2: Draft the answer ─────────────────────────────
        draft = await self._generate_draft(question, context_block)

        # Ensure summary is always a string (LLM may return list/dict)
        summary_raw = draft.get("summary", "I could not determine a clear answer.")
        if isinstance(summary_raw, list):
            summary_raw = " ".join(str(s) for s in summary_raw)
        elif not isinstance(summary_raw, str):
            summary_raw = str(summary_raw)
        summary_raw = _sanitize_summary_text(summary_raw)

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
            summary=summary_raw,
            reasoning_log=reasoning_log,
            commands=commands,
        )


    async def _generate_draft(self, question: str, context: str) -> dict:
        """Call LLM to draft the answer."""
        try:
            response = await task_chat_completion(
                task="executor",
                messages=[
                    {"role": "system", "content": EXECUTOR_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Question: {question}\n\nRetrieved Context:\n{context}"},
                ],
                temperature=0.3,
                max_tokens=500,
            )
            raw = response.choices[0].message.content or "{}"
            draft = json.loads(raw)
            if isinstance(draft, dict) and isinstance(draft.get("summary"), str):
                draft["summary"] = _sanitize_summary_text(draft["summary"])
            return draft
        except Exception as exc:
            logger.error("Executor LLM draft call failed. Error: %s", exc, exc_info=True)
            return {"summary": f"Error generating answer: {str(exc)}", "confidence": 0.0}

    async def _validate_draft(self, question: str, draft: dict, context: str) -> dict:
        """Internal Validation Loop — checks draft against the evidence."""
        try:
            response = await task_chat_completion(
                task="executor",
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


def _sanitize_summary_text(summary: str) -> str:
    text = (summary or "").strip()
    lower = text.lower()

    # Guardrail for legacy rigid formatting that users found unhelpful.
    if "most recent snapshot" in lower:
        lines = [line.strip(" -\t") for line in text.splitlines() if line.strip()]
        details: list[str] = []
        for line in lines[1:]:
            if ":" in line:
                details.append(line)
        if details:
            return "Recent snapshot context: " + "; ".join(details)
        return "Recent snapshot context found."

    return text


