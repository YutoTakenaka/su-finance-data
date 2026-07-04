"""JSONファイルストレージ層。

ローカルの data/ ディレクトリを正とする。環境変数 GITHUB_TOKEN と
GITHUB_DATA_REPO が設定されている場合は、書き込みのたびに GitHub リポジトリへ
同じ内容をプッシュする(要件定義書 9章 案A: 無料ホスティングでの永続化)。
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

JST = timezone(timedelta(hours=9))

FISCAL_YEAR = int(os.environ.get("FISCAL_YEAR", "2026"))
DATA_DIR = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent / "data")))
YEAR_DIR = DATA_DIR / str(FISCAL_YEAR)

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = os.environ.get("GITHUB_DATA_REPO", "")  # 例: "your-org/su-finance-data"
GITHUB_BRANCH = os.environ.get("GITHUB_DATA_BRANCH", "main")

# イベント名は固定リスト。年度(6月〜翌3月)ごとに月例イベント+懇親会を基本とし、
# 6月はキックオフ、11月は修学旅行、3月は同窓会という特別回。管理タブから編集可能。
DEFAULT_EVENTS = [
    "6月キックオフ", "6月懇親会",
    "7月月例イベント", "7月懇親会",
    "8月月例イベント", "8月懇親会",
    "9月月例イベント", "9月懇親会",
    "10月月例イベント", "10月懇親会",
    "11月修学旅行",
    "12月月例イベント", "12月懇親会",
    "1月月例イベント", "1月懇親会",
    "2月月例イベント", "2月懇親会",
    "3月同窓会", "3月懇親会",
]

DEFAULT_CONFIG = {
    "fiscal_year": FISCAL_YEAR,
    "start_month": f"{FISCAL_YEAR}/06",
    "end_month": f"{FISCAL_YEAR + 1}/03",
    "events": DEFAULT_EVENTS,
}

log = logging.getLogger("storage")

# 単一プロセス前提の排他制御。同時利用者数十人・書き込み頻度低ならこれで十分。
lock = asyncio.Lock()
_push_lock = asyncio.Lock()
_sha_cache: dict[str, str] = {}


def now_iso() -> str:
    return datetime.now(JST).isoformat(timespec="seconds")


def today() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")


def month_of(date_str: str) -> str:
    """'2026-06-07' -> '2026/06'(月はサーバー側で支払日から導出する)"""
    return date_str[:7].replace("-", "/")


def file_path(kind: str) -> Path:
    if kind == "config":
        return DATA_DIR / "config.json"
    if kind == "audit":
        return YEAR_DIR / "audit_log.jsonl"
    return YEAR_DIR / f"{kind}.json"


def read_json(kind: str) -> list[dict[str, Any]]:
    p = file_path(kind)
    if not p.exists():
        return []
    text = p.read_text(encoding="utf-8").strip()
    return json.loads(text) if text else []


def read_config() -> dict[str, Any]:
    p = file_path("config")
    if not p.exists():
        return dict(DEFAULT_CONFIG)
    return json.loads(p.read_text(encoding="utf-8"))


def write_config(cfg: dict[str, Any]) -> None:
    p = file_path("config")
    p.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    schedule_push(p)


def write_json(kind: str, records: list[dict[str, Any]]) -> None:
    p = file_path(kind)
    p.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    schedule_push(p)


def append_audit(entry: dict[str, Any]) -> None:
    p = file_path("audit")
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    schedule_push(p)


def read_audit() -> list[dict[str, Any]]:
    p = file_path("audit")
    if not p.exists():
        return []
    entries = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            entries.append(json.loads(line))
    return entries


def new_id(prefix: str, date_str: str, records: list[dict[str, Any]]) -> str:
    compact = date_str.replace("-", "")
    head = f"{prefix}_{compact}_"
    n = sum(1 for r in records if r["id"].startswith(head)) + 1
    return f"{prefix}_{compact}_{n:03d}"


# --- 領収書ファイル ---------------------------------------------------------------

def receipt_dir(expense_id: str) -> Path:
    return YEAR_DIR / "receipts" / expense_id


def receipt_path(expense_id: str, name: str) -> Path:
    return receipt_dir(expense_id) / name


def save_receipt(expense_id: str, name: str, content: bytes) -> None:
    d = receipt_dir(expense_id)
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_bytes(content)
    schedule_push(p)


def delete_receipt_file(expense_id: str, name: str) -> None:
    p = receipt_path(expense_id, name)
    if p.exists():
        p.unlink()
    schedule_delete(p)


async def init() -> None:
    """起動時: ディレクトリと初期ファイルを用意し、GitHub設定があれば取得する。"""
    YEAR_DIR.mkdir(parents=True, exist_ok=True)
    if GITHUB_TOKEN and GITHUB_REPO:
        await _pull_all()
    for kind in ("expenses", "incomes"):
        p = file_path(kind)
        if not p.exists():
            p.write_text("[]\n", encoding="utf-8")
    p = file_path("config")
    if not p.exists():
        p.write_text(
            json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


# --- GitHub 同期(任意) ---------------------------------------------------

def _gh_url(relpath: str) -> str:
    return f"https://api.github.com/repos/{GITHUB_REPO}/contents/data/{relpath}"


def _gh_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
    }


async def _pull_file(client, rel: str) -> bool:
    r = await client.get(_gh_url(rel), params={"ref": GITHUB_BRANCH}, headers=_gh_headers())
    if r.status_code != 200:
        return False
    data = r.json()
    local = DATA_DIR / rel
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_bytes(base64.b64decode(data["content"]))
    _sha_cache[rel] = data["sha"]
    log.info("GitHubから取得: %s", rel)
    return True


async def _pull_all() -> None:
    import httpx

    files = [
        f"{FISCAL_YEAR}/expenses.json",
        f"{FISCAL_YEAR}/incomes.json",
        f"{FISCAL_YEAR}/audit_log.jsonl",
        "config.json",
    ]
    async with httpx.AsyncClient(timeout=30) as client:
        for rel in files:
            try:
                await _pull_file(client, rel)
            except Exception:
                log.exception("GitHubからの取得に失敗: %s", rel)
        # 支出が参照している領収書ファイルも取得する(パスが分かるので一覧走査は不要)
        try:
            for exp in read_json("expenses"):
                for rc in exp.get("receipts", []):
                    rel = f"{FISCAL_YEAR}/receipts/{exp['id']}/{rc['name']}"
                    try:
                        await _pull_file(client, rel)
                    except Exception:
                        log.exception("領収書の取得に失敗: %s", rel)
        except Exception:
            log.exception("領収書一覧の解決に失敗")


def schedule_push(path: Path) -> None:
    if GITHUB_TOKEN and GITHUB_REPO:
        asyncio.get_event_loop().create_task(_push(path))


def schedule_delete(path: Path) -> None:
    if GITHUB_TOKEN and GITHUB_REPO:
        asyncio.get_event_loop().create_task(_delete(path))


async def _delete(path: Path) -> None:
    import httpx

    async with _push_lock:
        rel = str(path.relative_to(DATA_DIR))
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                sha: Optional[str] = _sha_cache.get(rel)
                if sha is None:
                    r = await client.get(_gh_url(rel), params={"ref": GITHUB_BRANCH}, headers=_gh_headers())
                    if r.status_code != 200:
                        return  # GitHub上に無ければ何もしない
                    sha = r.json().get("sha")
                r = await client.request(
                    "DELETE", _gh_url(rel), headers=_gh_headers(),
                    json={"message": f"delete {rel}", "sha": sha, "branch": GITHUB_BRANCH},
                )
                r.raise_for_status()
                _sha_cache.pop(rel, None)
        except Exception:
            log.exception("GitHubからの削除に失敗: %s", rel)


async def _push(path: Path) -> None:
    import httpx

    async with _push_lock:
        rel = str(path.relative_to(DATA_DIR))
        try:
            content = base64.b64encode(path.read_bytes()).decode()
            async with httpx.AsyncClient(timeout=30) as client:
                sha: Optional[str] = _sha_cache.get(rel)
                if sha is None:
                    r = await client.get(_gh_url(rel), params={"ref": GITHUB_BRANCH}, headers=_gh_headers())
                    if r.status_code == 200:
                        sha = r.json().get("sha")
                body: dict[str, Any] = {
                    "message": f"update {rel}",
                    "content": content,
                    "branch": GITHUB_BRANCH,
                }
                if sha:
                    body["sha"] = sha
                r = await client.put(_gh_url(rel), json=body, headers=_gh_headers())
                r.raise_for_status()
                _sha_cache[rel] = r.json()["content"]["sha"]
        except Exception:
            log.exception("GitHubへの同期に失敗: %s", rel)
