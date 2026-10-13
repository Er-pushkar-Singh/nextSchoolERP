import type { Metadata } from "next";
import Link from "next/link";
import { portalStudent } from "@/lib/portal";
import { classResults } from "@/lib/results";
import { balance, pct, type Due } from "@/lib/erp";
import { addDays, fmtDate, fullName, money, todayIST } from "@/lib/format";
import { fmtTime } from "@/lib/transport";
import { CopyButton } from "@/components/CopyButton";
import { resolveIntegration } from "@/lib/integrations";
import { startOnlinePayment } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Student", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Parent({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string; pay_error?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const { db, s } = await portalStudent(token);
  const school = s.schools;
  const today = todayIST();
  if (s.blocked_at && (!s.blocked_till || s.blocked_till >= today)) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
        <h1 className="m-0 text-[22px] font-extrabold text-ink">{school.name}</h1>
        <p className="m-0 rounded-[12px] border border-line bg-white p-5 text-[15px]">This page is not available right now. Please contact the school office{school.phone ? ` on ${school.phone}` : ""}.</p>
      </div>
    );
  }
  const { data: session } = await db.from("sessions").select("id,name,start_date,end_date").eq("school_id", s.school_id).eq("is_current", true).maybeSingle();

  const [{ data: dues }, { data: receipts }, { data: att }, { data: notices }, { data: exams }] = await Promise.all([
    db.from("fee_dues").select("id,label,due_date,amount,concession,fine,paid,status").eq("student_id", s.id).order("due_date"),
    db.from("fee_receipts").select("id,receipt_no,paid_on,amount,mode").eq("student_id", s.id).eq("cancelled", false).order("paid_on", { ascending: false }).limit(30),
    session ? db.from("attendance").select("date,status").eq("student_id", s.id).gte("date", session.start_date).lte("date", session.end_date).order("date", { ascending: false }).limit(400) : Promise.resolve({ data: [] }),
    db.from("notices").select("id,title,body,published_on,class_id").eq("school_id", s.school_id).or(`class_id.is.null${s.class_id ? `,class_id.eq.${s.class_id}` : ""}`).order("published_on", { ascending: false }).limit(10),
    session ? db.from("exams").select("id,name").eq("session_id", session.id).eq("published", true).order("sort") : Promise.resolve({ data: [] }),
  ]);
  // Standard-plan modules: shown only when the school has the module switched on
  const { data: mods } = await db.from("school_modules").select("module_code").eq("school_id", s.school_id).eq("licensed", true).eq("enabled", true).in("module_code", ["homework", "transport", "library"]);
  const on = new Set((mods ?? []).map((m) => m.module_code));
  const since = addDays(today, -14);
  const [{ data: hw }, { data: ride }, { data: books }] = await Promise.all([
    on.has("homework") && s.class_id
      ? db.from("homework").select("id,kind,title,details,link_url,assigned_on,due_on,subjects(name)").eq("class_id", s.class_id)
          .or(`section_id.is.null${s.section_id ? `,section_id.eq.${s.section_id}` : ""}`)
          .eq("school_id", s.school_id).filter("session_id", session ? "eq" : "is", session ? session.id : null).order("assigned_on", { ascending: false }).limit(80)
      : Promise.resolve({ data: [] }),
    on.has("transport") && session
      ? db.from("transport_allocations").select("trip,end_date,transport_stops(name,pickup_time,drop_time),transport_routes(name,transport_vehicles(reg_no,driver_name,driver_phone,attendant_name,attendant_phone))")
          .eq("student_id", s.id).eq("session_id", session.id).is("end_date", null).maybeSingle()
      : Promise.resolve({ data: null }),
    on.has("library") ? db.from("library_issues").select("id,due_on,library_books(title)").eq("student_id", s.id).is("returned_on", null).order("due_on") : Promise.resolve({ data: [] }),
  ]);
  type Hw = { id: string; kind: string; title: string; details: string | null; link_url: string | null; assigned_on: string; due_on: string | null; subjects: { name: string } | null };
  const HW = ((hw ?? []) as unknown as Hw[]);
  // homework of the last two weeks or still to be submitted; all study material
  const homework = HW.filter((h) => h.kind === "homework" && (h.assigned_on >= since || (h.due_on ?? "") >= today));
  const material = HW.filter((h) => h.kind === "material");
  const R = ride as unknown as { trip: string; transport_stops: { name: string; pickup_time: string | null; drop_time: string | null } | null;
    transport_routes: { name: string; transport_vehicles: { reg_no: string; driver_name: string | null; driver_phone: string | null; attendant_name: string | null; attendant_phone: string | null } | null } | null } | null;
  const L = (books ?? []) as unknown as { id: string; due_on: string; library_books: { title: string } | null }[];
  const D = (dues ?? []) as Due[];
  const unpaid = D.filter((d) => balance(d) > 0);
  const overdue = unpaid.filter((d) => d.due_date <= today).reduce((t, d) => t + balance(d), 0);
  const total = unpaid.reduce((t, d) => t + balance(d), 0);
  const payNow = overdue || total;
  const [{ data: feeSet }, rz] = await Promise.all([
    db.from("fee_settings").select("online_enabled,online_min_amount,online_allow_partial").eq("school_id", s.school_id).maybeSingle(),
    resolveIntegration(s.school_id, "razorpay"),
  ]);
  const online = !!feeSet?.online_enabled && rz?.source === "school" && s.status === "active" && total > 0;
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
        {sp.paid && <p className="m-0 mb-2 rounded-[8px] bg-wa-tint p-2 text-[14px] text-[#0b4f2c]">Thank you! Your payment is being confirmed — the receipt will show below in a minute.</p>}
        {sp.pay_error && <p className="m-0 mb-2 rounded-[8px] bg-[#fdecea] p-2 text-[14px] text-[#7a1a12]">{sp.pay_error.slice(0, 200)}</p>}
        {total > 0 ? (
          <>
            <p className="m-0 text-[15px]">{overdue > 0 ? <>Due now: <b className="text-[20px] text-error">{money(overdue)}</b></> : <>Nothing overdue. </>} <span className="text-muted">· Rest of the session: {money(total)}</span></p>
            {online && (
              <form action={startOnlinePayment} className="mt-3 flex flex-col gap-2 rounded-[10px] bg-wa-tint p-3">
                <input type="hidden" name="token" value={token} />
                <label className="text-[13px] font-semibold text-ink">Amount to pay (₹)
                  <input name="amount" type="number" step="0.01" min={Number(feeSet?.online_min_amount ?? 1)} max={total} defaultValue={payNow} readOnly={feeSet?.online_allow_partial === false}
                    className="input mt-1 !min-h-11 w-full !py-2 text-[16px]" />
                </label>
                <button className="btn btn-wa cursor-pointer">Pay online (UPI / card / net banking)</button>
                <p className="m-0 text-center text-[12px] text-muted">Secure payment by Razorpay straight to the school. The receipt appears here automatically.</p>
              </form>
            )}
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

      {homework.length > 0 && (
        <section className="rounded-[12px] border border-line bg-white p-4">
          <h2 className="m-0 mb-2 text-[17px] font-bold text-ink">Homework</h2>
          {homework.map((h) => (
            <div key={h.id} className="border-t border-line py-2 first:border-0">
              <p className="m-0 text-[15px] font-semibold text-ink">{h.subjects ? `${h.subjects.name}: ` : ""}{h.title}</p>
              <p className="m-0 text-[12px] text-muted">Given {fmtDate(h.assigned_on)}{h.due_on ? <> · <span className={h.due_on < today ? "" : "font-semibold text-ink"}>submit by {fmtDate(h.due_on)}</span></> : ""}</p>
              {h.details && <p className="m-0 mt-1 text-[14px] whitespace-pre-line">{h.details}</p>}
              {h.link_url && <a href={h.link_url} target="_blank" rel="noopener noreferrer" className="text-[14px] break-all">{h.link_url}</a>}
            </div>
          ))}
        </section>
      )}

      {material.length > 0 && (
        <section className="rounded-[12px] border border-line bg-white p-4">
          <h2 className="m-0 mb-2 text-[17px] font-bold text-ink">Study material</h2>
          <ul className="m-0 list-none p-0 text-[14px]">
            {material.map((h) => (
              <li key={h.id} className="border-t border-line py-1.5 first:border-0">
                {h.link_url ? <a href={h.link_url} target="_blank" rel="noopener noreferrer" className="font-semibold">{h.title}</a> : <b className="text-ink">{h.title}</b>}
                {h.subjects ? <span className="text-muted"> · {h.subjects.name}</span> : null}
                {h.details && <div className="text-muted whitespace-pre-line">{h.details}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {R && (
        <section className="rounded-[12px] border border-line bg-white p-4">
          <h2 className="m-0 mb-2 text-[17px] font-bold text-ink">School transport</h2>
          <p className="m-0 text-[15px]"><b className="text-ink">{R.transport_routes?.name}</b> · stop <b className="text-ink">{R.transport_stops?.name}</b></p>
          <p className="m-0 text-[14px] text-muted">
            {R.trip !== "drop" && R.transport_stops?.pickup_time ? `Pickup ${fmtTime(R.transport_stops.pickup_time)}` : ""}
            {R.trip === "both" && R.transport_stops?.pickup_time && R.transport_stops?.drop_time ? " · " : ""}
            {R.trip !== "pickup" && R.transport_stops?.drop_time ? `Drop ${fmtTime(R.transport_stops.drop_time)}` : ""}
          </p>
          {R.transport_routes?.transport_vehicles && (() => {
            const v = R.transport_routes!.transport_vehicles!;
            return (
              <p className="mt-2 mb-0 text-[14px]">
                Vehicle <b className="font-mono">{v.reg_no}</b>
                {v.driver_name && <> · Driver {v.driver_name}{v.driver_phone && <> (<a href={`tel:${v.driver_phone}`}>{v.driver_phone}</a>)</>}</>}
                {v.attendant_name && <> · Attendant {v.attendant_name}{v.attendant_phone && <> (<a href={`tel:${v.attendant_phone}`}>{v.attendant_phone}</a>)</>}</>}
              </p>
            );
          })()}
        </section>
      )}

      {L.length > 0 && (
        <section className="rounded-[12px] border border-line bg-white p-4">
          <h2 className="m-0 mb-2 text-[17px] font-bold text-ink">Library books with {s.first_name}</h2>
          <ul className="m-0 list-none p-0 text-[14px]">
            {L.map((b) => (
              <li key={b.id} className="flex justify-between gap-2 border-t border-line py-1.5 first:border-0">
                <span>{b.library_books?.title}</span>
                <span className={b.due_on < today ? "font-semibold text-error" : "text-muted"}>{b.due_on < today ? "overdue since " : "return by "}{fmtDate(b.due_on)}</span>
              </li>
            ))}
          </ul>
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
