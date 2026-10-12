import Link from "next/link";
import { LuGraduationCap } from "react-icons/lu";

/** Brand mark. `dark` = on the navy sidebar. Shows the school's own logo when given. */
export function Logo({ name, href = "/app", sub, logoUrl, dark }: { name?: string; href?: string; sub?: string; logoUrl?: string | null; dark?: boolean }) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-3 no-underline">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-10 w-10 flex-none rounded-xl bg-white object-contain p-0.5" />
      ) : (
        <span aria-hidden="true" className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-[#60a5fa] via-[#2563eb] to-[#1e3a8a] text-white shadow-[0_6px_16px_rgb(37_99_235/0.35)]">
          <LuGraduationCap size={22} />
        </span>
      )}
      <span className="min-w-0">
        <span className={`block truncate text-[15.5px] leading-tight font-extrabold ${dark ? "text-white" : "text-ink"}`}>{name ?? "School ERP"}</span>
        {sub && <span className={`block truncate text-[12px] leading-tight ${dark ? "text-[#9fb3e6]" : "text-muted"}`}>{sub}</span>}
      </span>
    </Link>
  );
}
