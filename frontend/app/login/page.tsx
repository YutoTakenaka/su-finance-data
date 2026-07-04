"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { API_BASE, basicHeader, Role, setAuth } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { Authorization: basicHeader(user, pass) },
      });
      if (!res.ok) {
        setError(
          res.status === 401
            ? "IDまたはパスワードが違います"
            : `ログインに失敗しました (${res.status})`,
        );
        return;
      }
      const { role } = (await res.json()) as { role: Role };
      setAuth({ user, pass, role });
      router.push("/");
    } catch {
      setError("サーバーに接続できません");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-xl shadow p-8 w-full max-w-sm space-y-4"
      >
        <div className="text-center">
          <h1 className="font-bold text-lg">Surprise University - Project</h1>
          <p className="text-sm text-gray-500">収支管理アプリ</p>
        </div>
        <label className="block text-sm">
          <span className="text-gray-600">共有ID</span>
          <input
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            required
            autoComplete="username"
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">パスワード</span>
          <input
            type="password"
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={busy}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 font-medium disabled:opacity-50"
        >
          {busy ? "確認中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}
