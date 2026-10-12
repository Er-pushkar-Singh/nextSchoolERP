"use client";

import { useActionState } from "react";
import { signIn } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="label">Email<input name="email" type="email" autoComplete="username" required className="input font-normal" /></label>
      <label className="label">Password<input name="password" type="password" autoComplete="current-password" required className="input font-normal" /></label>
      {state?.error && <p role="alert" className="m-0 text-[14px] text-error">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary cursor-pointer border-0 disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
