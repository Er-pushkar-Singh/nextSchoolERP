import { headers } from "next/headers";
import { LoginForm } from "./LoginForm";
import { brand } from "@/lib/brand";
import { Icon } from "@/components/shell/icons";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

type Tenant = { id: string; name: string; logo_url: string | null; brand_color: string | null };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/app" } = await searchParams;
  // On a school's own subdomain / domain, show that school's name and logo
  let tenant: Tenant | null = null;
  if (supabaseConfigured()) {
    const host = (await headers()).get("host") ?? "";
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc("tenant_by_host", { h: host });
    tenant = ((data ?? []) as Tenant[])[0] ?? null;
  }
  const color = tenant?.brand_color ?? null;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12" style={{ background: color ? `linear-gradient(150deg, ${color}, #0a1a4a)` : "linear-gradient(150deg, #2563eb 0%, #12317f 55%, #0a1a4a 100%)" }}>
        <div aria-hidden="true" className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden="true" className="absolute bottom-10 -left-16 h-64 w-64 rounded-full bg-[#60a5fa]/20 blur-2xl" />
        <div className="relative flex items-center gap-3 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-[18px] font-extrabold">{tenant ? tenant.name.slice(0, 2).toUpperCase() : <Icon name="academics" size={22} />}</span>
          <span className="text-[17px] font-extrabold">{tenant?.name ?? brand.product}</span>
        </div>
        <div className="relative max-w-[460px] text-white">
          <h2 className="m-0 text-[38px] leading-[1.1] font-extrabold tracking-[-0.02em]">Run your whole school from one screen.</h2>
          <ul className="mt-6 mb-0 flex list-none flex-col gap-3 p-0 text-[16px] text-[#dbe6ff]">
            <li>✓ Admissions, attendance and exams</li>
            <li>✓ Fees with UPI, Razorpay and WhatsApp reminders</li>
            <li>✓ Role-based access for every staff member</li>
            <li>✓ Parents see fees, results and notices on their phone</li>
          </ul>
        </div>
        <p className="relative m-0 text-[13px] text-[#a9bdf0]">{brand.product} · Made in India</p>
      </aside>
      <main className="page-bg flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-[420px]">
          {tenant ? (
            <div className="mb-6 flex flex-col items-center gap-2 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- school logos are arbitrary URLs */}
              {tenant.logo_url ? <img src={tenant.logo_url} alt="" className="h-16 w-16 object-contain" /> : <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-xl text-[18px] font-extrabold text-white" style={{ background: color ?? "#2563eb" }}>{tenant.name.slice(0, 2).toUpperCase()}</span>}
              <p className="m-0 text-[18px] font-extrabold text-ink">{tenant.name}</p>
            </div>
          ) : <p className="m-0 mb-6 text-center font-mono text-[12px] tracking-[0.08em] text-blue uppercase lg:hidden">{brand.product}</p>}
          <div className="rounded-[20px] border border-line bg-white p-8 shadow-[var(--shadow-raised)]" style={color ? { borderTop: `4px solid ${color}` } : undefined}>
            <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.01em] text-ink">Welcome back</h1>
            <p className="m-0 mt-1 text-[14px] text-muted">Sign in to continue.</p>
            {supabaseConfigured() ? <LoginForm next={next} /> : <p className="mt-4 mb-0">Supabase is not configured. See README.</p>}
          </div>
          {!tenant && <p className="mt-6 text-center text-[14px]">New school? <a href="/register" className="font-semibold">Start a free trial</a></p>}
          <p className="mt-2 text-center text-[13px] text-muted">Parents: use the private link your school shared on WhatsApp.{tenant ? ` · ${brand.product}` : ""}</p>
        </div>
      </main>
    </div>
  );
}
