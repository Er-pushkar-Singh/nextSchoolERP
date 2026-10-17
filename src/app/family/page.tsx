import Link from "next/link";
import { redirect } from "next/navigation";
import { childName, getFamily } from "@/lib/family";
import { signOut } from "../actions";

export default async function FamilyHome() {
  const { children, user } = await getFamily();
  if (children.length === 1) redirect(`/family/${children[0].student_id}`);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-[22px] font-extrabold text-ink">Who are you looking for?</h1>
        <form action={signOut}><button className="cursor-pointer border-0 bg-transparent text-[14px] text-blue underline">Sign out</button></form>
      </header>
      {children.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {children.map((c) => (
            <li key={c.student_id}>
              <Link href={`/family/${c.student_id}`} className="flex flex-col gap-0.5 rounded-[14px] border border-line bg-white p-4 no-underline shadow-[var(--shadow-card)]">
                <b className="text-[18px] text-ink">{childName(c)}</b>
                <span className="text-[14px] text-muted">Class {c.class_name ?? "—"}{c.section_name ? `-${c.section_name}` : ""} · Adm. {c.admission_no} · {c.school_name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 rounded-[12px] border border-line bg-white p-5 text-[15px]">
          No student is linked to <b>{user.email}</b> yet. Please ask the school office to link your mobile number or e-mail to your child.
        </p>
      )}
    </main>
  );
}
