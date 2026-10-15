"use client";

import { useEffect, useState } from "react";
import { VISIT_PURPOSES } from "@/lib/frontdesk";

/** What a visitor sees after scanning the school's QR: a short form, then a pass number to show at the desk. */
export function VisitForm({ token }: { token: string }) {
  const [school, setSchool] = useState<{ school: string; logo: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    fetch("/api/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action: "info" }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); if (!dead) setSchool(j); })
      .catch((e: Error) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [token]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const r = await fetch("/api/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...f }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Something went wrong.");
      setPass(j.pass_no);
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  const lbl = "flex flex-col gap-1 text-[14px] font-semibold text-ink";
  const inp = "input !min-h-11 !py-2 text-[16px] font-normal";
  if (pass) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-4 px-5 py-8 text-center">
        <div className="text-[56px]">✅</div>
        <h1 className="m-0 text-[24px] font-extrabold text-ink">You are checked in</h1>
        <p className="m-0 text-[15px] text-muted">{school?.school}</p>
        <div className="rounded-[16px] border-2 border-[#16a34a] bg-[#f0fdf4] px-8 py-4"><span className="text-[12px] font-bold uppercase tracking-wide text-[#15803d]">Your pass</span><b className="block font-mono text-[28px] text-ink">{pass}</b></div>
        <p className="m-0 text-[14px] text-muted">Please show this number at the front desk. Thank you for visiting.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 px-5 py-6">
      <header className="text-center">
        {school?.logo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={school.logo} alt="" width={64} height={64} className="mx-auto mb-2 h-16 w-16 rounded-full object-contain" />}
        <h1 className="m-0 text-[22px] font-extrabold text-ink">{school?.school ?? "Visitor check-in"}</h1>
        <p className="m-0 text-[14px] text-muted">Please fill in your details to enter the campus.</p>
      </header>
      {err && !school ? <p role="alert" className="m-0 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[15px] text-[#7a1a12]">{err}</p> : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className={lbl}>Your name<input name="name" required maxLength={80} autoComplete="name" className={inp} /></label>
          <label className={lbl}>Mobile number<input name="phone" required type="tel" inputMode="tel" maxLength={20} autoComplete="tel" className={inp} /></label>
          <label className={lbl}>Purpose of visit
            <select name="purpose" defaultValue="meeting" className={inp}>{VISIT_PURPOSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className={lbl}>Whom do you want to meet?<input name="to_meet" maxLength={80} placeholder="Teacher, principal, office…" className={inp} /></label>
          <label className={lbl}>Organisation (if any)<input name="organisation" maxLength={80} className={inp} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>People with you<input name="people" type="number" min={1} max={20} defaultValue={1} className={inp} /></label>
            <label className={lbl}>Vehicle no.<input name="vehicle_no" maxLength={20} className={inp} /></label>
          </div>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
          {err && <p role="alert" className="m-0 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]">{err}</p>}
          <button disabled={busy || !school} className="cursor-pointer rounded-[14px] border-0 bg-[#2563eb] px-4 py-4 text-[17px] font-bold text-white disabled:opacity-60">{busy ? "Please wait…" : "Check in"}</button>
          <p className="m-0 text-center text-[12px] text-muted">Your details are kept in the school&apos;s visitor register for safety.</p>
        </form>
      )}
    </div>
  );
}
