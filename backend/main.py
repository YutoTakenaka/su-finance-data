"""Surprise University - Project 収支管理アプリ バックエンドAPI。

認証・CRUD・集計・CSV出力・監査ログをすべてこのファイルで提供する。
データはJSONファイル(storage.py)で管理し、DBは使わない。
"""
from __future__ import annotations

import csv
import io
import os
import secrets
import time
import zipfile
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

import storage

ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "su-admin")
MEMBER_USER = os.environ.get("MEMBER_USER", "member")
MEMBER_PASSWORD = os.environ.get("MEMBER_PASSWORD", "su-member")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await storage.init()
    yield


app = FastAPI(title="Surprise University - Project 収支管理API", lifespan=lifespan)

# 認証はAuthorizationヘッダのみ(Cookie不使用)なので全オリジン許可で問題ない
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 認証 -------------------------------------------------------------------

security = HTTPBasic()


def _match(cred: HTTPBasicCredentials, user: str, password: str) -> bool:
    return secrets.compare_digest(cred.username, user) and secrets.compare_digest(
        cred.password, password
    )


def get_role(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    if _match(credentials, ADMIN_USER, ADMIN_PASSWORD):
        return "admin"
    if _match(credentials, MEMBER_USER, MEMBER_PASSWORD):
        return "member"
    raise HTTPException(status_code=401, detail="IDまたはパスワードが違います")


def require_admin(role: str = Depends(get_role)) -> str:
    if role != "admin":
        raise HTTPException(status_code=403, detail="管理者のみ実行できます")
    return role


# --- スキーマ -----------------------------------------------------------------

DATE_RE = r"^\d{4}-\d{2}-\d{2}$"


class ExpenseIn(BaseModel):
    date: str = Field(pattern=DATE_RE)
    event: str = Field(min_length=1)
    payer: str = Field(min_length=1)
    description: str = Field(min_length=1)
    amount: int = Field(gt=0)
    status: Literal["unsettled", "settled"] = "unsettled"
    settled_date: Optional[str] = None
    note: str = ""
    operator: str = ""


class ExpensePatch(BaseModel):
    date: Optional[str] = Field(default=None, pattern=DATE_RE)
    event: Optional[str] = None
    payer: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[int] = Field(default=None, gt=0)
    status: Optional[Literal["unsettled", "settled"]] = None
    settled_date: Optional[str] = None
    note: Optional[str] = None
    operator: str = ""


class IncomeIn(BaseModel):
    date: str = Field(pattern=DATE_RE)
    event: str = Field(min_length=1)
    payer: str = Field(min_length=1)
    amount: int = Field(gt=0)
    confirmed: bool = False
    note: str = ""
    operator: str = ""


class IncomePatch(BaseModel):
    date: Optional[str] = Field(default=None, pattern=DATE_RE)
    event: Optional[str] = None
    payer: Optional[str] = None
    amount: Optional[int] = Field(default=None, gt=0)
    confirmed: Optional[bool] = None
    note: Optional[str] = None
    operator: str = ""


class EventIn(BaseModel):
    name: str = Field(min_length=1)


class EventRename(BaseModel):
    old_name: str = Field(min_length=1)
    new_name: str = Field(min_length=1)


class SettleIn(BaseModel):
    ids: list[str]
    operator: str = ""


# --- 共通ヘルパー ---------------------------------------------------------------

# 収入は一般メンバーが更新できるフィールドを入金確認のみに絞る(他は管理者のみ)。
# 支出は一般メンバーも全項目を更新できる(削除だけ管理者)。
MEMBER_INCOME_FIELDS = {"confirmed"}


def active(records: list[dict]) -> list[dict]:
    return [r for r in records if not r.get("deleted")]


def fiscal_months() -> list[str]:
    cfg = storage.read_config()
    start_y, start_m = map(int, cfg["start_month"].split("/"))
    end_y, end_m = map(int, cfg["end_month"].split("/"))
    months = []
    y, m = start_y, start_m
    while (y, m) <= (end_y, end_m):
        months.append(f"{y}/{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return months


def audit(operator: str, role: str, action: str, target_type: str, target_id: str,
          before: Any, after: Any) -> None:
    storage.append_audit({
        "timestamp": storage.now_iso(),
        "operator": operator or "(未入力)",
        "role": role,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "before": before,
        "after": after,
    })


def find_record(records: list[dict], rec_id: str) -> dict:
    for r in records:
        if r["id"] == rec_id and not r.get("deleted"):
            return r
    raise HTTPException(status_code=404, detail="レコードが見つかりません")


# --- 認証・設定 -----------------------------------------------------------------

@app.post("/login")
def login(role: str = Depends(get_role)):
    return {"role": role}


@app.get("/config")
def get_config(role: str = Depends(get_role)):
    cfg = storage.read_config()
    expenses = active(storage.read_json("expenses"))
    incomes = active(storage.read_json("incomes"))
    # イベントは管理タブで管理する固定リスト。人名は入力補完用に実績から拾う。
    payers: list[str] = []
    for r in expenses + incomes:
        if r["payer"] not in payers:
            payers.append(r["payer"])
    return {
        "fiscal_year": cfg["fiscal_year"],
        "months": fiscal_months(),
        "events": list(cfg.get("events", [])),
        "payers": sorted(payers),
    }


# --- イベント名管理(管理者のみ) ----------------------------------------------------

@app.get("/events")
def list_events(role: str = Depends(get_role)):
    return {"events": list(storage.read_config().get("events", []))}


@app.post("/events", status_code=201)
async def create_event(body: EventIn, role: str = Depends(require_admin)):
    name = body.name.strip()
    async with storage.lock:
        cfg = storage.read_config()
        events = list(cfg.get("events", []))
        if name in events:
            raise HTTPException(status_code=409, detail="同じ名前のイベントが既にあります")
        events.append(name)
        cfg["events"] = events
        storage.write_config(cfg)
        audit(name, role, "create", "event", name, None, {"name": name})
    return {"events": events}


@app.patch("/events")
async def rename_event(body: EventRename, role: str = Depends(require_admin)):
    old, new = body.old_name.strip(), body.new_name.strip()
    async with storage.lock:
        cfg = storage.read_config()
        events = list(cfg.get("events", []))
        if old not in events:
            raise HTTPException(status_code=404, detail="対象のイベントがありません")
        if new != old and new in events:
            raise HTTPException(status_code=409, detail="同じ名前のイベントが既にあります")
        events[events.index(old)] = new
        cfg["events"] = events
        storage.write_config(cfg)
        # 既存レコードのイベント名も追従させ、集計が分裂しないようにする
        for kind in ("expenses", "incomes"):
            records = storage.read_json(kind)
            changed = False
            for r in records:
                if r["event"] == old:
                    r["event"] = new
                    r["updated_at"] = storage.now_iso()
                    changed = True
            if changed:
                storage.write_json(kind, records)
        audit(new, role, "update", "event", old, {"name": old}, {"name": new})
    return {"events": events}


@app.delete("/events")
async def delete_event(name: str, role: str = Depends(require_admin)):
    name = name.strip()
    async with storage.lock:
        cfg = storage.read_config()
        events = list(cfg.get("events", []))
        if name not in events:
            raise HTTPException(status_code=404, detail="対象のイベントがありません")
        # 既存レコードが参照している場合は、集計が壊れるので削除させない
        for kind in ("expenses", "incomes"):
            if any(r["event"] == name for r in active(storage.read_json(kind))):
                raise HTTPException(
                    status_code=409,
                    detail="このイベントを使っているレコードがあるため削除できません",
                )
        events.remove(name)
        cfg["events"] = events
        storage.write_config(cfg)
        audit(name, role, "delete", "event", name, {"name": name}, None)
    return {"events": events}


# --- 支出(立替) ----------------------------------------------------------------

@app.get("/expenses")
async def list_expenses(
    month: Optional[str] = None,
    payer: Optional[str] = None,
    status: Optional[Literal["unsettled", "settled"]] = None,
    event: Optional[str] = None,
    role: str = Depends(get_role),
):
    async with storage.lock:
        records = active(storage.read_json("expenses"))
    if month:
        records = [r for r in records if r["month"] == month]
    if payer:
        records = [r for r in records if r["payer"] == payer]
    if status:
        records = [r for r in records if r["status"] == status]
    if event:
        records = [r for r in records if r["event"] == event]
    records.sort(key=lambda r: (r["date"], r["id"]), reverse=True)
    return {
        "items": records,
        "count": len(records),
        "total": sum(r["amount"] for r in records),
    }


@app.post("/expenses", status_code=201)
async def create_expense(body: ExpenseIn, role: str = Depends(get_role)):
    async with storage.lock:
        records = storage.read_json("expenses")
        now = storage.now_iso()
        rec = {
            "id": storage.new_id("exp", body.date, records),
            "date": body.date,
            "month": storage.month_of(body.date),
            "event": body.event.strip(),
            "payer": body.payer.strip(),
            "description": body.description.strip(),
            "amount": body.amount,
            "status": body.status,
            "settled_date": body.settled_date if body.status == "settled" else None,
            "note": body.note,
            "receipts": [],  # 領収書ファイルのメタ情報リスト
            "deleted": False,
            "created_at": now,
            "updated_at": now,
        }
        if rec["status"] == "settled" and not rec["settled_date"]:
            rec["settled_date"] = storage.today()
        records.append(rec)
        storage.write_json("expenses", records)
        audit(body.operator, role, "create", "expense", rec["id"], None, rec)
    return rec


@app.patch("/expenses/{rec_id}")
async def update_expense(rec_id: str, body: ExpensePatch, role: str = Depends(get_role)):
    updates = body.model_dump(exclude_unset=True, exclude={"operator"})
    if not updates:
        raise HTTPException(status_code=400, detail="更新内容がありません")
    async with storage.lock:
        records = storage.read_json("expenses")
        rec = find_record(records, rec_id)
        before = dict(rec)
        rec.update(updates)
        if "date" in updates:
            rec["month"] = storage.month_of(rec["date"])
        if updates.get("status") == "settled" and not rec.get("settled_date"):
            rec["settled_date"] = storage.today()
        if updates.get("status") == "unsettled":
            rec["settled_date"] = None
        rec["updated_at"] = storage.now_iso()
        storage.write_json("expenses", records)
        audit(body.operator, role, "update", "expense", rec_id, before, rec)
    return rec


@app.delete("/expenses/{rec_id}")
async def delete_expense(rec_id: str, operator: str = "", role: str = Depends(require_admin)):
    async with storage.lock:
        records = storage.read_json("expenses")
        rec = find_record(records, rec_id)
        before = dict(rec)
        rec["deleted"] = True  # 論理削除。履歴から復元可能な状態を保つ
        rec["updated_at"] = storage.now_iso()
        storage.write_json("expenses", records)
        audit(operator, role, "delete", "expense", rec_id, before, rec)
    return {"ok": True}


# --- 領収書(支出のエビデンス添付) --------------------------------------------------

# 許可する拡張子とContent-Type(PDFと主な画像フォーマット)
RECEIPT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
}
MAX_RECEIPT_BYTES = 15 * 1024 * 1024  # 1ファイル15MBまで


@app.post("/expenses/{rec_id}/receipts")
async def upload_receipts(
    rec_id: str,
    files: list[UploadFile] = File(...),
    operator: str = "",
    role: str = Depends(get_role),
):
    async with storage.lock:
        records = storage.read_json("expenses")
        rec = find_record(records, rec_id)
        before = dict(rec)
        added = []
        for up in files:
            ext = os.path.splitext(up.filename or "")[1].lower()
            if ext not in RECEIPT_TYPES:
                raise HTTPException(
                    status_code=415,
                    detail=f"対応していないファイル形式です: {up.filename}(PDF・画像のみ)",
                )
            content = await up.read()
            if len(content) > MAX_RECEIPT_BYTES:
                raise HTTPException(status_code=413, detail=f"ファイルが大きすぎます(15MBまで): {up.filename}")
            stored = f"{int(time.time() * 1000)}_{secrets.token_hex(3)}{ext}"
            storage.save_receipt(rec_id, stored, content)
            meta = {
                "name": stored,
                "original": up.filename or stored,
                "content_type": RECEIPT_TYPES[ext],
                "size": len(content),
                "uploaded_at": storage.now_iso(),
            }
            rec.setdefault("receipts", []).append(meta)
            added.append(meta)
        rec["updated_at"] = storage.now_iso()
        storage.write_json("expenses", records)
        audit(operator or rec["payer"], role, "upload_receipt", "expense", rec_id,
              before, {"added": [m["original"] for m in added]})
    return rec


@app.get("/expenses/{rec_id}/receipts/{name}")
async def get_receipt(rec_id: str, name: str, role: str = Depends(get_role)):
    if "/" in name or ".." in name:  # パストラバーサル対策
        raise HTTPException(status_code=400, detail="不正なファイル名です")
    async with storage.lock:
        records = storage.read_json("expenses")
        rec = find_record(records, rec_id)
        meta = next((m for m in rec.get("receipts", []) if m["name"] == name), None)
        if meta is None:
            raise HTTPException(status_code=404, detail="領収書が見つかりません")
        path = storage.receipt_path(rec_id, name)
        if not path.exists():
            raise HTTPException(status_code=404, detail="ファイルの実体がありません")
        data = path.read_bytes()
    return Response(content=data, media_type=meta.get("content_type", "application/octet-stream"))


@app.delete("/expenses/{rec_id}/receipts/{name}")
async def delete_receipt(rec_id: str, name: str, operator: str = "", role: str = Depends(get_role)):
    if "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="不正なファイル名です")
    async with storage.lock:
        records = storage.read_json("expenses")
        rec = find_record(records, rec_id)
        receipts = rec.get("receipts", [])
        meta = next((m for m in receipts if m["name"] == name), None)
        if meta is None:
            raise HTTPException(status_code=404, detail="領収書が見つかりません")
        receipts.remove(meta)
        storage.delete_receipt_file(rec_id, name)
        rec["updated_at"] = storage.now_iso()
        storage.write_json("expenses", records)
        audit(operator or rec["payer"], role, "delete_receipt", "expense", rec_id,
              {"removed": meta["original"]}, None)
    return rec


# --- 収入(集金) ----------------------------------------------------------------

@app.get("/incomes")
async def list_incomes(
    month: Optional[str] = None,
    payer: Optional[str] = None,
    confirmed: Optional[bool] = None,
    event: Optional[str] = None,
    role: str = Depends(get_role),
):
    async with storage.lock:
        records = active(storage.read_json("incomes"))
    if month:
        records = [r for r in records if r["month"] == month]
    if payer:
        records = [r for r in records if r["payer"] == payer]
    if confirmed is not None:
        records = [r for r in records if r["confirmed"] == confirmed]
    if event:
        records = [r for r in records if r["event"] == event]
    records.sort(key=lambda r: (r["date"], r["id"]), reverse=True)
    return {
        "items": records,
        "count": len(records),
        "total": sum(r["amount"] for r in records),
    }


@app.post("/incomes", status_code=201)
async def create_income(body: IncomeIn, role: str = Depends(get_role)):
    async with storage.lock:
        records = storage.read_json("incomes")
        now = storage.now_iso()
        rec = {
            "id": storage.new_id("inc", body.date, records),
            "date": body.date,
            "month": storage.month_of(body.date),
            "event": body.event.strip(),
            "payer": body.payer.strip(),
            "amount": body.amount,
            "confirmed": body.confirmed,
            "note": body.note,
            "deleted": False,
            "created_at": now,
            "updated_at": now,
        }
        records.append(rec)
        storage.write_json("incomes", records)
        audit(body.operator, role, "create", "income", rec["id"], None, rec)
    return rec


@app.patch("/incomes/{rec_id}")
async def update_income(rec_id: str, body: IncomePatch, role: str = Depends(get_role)):
    updates = body.model_dump(exclude_unset=True, exclude={"operator"})
    if not updates:
        raise HTTPException(status_code=400, detail="更新内容がありません")
    if role == "member" and set(updates) - MEMBER_INCOME_FIELDS:
        raise HTTPException(status_code=403, detail="一般メンバーは入金確認のみ変更できます")
    async with storage.lock:
        records = storage.read_json("incomes")
        rec = find_record(records, rec_id)
        before = dict(rec)
        rec.update(updates)
        if "date" in updates:
            rec["month"] = storage.month_of(rec["date"])
        rec["updated_at"] = storage.now_iso()
        storage.write_json("incomes", records)
        audit(body.operator, role, "update", "income", rec_id, before, rec)
    return rec


@app.delete("/incomes/{rec_id}")
async def delete_income(rec_id: str, operator: str = "", role: str = Depends(require_admin)):
    async with storage.lock:
        records = storage.read_json("incomes")
        rec = find_record(records, rec_id)
        before = dict(rec)
        rec["deleted"] = True
        rec["updated_at"] = storage.now_iso()
        storage.write_json("incomes", records)
        audit(operator, role, "delete", "income", rec_id, before, rec)
    return {"ok": True}


# --- 精算 -----------------------------------------------------------------------

@app.get("/settlement")
async def settlement_list(role: str = Depends(require_admin)):
    """未精算の立替を人別に集計した「誰にいくら渡すべきか」一覧。"""
    async with storage.lock:
        records = [r for r in active(storage.read_json("expenses")) if r["status"] == "unsettled"]
    groups: dict[str, dict] = {}
    for r in sorted(records, key=lambda r: r["date"]):
        g = groups.setdefault(r["payer"], {"payer": r["payer"], "count": 0, "total": 0, "items": []})
        g["count"] += 1
        g["total"] += r["amount"]
        g["items"].append(r)
    result = sorted(groups.values(), key=lambda g: -g["total"])
    return {"groups": result, "total": sum(g["total"] for g in result)}


@app.post("/settlement/settle")
async def settle(body: SettleIn, role: str = Depends(require_admin)):
    """選択したレコードを一括で「精算済+精算日自動記録」にする。"""
    settled = []
    async with storage.lock:
        records = storage.read_json("expenses")
        by_id = {r["id"]: r for r in records if not r.get("deleted")}
        for rec_id in body.ids:
            rec = by_id.get(rec_id)
            if rec is None or rec["status"] == "settled":
                continue
            before = dict(rec)
            rec["status"] = "settled"
            rec["settled_date"] = storage.today()
            rec["updated_at"] = storage.now_iso()
            # 精算対象の立替者名を操作者として記録する
            audit(body.operator or rec["payer"], role, "settle", "expense", rec_id, before, rec)
            settled.append(rec_id)
        storage.write_json("expenses", records)
    return {"settled": settled, "count": len(settled)}


# --- ダッシュボード用集計 ----------------------------------------------------------

@app.get("/summary")
async def summary(role: str = Depends(get_role)):
    async with storage.lock:
        expenses = active(storage.read_json("expenses"))
        incomes = active(storage.read_json("incomes"))
    confirmed_incomes = [r for r in incomes if r["confirmed"]]

    # アラート: 未精算の立替(人別)と未確認の入金
    unsettled = [r for r in expenses if r["status"] == "unsettled"]
    unconfirmed = [r for r in incomes if not r["confirmed"]]

    def group_by_payer(records: list[dict]) -> list[dict]:
        groups: dict[str, dict] = {}
        for r in records:
            g = groups.setdefault(r["payer"], {"payer": r["payer"], "count": 0, "amount": 0})
            g["count"] += 1
            g["amount"] += r["amount"]
        return sorted(groups.values(), key=lambda g: -g["amount"])

    # 資金状況カード
    income_confirmed = sum(r["amount"] for r in confirmed_incomes)
    expense_total = sum(r["amount"] for r in expenses)
    expense_settled = sum(r["amount"] for r in expenses if r["status"] == "settled")
    unsettled_amount = sum(r["amount"] for r in unsettled)

    # 月別収支(確認済み収入のみ計上)
    monthly = []
    cumulative = 0
    for month in fiscal_months():
        inc = sum(r["amount"] for r in confirmed_incomes if r["month"] == month)
        exp = sum(r["amount"] for r in expenses if r["month"] == month)
        net = inc - exp
        cumulative += net
        monthly.append({
            "month": month,
            "income": inc,
            "expense": exp,
            "net": net,
            "cumulative": cumulative,
            "net_rate": round(net / inc * 100, 1) if inc > 0 else None,
        })

    # イベント別収支
    events: dict[str, dict] = {}
    for r in confirmed_incomes:
        e = events.setdefault(r["event"], {"event": r["event"], "income": 0, "expense": 0})
        e["income"] += r["amount"]
    for r in expenses:
        e = events.setdefault(r["event"], {"event": r["event"], "income": 0, "expense": 0})
        e["expense"] += r["amount"]
    by_event = []
    for e in events.values():
        e["net"] = e["income"] - e["expense"]
        by_event.append(e)
    by_event.sort(key=lambda e: -(e["income"] + e["expense"]))

    return {
        "alerts": {
            "unsettled": group_by_payer(unsettled),
            "unsettled_count": len(unsettled),
            "unsettled_amount": unsettled_amount,
            "unconfirmed": group_by_payer(unconfirmed),
            "unconfirmed_count": len(unconfirmed),
            "unconfirmed_amount": sum(r["amount"] for r in unconfirmed),
        },
        "cards": {
            "income_confirmed": income_confirmed,
            "expense_total": expense_total,
            "net": income_confirmed - expense_total,
            "expense_settled": expense_settled,
            "unsettled_amount": unsettled_amount,
            "cash_on_hand": income_confirmed - expense_settled,
        },
        "monthly": monthly,
        "by_event": by_event,
    }


# --- エクスポート・監査ログ・バックアップ(管理者のみ) --------------------------------------

def csv_response(rows: list[list], filename: str) -> Response:
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    # ExcelでそのままUTF-8として開けるようBOMを付ける
    data = "\ufeff" + buf.getvalue()
    return Response(
        content=data.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/export/expenses")
async def export_expenses(role: str = Depends(require_admin)):
    async with storage.lock:
        records = active(storage.read_json("expenses"))
    rows = [["ID", "支払日", "月", "イベント名", "支払者", "支払内容", "金額", "精算状況", "精算日", "備考"]]
    for r in sorted(records, key=lambda r: r["date"]):
        rows.append([
            r["id"], r["date"], r["month"], r["event"], r["payer"], r["description"],
            r["amount"], "精算済" if r["status"] == "settled" else "未精算",
            r.get("settled_date") or "", r.get("note", ""),
        ])
    return csv_response(rows, "expenses.csv")


@app.get("/export/incomes")
async def export_incomes(role: str = Depends(require_admin)):
    async with storage.lock:
        records = active(storage.read_json("incomes"))
    rows = [["ID", "入金日", "月", "イベント名", "入金者", "金額", "入金確認", "備考"]]
    for r in sorted(records, key=lambda r: r["date"]):
        rows.append([
            r["id"], r["date"], r["month"], r["event"], r["payer"], r["amount"],
            "確認済" if r["confirmed"] else "未確認", r.get("note", ""),
        ])
    return csv_response(rows, "incomes.csv")


@app.get("/export/audit")
async def export_audit(role: str = Depends(require_admin)):
    async with storage.lock:
        entries = storage.read_audit()
    rows = [["日時", "操作者", "ロール", "操作種別", "対象", "対象ID", "変更前", "変更後"]]
    import json as _json
    for e in entries:
        rows.append([
            e["timestamp"], e["operator"], e["role"], e["action"], e["target_type"],
            e["target_id"],
            _json.dumps(e["before"], ensure_ascii=False) if e["before"] else "",
            _json.dumps(e["after"], ensure_ascii=False) if e["after"] else "",
        ])
    return csv_response(rows, "audit_log.csv")


@app.get("/audit")
async def list_audit(limit: int = Query(default=100, le=1000), role: str = Depends(require_admin)):
    async with storage.lock:
        entries = storage.read_audit()
    entries.reverse()  # 新しい順
    return {"items": entries[:limit], "count": len(entries)}


@app.get("/backup")
async def backup(role: str = Depends(require_admin)):
    """JSON一式をZIPでダウンロード(ワンクリックバックアップ)。"""
    buf = io.BytesIO()
    async with storage.lock:
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in sorted(storage.DATA_DIR.rglob("*")):
                if p.is_file():
                    zf.write(p, arcname=str(p.relative_to(storage.DATA_DIR)))
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="su-finance-backup.zip"'},
    )
