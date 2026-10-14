"use client";

import { useState } from "react";
import { saveVoucher } from "@/app/app/_actions/accounts";

type Head = { id: string; name: string; kind: "income" | "expense" };
type Book = { id: string; name: string; kind: string };
type Initial = { id: string; kind: string; date: string; head_id: string | null; book_id: string; to_book_id: string | null; amount: string; party: string; mode: string; ref_no: string; narration: string };

const TABS: [string, string][] = [["receipt", "Money received"], ["payment", "Money paid"], ["transfer", "Cash ⇄ bank transfer"]];

/** One form for the three voucher kinds; the head list follows the kind so an expense head cannot be used on a receipt. */
export function VoucherForm({ heads, books, modes, today, back, initial, submit }: {
  heads: Head[]; books: Book[]; modes: [string, string][]; today: string; back: string; initial?: Initial; submit: React.ReactNode;
}) {
  const [kind, setKind] = useState(initial?.kind ?? "receipt");
  const list = heads.filter((h) => h.kind === (kind === "receipt" ? "income" : "expense"));
  const lbl = "flex flex-col gap-1 text-[13px] font-semibold text-ink";
  const inp = "input !min-h-10 !py-2 text-[15px] font-normal";
  return (
    <form action={saveVoucher} className="flex flex-col gap-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="kind" value={kind} />
      <div role="tablist" aria-label="Voucher type" className="flex flex-wrap gap-2">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
            className={`cursor-pointer rounded-full border px-4 py-2 text-[14px] font-semibold ${kind === k ? "border-blue bg-blue text-white" : "border-line bg-white text-body"}`}>{l}</button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={lbl}>Date<input type="date" name="date" max={today} defaultValue={initial?.date ?? today} required className={inp} /></label>
        <label className={lbl}>Amount (₹)<input name="amount" inputMode="decimal" required defaultValue={initial?.amount} placeholder="0.00" className={inp} /></label>
        {kind !== "transfer" ? (
          <label key={kind} className={`${lbl} sm:col-span-2`}>{kind === "receipt" ? "Income head" : "Expense head"}
            <select name="head_id" required defaultValue={list.some((h) => h.id === initial?.head_id) ? initial?.head_id ?? "" : ""} className={inp}>
              <option value="" disabled>Choose…</option>
              {list.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
        ) : <span className="sm:col-span-2" />}
        <label className={lbl}>{kind === "transfer" ? "From" : kind === "receipt" ? "Into" : "Paid from"}
          <select name="book_id" required defaultValue={initial?.book_id ?? books[0]?.id} className={inp}>
            {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        {kind === "transfer" && (
          <label className={lbl}>To
            <select name="to_book_id" required defaultValue={initial?.to_book_id ?? books[1]?.id ?? ""} className={inp}>
              {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        {kind !== "transfer" && <label className={lbl}>{kind === "receipt" ? "Received from" : "Paid to"}<input name="party" defaultValue={initial?.party} className={inp} /></label>}
        <label className={lbl}>Mode
          <select name="mode" defaultValue={initial?.mode ?? "cash"} className={inp}>{modes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className={lbl}>Reference no.<input name="ref_no" defaultValue={initial?.ref_no} placeholder="Bill / cheque / UTR" className={inp} /></label>
        <label className={`${lbl} sm:col-span-4`}>Narration<input name="narration" defaultValue={initial?.narration} maxLength={500} placeholder="What was this for?" className={inp} /></label>
      </div>
      <div className="flex items-center gap-3">{submit}</div>
    </form>
  );
}
