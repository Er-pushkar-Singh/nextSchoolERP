"use client";
import {
  LuLayoutDashboard, LuUsers, LuGraduationCap, LuCalendarCheck, LuClipboardList, LuWallet, LuMegaphone, LuSettings, LuLifeBuoy,
  LuBuilding2, LuNetwork, LuReceipt, LuCreditCard, LuTicket, LuShieldCheck, LuUserCog, LuPlug, LuBell, LuHistory, LuBlocks,
  LuSlidersHorizontal, LuSchool, LuUserPlus, LuTags, LuLayers, LuChartColumn, LuDatabaseBackup, LuBookOpen,
  LuBus, LuLibrary, LuNotebookPen, LuBriefcase, LuCalendarOff, LuBanknote, LuRoute,
} from "react-icons/lu";
import type { IconType } from "react-icons";

/** Icons the server can refer to by name (functions can't cross the server → client boundary). */
export const ICONS = {
  dashboard: LuLayoutDashboard, students: LuUsers, academics: LuGraduationCap, attendance: LuCalendarCheck, exams: LuClipboardList,
  fees: LuWallet, notices: LuMegaphone, settings: LuSettings, support: LuLifeBuoy, tenants: LuBuilding2, groups: LuNetwork,
  billing: LuReceipt, plans: LuTags, tickets: LuTicket, audit: LuHistory, team: LuShieldCheck, modules: LuBlocks, account: LuUserCog,
  integrations: LuPlug, notifications: LuBell, prefs: LuSlidersHorizontal, school: LuSchool, admissions: LuUserPlus, layers: LuLayers,
  revenue: LuChartColumn, backups: LuDatabaseBackup, card: LuCreditCard, book: LuBookOpen,
  homework: LuNotebookPen, transport: LuBus, hr: LuBriefcase, library: LuLibrary, leave: LuCalendarOff, payroll: LuBanknote, route: LuRoute,
} satisfies Record<string, IconType>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className, size }: { name: IconName; className?: string; size?: number }) {
  const C = ICONS[name];
  return <C aria-hidden="true" className={className} size={size} />;
}
