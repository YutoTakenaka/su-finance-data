"use client";

// 管理ページ(管理者のみ): CSVエクスポート、バックアップ、操作履歴の閲覧。
import { useEffect, useState } from "react";
import { api, downloadFile } from "@/lib/api";

interface AuditEntry {
  timestamp: string;
  operator: string;
  role: string;
  action: string;
  target_type: string;
  target_id: string;
  before: unknown;
  after: unknown;
}

const ACTION_LABELS: Record<string, string> = {
  create: "登録",
  update: "更新",
  delete: "削除",
  settle: "精算",
  upload_receipt: "領収書添付",
  delete_receipt: "領収書削除",
};

export default function AdminPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const [events, setEvents] = useState<string[]>([]);
  const [newEvent, setNewEvent] = useState("");
  const [eventError, setEventError] = useState("");

  useEffect(() => {
    api<{ items: AuditEntry[]; count: number }>("/audit?limit=100")
      .then((d) => {
        setEntries(d.items);
        setCount(d.count);
      })
      .catch((e: Error) => setError(e.message));
    api<{ events: string[] }>("/events")
      .then((d) => setEvents(d.events))
      .catch((e: Error) => setEventError(e.message));
  }, []);

  function dl(path: string, filename: string) {
    downloadFile(path, filename).catch((e: Error) => setError(e.message));
  }

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    const name = newEvent.trim();
    if (!name) return;
    setEventError("");
    try {
      const d = await api<{ events: string[] }>("/events", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setEvents(d.events);
      setNewEvent("");
    } catch (err) {
      setEventError((err as Error).message);
    }
  }

  async function renameEvent(old: string) {
    const next = window.prompt(`「${old}」を新しい名前に変更`, old);
    if (!next || next.trim() === old) return;
    setEventError("");
    try {
      const d = await api<{ events: string[] }>("/events", {
        method: "PATCH",
        body: JSON.stringify({ old_name: old, new_name: next.trim() }),
      });
      setEvents(d.events);
    } catch (err) {
      setEventError((err as Error).message);
    }
  }

  async function deleteEvent(name: string) {
    if (!window.confirm(`イベント「${name}」を削除しますか?`)) return;
    setEventError("");
    try {
      const d = await api<{ events: string[] }>(
        `/events?name=${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      setEvents(d.events);
    } catch (err) {
      setEventError((err as Error).message);
    }
  }

  const btn =
    "bg-white border border-gray-300 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium";

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-lg font-bold mb-1">イベント名の管理</h1>
        <p className="text-xs text-gray-500 mb-3">
          支出・収入の登録フォームで選べるイベント名の一覧です。名前の変更は既存レコードにも反映されます。
        </p>
        <form onSubmit={addEvent} className="flex gap-2 mb-3">
          <input
            className="flex-1 max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            placeholder="例: 12月特別イベント"
            value={newEvent}
            onChange={(e) => setNewEvent(e.target.value)}
          />
          <button className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
            追加
          </button>
        </form>
        {eventError && <p className="text-sm text-red-600 mb-2">{eventError}</p>}
        <div className="bg-white rounded-xl shadow-sm divide-y">
          {events.map((ev) => (
            <div key={ev} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{ev}</span>
              <span className="space-x-3">
                <button
                  onClick={() => renameEvent(ev)}
                  className="text-blue-600 hover:underline"
                >
                  名称変更
                </button>
                <button
                  onClick={() => deleteEvent(ev)}
                  className="text-red-600 hover:underline"
                >
                  削除
                </button>
              </span>
            </div>
          ))}
          {events.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-400">イベントがありません</p>
          )}
        </div>
      </section>

      <section>
        <h1 className="text-lg font-bold mb-3">エクスポート・バックアップ</h1>
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => dl("/export/expenses", "expenses.csv")}>
            支出CSV
          </button>
          <button className={btn} onClick={() => dl("/export/incomes", "incomes.csv")}>
            収入CSV
          </button>
          <button className={btn} onClick={() => dl("/export/audit", "audit_log.csv")}>
            操作履歴CSV
          </button>
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
            onClick={() => dl("/backup", "su-finance-backup.zip")}
          >
            JSON一式をバックアップ(ZIP)
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          CSVはUTF-8(BOM付き)なのでExcelでそのまま開けます。
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold mb-3">
          操作履歴
          {entries && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              全{count}件(最新100件を表示)
            </span>
          )}
        </h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-gray-500 border-b text-left">
                <th className="py-2 px-3">日時</th>
                <th>操作者</th>
                <th>ロール</th>
                <th>操作</th>
                <th>対象</th>
                <th className="text-right pr-3">変更内容</th>
              </tr>
            </thead>
            <tbody>
              {entries?.map((e, i) => (
                <tr key={i} className="border-b last:border-0 align-top hover:bg-gray-50">
                  <td className="py-2 px-3 whitespace-nowrap text-gray-500">
                    {e.timestamp.replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="whitespace-nowrap">{e.operator}</td>
                  <td className="whitespace-nowrap text-gray-500">
                    {e.role === "admin" ? "管理者" : "一般"}
                  </td>
                  <td className="whitespace-nowrap">
                    {ACTION_LABELS[e.action] ?? e.action}
                  </td>
                  <td className="whitespace-nowrap text-gray-500">{e.target_id}</td>
                  <td className="text-right pr-3">
                    <button
                      className="text-blue-600 hover:underline"
                      onClick={() => setOpenIdx(openIdx === i ? null : i)}
                    >
                      {openIdx === i ? "閉じる" : "表示"}
                    </button>
                    {openIdx === i && (
                      <pre className="text-left text-xs bg-gray-50 rounded p-2 mt-1 max-w-md overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              ))}
              {entries && entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-400">
                    まだ操作履歴がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
