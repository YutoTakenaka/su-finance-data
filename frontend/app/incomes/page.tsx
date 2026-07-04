"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  api,
  AppConfig,
  getAuth,
  Income,
  ListResponse,
  yen,
} from "@/lib/api";

const EMPTY_FORM = {
  date: "",
  event: "",
  payer: "",
  amount: "",
  note: "",
};

export default function IncomesPage() {
  return (
    <Suspense>
      <IncomesInner />
    </Suspense>
  );
}

function IncomesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const auth = getAuth();
  const isAdmin = auth?.role === "admin";

  const month = params.get("month") ?? "";
  const payer = params.get("payer") ?? "";
  const confirmed = params.get("confirmed") ?? ""; // "" | "true" | "false"
  const event = params.get("event") ?? "";

  const [data, setData] = useState<ListResponse<Income> | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (month) q.set("month", month);
    if (payer) q.set("payer", payer);
    if (confirmed) q.set("confirmed", confirmed);
    if (event) q.set("event", event);
    api<ListResponse<Income>>(`/incomes?${q}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [month, payer, confirmed, event]);

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
    router.replace(`/incomes?${q}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const body = {
      date: form.date,
      event: form.event.trim(),
      payer: form.payer.trim(),
      amount: Number(form.amount),
      note: form.note,
      operator: form.payer.trim(), // 登録時に入力した名前を操作者として記録
    };
    try {
      if (editingId) {
        await api(`/incomes/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api("/incomes", { method: "POST", body: JSON.stringify(body) });
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleConfirmed(rec: Income) {
    setError("");
    try {
      await api(`/incomes/${rec.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          confirmed: !rec.confirmed,
          operator: rec.payer,
        }),
      });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(rec: Income) {
    if (!confirm(`${rec.payer} の入金(${yen(rec.amount)})を削除しますか?`)) return;
    setError("");
    try {
      await api(
        `/incomes/${rec.id}?operator=${encodeURIComponent(rec.payer)}`,
        { method: "DELETE" },
      );
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEdit(rec: Income) {
    setEditingId(rec.id);
    setForm({
      date: rec.date,
      event: rec.event,
      payer: rec.payer,
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
        <h1 className="text-lg font-bold">収入(集金)</h1>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
            setForm(EMPTY_FORM);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
        >
          {showForm ? "閉じる" : "+ 入金を登録"}
        </button>
      </div>

      <p className="text-xs text-gray-500">
        運用フロー: PayPay等で集金担当に送金 → ここに入金レコードを登録(未確認)→
        集金担当が受領を確認して「確認済」に変更。集計上の収入は確認済のみ計上されます。
      </p>

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
            入金日
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
            入金者名
            <input
              required
              list="payer-list"
              className={input}
              value={form.payer}
              onChange={(e) => setForm({ ...form, payer: e.target.value })}
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

      {/* フィルタ(月 × 人 × 入金確認 × イベント、URLに反映) */}
      <div className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap gap-2 items-center">
        <select className={`${input} !w-auto`} value={month} onChange={(e) => setFilter("month", e.target.value)}>
          <option value="">全ての月</option>
          {config?.months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select className={`${input} !w-auto`} value={payer} onChange={(e) => setFilter("payer", e.target.value)}>
          <option value="">全ての入金者</option>
          {config?.payers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select className={`${input} !w-auto`} value={confirmed} onChange={(e) => setFilter("confirmed", e.target.value)}>
          <option value="">全ての確認状況</option>
          <option value="false">未確認</option>
          <option value="true">確認済</option>
        </select>
        <select className={`${input} !w-auto`} value={event} onChange={(e) => setFilter("event", e.target.value)}>
          <option value="">全てのイベント</option>
          {config?.events.map((ev) => (
            <option key={ev} value={ev}>{ev}</option>
          ))}
        </select>
        <button
          onClick={() => setFilter("confirmed", confirmed === "false" ? "" : "false")}
          className={`rounded-full px-3 py-1.5 text-sm border ${
            confirmed === "false"
              ? "bg-amber-500 text-white border-amber-500"
              : "bg-white text-amber-700 border-amber-300 hover:bg-amber-50"
          }`}
        >
          未確認のみ
        </button>
        {(month || payer || confirmed || event) && (
          <button
            onClick={() => router.replace("/incomes")}
            className="text-sm text-gray-500 underline"
          >
            クリア
          </button>
        )}
      </div>

      {data && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm flex justify-between">
          <span className="text-blue-800">
            {data.count}件
            {(month || payer || confirmed || event) && "(絞り込み中)"}
          </span>
          <span className="font-bold text-blue-900">合計 {yen(data.total)}</span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-gray-500 border-b text-left">
              <th className="py-2 px-3">入金日</th>
              <th>イベント</th>
              <th>入金者</th>
              <th className="text-right">金額</th>
              <th className="text-center">確認</th>
              <th className="text-right pr-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-2 px-3 whitespace-nowrap">{r.date}</td>
                <td>{r.event}</td>
                <td className="whitespace-nowrap">
                  {r.payer}
                  {r.note && <span className="text-xs text-gray-400 block">{r.note}</span>}
                </td>
                <td className="text-right font-medium whitespace-nowrap">{yen(r.amount)}</td>
                <td className="text-center">
                  <button
                    onClick={() => toggleConfirmed(r)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      r.confirmed
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                    title="タップで切り替え"
                  >
                    {r.confirmed ? "確認済" : "未確認"}
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
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-gray-400">
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
