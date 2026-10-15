"use client";

import { useState } from "react";
import { saveQuestion } from "@/app/app/_actions/online-exams";

type Opt = { id: string; text: string };
export type QuestionInit = { id: string; class_id: string; subject_id: string; kind: string; text: string; options: Opt[]; answer: string[]; marks: number; negative_marks: number;
  difficulty: string; chapter: string | null; explanation: string | null; active: boolean };

/** Add / edit one question: single answer, multiple answers or true / false. */
export function QuestionForm({ classes, subjects, initial, back, defaults }: {
  classes: { id: string; name: string }[]; subjects: { id: string; name: string }[]; initial?: QuestionInit; back: string; defaults?: { class_id?: string; subject_id?: string };
}) {
  const [kind, setKind] = useState(initial?.kind ?? "single");
  const [n, setN] = useState(Math.max(initial?.kind === "truefalse" ? 4 : initial?.options.length ?? 4, 2));
  const [correct, setCorrect] = useState<string[]>(initial?.kind === "truefalse" ? [] : initial?.answer ?? []);
  const opts = initial?.kind === "truefalse" ? [] : initial?.options ?? [];
  const L = "abcdefgh";
  const lbl = "flex flex-col gap-1 text-[13px] font-semibold text-ink";
  const inp = "input !min-h-10 !py-2 text-[15px] font-normal";

  const toggle = (id: string) => {
    if (kind === "single") setCorrect([id]);
    else setCorrect((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };

  return (
    <form action={saveQuestion} className="grid gap-3 sm:grid-cols-2">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="back" value={back} />
      <label className={lbl}>Class
        <select name="class_id" required defaultValue={initial?.class_id ?? defaults?.class_id ?? ""} className={inp}><option value="" disabled>Choose…</option>{classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}</select>
      </label>
      <label className={lbl}>Subject
        <select name="subject_id" required defaultValue={initial?.subject_id ?? defaults?.subject_id ?? ""} className={inp}><option value="" disabled>Choose…</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </label>
      <label className={lbl}>Type
        <select name="kind" value={kind} onChange={(e) => { setKind(e.target.value); setCorrect([]); }} className={inp}>
          <option value="single">Single answer (MCQ)</option><option value="multi">Multiple answers</option><option value="truefalse">True / False</option>
        </select>
      </label>
      <label className={lbl}>Chapter / topic<input name="chapter" defaultValue={initial?.chapter ?? ""} maxLength={80} className={inp} placeholder="Numbers" /></label>
      <label className={`${lbl} sm:col-span-2`}>Question<textarea name="text" required rows={3} defaultValue={initial?.text} maxLength={2000} className={`${inp} !min-h-20`} /></label>

      {kind === "truefalse" ? (
        <fieldset className="m-0 flex gap-4 border-0 p-0 text-[14px] sm:col-span-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink">Correct answer</legend>
          <label className="flex items-center gap-1.5"><input type="radio" name="tf" value="t" defaultChecked={initial?.answer?.[0] !== "f"} /> True</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="tf" value="f" defaultChecked={initial?.answer?.[0] === "f"} /> False</label>
        </fieldset>
      ) : (
        <fieldset className="m-0 grid gap-2 border-0 p-0 sm:col-span-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink">Options — tick {kind === "single" ? "the correct one" : "all correct ones"}</legend>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type={kind === "single" ? "radio" : "checkbox"} name={kind === "single" ? "correct_single" : "correct"} value={L[i]} checked={correct.includes(L[i])}
                onChange={() => toggle(L[i])} aria-label={`Option ${L[i].toUpperCase()} is correct`} />
              {/* single-answer radios are mirrored into one hidden "correct" field */}
              {kind === "single" && correct.includes(L[i]) && <input type="hidden" name="correct" value={L[i]} />}
              <span className="w-5 text-[13px] font-bold text-muted">{L[i].toUpperCase()}</span>
              <input name={`opt_${i}`} defaultValue={opts[i]?.text ?? ""} maxLength={300} placeholder={`Option ${L[i].toUpperCase()}`} className={`${inp} flex-1`} />
            </div>
          ))}
          <div className="flex gap-3 text-[13px]">
            {n < 8 && <button type="button" onClick={() => setN(n + 1)} className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">+ Add option</button>}
            {n > 2 && <button type="button" onClick={() => { setCorrect((c) => c.filter((x) => x !== L[n - 1])); setN(n - 1); }} className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Remove last</button>}
          </div>
        </fieldset>
      )}

      <label className={lbl}>Marks<input name="marks" type="number" step="0.5" min={0.5} defaultValue={initial?.marks ?? 1} className={inp} /></label>
      <label className={lbl}>Negative marks (if the exam uses them)<input name="negative_marks" type="number" step="0.25" min={0} defaultValue={initial?.negative_marks ?? 0} className={inp} /></label>
      <label className={lbl}>Difficulty
        <select name="difficulty" defaultValue={initial?.difficulty ?? "medium"} className={inp}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
      </label>
      <label className="flex items-center gap-2 pt-6 text-[14px]"><input type="checkbox" name="inactive" value="1" defaultChecked={initial ? !initial.active : false} /> Keep out of exams (inactive)</label>
      <label className={`${lbl} sm:col-span-2`}>Explanation shown in review (optional)<input name="explanation" defaultValue={initial?.explanation ?? ""} maxLength={600} className={inp} /></label>
      <div className="sm:col-span-2"><button className="btn btn-sm btn-primary cursor-pointer border-0">{initial ? "Save question" : "Add question"}</button></div>
    </form>
  );
}
