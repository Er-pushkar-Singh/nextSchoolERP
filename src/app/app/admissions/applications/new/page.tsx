import { requirePerm } from "@/lib/school";
import { Flash, PageHeader } from "@/components/ui/ui";
import { ApplicationForm } from "@/components/ApplicationForm";
import { getClasses } from "@/lib/erp";
import { createApplication } from "../../../_actions/applications";
import type { AppForm } from "@/lib/applications";

export default async function NewApplication({ searchParams }: { searchParams: Promise<{ enquiry?: string; error?: string }> }) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.create");
  const sp = await searchParams;
  const classes = await getClasses(supabase, school.id);
  let form: AppForm = { nationality: "Indian", state: school.state ?? "Uttar Pradesh" };
  let enquiry: string | undefined;
  let applied: string | null = null;
  let source: string | null = null;
  if (sp.enquiry && /^[0-9a-f-]{36}$/.test(sp.enquiry)) {
    const { data: e } = await supabase.from("enquiries").select("student_name,class_sought,parent_name,phone,email,source").eq("id", sp.enquiry).eq("school_id", school.id).maybeSingle();
    if (e) {
      enquiry = sp.enquiry;
      const [first, ...rest] = e.student_name.trim().split(/\s+/);
      form = { ...form, first_name: first, last_name: rest.join(" ") || null, father_name: e.parent_name, guardian_phone: e.phone, email: e.email };
      applied = classes.find((c) => c.name.toLowerCase() === (e.class_sought ?? "").replace(/^class\s*/i, "").toLowerCase())?.id ?? null;
      source = e.source;
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="New admission application" subtitle="Everything the school and the board will ask for, in one go — you can complete the rest later"
        back={{ href: "/app/admissions/applications", label: "Applications" }} />
      <Flash error={sp.error} />
      <ApplicationForm action={createApplication} classes={classes} form={form} enquiryId={enquiry} appliedClass={applied} source={source} submitLabel="Receive application" />
    </div>
  );
}
