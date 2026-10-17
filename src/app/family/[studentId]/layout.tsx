import Link from "next/link";
import { childName, requireChild } from "@/lib/family";
import { signOut } from "../../actions";

export default async function ChildLayout({ children, params }: { children: React.ReactNode; params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const { supabase, child, children: all } = await requireChild(studentId);
  const { count: unread } = await supabase.from("family_messages").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("from_family", false).is("read_at", null);
  const base = `/family/${studentId}`;
  const tab = "relative flex-1 px-2 py-3 text-center text-[14px] font-semibold text-ink no-underline hover:bg-blue-soft";
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="m-0 truncate text-[12px] text-muted">{child.school_name}</p>
            <p className="m-0 truncate text-[16px] font-extrabold text-ink">{childName(child)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[13px]">
            {all.length > 1 && <Link href="/family">Switch</Link>}
            <Link href="/family/account">Account</Link>
            <form action={signOut}><button className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">Sign out</button></form>
          </div>
        </div>
        <nav className="flex border-t border-line" aria-label="Sections">
          <Link href={base} className={tab}>Home</Link>
          <Link href={`${base}/leave`} className={tab}>Leave</Link>
          <Link href={`${base}/messages`} className={tab}>Messages{(unread ?? 0) > 0 && <span className="ml-1 rounded-full bg-error px-1.5 py-0.5 text-[11px] text-white">{unread}</span>}</Link>
        </nav>
      </header>
      <main className="flex-1 px-4 py-4">{children}</main>
    </div>
  );
}
