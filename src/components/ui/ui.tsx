import Link from "next/link";
import { label } from "@/lib/format";
import { Icon, type IconName } from "@/components/shell/icons";
import { FlashIcon } from "./FlashIcon";

export function PageHeader({ title, subtitle, actions, back, icon }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string }; icon?: IconName }) {
  return (
    <div className="flex flex-col gap-2">
      {back && <Link href={back.href} className="inline-flex w-fit items-center gap-1 text-[14px] font-semibold no-underline">← {back.label}</Link>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          {icon && (
            <span className="icon-tile h-12 w-12 bg-gradient-to-br from-[#3b82f6] to-[#1e40af] text-white shadow-[0_8px_20px_rgb(37_99_235/0.28)]">
              <Icon name={icon} size={24} />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="m-0 text-[24px] leading-tight font-extrabold tracking-[-0.015em] text-ink sm:text-[27px]">{title}</h1>
            {subtitle && <div className="mt-0.5 text-[14px] text-muted">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className = "", icon, description, id }: { id?: string; title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; icon?: IconName; description?: React.ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-20 rounded-[14px] border border-line bg-white p-5 shadow-[var(--shadow-card)] ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="icon-tile h-9 w-9 bg-blue-tint text-blue-strong"><Icon name={icon} size={18} /></span>}
            <div className="min-w-0">
              {title && <h2 className="m-0 text-[16px] font-bold text-ink">{title}</h2>}
              {description && <p className="m-0 text-[13px] text-muted">{description}</p>}
            </div>
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const tone: Record<string, string> = {
  // ERP
  due: "warn", partial: "warn", left: "muted", passed_out: "muted", visited: "info", test: "info", admitted: "good", published: "good",
  admin: "info", accountant: "neutral", reception: "neutral", teacher: "neutral", suspended: "bad", trial: "warn",
  // good
  won: "good", paid: "good", done: "good", delivered: "good", accepted: "good", active: "good",
  // in progress
  contacted: "info", qualified: "info", proposal: "info", in_progress: "info", doing: "info", sent: "info", review: "info", invoiced: "info",
  // attention
  new: "warn", partially_paid: "warn", overdue: "bad", urgent: "bad", high: "warn", on_hold: "warn", paused: "warn", planning: "neutral", todo: "neutral", pending: "neutral",
  // closed / negative
  lost: "muted", spam: "muted", cancelled: "muted", rejected: "muted", expired: "muted", draft: "neutral", low: "muted", normal: "neutral",
};
const toneClass: Record<string, string> = {
  good: "bg-wa-tint text-[#0b4f2c]",
  info: "bg-blue-tint text-blue-strong",
  warn: "bg-[#fff4e0] text-[#7a4b00]",
  bad: "bg-[#fdecea] text-[#7a1a12]",
  neutral: "bg-[#eef1f6] text-body",
  muted: "bg-[#f1f2f4] text-muted",
};
export function Badge({ value, text }: { value: string; text?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap ${toneClass[tone[value] ?? "neutral"]}`}>
      {text ?? label(value)}
    </span>
  );
}

const statTone = {
  blue: "from-[#3b82f6] to-[#1d4ed8]", green: "from-[#22c55e] to-[#0e7a43]", amber: "from-[#fbbf24] to-[#d97706]",
  rose: "from-[#fb7185] to-[#e11d48]", violet: "from-[#a78bfa] to-[#7c3aed]", cyan: "from-[#22d3ee] to-[#0891b2]",
} as const;

export function Stat({ label: l, value, hint, href, icon, tone: t = "blue" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; icon?: IconName; tone?: keyof typeof statTone }) {
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-medium text-muted">{l}</p>
        <p className="mt-1 mb-0 text-[24px] leading-tight font-extrabold tracking-[-0.01em] text-ink">{value}</p>
        {hint && <p className="m-0 mt-1 text-[12px] text-muted">{hint}</p>}
      </div>
      {icon && <span className={`icon-tile h-11 w-11 bg-gradient-to-br text-white ${statTone[t]}`}><Icon name={icon} size={20} /></span>}
    </div>
  );
  const cls = "rounded-[14px] border border-line bg-white p-4 shadow-[var(--shadow-card)]";
  return href ? (
    <Link href={href} className={`${cls} no-underline transition hover:-translate-y-0.5 hover:border-blue hover:shadow-[var(--shadow-raised)]`}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="m-0 rounded-[14px] border border-dashed border-line-strong bg-white/70 p-8 text-center text-[14px] text-muted">{children}</p>;
}

type FieldProps = { label: string; name: string; defaultValue?: string | number | null; required?: boolean; hint?: string; className?: string };

export function Input({ label: l, name, defaultValue, required, hint, className = "", type = "text", ...rest }: FieldProps & { type?: string; placeholder?: string; step?: string; min?: number | string; max?: number | string; list?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-[13px] font-semibold text-ink ${className}`}>
      {l}{required && <span className="sr-only"> (required)</span>}
      <input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} className="input !min-h-10 !py-2 text-[15px] font-normal" {...rest} />
      {hint && <span className="text-[12px] font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function Select({ label: l, name, defaultValue, options, className = "", blank }: FieldProps & { options: readonly (string | [string, string])[]; blank?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-[13px] font-semibold text-ink ${className}`}>
      {l}
      <select name={name} defaultValue={defaultValue ?? ""} className="input !min-h-10 !py-2 text-[15px] font-normal">
        {blank !== undefined && <option value="">{blank}</option>}
        {options.map((o) => {
          const [v, t] = Array.isArray(o) ? o : [o, label(o)];
          return <option key={v} value={v}>{t}</option>;
        })}
      </select>
    </label>
  );
}

export function Textarea({ label: l, name, defaultValue, className = "", rows = 3, placeholder }: FieldProps & { rows?: number; placeholder?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-[13px] font-semibold text-ink ${className}`}>
      {l}
      <textarea name={name} rows={rows} defaultValue={defaultValue ?? ""} placeholder={placeholder} className="input !min-h-0 text-[15px] font-normal" />
    </label>
  );
}

export { Submit } from "./SubmitButton";

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  return <Link href={href} className={`btn btn-sm ${variant === "primary" ? "btn-primary" : "btn-secondary"}`}>{children}</Link>;
}

export function Table({ head, children, minWidth = 760 }: { head: string[]; children: React.ReactNode; minWidth?: number }) {
  return (
    // the header stays in view while the rows scroll (the table scrolls inside its own box)
    <div className="max-h-[calc(100vh-9rem)] overflow-auto rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
      <table className="w-full border-collapse text-[14px]" style={{ minWidth }}>
        <thead>
          <tr className="text-left text-[12.5px] tracking-[0.02em] text-[#3d4f7a] uppercase">{head.map((h, i) => <th key={`${h}${i}`} className="sticky top-0 z-[11] bg-blue-soft px-3 py-3 font-bold whitespace-nowrap shadow-[0_1px_0_rgba(15,23,42,0.12)]">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td = "border-t border-line px-3 py-2.5 align-top";

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <div role="alert" className="flex items-start gap-2.5 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]"><FlashIcon kind="error" />{error}</div>;
  if (ok) return <div role="status" className="flex items-start gap-2.5 rounded-[12px] border border-[#a8d8bc] bg-wa-tint px-4 py-3 text-[14px] text-[#0b4f2c]"><FlashIcon kind="ok" />{ok}</div>;
  return null;
}
