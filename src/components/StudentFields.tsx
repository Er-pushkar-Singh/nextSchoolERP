import { Input, Select, Textarea } from "@/components/ui/ui";
import { ClassSection } from "./ClassSection";
import type { ClassRow } from "@/lib/erp";
import { todayIST } from "@/lib/format";

type V = (k: string) => string | number | boolean | null | undefined;

/** The full student profile, shared by the admission form, the application form and the student edit form.
 *  Field names are the students-table column names, so a saved application can be turned into a student as it is. */
export function StudentFields({ v, classes, showClass = true, showAdmission = true }: { v: V; classes: ClassRow[]; showClass?: boolean; showAdmission?: boolean }) {
  const g = (k: string) => (v(k) ?? null) as string | number | null;
  return (
    <>
      <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-[15px] font-bold text-ink">Student</legend>
        <Input label="First name" name="first_name" defaultValue={g("first_name")} required hint="As on the birth certificate" />
        <Input label="Middle name" name="middle_name" defaultValue={g("middle_name")} />
        <Input label="Last name" name="last_name" defaultValue={g("last_name")} />
        <Select label="Gender" name="gender" defaultValue={g("gender")} blank="—" options={[["M", "Male"], ["F", "Female"], ["O", "Transgender / other"]]} />
        <Input label="Name in Hindi (नाम)" name="name_hi" defaultValue={g("name_hi")} className="sm:col-span-2" hint="Needed for the UP Board form" />
        <Input label="Date of birth" name="dob" type="date" defaultValue={g("dob")} />
        <Select label="Medium" name="medium" defaultValue={g("medium")} blank="—" options={[["hindi", "Hindi"], ["english", "English"]]} />
        {showClass && <ClassSection classes={classes} classId={g("class_id") as string} sectionId={g("section_id") as string} />}
        {showClass && <Input label="Roll no." name="roll_no" type="number" min={1} defaultValue={g("roll_no")} />}
        {showAdmission && <Input label="Admission no." name="admission_no" defaultValue={g("admission_no")} hint={g("id") ? "Changing it is logged" : "Leave blank to auto-number"} />}
        {showAdmission && <Input label="Admission date" name="admission_date" type="date" defaultValue={g("admission_date") ?? todayIST()} />}
        <Select label="Category" name="category" defaultValue={g("category")} blank="—" options={[["General", "General (सामान्य)"], ["OBC", "OBC (पिछड़ा वर्ग)"], ["SC", "SC (अनुसूचित जाति)"], ["ST", "ST (अनुसूचित जनजाति)"], ["EWS", "EWS (आर्थिक रूप से कमजोर)"], ["Other", "Other"]]} />
        <Select label="Admission type" name="admission_category" defaultValue={g("admission_category")} blank="—"
          options={[["general", "General"], ["rte", "RTE (25% quota)"], ["staff_ward", "Staff ward"], ["sibling", "Sibling"], ["other", "Other"]]} />
        <Input label="Religion" name="religion" defaultValue={g("religion")} />
        <Input label="Caste / sub-caste" name="caste" defaultValue={g("caste")} />
        <Select label="BPL family" name="bpl" defaultValue={v("bpl") === true ? "1" : v("bpl") === false ? "0" : ""} blank="—" options={[["1", "Yes"], ["0", "No"]]} />
        <Input label="Blood group" name="blood_group" defaultValue={g("blood_group")} />
        <Input label="Mother tongue" name="mother_tongue" defaultValue={g("mother_tongue")} />
        <Input label="Nationality" name="nationality" defaultValue={g("nationality") ?? "Indian"} />
        <Input label="Student's mobile" name="mobile" type="tel" defaultValue={g("mobile")} hint="10 digits (UP Board form)" />
      </fieldset>

      <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-[15px] font-bold text-ink">Parents</legend>
        <Input label="Father's name" name="father_name" defaultValue={g("father_name")} hint="Either parent's name is enough; add a guardian under contacts" />
        <Input label="Father's name in Hindi" name="father_name_hi" defaultValue={g("father_name_hi")} />
        <Input label="Mother's name" name="mother_name" defaultValue={g("mother_name")} />
        <Input label="Mother's name in Hindi" name="mother_name_hi" defaultValue={g("mother_name_hi")} />
        <Input label="WhatsApp / mobile" name="guardian_phone" type="tel" defaultValue={g("guardian_phone")} hint="Fee reminders and absence alerts go here" />
        <Input label="Other phone" name="alt_phone" type="tel" defaultValue={g("alt_phone")} />
        <Input label="Email" name="email" type="email" defaultValue={g("email")} />
      </fieldset>

      <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-[15px] font-bold text-ink">Address</legend>
        <Textarea label="Current address" name="address" defaultValue={g("address") as string} className="sm:col-span-2" rows={2} />
        <Textarea label="Permanent address" name="permanent_address" defaultValue={g("permanent_address") as string} className="sm:col-span-2" rows={2} />
        <Input label="Street / mohalla / area" name="street" defaultValue={g("street")} />
        <Input label="Village / town / city" name="city" defaultValue={g("city")} />
        <Input label="Post office" name="post_office" defaultValue={g("post_office")} />
        <Input label="Tehsil / block" name="block_tehsil" defaultValue={g("block_tehsil")} />
        <Input label="District" name="district" defaultValue={g("district")} />
        <Input label="State" name="state" defaultValue={g("state") ?? "Uttar Pradesh"} />
        <Input label="PIN code" name="pincode" defaultValue={g("pincode")} placeholder="226001" />
        <Select label="Rural / urban" name="locality_type" defaultValue={g("locality_type")} blank="—" options={[["rural", "Rural"], ["urban", "Urban"]]} />
        <Input label="Distance from school (km)" name="distance_km" type="number" step="0.1" min={0} defaultValue={g("distance_km")} />
      </fieldset>

      <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-[15px] font-bold text-ink">Previous school</legend>
        <Input label="School name" name="previous_school" defaultValue={g("previous_school")} className="sm:col-span-2" />
        <Input label="Board" name="previous_board" defaultValue={g("previous_board")} placeholder="UP Board / CBSE / ICSE" />
        <Input label="Last class passed" name="previous_class" defaultValue={g("previous_class")} />
        <Input label="Marks in last exam (%)" name="previous_year_percent" type="number" step="0.01" min={0} max={100} defaultValue={g("previous_year_percent")} />
        <Input label="Days attended last year" name="previous_year_days" type="number" min={0} defaultValue={g("previous_year_days")} />
      </fieldset>
    </>
  );
}
