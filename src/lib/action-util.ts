import "server-only";
import { redirect } from "next/navigation";

export const str = (f: FormData, k: string, max = 1000) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
};
export const num = (f: FormData, k: string) => {
  const v = str(f, k, 30);
  if (v === null) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const date = (f: FormData, k: string) => {
  const v = str(f, k, 10);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
export const oneOf = <T extends readonly string[]>(f: FormData, k: string, list: T, fallback: T[number]): T[number] => {
  const v = str(f, k, 40);
  return v && (list as readonly string[]).includes(v) ? (v as T[number]) : fallback;
};
export const uuid = (f: FormData, k: string) => {
  const v = str(f, k, 40);
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
};

/** Redirect back with a flash message in the query string. */
export function go(path: string, msg?: { ok?: string; error?: string }): never {
  const q = new URLSearchParams();
  if (msg?.ok) q.set("ok", msg.ok);
  if (msg?.error) q.set("error", msg.error);
  const [base, hash] = path.split("#");
  redirect((q.size ? `${base}${base.includes("?") ? "&" : "?"}${q}` : base) + (hash ? `#${hash}` : ""));
}

export function errMsg(e: { message?: string } | null | undefined, fallback = "Something went wrong") {
  if (!e?.message) return fallback;
  if (/row-level security|permission denied/i.test(e.message)) return "You don't have permission to do that.";
  if (/foreign key/i.test(e.message)) return "This record is linked to others and can't be removed.";
  return e.message.slice(0, 200);
}
