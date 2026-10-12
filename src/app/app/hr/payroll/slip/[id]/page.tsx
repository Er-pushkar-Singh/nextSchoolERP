import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchool } from "@/lib/school";
import { PrintButton } from "@/components/ui/PrintButton";
import { amountInWords, fmtDate, money } from "@/lib/format";
import { monthName, type Line } from "@/lib/hr";

type Slip = {
  id: string; run_id: string; working_days: number; lop_days: number; earnings: Line[]; deductions: Line[]; gross: number; total_deductions: number;
  adjustment: number; adjustment_note: string | null; net: number; paid_on: string | null; pay_mode: string | null; pay_ref: string | null;
  payroll_runs: { month: string; status: string } | null;
  staff: { name: string; emp_code: string | null; designation: string | null; department: string | null; joining_date: string | null; bank_name: string | null; bank_account: string | null; pan: string | null; uan: string | null } | null;
};

/** Printable payslip. Payroll staff see every slip; everyone else only their own approved ones (Row Level Security). */
export default async function Payslip({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requireSchool();
  const { data } = await supabase.from("payslips")
    .select("id,run_id,working_days,lop_days,earnings,deductions,gross,total_deductions,adjustment,adjustment_note,net,paid_on,pay_mode,pay_ref,payroll_runs(month,status),staff(name,emp_code,designation,department,joining_date,bank_name,bank_account,pan,uan)")
    .eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!data) notFound();
  const p = data as unknown as Slip;
  const s = p.staff;
  const mask = (a: string | null) => (a ? `••••${a.slice(-4)}` : "—");
  const rows = Math.max(p.earnings.length, p.deductions.length + (Number(p.adjustment) < 0 ? 1 : 0), 1);
  const ded: Line[] = [...p.deductions, ...(Number(p.adjustment) < 0 ? [{ name: p.adjustment_note || "Recovery", amount: -Number(p.adjustment) }] : [])];
  const earn: Line[] = [...p.earnings, ...(Number(p.adjustment) > 0 ? [{ name: p.adjustment_note || "Bonus", amount: Number(p.adjustment) }] : [])];
  const cell = "border border-line px-3 py-1.5";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={can("hr.payroll.view") ? `/app/hr/payroll/${p.run_id}` : "/app/hr/leave"} className="text-[14px] font-semibold no-underline">← Back</Link>
        <PrintButton />
      </div>
      <article className="rounded-[12px] border border-line bg-white p-6 text-[14px] print:border-0 print:p-0">
        <header className="mb-4 flex items-start justify-between gap-4 border-b border-line pb-3">
          <div className="flex items-center gap-3">
            {school.logo_url && <img src={school.logo_url} alt="" className="h-12 w-12 object-contain" />}
            <div>
              <h1 className="m-0 text-[20px] font-extrabold text-ink">{school.name}</h1>
              <p className="m-0 text-[12px] text-muted">{[school.address, school.city, school.pincode].filter(Boolean).join(", ")}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="m-0 text-[16px] font-bold text-ink">Payslip</p>
            <p className="m-0 text-muted">{p.payroll_runs ? monthName(p.payroll_runs.month) : ""}{p.payroll_runs?.status === "draft" ? " · DRAFT" : ""}</p>
          </div>
        </header>
        <dl className="m-0 mb-4 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          {[["Name", s?.name], ["Employee code", s?.emp_code], ["Designation", [s?.designation, s?.department].filter(Boolean).join(", ")], ["Date of joining", fmtDate(s?.joining_date)],
            ["Days paid", `${Number(p.working_days) - Number(p.lop_days)} of ${p.working_days}`], ["Bank account", `${s?.bank_name ?? ""} ${mask(s?.bank_account ?? null)}`.trim()],
            ["PAN", s?.pan], ["UAN", s?.uan]].map(([k, v]) => (
            <div key={k}><dt className="text-[12px] text-muted">{k}</dt><dd className="m-0 font-semibold text-ink">{v || "—"}</dd></div>
          ))}
        </dl>
        <table className="w-full border-collapse">
          <thead><tr className="bg-blue-soft text-left text-[12.5px] uppercase"><th className={cell}>Earnings</th><th className={`${cell} text-right`}>₹</th><th className={cell}>Deductions</th><th className={`${cell} text-right`}>₹</th></tr></thead>
          <tbody>
            {Array.from({ length: Math.max(rows, earn.length, ded.length) }, (_, i) => (
              <tr key={i}>
                <td className={cell}>{earn[i]?.name ?? ""}</td><td className={`${cell} text-right`}>{earn[i] ? money(earn[i].amount) : ""}</td>
                <td className={cell}>{ded[i]?.name ?? ""}</td><td className={`${cell} text-right`}>{ded[i] ? money(ded[i].amount) : ""}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className={cell}>Total earnings</td><td className={`${cell} text-right`}>{money(earn.reduce((t, x) => t + Number(x.amount), 0))}</td>
              <td className={cell}>Total deductions</td><td className={`${cell} text-right`}>{money(ded.reduce((t, x) => t + Number(x.amount), 0))}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-4 mb-0 text-[16px]">Net pay: <b className="text-[20px] text-ink">{money(p.net)}</b></p>
        <p className="m-0 text-muted">{amountInWords(Number(p.net))}</p>
        {p.paid_on && <p className="mt-2 mb-0 text-[13px]">Paid on {fmtDate(p.paid_on)}{p.pay_ref ? ` · Ref ${p.pay_ref}` : ""}</p>}
        {Number(p.lop_days) > 0 && <p className="mt-2 mb-0 text-[12px] text-muted">Earnings are for {Number(p.working_days) - Number(p.lop_days)} of {p.working_days} days ({Number(p.lop_days)} day(s) without pay).</p>}
        <p className="mt-8 mb-0 text-[12px] text-muted">This is a computer-generated payslip.</p>
      </article>
    </div>
  );
}
