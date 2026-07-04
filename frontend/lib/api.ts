// バックエンドAPIクライアント。認証情報はlocalStorageに保持し、
// すべてのリクエストにBasic認証ヘッダを付ける。

export type Role = "admin" | "member";

export interface Auth {
  user: string;
  pass: string;
  role: Role;
}

export interface Receipt {
  name: string;
  original: string;
  content_type: string;
  size: number;
  uploaded_at: string;
}

export interface Expense {
  id: string;
  date: string;
  month: string;
  event: string;
  payer: string;
  description: string;
  amount: number;
  status: "unsettled" | "settled";
  settled_date: string | null;
  note: string;
  receipts?: Receipt[];
}

export interface Income {
  id: string;
  date: string;
  month: string;
  event: string;
  payer: string;
  amount: number;
  confirmed: boolean;
  note: string;
}

export interface ListResponse<T> {
  items: T[];
  count: number;
  total: number;
}

export interface AppConfig {
  fiscal_year: number;
  months: string[];
  events: string[];
  payers: string[];
}

export interface Summary {
  alerts: {
    unsettled: { payer: string; count: number; amount: number }[];
    unsettled_count: number;
    unsettled_amount: number;
    unconfirmed: { payer: string; count: number; amount: number }[];
    unconfirmed_count: number;
    unconfirmed_amount: number;
  };
  cards: {
    income_confirmed: number;
    expense_total: number;
    net: number;
    expense_settled: number;
    unsettled_amount: number;
    cash_on_hand: number;
  };
  monthly: {
    month: string;
    income: number;
    expense: number;
    net: number;
    cumulative: number;
    net_rate: number | null;
  }[];
  by_event: { event: string; income: number; expense: number; net: number }[];
}

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const AUTH_KEY = "su_finance_auth";

export function getAuth(): Auth | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? (JSON.parse(raw) as Auth) : null;
}

export function setAuth(auth: Auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

export function basicHeader(user: string, pass: string): string {
  return "Basic " + btoa(`${user}:${pass}`);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = getAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (auth) headers.Authorization = basicHeader(auth.user, auth.pass);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearAuth();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("認証エラー");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(body.detail ?? `エラーが発生しました (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// CSV・ZIPなど認証付きファイルダウンロード
export async function downloadFile(path: string, filename: string) {
  const auth = getAuth();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: auth ? { Authorization: basicHeader(auth.user, auth.pass) } : {},
  });
  if (!res.ok) throw new Error(`ダウンロードに失敗しました (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 領収書アップロード(FormData。Content-Typeはブラウザに任せる)
export async function uploadReceipts<T>(path: string, files: FileList): Promise<T> {
  const auth = getAuth();
  const form = new FormData();
  Array.from(files).forEach((f) => form.append("files", f));
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: auth ? { Authorization: basicHeader(auth.user, auth.pass) } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(body.detail ?? `アップロードに失敗しました (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// 認証付きで領収書を取得し、別タブで開く(<img>/<a>に直接URLを渡せないため)
export async function openReceipt(path: string) {
  const auth = getAuth();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: auth ? { Authorization: basicHeader(auth.user, auth.pass) } : {},
  });
  if (!res.ok) throw new Error(`表示に失敗しました (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const yen = (n: number) => "¥" + n.toLocaleString("ja-JP");
