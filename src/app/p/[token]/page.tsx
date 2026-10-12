import type { Metadata } from "next";
import Link from "next/link";
import { portalStudent } from "@/lib/portal";
import { classResults } from "@/lib/results";
import { balance, pct, type Due } from "@/lib/erp";
import { fmtDate, fullName, money, todayIST } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Student", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Parent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { db, s } = await portalStudent(token);
  const school = s.schools;
  const today = todayIST();
  const { data: session } = await db.from("sessions").select("id,name,start_date,end_date").eq("school_id", s.school_id).eq("is_current", true).maybeSingle();

  const [{ data: dues }, { data: receipts }, { data: att }, { data: notices }, { data: exams }] = await Promise.all([
    db.from("fee_dues").select("id,label,due_date,amount,concession,fine,paid,status").eq("student_id", s.id).order("due_date"),
    db.from("fee_receipts").select("id,receipt_no,paid_on,amount,mode").eq("student_id", s.id).eq("cancelled", false).order("paid_on", { ascending: false }).limit(30),
    session ? db.from("attendance").select("date,status").eq("student_id", s.id).gte("date", session.start_date).lte("date", session.end_date).order("date", { ascending: false }).limit(400) : Promise.resolve({ data: [] }),
    db.from("notices").select("id,title,body,published_on,class_id").eq("school_id", s.school_id).or(`class_id.is.null${s.class_id ? `,class_id.eq.${s.class_id}` : ""}`).order("published_on", { ascending: false }).limit(10),
    session ? db.from("exams").select("id,name").eq("session_id", session.id).eq("published", true).order("sort") : Promise.resolve({ data: [] }),
  ]);
  const D = (dues ?? []) as Due[];
  const unpaid = D.filter((d) => balance(d) > 0);
  const overdue = unpaid.filter((d) => d.due_date <= today).reduce((t, d) => t + balance(d), 0);
  const total = unpaid.reduce((t, d) => t + balance(d), 0);
  const payNow = overdue || total;
  const A = (att ?? []) as { date: string; status: string }[];
  const present = A.filter((a) => ["P", "L", "H"].includes(a.status)).length;
  const absences = A.filter((a) => a.status === "A").slice(0, 10);
  let results: Awaited<ReturnType<typeof classResults>> | null = null;
  if (s.class_id && (exams ?? []).length) {
    const { data: mates } = await db.from("students").select("id").eq("school_id", s.school_id).eq("class_id", s.class_id).eq("status", "active");
    results = await classResults(db, s.class_id, exams as { id: string; name: string }[], [...new Set([s.id, ...(mates ?? []).map((m) => m.id)])], school.grade_scale);
  }
  const res = results?.get(s.id) ?? [];
  const name = fullName(s);
  const upi = school.upi_id && payNow > 0
    ? `upi://pay?${new URLSearchParams({ pa: school.upi_id, pn: school.name.slice(0, 40), am: payNow.toFixed(2), cu: "INR", tn: `Fee ${s.admission_no} ${name}`.slice(0, 60) })}`
    : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="text-center">
        <h1 className="m-0 text-[22px] font-extrabold text-ink">{school.name}</h1>
        <p className="m-0 text-[13px] text-muted">{[school.address, school.city].filter(Boolean).join(", ")}{school.phone ? ` · ${school.phone}` : ""}</p>
      </header>
      <section className="rounded-[12px] border border-line bg-white p-4">
        <p className="m-0 text-[20px] font-bold text-ink">{name}</p>
        <p className="m-0 text-[14px] text-muted">Class {s.classes?.name ?? "—"}{s.sections ? `-${s.sections.name}` : ""} · Adm. no. {s.admission_no}{s.father_name ? ` · ${s.father_name}` : ""}</p>
      </section>

      <section className="rounded-[12px] border border-line bg-white p-4">
        <h2 className="m-0 mb-2 text-[17px] font-bold text-ink">Fees {session ? `· ${session.name}` : ""}</h2>
        {total > 0 ? (
          <>
            <p className="m-0 text-[15px]">{overdue > 0 ? <>Due now: <b className="text-[20px] text-error">{money(overdue)}</b></> : <>Nothing overdue. </>} <span className="text-muted">· Rest of the session: {money(total)}</span></p>
            {upi && (
              <div className="mt-3 flex flex-col gap-2">
                <a href={upi} className="btn btn-wa">Pay {money(payNow)} by UPI</a>
                <p className="m-0 text-center text-[12px] text-muted">Opens GPay / PhonePe / Paytm on your phone. UPI ID: <b>{school.upi_id}</b>. After paying, send the screenshot to the school office — the receipt is issued when the school records it.</p>
                <div className="flex justify-center"><CopyButton text={school.upi_id!} label="Copy UPI ID" /></div>
              </div>
            )}
            {school.bank_details && <p className="mt-2 mb-0 text-[13px] whitespace-pre-line text-muted">Bank: {school.bank_details}</p>}
            <ul className="m-0 mt-3 list-none p-0 text-[14px]">
              {unpaid.map((d) => (
                <li key={d.id} className="flex justify-between gap-2 border-t border-line py-1.5">
                  <span>{d.label} <span className="text-muted">· {fmtDate(d.due_date)}</span></span>
                  <b className={d.due_date <= today ? "text-error" : "text-ink"}>{money(balance(d))}</b>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="m-0 text-[15px] text-[#0b4f2c]">{D.length ? "All fees are paid. Thank you! ✓" : "No fees billed yet."}</p>}
        {(receipts ?? []).length > 0 && (
          <details className="mt-3 text-[14px]"><summary className="cursor-pointer text-blue">Receipts ({(receipts ?? []).length})</summary>
            <ul className="m-0 mt-2 list-none p-0">
              {(receipts ?? []).map((r) => (
                <li key={r.id} className="flex justify-between gap-2 border-t border-line py-1.5">
                  <Link href={`/p/${token}/r/${r.id}`} className="font-mono text-[13px]">{r.receipt_no}</Link>
                  <span className="text-muted">{fmtDate(r.paid_on)}</span><b>{money(r.amount)}</b>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="rounded-[12px] border border-line bg-white p-4">
        <h2 className="m-0 mb-2 text-[17px] font-bold text-ink">Attendance</h2>
        {A.length ? (
          <>
            <p className="m-0 text-[15px]"><b className="text-[20px] text-ink">{pct(present, A.length)}%</b> <span className="text-muted">· present {present} of {A.length} days this session</span></p>
            {absences.length > 0 && <p className="mt-2 mb-0 text-[13px] text-muted">Recent absences: {absences.map((a) => fmtDate(a.date)).join(", ")}</p>}
          </>
        ) : <p className="m-0 text-[14px] text-muted">Not recorded yet.</p>}
      </section>

      {res.length > 0 && (
        <section className="rounded-[12px] border border-line bg-white p-4">
          <h2 className="m-0 mb-2 text-[17px] font-bold text-ink">Results</h2>
          {res.map((r) => (
            <details key={r.exam.id} className="border-t border-line py-2 first:border-0" open={r === res[res.length - 1]}>
              <summary className="cursor-pointer text-[15px]"><b className="text-ink">{r.exam.name}</b> · {r.total}/{r.max} · {r.percent}% · Grade {r.grade}{r.rank ? ` · Rank ${r.rank}` : ""}</summary>
              <table className="mt-2 w-full text-[14px]"><tbody>
                {r.rows.map((x) => <tr key={x.subject} className="border-t border-line"><td className="py-1">{x.subject}</td><td className="py-1 text-right">{x.absent ? "Absent" : x.marks === null ? "—" : `${x.marks}/${x.max}`}</td><td className="w-12 py-1 text-right">{x.grade}</td></tr>)}
              </tbody></table>
            </details>
          ))}
        </section>
      )}

      {(notices ?? []).length > 0 && (
        <section className="rounded-[12px] border border-line bg-white p-4">
          <h2 className="m-0 mb-2 text-[17px] font-bold text-ink">Notices</h2>
          {(notices ?? []).map((n) => (
            <div key={n.id} className="border-t border-line py-2 first:border-0">
              <p className="m-0 text-[15px] font-semibold text-ink">{n.title} <span className="text-[12px] font-normal text-muted">· {fmtDate(n.published_on)}</span></p>
              {n.body && <p className="m-0 mt-1 text-[14px] whitespace-pre-line">{n.body}</p>}
            </div>
          ))}
        </section>
      )}
      <p className="text-center text-[12px] text-muted">This private link is only for {name}'s family — please don't share it.</p>
    </div>
  );
}
