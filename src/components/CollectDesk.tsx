"use client";

import { useMemo, useState } from "react";
import { METHODS, METHOD_GROUPS, methodOf } from "@/lib/fees";

export type DeskDue = {
  id: string; label: string; head: string; due_date: string; amount: number; concession: number; fine: number; paid: number; balance: number; overdue: boolean; kind: string;
};

const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
const input = "input !min-h-10 !py-2 text-[15px] font-normal";

type Line = { method: string; amount: string; reference: string; bank: string; date: string; label: string };
const blank = (method: string): Line => ({ method, amount: "", reference: "", bank: "", date: "", label: "" });

/**
 * Collect fees structure-wise: tick the fees, change the amount of each, pick the payment method(s) —
 * the details of the chosen method open by themselves — and the total follows.
 */
export function CollectDesk({ studentId, dues, wallet, advanceAllowed, autoFine, legacyFine, today, action }: {
  studentId: string; dues: DeskDue[]; wallet: number; advanceAllowed: boolean; autoFine: boolean; legacyFine: number; today: string;
  action: (f: FormData) => void | Promise<void>;
}) {
  // by default the overdue fees are ticked; if nothing is overdue, the first one
  const [sel, setSel] = useState<Record<string, boolean>>(() => {
    const over = dues.filter((d) => d.overdue);
    const pick = over.length ? over : dues.slice(0, 1);
    return Object.fromEntries(pick.map((d) => [d.id, true]));
  });
  const [amt, setAmt] = useState<Record<string, string>>(() => Object.fromEntries(dues.map((d) => [d.id, String(d.balance)])));
  const [extraFine, setExtraFine] = useState<string>(legacyFine > 0 ? String(legacyFine) : "");
  const [useWallet, setUseWallet] = useState("");
  const [lines, setLines] = useState<Line[]>([blank("cash"), blank("upi"), blank("cheque")]);
  const [showSplit, setShowSplit] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, DeskDue[]>();
    for (const d of dues) m.set(d.head, [...(m.get(d.head) ?? []), d]);
    return [...m.entries()];
  }, [dues]);

  const num = (v: string) => (Number.isFinite(Number(v)) && v !== "" ? Math.max(0, Number(v)) : 0);
  const chosen = dues.filter((d) => sel[d.id]);
  const fees = chosen.reduce((t, d) => t + Math.min(num(amt[d.id]), d.balance), 0);
  const total = Math.round((fees + num(extraFine)) * 100) / 100;
  const wal = Math.min(num(useWallet), wallet, total);
  const toPay = Math.round((total - wal) * 100) / 100;
  const extraLines = showSplit ? lines.slice(1).reduce((t, l) => t + num(l.amount), 0) : 0;
  const first = Math.max(0, Math.round((toPay - extraLines) * 100) / 100);
  const balanced = toPay >= 0 && extraLines <= toPay;
  const nothing = chosen.length === 0 || total <= 0;
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const toggle = (id: string, on: boolean) => setSel((s) => ({ ...s, [id]: on }));
  const setMany = (pred: (d: DeskDue) => boolean) => setSel(Object.fromEntries(dues.filter(pred).map((d) => [d.id, true])));

  const methodFields = (i: number) => {
    const l = lines[i];
    const m = methodOf(l.method);
    const need: ("ref" | "bank" | "date" | "label")[] =
      m.value === "cash" ? [] : m.value === "debit_card" || m.value === "credit_card" ? ["ref", "bank"] : m.value === "upi" ? ["ref"]
      : m.value === "cheque" || m.value === "dd" ? ["ref", "bank", "date"] : m.value === "bank_transfer" ? ["ref", "bank"] : ["label", "ref"];
    if (!need.length) return <p className="m-0 self-end pb-2 text-[13px] text-muted sm:col-span-2">Cash — nothing more to note.</p>;
    return (
      <>
        {need.includes("label") && (
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">What is it?
            <input value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="e.g. Scholarship adjustment" className={input} />
          </label>
        )}
        {need.includes("ref") && (
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">{m.refLabel}
            <input value={l.reference} onChange={(e) => setLine(i, { reference: e.target.value })} className={input} required={m.value === "cheque" || m.value === "dd" || m.value === "upi"} />
          </label>
        )}
        {need.includes("bank") && (
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">{m.value === "debit_card" || m.value === "credit_card" ? "Card bank (optional)" : "Bank"}
            <input value={l.bank} onChange={(e) => setLine(i, { bank: e.target.value })} className={input} />
          </label>
        )}
        {need.includes("date") && (
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">{m.value === "dd" ? "DD date" : "Cheque date"}
            <input type="date" value={l.date} onChange={(e) => setLine(i, { date: e.target.value })} className={input} />
          </label>
        )}
      </>
    );
  };

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="student_id" value={studentId} />
      {chosen.map((d) => <input key={d.id} type="hidden" name={`alloc_${d.id}`} value={Math.min(num(amt[d.id]), d.balance)} />)}

      <section className="rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="m-0 text-[15px] font-bold text-ink">1 · Choose the fees to collect</h2>
          <span className="flex flex-wrap gap-3 text-[13px]">
            <button type="button" onClick={() => setMany((d) => d.overdue)} className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">Overdue only</button>
            <button type="button" onClick={() => setMany(() => true)} className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">All fees</button>
            <button type="button" onClick={() => setSel({})} className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">Clear</button>
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead>
              <tr className="bg-surface text-left text-[12px] text-muted">
                <th className="px-3 py-2" />
                <th className="px-3 py-2">Fee</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Fee</th>
                <th className="px-3 py-2 text-right">Concession</th><th className="px-3 py-2 text-right">Fine</th><th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2 text-right">Pay now (₹)</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([head, rows]) => (
                <GroupRows key={head} head={head} rows={rows} sel={sel} amt={amt} toggle={toggle} setAmt={(id, v) => setAmt((a) => ({ ...a, [id]: v }))}
                  selectHead={() => setSel((s) => ({ ...s, ...Object.fromEntries(rows.map((r) => [r.id, true])) }))} />
              ))}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-wrap items-end justify-between gap-3 border-t border-line px-4 py-3 text-[14px]">
          <span className="text-muted">
            {autoFine ? "Late fine is fetched automatically by the school's rule and is already in each balance." : legacyFine > 0 ? "No late-fine rule is set; the suggested fine (per day late) is below — change or clear it." : "No late fine due."}
          </span>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">Extra fine / charge (₹)
            <input name="fine" type="number" min={0} step="1" value={extraFine} onChange={(e) => setExtraFine(e.target.value)} className={`${input} !w-28`} />
          </label>
        </footer>
      </section>

      <section className="rounded-[14px] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
        <h2 className="m-0 mb-3 text-[15px] font-bold text-ink">2 · Payment</h2>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-[10px] bg-surface p-3"><div className="text-[12px] text-muted">Fees chosen</div><b className="text-[18px] text-ink">{inr(fees)}</b></div>
          <div className="rounded-[10px] bg-surface p-3"><div className="text-[12px] text-muted">Extra fine / charge</div><b className="text-[18px] text-ink">{inr(num(extraFine))}</b></div>
          <div className="rounded-[10px] bg-surface p-3"><div className="text-[12px] text-muted">From advance</div><b className="text-[18px] text-ink">{inr(wal)}</b></div>
          <div className="rounded-[10px] bg-wa-tint p-3"><div className="text-[12px] text-[#0b4f2c]">To receive now</div><b className="text-[22px] text-[#0b4f2c]">{inr(toPay)}</b></div>
        </div>

        <div className="grid gap-4">
          {(showSplit ? [0, 1, 2] : [0]).map((i) => (
            <div key={i} className="grid gap-3 rounded-[12px] border border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">{i === 0 ? "Payment method" : `Second method ${i}`}
                <select name={`mode_${i + 1}`} value={lines[i].method} onChange={(e) => setLine(i, { method: e.target.value })} className={input}>
                  {METHOD_GROUPS.map((g) => (
                    <optgroup key={g} label={g}>{METHODS.filter((m) => m.group === g).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</optgroup>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Amount (₹)
                {i === 0
                  ? <input name="amount_1" type="number" step="0.01" value={first} readOnly className={`${input} bg-surface`} />
                  : <input name={`amount_${i + 1}`} type="number" step="0.01" min={0} value={lines[i].amount} onChange={(e) => setLine(i, { amount: e.target.value })} className={input} />}
              </label>
              {methodFields(i)}
              <input type="hidden" name={`reference_${i + 1}`} value={lines[i].reference} />
              <input type="hidden" name={`bank_${i + 1}`} value={lines[i].bank} />
              <input type="hidden" name={`cheque_date_${i + 1}`} value={lines[i].date} />
              <input type="hidden" name={`label_${i + 1}`} value={lines[i].label} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
          <button type="button" onClick={() => setShowSplit((v) => !v)} className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">{showSplit ? "Single method" : "Split between two methods (cash + UPI …)"}</button>
          {!balanced && <span className="text-error">The extra lines are more than the amount to receive.</span>}
          {!advanceAllowed && <span className="text-muted">Paying more than is due is not allowed.</span>}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Receipt date
            <input name="paid_on" type="date" defaultValue={today} className={input} />
          </label>
          {wallet > 0 && (
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Use advance (up to {inr(wallet)})
              <input name="wallet_use" type="number" min={0} max={wallet} step="0.01" value={useWallet} onChange={(e) => setUseWallet(e.target.value)} className={input} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink sm:col-span-2">Note
            <input name="note" className={input} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button disabled={nothing || !balanced} className="btn btn-primary cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-50">Save &amp; print receipt · {inr(toPay)}</button>
          {nothing && <span className="text-[13px] text-muted">Tick at least one fee to collect.</span>}
        </div>
      </section>
    </form>
  );
}

function GroupRows({ head, rows, sel, amt, toggle, setAmt, selectHead }: {
  head: string; rows: DeskDue[]; sel: Record<string, boolean>; amt: Record<string, string>;
  toggle: (id: string, on: boolean) => void; setAmt: (id: string, v: string) => void; selectHead: () => void;
}) {
  const bal = rows.reduce((t, r) => t + r.balance, 0);
  return (
    <>
      <tr className="bg-[#f6f8fb]">
        <td colSpan={7} className="px-3 py-1.5 text-[13px] font-bold text-ink">{head} <span className="font-normal text-muted">· {rows.length} instalment(s) · balance {inr(bal)}</span></td>
        <td colSpan={2} className="px-3 py-1.5 text-right"><button type="button" onClick={selectHead} className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-blue underline">Select all {head}</button></td>
      </tr>
      {rows.map((d) => (
        <tr key={d.id} className="border-t border-line">
          <td className="px-3 py-2"><input type="checkbox" checked={Boolean(sel[d.id])} onChange={(e) => toggle(d.id, e.target.checked)} aria-label={`Collect ${d.label}`} className="h-4 w-4" /></td>
          <td className="px-3 py-2">{d.label}{d.kind !== "plan" && <span className="ml-1 text-[12px] text-muted">{d.kind}</span>}</td>
          <td className={`px-3 py-2 ${d.overdue ? "font-semibold text-error" : ""}`}>{dmy(d.due_date)}{d.overdue && <span className="ml-1 text-[11px]">overdue</span>}</td>
          <td className="px-3 py-2 text-right">{inr(d.amount)}</td>
          <td className="px-3 py-2 text-right text-muted">{d.concession > 0 ? `− ${inr(d.concession)}` : "—"}</td>
          <td className={`px-3 py-2 text-right ${d.fine > 0 ? "font-semibold text-error" : "text-muted"}`}>{d.fine > 0 ? `+ ${inr(d.fine)}` : "—"}</td>
          <td className="px-3 py-2 text-right text-muted">{d.paid > 0 ? inr(d.paid) : "—"}</td>
          <td className="px-3 py-2 text-right font-semibold text-ink">{inr(d.balance)}</td>
          <td className="px-3 py-2 text-right">
            <input type="number" min={0} max={d.balance} step="0.01" value={amt[d.id] ?? ""} disabled={!sel[d.id]} onChange={(e) => setAmt(d.id, e.target.value)}
              aria-label={`Amount for ${d.label}`} className="input !min-h-9 !w-28 !py-1 text-right text-[14px]" />
          </td>
        </tr>
      ))}
    </>
  );
}
