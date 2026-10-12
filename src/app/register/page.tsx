import Link from "next/link";
import { RegisterForm } from "./RegisterForm";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata = { title: "Register your school" };

export default function Register() {
  return (
    <div className="page-bg min-h-screen"><div className="mx-auto max-w-[640px] px-4 py-12">
      <p className="m-0 mb-6 text-center font-mono text-[12px] tracking-[0.08em] text-blue uppercase">{brand.product}</p>
      <div className="rounded-[20px] border border-line border-t-4 border-t-blue bg-white p-8 shadow-[var(--shadow-raised)]">
        <h1 className="m-0 text-[24px] font-extrabold text-ink">Register your school</h1>
        <p className="mt-2 mb-0 text-[15px]">Free trial with every module: admissions, fees with WhatsApp reminders, attendance, exams and a parent page. No card needed. We confirm new schools on a short call, usually the same day.</p>
        <RegisterForm />
      </div>
      <p className="mt-6 text-center text-[14px]">Already registered? <Link href="/login" className="font-semibold">Sign in</Link></p>
    </div></div>
  );
}
