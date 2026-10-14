import { requirePerm } from "@/lib/school";
import { Card, PageHeader } from "@/components/ui/ui";
import { ScanDesk } from "@/components/attendance/ScanDesk";

export default async function Scan() {
  await requirePerm("attendance.students.create", "attendance.staff.create");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="attendance" title="Scan attendance" subtitle="Hold a student's or staff member's ID card to the camera" back={{ href: "/app/attendance", label: "Attendance" }} />
      <div className="mx-auto w-full max-w-xl">
        <ScanDesk />
      </div>
      <Card title="How it works">
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px] text-body">
          <li>Every ID card printed from the template studio can carry a QR code (add the <b>QR code</b> block). Cards without a QR still work with the admission number.</li>
          <li>The first scan of the day marks the student present — or late, after the time set in Devices &amp; timings. A scan 10 minutes or more later records the out-time.</li>
          <li>A teacher can only scan students of their own sections.</li>
        </ul>
      </Card>
    </div>
  );
}
