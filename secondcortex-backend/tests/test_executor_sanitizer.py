from agents.executor import _sanitize_summary_text


def test_sanitize_summary_removes_most_recent_snapshot_phrase() -> None:
    raw = "Most recent snapshot:\n- Work context: Editing file\n- File: a.py"
    sanitized = _sanitize_summary_text(raw)

    assert "Most recent snapshot" not in sanitized
    assert sanitized.startswith("Recent snapshot context")
