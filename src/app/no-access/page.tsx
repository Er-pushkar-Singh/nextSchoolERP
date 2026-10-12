import { signOut } from "../actions";
export const metadata = { title: "No access" };
export default async function NoAccess({ searchParams }: { searchParams: Promise<{ school?: string; blocked?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="page-bg min-h-screen px-4 pt-16"><div className="mx-auto max-w-[480px] rounded-[20px] border border-line border-t-4 border-t-blue bg-white p-8 shadow-[var(--shadow-raised)]">
      <h1 className="m-0 text-[22px] font-extrabold text-ink">{sp.blocked ? "Your access has been suspended" : sp.school ? "This account isn't part of this school" : "No school linked to this account"}</h1>
      <p className="mt-3 text-[15px]">{sp.blocked ? "The school has switched off this login. Please contact the principal or the school office." : sp.school ? "You signed in on a school's own web address, but your login belongs to a different school. Use your own school's address, or ask this school's admin to add you." : "Ask your school admin to add your email in Settings → Staff & access, then sign in again."}</p>
      <form action={signOut}><button className="btn btn-secondary btn-sm cursor-pointer">Sign out</button></form>
    </div></div>
  );
}
