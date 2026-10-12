"use client";

import { useActionState, useState } from "react";
import { registerSchool } from "./actions";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerSchool, undefined);
  const [t] = useState(() => String(Date.now()));
  const v = state?.values ?? {};
  return (
    <form action={action} className="mt-6 grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="t" value={t} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <label className="label sm:col-span-2">School name<input name="school" defaultValue={v.school} required className="input font-normal" placeholder="Sunrise Public School" /></label>
      <label className="label">Board
        <select name="board" defaultValue={v.board ?? "CBSE"} className="input font-normal">{["CBSE", "ICSE", "UP Board", "State Board", "Other"].map((b) => <option key={b}>{b}</option>)}</select>
      </label>
      <label className="label">City<input name="city" defaultValue={v.city} required className="input font-normal" /></label>
      <label className="label">Principal / owner name<input name="principal" defaultValue={v.principal} required className="input font-normal" /></label>
      <label className="label">Mobile (WhatsApp)<input name="phone" type="tel" defaultValue={v.phone} required className="input font-normal" inputMode="numeric" /></label>
      <label className="label">Email (your login)<input name="email" type="email" autoComplete="username" defaultValue={v.email} required className="input font-normal" /></label>
      <label className="label">Password<input name="password" type="password" autoComplete="new-password" minLength={8} required className="input font-normal" /></label>
      {state?.error && <p role="alert" className="m-0 text-[14px] text-error sm:col-span-2">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary cursor-pointer border-0 disabled:opacity-60 sm:col-span-2">{pending ? "Creating your school…" : "Start free trial"}</button>
    </form>
  );
}
