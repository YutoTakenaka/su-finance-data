"use client";

// 全ページ共通のシェル。ログインチェックとナビゲーションを担当する。
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Auth, clearAuth, getAuth } from "@/lib/api";

const TABS = [
  { href: "/", label: "ダッシュボード" },
  { href: "/expenses", label: "支出(立替)" },
  { href: "/incomes", label: "収入(集金)" },
  { href: "/settlement", label: "精算", adminOnly: true },
  { href: "/admin", label: "管理", adminOnly: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [auth, setAuthState] = useState<Auth | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const a = getAuth();
    if (!a && pathname !== "/login") {
      router.replace("/login");
      return;
    }
    setAuthState(a);
    setChecked(true);
  }, [pathname, router]);

  if (pathname === "/login") return <>{children}</>;
  if (!checked || !auth) return null;

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between py-3">
            <Link href="/" className="font-bold text-gray-900 leading-tight">
              Surprise University - Project
              <span className="block text-xs font-normal text-gray-500">
                収支管理アプリ
              </span>
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-gray-600">
                {auth.role === "admin" ? "管理者" : "一般メンバー"}
              </span>
              <button
                onClick={() => {
                  clearAuth();
                  router.push("/login");
                }}
                className="text-gray-500 hover:text-gray-800 underline"
              >
                ログアウト
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto -mb-px">
            {TABS.filter((t) => !t.adminOnly || auth.role === "admin").map(
              (t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 ${
                    pathname === t.href
                      ? "border-blue-600 text-blue-700 font-medium"
                      : "border-transparent text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {t.label}
                </Link>
              ),
            )}
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
