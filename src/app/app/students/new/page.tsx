import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader } from "@/components/ui/ui";
import { StudentForm } from "@/components/StudentForm";
import { getClasses } from "@/lib/erp";

export default async function NewStudent({ searchParams }: { searchParams: Promise<{ enquiry?: string; error?: string }> }) {
  const { supabase, school } = await requirePerm("students.profile.create");
  const sp = await searchParams;
  const classes = await getClasses(supabase, school.id);
  let prefill: Record<string, string | null> | undefined;
  if (sp.enquiry && /^[0-9a-f-]{36}$/.test(sp.enquiry)) {
    const { data: e } = await supabase.from("enquiries").select("student_name,class_sought,parent_name,phone,email").eq("id", sp.enquiry).eq("school_id", school.id).maybeSingle();
    if (e) {
      const [first, ...rest] = e.student_name.split(" ");
      const cls = classes.find((c) => c.name.toLowerCase() === (e.class_sought ?? "").replace(/^class\s*/i, "").toLowerCase());
      prefill = { first_name: first, last_name: rest.join(" ") || null, father_name: e.parent_name, guardian_phone: e.phone, email: e.email, class_id: cls?.id ?? null };
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="New admission" back={{ href: "/app/students", label: "Students" }} />
      <Flash error={sp.error} />
      <Card><StudentForm classes={classes} s={prefill} enquiryId={prefill ? sp.enquiry : undefined} /></Card>
    </div>
  );
}
