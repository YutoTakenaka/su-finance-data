"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, Summary, yen } from "@/lib/api";

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Summary>("/summary")
      .then(setSummary)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!summary) return <p className="text-gray-500">読み込み中...</p>;

  const { alerts, cards, monthly, by_event } = summary;
  const hasAlert = alerts.unsettled_count > 0 || alerts.unconfirmed_count > 0;
  const chartData = monthly.map((m) => ({
    ...m,
    label: m.month.slice(2), // "26/06"
  }));

  return (
    <div className="space-y-6">
      {/* 1. アラートエリア(リマインドの代替) */}
      {hasAlert ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
          <h2 className="font-bold text-red-800">⚠ 対応が必要です</h2>
          {alerts.unsettled_count > 0 && (
            <div>
              <p className="text-sm text-red-700 mb-1">
                未精算の立替: {alerts.unsettled_count}件 /{" "}
                {yen(alerts.unsettled_amount)}
              </p>
              <div className="flex flex-wrap gap-2">
                {alerts.unsettled.map((g) => (
                  <Link
                    key={g.payer}
                    href={`/expenses?payer=${encodeURIComponent(g.payer)}&status=unsettled`}
                    className="bg-white border border-red-300 text-red-800 rounded-full px-3 py-1 text-sm hover:bg-red-100"
                  >
                    {g.payer} {yen(g.amount)}({g.count}件)
                  </Link>
                ))}
              </div>
            </div>
          )}
          {alerts.unconfirmed_count > 0 && (
            <div>
              <p className="text-sm text-red-700 mb-1">
                未確認の入金: {alerts.unconfirmed_count}件 /{" "}
                {yen(alerts.unconfirmed_amount)}
              </p>
              <div className="flex flex-wrap gap-2">
                {alerts.unconfirmed.map((g) => (
                  <Link
                    key={g.payer}
                    href={`/incomes?payer=${encodeURIComponent(g.payer)}&confirmed=false`}
                    className="bg-white border border-amber-300 text-amber-800 rounded-full px-3 py-1 text-sm hover:bg-amber-100"
                  >
                    {g.payer} {yen(g.amount)}({g.count}件)
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
          ✓ 未精算・未確認はありません
        </div>
      )}

      {/* 2. 資金状況カード */}
      <section>
        <h2 className="font-bold mb-2">資金状況</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card label="集金合計(確認済)" value={cards.income_confirmed} />
          <Card label="支出合計" value={cards.expense_total} />
          <Card label="年間収支" value={cards.net} signed />
          <Card label="精算済み支出" value={cards.expense_settled} />
          <Card label="未精算残高" value={cards.unsettled_amount} warn />
          <Card label="手元資金(集金−精算済)" value={cards.cash_on_hand} signed />
        </div>
      </section>

      {/* 3. 月別収支グラフ */}
      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-bold mb-3">月別収支グラフ</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis
                yAxisId="amount"
                fontSize={11}
                tickFormatter={(v: number) => (v / 10000).toLocaleString() + "万"}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                fontSize={11}
                tickFormatter={(v: number) => v + "%"}
              />
              <Tooltip
                formatter={(value: number, name: string) =>
                  name === "収支率" ? `${value}%` : yen(value)
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="amount" dataKey="income" name="収入" fill="#3b82f6" />
              <Bar yAxisId="amount" dataKey="expense" name="支出" fill="#fca5a5" />
              <Line
                yAxisId="amount"
                type="monotone"
                dataKey="net"
                name="収支"
                stroke="#16a34a"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="net_rate"
                name="収支率"
                stroke="#9333ea"
                strokeDasharray="5 3"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 3'. 月別収支表(各行から明細へ遷移) */}
      <section className="bg-white rounded-xl shadow-sm p-4 overflow-x-auto">
        <h2 className="font-bold mb-3">月別収支表</h2>
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-gray-500 border-b">
              <th className="text-left py-2">月</th>
              <th className="text-right">収入(確認済)</th>
              <th className="text-right">支出</th>
              <th className="text-right">収支</th>
              <th className="text-right">収支率</th>
              <th className="text-right">累計残高</th>
              <th className="text-right">明細</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.month} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-2 font-medium">{m.month}</td>
                <td className="text-right">{yen(m.income)}</td>
                <td className="text-right">{yen(m.expense)}</td>
                <td className={`text-right ${m.net < 0 ? "text-red-600" : "text-green-700"}`}>
                  {yen(m.net)}
                </td>
                <td className="text-right text-gray-500">
                  {m.net_rate === null ? "−" : `${m.net_rate}%`}
                </td>
                <td className={`text-right ${m.cumulative < 0 ? "text-red-600" : ""}`}>
                  {yen(m.cumulative)}
                </td>
                <td className="text-right space-x-2 whitespace-nowrap">
                  <Link
                    href={`/expenses?month=${encodeURIComponent(m.month)}`}
                    className="text-blue-600 hover:underline"
                  >
                    支出
                  </Link>
                  <Link
                    href={`/incomes?month=${encodeURIComponent(m.month)}`}
                    className="text-blue-600 hover:underline"
                  >
                    収入
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 4. イベント別収支 */}
      <section className="bg-white rounded-xl shadow-sm p-4 overflow-x-auto">
        <h2 className="font-bold mb-3">イベント別収支</h2>
        {by_event.length === 0 ? (
          <p className="text-sm text-gray-500">まだデータがありません</p>
        ) : (
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-gray-500 border-b">
                <th className="text-left py-2">イベント</th>
                <th className="text-right">収入(確認済)</th>
                <th className="text-right">支出</th>
                <th className="text-right">収支</th>
                <th className="text-right">明細</th>
              </tr>
            </thead>
            <tbody>
              {by_event.map((e) => (
                <tr key={e.event} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 font-medium">{e.event}</td>
                  <td className="text-right">{yen(e.income)}</td>
                  <td className="text-right">{yen(e.expense)}</td>
                  <td className={`text-right ${e.net < 0 ? "text-red-600" : "text-green-700"}`}>
                    {yen(e.net)}
                  </td>
                  <td className="text-right space-x-2 whitespace-nowrap">
                    <Link
                      href={`/expenses?event=${encodeURIComponent(e.event)}`}
                      className="text-blue-600 hover:underline"
                    >
                      支出
                    </Link>
                    <Link
                      href={`/incomes?event=${encodeURIComponent(e.event)}`}
                      className="text-blue-600 hover:underline"
                    >
                      収入
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 5. 明細ビューへの入口 */}
      <div className="flex gap-3">
        <Link
          href="/expenses"
          className="flex-1 bg-white rounded-xl shadow-sm p-4 text-center hover:bg-gray-50"
        >
          <span className="font-medium text-blue-700">支出明細を見る →</span>
          <p className="text-xs text-gray-500 mt-1">誰が・いつ・何に・いくら払ったか</p>
        </Link>
        <Link
          href="/incomes"
          className="flex-1 bg-white rounded-xl shadow-sm p-4 text-center hover:bg-gray-50"
        >
          <span className="font-medium text-blue-700">収入明細を見る →</span>
          <p className="text-xs text-gray-500 mt-1">誰がいくら入金したか</p>
        </Link>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  signed = false,
  warn = false,
}: {
  label: string;
  value: number;
  signed?: boolean;
  warn?: boolean;
}) {
  const color =
    signed && value < 0
      ? "text-red-600"
      : warn && value > 0
        ? "text-amber-600"
        : "text-gray-900";
  return (
    <div className="bg-white rounded-xl shadow-sm p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-1 ${color}`}>{yen(value)}</p>
    </div>
  );
}
