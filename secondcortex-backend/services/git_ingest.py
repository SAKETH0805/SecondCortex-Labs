"""
Retroactive Git ingestion service.

Mines repository history (commits + diffs + inline comments) and, when available,
GitHub pull request descriptions/comments for cold-start memory backfill.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import re
import subprocess
from pathlib import Path

import httpx

from config import settings


@dataclass
class GitIngestRecord:
    id: str
    timestamp: datetime
    workspace_folder: str
    active_file: str
    language_id: str
    git_branch: str
    summary: str
    shadow_graph: str
    terminal_commands: list[str] = field(default_factory=list)


@dataclass
class GitIngestSummary:
    repo: str
    branch: str
    commit_count: int
    pr_count: int
    comment_count: int
    skipped_count: int
    warnings: list[str]


class RetroGitIngestionService:
    def mine(
        self,
        repo_path: str | None,
        max_commits: int = 120,
        max_pull_requests: int = 30,
        include_pull_requests: bool = True,
    ) -> tuple[list[GitIngestRecord], GitIngestSummary]:
        warnings: list[str] = []
        skipped_count = 0

        resolved_repo = self._resolve_repo_path(repo_path)
        self._ensure_git_repo(resolved_repo)

        branch = self._run_git(resolved_repo, ["rev-parse", "--abbrev-ref", "HEAD"]).strip() or "unknown"
        remote_url = self._run_git_no_raise(resolved_repo, ["config", "--get", "remote.origin.url"]).strip()

        records: list[GitIngestRecord] = []

        commit_records, commit_comment_count, commit_skipped = self._mine_commits(
            repo_path=resolved_repo,
            branch=branch,
            max_commits=max(1, min(max_commits, 2000)),
        )
        records.extend(commit_records)
        skipped_count += commit_skipped

        pr_records: list[GitIngestRecord] = []
        pr_comment_count = 0
        if include_pull_requests:
            owner_repo = self._parse_github_repo(remote_url)
            if owner_repo:
                try:
                    pr_records, pr_comment_count = self._mine_pull_requests(
                        owner=owner_repo[0],
                        repo=owner_repo[1],
                        branch=branch,
                        workspace_folder=resolved_repo,
                        max_pull_requests=max(1, min(max_pull_requests, 200)),
                    )
                    records.extend(pr_records)
                except Exception as exc:
                    warnings.append(f"PR mining failed: {exc}")
            else:
                warnings.append("No GitHub remote detected; skipped PR ingestion.")

        records.sort(key=lambda record: record.timestamp)

        summary = GitIngestSummary(
            repo=resolved_repo,
            branch=branch,
            commit_count=len(commit_records),
            pr_count=len(pr_records),
            comment_count=commit_comment_count + pr_comment_count,
            skipped_count=skipped_count,
            warnings=warnings,
        )
        return records, summary

    def _mine_commits(
        self,
        repo_path: str,
        branch: str,
        max_commits: int,
    ) -> tuple[list[GitIngestRecord], int, int]:
        records: list[GitIngestRecord] = []
        skipped = 0
        comment_count = 0

        raw_log = self._run_git(
            repo_path,
            [
                "log",
                f"-n{max_commits}",
                "--date=iso-strict",
                "--pretty=format:%H%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%b%x1e",
            ],
        )

        for chunk in raw_log.split("\x1e"):
            item = chunk.strip()
            if not item:
                continue
            parts = item.split("\x1f")
            if len(parts) < 6:
                skipped += 1
                continue

            commit_hash, author, email, commit_date, subject, body = [p.strip() for p in parts[:6]]
            if not commit_hash:
                skipped += 1
                continue

            changed_files = self._run_git_no_raise(
                repo_path,
                ["show", "--name-only", "--pretty=format:", commit_hash],
            )
            file_list = [line.strip() for line in changed_files.splitlines() if line.strip()]
            active_file = file_list[0] if file_list else "."

            diff_text = self._run_git_no_raise(
                repo_path,
                ["show", "--unified=1", "--no-color", "--format=", commit_hash],
            )

            extracted_comments = self._extract_code_comments(diff_text, max_comments=25)
            comment_count += len(extracted_comments)

            shadow_graph = "\n".join(
                [
                    f"Source: git_commit:{commit_hash}",
                    f"Author: {author} <{email}>",
                    f"Branch: {branch}",
                    f"Date: {commit_date}",
                    f"Subject: {subject}",
                    f"Body: {body or '(none)'}",
                    f"Files: {', '.join(file_list[:20]) or '(none)'}",
                    "Commit diff excerpt:",
                    diff_text[:12000] or "(no diff)",
                    "Code comments found in diff:",
                    "\n".join(extracted_comments) if extracted_comments else "(none)",
                ]
            )

            records.append(
                GitIngestRecord(
                    id=f"git-commit-{commit_hash}",
                    timestamp=self._parse_dt(commit_date),
                    workspace_folder=repo_path,
                    active_file=active_file,
                    language_id=self._language_from_path(active_file),
                    git_branch=branch,
                    summary=f"Commit {commit_hash[:8]}: {subject or 'No subject'}",
                    shadow_graph=shadow_graph,
                )
            )

        return records, comment_count, skipped

    def _mine_pull_requests(
        self,
        owner: str,
        repo: str,
        branch: str,
        workspace_folder: str,
        max_pull_requests: int,
    ) -> tuple[list[GitIngestRecord], int]:
        token = (settings.github_token or "").strip()
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "SecondCortex-RetroIngest",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"

        per_page = min(100, max_pull_requests)
        remaining = max_pull_requests
        page = 1
        pulls: list[dict] = []

        with httpx.Client(timeout=15.0, headers=headers) as client:
            while remaining > 0:
                response = client.get(
                    f"https://api.github.com/repos/{owner}/{repo}/pulls",
                    params={
                        "state": "all",
                        "sort": "updated",
                        "direction": "desc",
                        "per_page": min(per_page, remaining),
                        "page": page,
                    },
                )
                if response.status_code >= 400:
                    raise RuntimeError(f"GitHub API /pulls failed ({response.status_code})")

                batch = response.json()
                if not isinstance(batch, list) or not batch:
                    break

                pulls.extend(batch)
                remaining -= len(batch)
                page += 1
                if len(batch) < per_page:
                    break

            records: list[GitIngestRecord] = []
            pr_comment_count = 0

            for pr in pulls:
                pr_number = int(pr.get("number") or 0)
                if pr_number <= 0:
                    continue

                title = str(pr.get("title") or "")
                body = str(pr.get("body") or "")
                created_at = str(pr.get("created_at") or pr.get("updated_at") or "")
                merge_commit = str(pr.get("merge_commit_sha") or "")
                html_url = str(pr.get("html_url") or "")

                issue_comments = self._fetch_pr_comments(client, pr_number, owner, repo, review=False)
                review_comments = self._fetch_pr_comments(client, pr_number, owner, repo, review=True)
                all_comments = issue_comments + review_comments
                pr_comment_count += len(all_comments)

                shadow_graph = "\n".join(
                    [
                        f"Source: pull_request:{owner}/{repo}#{pr_number}",
                        f"URL: {html_url}",
                        f"Branch: {branch}",
                        f"Merge commit: {merge_commit or '(none)'}",
                        f"Title: {title}",
                        f"Description: {body or '(none)'}",
                        "PR comments:",
                        "\n".join(all_comments[:60]) if all_comments else "(none)",
                    ]
                )

                records.append(
                    GitIngestRecord(
                        id=f"git-pr-{owner}-{repo}-{pr_number}",
                        timestamp=self._parse_dt(created_at),
                        workspace_folder=workspace_folder,
                        active_file=f"PR#{pr_number}",
                        language_id="markdown",
                        git_branch=branch,
                        summary=f"PR #{pr_number}: {title or 'No title'}",
                        shadow_graph=shadow_graph,
                    )
                )

        return records, pr_comment_count

    def _fetch_pr_comments(
        self,
        client: httpx.Client,
        pr_number: int,
        owner: str,
        repo: str,
        review: bool,
    ) -> list[str]:
        endpoint = "reviews" if review else "issues"
        url = (
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/comments"
            if review
            else f"https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments"
        )

        response = client.get(url, params={"per_page": 30})
        if response.status_code >= 400:
            return [f"[{endpoint} comments unavailable: HTTP {response.status_code}]"]

        payload = response.json()
        if not isinstance(payload, list):
            return []

        comments: list[str] = []
        for row in payload[:30]:
            user = str((row or {}).get("user", {}).get("login") or "unknown")
            body = str((row or {}).get("body") or "").strip()
            if not body:
                continue
            comments.append(f"{user}: {body[:300]}")
        return comments

    def _resolve_repo_path(self, repo_path: str | None) -> str:
        candidate = Path(repo_path).expanduser() if repo_path else Path.cwd()
        return str(candidate.resolve())

    def _ensure_git_repo(self, repo_path: str) -> None:
        out = self._run_git(repo_path, ["rev-parse", "--is-inside-work-tree"]).strip().lower()
        if out != "true":
            raise RuntimeError(f"Path is not a git repository: {repo_path}")

    def _run_git(self, repo_path: str, args: list[str]) -> str:
        process = subprocess.run(
            ["git", "-C", repo_path, *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if process.returncode != 0:
            stderr = (process.stderr or "").strip()
            raise RuntimeError(stderr or f"git command failed: {' '.join(args)}")
        return process.stdout or ""

    def _run_git_no_raise(self, repo_path: str, args: list[str]) -> str:
        try:
            return self._run_git(repo_path, args)
        except Exception:
            return ""

    def _parse_github_repo(self, remote_url: str) -> tuple[str, str] | None:
        remote = (remote_url or "").strip()
        if not remote:
            return None

        https_match = re.match(r"^https://github\.com/([^/]+)/([^/]+?)(?:\.git)?$", remote)
        ssh_match = re.match(r"^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$", remote)

        match = https_match or ssh_match
        if not match:
            return None

        owner = match.group(1)
        repo = match.group(2)
        return owner, repo

    def _extract_code_comments(self, diff_text: str, max_comments: int) -> list[str]:
        comments: list[str] = []
        for line in (diff_text or "").splitlines():
            if not line.startswith("+") or line.startswith("+++"):
                continue
            candidate = line[1:].strip()
            if not candidate:
                continue
            if re.match(r"^(#|//|/\*|\*|<!--)", candidate):
                comments.append(candidate[:300])
                if len(comments) >= max_comments:
                    break
        return comments

    def _parse_dt(self, raw: str) -> datetime:
        value = (raw or "").strip()
        if not value:
            return datetime.now(timezone.utc)
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return datetime.now(timezone.utc)

    def _language_from_path(self, path: str) -> str:
        ext = Path(path or "").suffix.lower()
        mapping = {
            ".py": "python",
            ".ts": "typescript",
            ".tsx": "typescriptreact",
            ".js": "javascript",
            ".jsx": "javascriptreact",
            ".go": "go",
            ".rs": "rust",
            ".java": "java",
            ".kt": "kotlin",
            ".cs": "csharp",
            ".cpp": "cpp",
            ".c": "c",
            ".h": "c",
            ".md": "markdown",
            ".html": "html",
            ".css": "css",
            ".json": "json",
            ".yml": "yaml",
            ".yaml": "yaml",
            ".sql": "sql",
            ".sh": "shellscript",
        }
        return mapping.get(ext, "plaintext")
