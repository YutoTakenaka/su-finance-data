"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import {
  api,
  AppConfig,
  Expense,
  getAuth,
  ListResponse,
  openReceipt,
  uploadReceipts,
  yen,
} from "@/lib/api";

const EMPTY_FORM = {
  date: "",
  event: "",
  payer: "",
  description: "",
  amount: "",
  note: "",
};

export default function ExpensesPage() {
  return (
    <Suspense>
      <ExpensesInner />
    </Suspense>
  );
}

function ExpensesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const auth = getAuth();
  const isAdmin = auth?.role === "admin";

  const month = params.get("month") ?? "";
  const payer = params.get("payer") ?? "";
  const status = params.get("status") ?? "";
  const event = params.get("event") ?? "";

  const [data, setData] = useState<ListResponse<Expense> | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [openReceiptsId, setOpenReceiptsId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (month) q.set("month", month);
    if (payer) q.set("payer", payer);
    if (status) q.set("status", status);
    if (event) q.set("event", event);
    api<ListResponse<Expense>>(`/expenses?${q}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [month, payer, status, event]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<AppConfig>("/config").then(setConfig).catch(() => {});
  }, []);

  function setFilter(key: string, value: string) {
    const q = new URLSearchParams(params.toString());
    if (value) q.set(key, value);
    else q.delete(key);
    router.replace(`/expenses?${q}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const body = {
      date: form.date,
      event: form.event.trim(),
      payer: form.payer.trim(),
      description: form.description.trim(),
      amount: Number(form.amount),
      note: form.note,
      operator: form.payer.trim(), // 登録時に入力した名前を操作者として記録
    };
    try {
      if (editingId) {
        await api(`/expenses/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api("/expenses", { method: "POST", body: JSON.stringify(body) });
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleStatus(rec: Expense) {
    setError("");
    try {
      await api(`/expenses/${rec.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: rec.status === "settled" ? "unsettled" : "settled",
          operator: rec.payer,
        }),
      });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(rec: Expense) {
    if (!confirm(`「${rec.description}」(${yen(rec.amount)})を削除しますか?`)) return;
    setError("");
    try {
      await api(
        `/expenses/${rec.id}?operator=${encodeURIComponent(rec.payer)}`,
        { method: "DELETE" },
      );
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function uploadFor(rec: Expense, files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setUploadingId(rec.id);
    try {
      await uploadReceipts(`/expenses/${rec.id}/receipts`, files);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingId(null);
    }
  }

  async function viewReceipt(rec: Expense, name: string) {
    setError("");
    try {
      await openReceipt(`/expenses/${rec.id}/receipts/${encodeURIComponent(name)}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeReceipt(rec: Expense, name: string, original: string) {
    if (!confirm(`領収書「${original}」を削除しますか?`)) return;
    setError("");
    try {
      await api(`/expenses/${rec.id}/receipts/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEdit(rec: Expense) {
    setEditingId(rec.id);
    setForm({
      date: rec.date,
      event: rec.event,
      payer: rec.payer,
      description: rec.description,
      amount: String(rec.amount),
      note: rec.note,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const input =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">支出(立替)</h1>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
            setForm(EMPTY_FORM);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
        >
          {showForm ? "閉じる" : "+ 立替を登録"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showForm && (
        <form
          onSubmit={submit}
          className="bg-white rounded-xl shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 gap-3"
        >
          <p className="col-span-2 md:col-span-3 text-sm font-medium">
            {editingId ? `編集中: ${editingId}` : "新規登録"}
          </p>
          <label className="text-xs text-gray-600">
            支払日
            <input
              type="date"
              required
              className={input}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-600">
            イベント名
            <select
              required
              className={input}
              value={form.event}
              onChange={(e) => setForm({ ...form, event: e.target.value })}
            >
              <option value="" disabled>
                選択してください
              </option>
              {config?.events.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            支払者名
            <input
              required
              list="payer-list"
              className={input}
              value={form.payer}
              onChange={(e) => setForm({ ...form, payer: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-600">
            支払内容
            <input
              required
              className={input}
              placeholder="例: 会場費"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-600">
            金額(円)
            <input
              type="number"
              required
              min={1}
              className={input}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-600">
            備考
            <input
              className={input}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <datalist id="payer-list">
            {config?.payers.map((p) => <option key={p} value={p} />)}
          </datalist>
          <div className="col-span-2 md:col-span-3">
            <button className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-6 py-2 text-sm font-medium">
              {editingId ? "更新する" : "登録する"}
            </button>
          </div>
        </form>
      )}

      {/* フィルタ(月 × 人 × 精算状況 × イベント、URLに反映) */}
      <div className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap gap-2 items-center">
        <select className={`${input} !w-auto`} value={month} onChange={(e) => setFilter("month", e.target.value)}>
          <option value="">全ての月</option>
          {config?.months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select className={`${input} !w-auto`} value={payer} onChange={(e) => setFilter("payer", e.target.value)}>
          <option value="">全ての支払者</option>
          {config?.payers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select className={`${input} !w-auto`} value={status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">全ての精算状況</option>
          <option value="unsettled">未精算</option>
          <option value="settled">精算済</option>
        </select>
        <select className={`${input} !w-auto`} value={event} onChange={(e) => setFilter("event", e.target.value)}>
          <option value="">全てのイベント</option>
          {config?.events.map((ev) => (
            <option key={ev} value={ev}>{ev}</option>
          ))}
        </select>
        <button
          onClick={() => setFilter("status", status === "unsettled" ? "" : "unsettled")}
          className={`rounded-full px-3 py-1.5 text-sm border ${
            status === "unsettled"
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-red-700 border-red-300 hover:bg-red-50"
          }`}
        >
          未精算のみ
        </button>
        {(month || payer || status || event) && (
          <button
            onClick={() => router.replace("/expenses")}
            className="text-sm text-gray-500 underline"
          >
            クリア
          </button>
        )}
      </div>

      {/* 絞り込み条件での合計 */}
      {data && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm flex justify-between">
          <span className="text-blue-800">
            {data.count}件
            {(month || payer || status || event) && "(絞り込み中)"}
          </span>
          <span className="font-bold text-blue-900">合計 {yen(data.total)}</span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-gray-500 border-b text-left">
              <th className="py-2 px-3">支払日</th>
              <th>イベント</th>
              <th>支払者</th>
              <th>内容</th>
              <th className="text-right">金額</th>
              <th className="text-center">精算</th>
              <th>精算日</th>
              <th className="text-center">領収書</th>
              <th className="text-right pr-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <Fragment key={r.id}>
              <tr className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-2 px-3 whitespace-nowrap">{r.date}</td>
                <td>{r.event}</td>
                <td className="whitespace-nowrap">{r.payer}</td>
                <td>
                  {r.description}
                  {r.note && <span className="text-xs text-gray-400 block">{r.note}</span>}
                </td>
                <td className="text-right font-medium whitespace-nowrap">{yen(r.amount)}</td>
                <td className="text-center">
                  <button
                    onClick={() => toggleStatus(r)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      r.status === "settled"
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-700"
                    }`}
                    title="タップで切り替え"
                  >
                    {r.status === "settled" ? "精算済" : "未精算"}
                  </button>
                </td>
                <td className="whitespace-nowrap text-gray-500">{r.settled_date ?? "−"}</td>
                <td className="text-center whitespace-nowrap">
                  <button
                    onClick={() =>
                      setOpenReceiptsId(openReceiptsId === r.id ? null : r.id)
                    }
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      (r.receipts?.length ?? 0) > 0
                        ? "bg-blue-100 text-blue-800"
                        : "bg-gray-100 text-gray-500"
                    }`}
                    title="領収書の表示・添付"
                  >
                    📎 {r.receipts?.length ?? 0}
                  </button>
                </td>
                <td className="text-right pr-3 whitespace-nowrap">
                  {isAdmin && (
                    <>
                      <button onClick={() => startEdit(r)} className="text-blue-600 hover:underline mr-2">
                        編集
                      </button>
                      <button onClick={() => remove(r)} className="text-red-600 hover:underline">
                        削除
                      </button>
                    </>
                  )}
                </td>
              </tr>
              {openReceiptsId === r.id && (
                  <tr className="bg-blue-50/40 border-b">
                    <td colSpan={9} className="px-4 py-3">
                      <p className="text-xs font-medium text-gray-600 mb-2">
                        領収書(エビデンス)— {r.description}
                      </p>
                      {(r.receipts?.length ?? 0) === 0 && (
                        <p className="text-xs text-gray-400 mb-2">
                          まだ添付されていません
                        </p>
                      )}
                      <ul className="space-y-1 mb-3">
                        {r.receipts?.map((rc) => (
                          <li key={rc.name} className="flex items-center gap-3 text-sm">
                            <button
                              onClick={() => viewReceipt(r, rc.name)}
                              className="text-blue-600 hover:underline"
                            >
                              {rc.content_type === "application/pdf" ? "📄" : "🖼"}{" "}
                              {rc.original}
                            </button>
                            <span className="text-xs text-gray-400">
                              {Math.round(rc.size / 1024)}KB
                            </span>
                            <button
                              onClick={() => removeReceipt(r, rc.name, rc.original)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              削除
                            </button>
                          </li>
                        ))}
                      </ul>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <span className="bg-white border border-gray-300 hover:bg-gray-50 rounded-lg px-3 py-1.5 cursor-pointer">
                          {uploadingId === r.id ? "アップロード中..." : "+ ファイルを添付"}
                        </span>
                        <input
                          type="file"
                          multiple
                          accept=".pdf,image/*"
                          className="hidden"
                          disabled={uploadingId === r.id}
                          onChange={(e) => {
                            uploadFor(r, e.target.files);
                            e.target.value = "";
                          }}
                        />
                        <span className="text-xs text-gray-400">
                          PDF・画像(1ファイル15MBまで)
                        </span>
                      </label>
                    </td>
                  </tr>
              )}
              </Fragment>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-gray-400">
                  該当するレコードがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
