"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Opt = { id: string; text: string };
type Q = { id: string; kind: string; text: string; marks: number; neg: number; options: Opt[] };
type PortalExam = { id: string; title: string; subject: string; duration_min: number; starts_at: string | null; ends_at: string | null; total_marks: number; needs_code: boolean; status: string; state: string; score: number | null; max_score: number | null };
type State = { exam: { id: string; title: string; instructions: string | null; duration_min: number; max_tab_switches: number; require_fullscreen: boolean; total_marks: number; negative_marking: boolean };
  status: string; remaining_s: number; questions: Q[]; answers: Record<string, string[]>; tab_switches: number };
type Result = { title: string; submitted: boolean; shown: boolean; score: number | null; max_score: number | null; correct: number | null; wrong: number | null; skipped: number | null; passed: boolean | null; terminated: boolean;
  review: { text: string; options: Opt[]; chosen: string[]; correct: string[]; explanation: string | null }[] };

const ist = (t: string | null) => (t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/exam", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error ?? "Something went wrong.") as Error & { status?: number }; e.status = r.status; throw e; }
  return j as T;
}

/** The whole student side: sign in → my exams → start → write → submit → result. */
export function ExamApp({ examToken }: { examToken?: string }) {
  const [info, setInfo] = useState<{ title: string; school: string; school_code: string; logo: string | null } | null>(null);
  const [view, setView] = useState<"boot" | "login" | "portal" | "pre" | "exam" | "result">("boot");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [portal, setPortal] = useState<{ student: string; school: string; class: string; exams: PortalExam[] } | null>(null);
  const [cur, setCur] = useState<PortalExam | null>(null);
  const [code, setCode] = useState("");
  const [st, setSt] = useState<State | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(0);
  const [switches, setSwitches] = useState(0);
  const [warn, setWarn] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState(false);
  const examId = useRef<string>("");
  const submitting = useRef(false);

  const toPortal = useCallback(async () => {
    try { const p = await api<NonNullable<typeof portal>>({ action: "portal" }); setPortal(p); setView("portal"); setErr(null); }
    catch (e) { if ((e as { status?: number }).status === 401) setView("login"); else setErr((e as Error).message); }
  }, []);

  // first load: exam link info, then existing session?
  useEffect(() => {
    let dead = false;
    (async () => {
      if (examToken) { try { const i = await api<typeof info>({ action: "info", token: examToken }); if (!dead) setInfo(i); } catch (e) { if (!dead) { setErr((e as Error).message); setView("login"); return; } } }
      try { const p = await api<NonNullable<typeof portal>>({ action: "portal" }); if (!dead) { setPortal(p); setView("portal"); } }
      catch { if (!dead) setView("login"); }
    })();
    return () => { dead = true; };
  }, [examToken]);

  const login = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      await api({ action: "login", school: info?.school_code ?? String(f.get("school") ?? ""), admission: String(f.get("admission") ?? ""), dob: String(f.get("dob") ?? "") });
      await toPortal();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const logout = async () => { try { await api({ action: "logout" }); } catch { /* ignore */ } setPortal(null); setView("login"); };

  const enterFullscreen = async () => { try { await document.documentElement.requestFullscreen?.(); } catch { /* the browser may refuse; counted as a switch only if it was required and left later */ } };

  const begin = async (ex: PortalExam) => {
    setBusy(true); setErr(null);
    try {
      const s = await api<State>({ action: "start", exam: ex.id, code });
      examId.current = ex.id; setCur(ex);
      if (s.status !== "in_progress") { await showResult(ex.id); }
      else {
        setSt(s); setAnswers(s.answers ?? {}); setIdx(0); setLeft(s.remaining_s); setSwitches(s.tab_switches); setMarked(new Set()); setView("exam");
        if (s.exam.require_fullscreen) await enterFullscreen();
      }
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  const showResult = useCallback(async (id: string) => {
    try { const r = await api<Result>({ action: "result", exam: id }); setResult(r); setView("result"); document.fullscreenElement && document.exitFullscreen?.().catch(() => null); }
    catch (x) { setErr((x as Error).message); }
  }, []);

  const finish = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try { const r = await api<Result>({ action: "submit", exam: examId.current }); setResult(r); setView("result"); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => null); }
    catch (x) { setErr((x as Error).message); submitting.current = false; }
    setBusy(false);
  }, []);

  // countdown on the server's clock (re-synced by every save and every 30 s)
  useEffect(() => {
    if (view !== "exam") return;
    const t = setInterval(() => setLeft((l) => Math.max(l - 1, 0)), 1000);
    return () => clearInterval(t);
  }, [view]);
  useEffect(() => { if (view === "exam" && left === 0 && st) void finish(); }, [left, view, st, finish]);
  useEffect(() => {
    if (view !== "exam") return;
    const t = setInterval(async () => {
      try { const s = await api<State>({ action: "state", exam: examId.current }); if (s.status !== "in_progress") { await showResult(examId.current); } else { setLeft(s.remaining_s); setSwitches(s.tab_switches); } } catch { /* offline: keep counting */ }
    }, 30000);
    return () => clearInterval(t);
  }, [view, showResult]);

  // integrity events
  const report = useCallback(async (kind: string, detail?: string) => {
    if (!examId.current) return;
    try {
      const r = await api<{ tab_switches: number; limit: number; terminated: boolean }>({ action: "event", exam: examId.current, kind, detail });
      setSwitches(r.tab_switches);
      if (r.terminated) { await showResult(examId.current); }
      else if (r.limit > 0) setWarn(`You left the exam screen (${r.tab_switches} of ${r.limit} allowed). Leaving more often ends your exam.`);
    } catch { /* ignore */ }
  }, [showResult]);
  useEffect(() => {
    if (view !== "exam" || !st) return;
    const vis = () => { if (document.hidden) void report("tab_hidden"); };
    const blur = () => { if (!document.hidden) void report("window_blur"); };
    const fs = () => { if (!document.fullscreenElement && st.exam.require_fullscreen) void report("fullscreen_exit"); };
    const stop = (e: Event) => { e.preventDefault(); void report(e.type); };
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && ["c", "v", "x", "p", "s", "u", "a"].includes(e.key.toLowerCase())) { e.preventDefault(); void report("blocked_shortcut", e.key); } if (e.key === "F12") e.preventDefault(); };
    const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    document.addEventListener("visibilitychange", vis); window.addEventListener("blur", blur); document.addEventListener("fullscreenchange", fs);
    document.addEventListener("contextmenu", stop); document.addEventListener("copy", stop); document.addEventListener("cut", stop); document.addEventListener("paste", stop); document.addEventListener("keydown", key);
    window.addEventListener("beforeunload", leave);
    return () => {
      document.removeEventListener("visibilitychange", vis); window.removeEventListener("blur", blur); document.removeEventListener("fullscreenchange", fs);
      document.removeEventListener("contextmenu", stop); document.removeEventListener("copy", stop); document.removeEventListener("cut", stop); document.removeEventListener("paste", stop); document.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", leave);
    };
  }, [view, st, report]);

  const choose = async (q: Q, optId: string) => {
    const now = answers[q.id] ?? [];
    const next = q.kind === "multi" ? (now.includes(optId) ? now.filter((x) => x !== optId) : [...now, optId]) : [optId];
    setAnswers((a) => ({ ...a, [q.id]: next }));
    setSaveState("saving");
    try { const r = await api<{ remaining_s: number }>({ action: "answer", exam: examId.current, question: q.id, answer: next }); setLeft(r.remaining_s); setSaveState("saved"); }
    catch (x) {
      setSaveState("error");
      if ((x as { status?: number }).status === 401) setView("login");
      else if (/time is over|already submitted/i.test((x as Error).message)) await showResult(examId.current);
    }
  };
  const clear = async (q: Q) => {
    setAnswers((a) => ({ ...a, [q.id]: [] }));
    try { await api({ action: "answer", exam: examId.current, question: q.id, answer: [] }); setSaveState("saved"); } catch { setSaveState("error"); }
  };

  const shell = "mx-auto w-full max-w-3xl px-4 py-6";
  const card = "rounded-[16px] border border-line bg-white p-5 shadow-[var(--shadow-card)]";
  const btn = "cursor-pointer rounded-[12px] border-0 bg-[#2563eb] px-5 py-3 text-[16px] font-bold text-white disabled:opacity-50";
  const inp = "input !min-h-11 !py-2 text-[16px] font-normal";

  if (view === "boot") return <div className={shell}><p className="text-center text-muted">Loading…</p></div>;

  if (view === "login") return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-4 px-5 py-8">
      <header className="text-center">
        {info?.logo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={info.logo} alt="" width={64} height={64} className="mx-auto mb-2 h-16 w-16 rounded-full object-contain" />}
        <h1 className="m-0 text-[22px] font-extrabold text-ink">{info?.school ?? "Online examination"}</h1>
        {info?.title && <p className="m-0 text-[15px] text-muted">{info.title}</p>}
      </header>
      <form onSubmit={login} className={`${card} flex flex-col gap-3`}>
        {!info && <label className="flex flex-col gap-1 text-[14px] font-semibold text-ink">School code<input name="school" required className={inp} autoCapitalize="off" /></label>}
        <label className="flex flex-col gap-1 text-[14px] font-semibold text-ink">Admission number<input name="admission" required className={inp} autoComplete="off" autoCapitalize="characters" /></label>
        <label className="flex flex-col gap-1 text-[14px] font-semibold text-ink">Date of birth<input name="dob" type="date" required className={inp} /></label>
        {err && <p role="alert" className="m-0 rounded-[10px] border border-[#f3b8b1] bg-[#fdecea] px-3 py-2 text-[14px] text-[#7a1a12]">{err}</p>}
        <button disabled={busy} className={btn}>{busy ? "Please wait…" : "Sign in"}</button>
        <p className="m-0 text-center text-[12px] text-muted">Use only your own details. Your exam is monitored: leaving the screen is recorded.</p>
      </form>
    </div>
  );

  if (view === "portal" && portal) return (
    <div className={shell}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div><h1 className="m-0 text-[22px] font-extrabold text-ink">Hello, {portal.student}</h1><p className="m-0 text-[14px] text-muted">{portal.school} · Class {portal.class}</p></div>
        <button onClick={logout} className="cursor-pointer rounded-md border border-line bg-white px-3 py-1.5 text-[13px]">Sign out</button>
      </header>
      {err && <p role="alert" className="mb-3 rounded-[10px] border border-[#f3b8b1] bg-[#fdecea] px-3 py-2 text-[14px] text-[#7a1a12]">{err}</p>}
      {portal.exams.length === 0 && <p className={`${card} text-center text-muted`}>No exams are scheduled for your class.</p>}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {portal.exams.map((ex) => (
          <li key={ex.id} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <b className="text-[17px] text-ink">{ex.title}</b>
                <p className="m-0 text-[13px] text-muted">{ex.subject} · {ex.duration_min} minutes{Number(ex.total_marks) ? ` · ${ex.total_marks} marks` : ""}</p>
                <p className="m-0 text-[13px] text-muted">{ist(ex.starts_at)} to {ist(ex.ends_at)}</p>
              </div>
              <div className="text-right">
                {ex.state === "open" && <button className={btn} onClick={() => { setCur(ex); setCode(""); setErr(null); setView("pre"); }}>Start</button>}
                {ex.state === "running" && <button className={btn} onClick={() => { setCur(ex); void begin(ex); }}>Continue</button>}
                {ex.state === "upcoming" && <span className="rounded-full bg-[#eef1f6] px-3 py-1 text-[13px] font-semibold text-body">Not open yet</span>}
                {ex.state === "missed" && <span className="rounded-full bg-[#f1f2f4] px-3 py-1 text-[13px] font-semibold text-muted">Closed</span>}
                {ex.state === "done" && (
                  ex.score !== null ? <b className="text-[18px] text-ink">{ex.score} / {ex.max_score}</b>
                    : <span className="rounded-full bg-[#f0fdf4] px-3 py-1 text-[13px] font-semibold text-[#15803d]">Submitted</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  if (view === "pre" && cur) return (
    <div className={shell}>
      <div className={`${card} flex flex-col gap-3`}>
        <h1 className="m-0 text-[22px] font-extrabold text-ink">{cur.title}</h1>
        <p className="m-0 text-[14px] text-muted">{cur.subject} · {cur.duration_min} minutes{Number(cur.total_marks) ? ` · ${cur.total_marks} marks` : ""}</p>
        <ul className="m-0 list-disc pl-5 text-[14px] text-body">
          <li>The clock starts when you press <b>Start exam</b> and cannot be paused. It keeps running even if you close the page.</li>
          <li>Your answers are saved as you choose them. Press <b>Submit</b> when you finish — or the exam submits itself when time ends.</li>
          <li>The exam opens in <b>full screen</b>. Leaving the screen, switching tabs or windows is recorded and too many times ends your exam.</li>
          <li>Copy, paste, right-click and printing are disabled. Work alone.</li>
        </ul>
        {cur.needs_code && <label className="flex flex-col gap-1 text-[14px] font-semibold text-ink">Exam code (from your teacher)<input value={code} onChange={(e) => setCode(e.target.value)} className={inp} autoComplete="off" /></label>}
        {err && <p role="alert" className="m-0 rounded-[10px] border border-[#f3b8b1] bg-[#fdecea] px-3 py-2 text-[14px] text-[#7a1a12]">{err}</p>}
        <div className="flex flex-wrap gap-3">
          <button disabled={busy || (cur.needs_code && !code.trim())} className={btn} onClick={() => void begin(cur)}>{busy ? "Starting…" : "Start exam"}</button>
          <button className="cursor-pointer rounded-[12px] border border-line bg-white px-5 py-3 text-[16px]" onClick={() => setView("portal")}>Back</button>
        </div>
      </div>
    </div>
  );

  if (view === "exam" && st) {
    const q = st.questions[idx];
    const answered = st.questions.filter((x) => (answers[x.id] ?? []).length > 0).length;
    const low = left <= 120;
    return (
      <div className="select-none" onCopy={(e) => e.preventDefault()}>
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-2">
          <div className="min-w-0"><b className="block truncate text-[15px] text-ink">{st.exam.title}</b><span className="text-[12px] text-muted">{answered} of {st.questions.length} answered · {saveState === "saving" ? "saving…" : saveState === "error" ? "not saved — check network" : "saved"}</span></div>
          <div className={`rounded-[10px] px-3 py-1.5 font-mono text-[20px] font-bold ${low ? "bg-[#fef2f2] text-[#b91c1c]" : "bg-[#eff6ff] text-[#1d4ed8]"}`} aria-live="off">{mmss(left)}</div>
        </header>
        {(warn || (st.exam.max_tab_switches > 0 && switches > 0)) && (
          <p role="alert" className="m-0 border-b border-[#f1d39a] bg-[#fff4e0] px-4 py-2 text-[13px] text-[#7a4b00]">
            {warn ?? `Screen switches so far: ${switches} of ${st.exam.max_tab_switches}.`} <button onClick={() => { setWarn(null); void enterFullscreen(); }} className="cursor-pointer border-0 bg-transparent p-0 text-[13px] underline">Return to full screen</button>
          </p>
        )}
        <div className="mx-auto grid max-w-5xl gap-4 px-4 py-4 lg:grid-cols-[1fr_220px]">
          <main className={card}>
            <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-muted">Question {idx + 1} of {st.questions.length} · {q.marks} mark{Number(q.marks) === 1 ? "" : "s"}{st.exam.negative_marking && Number(q.neg) > 0 ? ` · −${q.neg} for a wrong answer` : ""}{q.kind === "multi" ? " · choose all correct answers" : ""}</p>
            <p className="my-3 text-[18px] leading-relaxed text-ink" style={{ whiteSpace: "pre-wrap" }}>{q.text}</p>
            <div role={q.kind === "multi" ? "group" : "radiogroup"} aria-label="Options" className="flex flex-col gap-2">
              {q.options.map((o) => {
                const on = (answers[q.id] ?? []).includes(o.id);
                return (
                  <button key={o.id} type="button" role={q.kind === "multi" ? "checkbox" : "radio"} aria-checked={on} onClick={() => void choose(q, o.id)}
                    className={`flex cursor-pointer items-center gap-3 rounded-[12px] border-2 px-4 py-3 text-left text-[16px] ${on ? "border-[#2563eb] bg-[#eff6ff]" : "border-line bg-white"}`}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center border-2 text-[13px] font-bold ${q.kind === "multi" ? "rounded-md" : "rounded-full"} ${on ? "border-[#2563eb] bg-[#2563eb] text-white" : "border-[#c4cad4] text-transparent"}`}>✓</span>
                    <span>{o.text}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <span className="flex gap-2">
                <button disabled={idx === 0} onClick={() => setIdx(idx - 1)} className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2 disabled:opacity-40">← Previous</button>
                <button disabled={idx === st.questions.length - 1} onClick={() => setIdx(idx + 1)} className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2 disabled:opacity-40">Next →</button>
              </span>
              <span className="flex gap-3 text-[13px]">
                <button onClick={() => void clear(q)} className="cursor-pointer border-0 bg-transparent p-0 text-muted underline">Clear answer</button>
                <button onClick={() => setMarked((m) => { const n = new Set(m); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; })} className="cursor-pointer border-0 bg-transparent p-0 text-[#b45309] underline">{marked.has(q.id) ? "Unmark review" : "Mark for review"}</button>
              </span>
            </div>
          </main>
          <aside className={card}>
            <p className="mt-0 mb-2 text-[13px] font-bold text-ink">Questions</p>
            <div className="grid grid-cols-5 gap-1.5">
              {st.questions.map((x, i) => {
                const done = (answers[x.id] ?? []).length > 0;
                return <button key={x.id} onClick={() => setIdx(i)} aria-label={`Question ${i + 1}${done ? ", answered" : ""}`}
                  className={`cursor-pointer rounded-md border py-1.5 text-[13px] font-semibold ${i === idx ? "border-[#1d4ed8] ring-2 ring-[#93c5fd]" : "border-line"} ${marked.has(x.id) ? "bg-[#fef3c7]" : done ? "bg-[#dcfce7]" : "bg-white"}`}>{i + 1}</button>;
              })}
            </div>
            <p className="mt-3 mb-0 text-[11px] text-muted">Green answered · yellow marked · white not answered</p>
            <button onClick={() => setConfirm(true)} className={`${btn} mt-4 w-full`}>Submit exam</button>
          </aside>
        </div>
        {confirm && (
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
            <div className={`${card} max-w-sm`}>
              <h2 className="m-0 text-[18px] font-bold text-ink">Submit your exam?</h2>
              <p className="my-3 text-[14px] text-body">You answered <b>{answered}</b> of <b>{st.questions.length}</b> questions{marked.size ? `; ${marked.size} marked for review` : ""}. You cannot change anything after submitting.</p>
              <div className="flex gap-3"><button disabled={busy} onClick={() => void finish()} className={btn}>{busy ? "Submitting…" : "Yes, submit"}</button><button onClick={() => setConfirm(false)} className="cursor-pointer rounded-[12px] border border-line bg-white px-5 py-3 text-[16px]">Keep writing</button></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === "result" && result) return (
    <div className={shell}>
      <div className={`${card} flex flex-col gap-3 text-center`}>
        <div className="text-[48px]">{result.terminated ? "⚠️" : "✅"}</div>
        <h1 className="m-0 text-[22px] font-extrabold text-ink">{result.terminated ? "Your exam was ended" : "Exam submitted"}</h1>
        <p className="m-0 text-[14px] text-muted">{result.title}</p>
        {result.terminated && <p className="m-0 text-[14px] text-body">It ended because you left the exam screen too many times. Your answers up to that point were saved. Please meet your teacher.</p>}
        {result.shown && result.score !== null ? (
          <>
            <p className="m-0 text-[36px] font-extrabold text-ink">{result.score} <span className="text-[18px] font-semibold text-muted">/ {result.max_score}</span></p>
            <p className="m-0 text-[14px]">Correct {result.correct} · Wrong {result.wrong} · Not answered {result.skipped}{result.passed !== null ? ` · ${result.passed ? "Passed" : "Not passed"}` : ""}</p>
          </>
        ) : <p className="m-0 text-[14px] text-body">Your answers are recorded. Your score will be shown when the school declares the result.</p>}
        {result.review?.length > 0 && (
          <div className="mt-2 text-left">
            <h2 className="mb-2 text-[16px] font-bold text-ink">Review</h2>
            <ol className="m-0 flex list-decimal flex-col gap-3 pl-5 text-[14px]">
              {result.review.map((r, i) => (
                <li key={i}>
                  <p className="m-0 text-ink">{r.text}</p>
                  <ul className="m-0 mt-1 list-none p-0">
                    {r.options.map((o) => (
                      <li key={o.id} className={r.correct.includes(o.id) ? "font-semibold text-[#15803d]" : r.chosen.includes(o.id) ? "text-error" : "text-muted"}>
                        {r.correct.includes(o.id) ? "✓ " : r.chosen.includes(o.id) ? "✗ " : "• "}{o.text}
                      </li>
                    ))}
                  </ul>
                  {r.explanation && <p className="m-0 mt-1 text-[12px] text-muted">{r.explanation}</p>}
                </li>
              ))}
            </ol>
          </div>
        )}
        <button onClick={() => void toPortal()} className={`${btn} self-center`}>Back to my exams</button>
      </div>
    </div>
  );

  return <div className={shell}><p className="text-center text-muted">{err ?? "Loading…"}</p></div>;
}
