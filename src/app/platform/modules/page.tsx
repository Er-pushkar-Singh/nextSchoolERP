import { Badge, PageHeader } from "@/components/ui/ui";
import catalog from "@/lib/catalog.json";

const ACTIONS = Object.keys(catalog.actions) as (keyof typeof catalog.actions)[];
const SHORT: Record<string, string> = { school: "S", assigned: "A", own: "O", child: "C", self: "Me" };

/** The module map and the default role matrix, straight from src/lib/catalog.json. */
export default function ModuleMap() {
  const roles = catalog.roles;
  const grant = (r: (typeof roles)[number], sub: string, action: string): string | null => {
    const g = r.grants as unknown as Record<string, string | string[]>;
    if (g["*"]) return g["*"] as string;
    const v = g[sub] as string[] | undefined;
    if (!v) return null;
    const [scope, ...acts] = v;
    return acts.includes("*") || acts.includes(action) ? scope : null;
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="modules" title="Module map & default permissions" subtitle={`${catalog.modules.length} modules · ${catalog.modules.reduce((n, m) => n + m.submodules.length, 0)} sub-modules · ${roles.length} default roles. S = whole school, A = assigned, O = own, C = own children, Me = self.`} back={{ href: "/platform", label: "Schools" }} />
      <div className="max-h-[calc(100vh-10rem)] overflow-auto rounded-[12px] border border-line bg-white">
        <table className="w-full border-separate border-spacing-0 text-[12px]" style={{ minWidth: 1300 }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface-alt text-left">
              <th className="sticky left-0 z-20 border-b border-line-strong bg-surface-alt px-2 py-2">Module · sub-module · actions</th>
              {roles.map((r) => <th key={r.code} className="border-b border-line-strong bg-surface-alt px-1 py-2 text-center font-semibold">{r.name.split(" /")[0]}</th>)}
            </tr>
          </thead>
          {catalog.modules.map((m) => (
            <tbody key={m.code}>
              <tr className="border-t-2 border-line-strong bg-surface-alt/60"><td colSpan={roles.length + 1} className="px-2 py-1.5 text-[13px] font-bold">{m.name} <span className="font-normal text-muted">· {m.group} · {m.tier}</span></td></tr>
              {m.submodules.map((s) => {
                const sub = `${m.code}.${s.code}`;
                return (
                  <tr key={sub} className="border-t border-line">
                    <td className="px-2 py-1 pl-4">{s.name} {"built" in s && s.built ? <Badge value="active" text="built" /> : null}<div className="text-[11px] text-muted">{s.actions.join(" · ")}</div></td>
                    {roles.map((r) => {
                      const cells = ACTIONS.filter((a) => s.actions.includes(a)).map((a) => [a, grant(r, sub, a)] as const).filter(([, sc]) => sc);
                      const all = cells.length === s.actions.length;
                      return <td key={r.code} className="px-1 py-1 text-center">{cells.length ? (all ? `All (${SHORT[cells[0][1]!]})` : cells.map(([a, sc]) => `${a[0].toUpperCase()}${sc !== "school" ? `(${SHORT[sc!]})` : ""}`).join(" ")) : <span className="text-line-strong">—</span>}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
