"use client";

// 精算一覧(管理者のみ): 未精算の立替を人別に集計し、選択して一括精算する。
import { useEffect, useState } from "react";
import { api, Expense, yen } from "@/lib/api";

interface SettlementGroup {
  payer: string;
  count: number;
  total: number;
  items: Expense[];
}

export default function SettlementPage() {
  const [groups, setGroups] = useState<SettlementGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    api<{ groups: SettlementGroup[]; total: number }>("/settlement")
      .then((d) => {
        setGroups(d.groups);
        setTotal(d.total);
        setSelected(new Set());
      })
      .catch((e: Error) => setError(e.message));
  }

  useEffect(load, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function togglePayer(g: SettlementGroup) {
    const next = new Set(selected);
    const allSelected = g.items.every((r) => next.has(r.id));
    for (const r of g.items) {
      if (allSelected) next.delete(r.id);
      else next.add(r.id);
    }
    setSelected(next);
  }

  const selectedAmount =
    groups
      ?.flatMap((g) => g.items)
      .filter((r) => selected.has(r.id))
      .reduce((s, r) => s + r.amount, 0) ?? 0;

  async function settle() {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}件(${yen(selectedAmount)})を精算済にしますか?`))
      return;
    setBusy(true);
    setError("");
    try {
      await api("/settlement/settle", {
        method: "POST",
        body: JSON.stringify({
          ids: Array.from(selected),
        }),
      });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (!groups) return <p className="text-gray-500">読み込み中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">精算一覧(誰にいくら渡すべきか)</h1>
        <button
          onClick={settle}
          disabled={selected.size === 0 || busy}
          className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          選択した{selected.size}件を一括精算({yen(selectedAmount)})
        </button>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm flex justify-between">
        <span className="text-red-800">未精算合計</span>
        <span className="font-bold text-red-900">{yen(total)}</span>
      </div>

      {groups.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center text-green-800">
          ✓ 未精算の立替はありません
        </div>
      )}

      {groups.map((g) => (
        <div key={g.payer} className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-bold">
              {g.payer}
              <span className="ml-2 text-sm font-normal text-gray-500">
                {g.count}件 / {yen(g.total)}
              </span>
            </p>
            <button
              onClick={() => togglePayer(g)}
              className="text-sm text-blue-600 hover:underline"
            >
              {g.items.every((r) => selected.has(r.id)) ? "全解除" : "全選択"}
            </button>
          </div>
          <ul className="divide-y">
            {g.items.map((r) => (
              <li key={r.id} className="py-2 flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <span className="text-gray-500 whitespace-nowrap">{r.date}</span>
                <span className="flex-1">
                  {r.event} / {r.description}
                </span>
                <span className="font-medium whitespace-nowrap">{yen(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
