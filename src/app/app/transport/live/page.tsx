import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader, Submit } from "@/components/ui/ui";
import { LiveBoard } from "@/components/transport/LiveBoard";
import { LocationPicker } from "@/components/transport/LocationPicker";
import { setSchoolLocation } from "../../_actions/transport";

export default async function LiveMapPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("transport.tracking.view");
  const sp = await searchParams;
  const { data: sc } = await supabase.from("schools").select("lat,lng").eq("id", school.id).maybeSingle();
  const set = sc?.lat != null && sc?.lng != null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="transport" title="Live bus map" subtitle="Where every school vehicle is right now" back={{ href: "/app/transport", label: "Transport" }}
        actions={<><Link href="/app/transport/trips" className="btn btn-sm btn-secondary">Trip history</Link><Link href="/app/transport/vehicles" className="btn btn-sm btn-secondary">Driver links</Link></>} />
      <Flash ok={sp.ok} error={sp.error} />
      <LiveBoard />
      {can("transport.routes.edit") && (
        <details className="rounded-[14px] border border-line bg-white p-4" open={!set}>
          <summary className="cursor-pointer text-[14px] font-bold text-ink">{set ? "School location" : "Set the school's location (shown on every map)"}</summary>
          <form action={setSchoolLocation} className="mt-3 flex flex-col gap-3">
            <LocationPicker lat={sc?.lat != null ? Number(sc.lat) : null} lng={sc?.lng != null ? Number(sc.lng) : null} hint="Click on the school building." />
            <div><Submit>Save school location</Submit></div>
          </form>
        </details>
      )}
      <Card title="How it works" icon="route">
        <ol className="m-0 pl-5 text-[14px] leading-relaxed">
          <li>Give every driver his <b>driver link</b> (Vehicles → Driver link). It opens on his phone — no login.</li>
          <li>The driver taps <b>Start morning pickup</b> / <b>Start evening drop</b> and keeps the page open; the phone sends its location every few seconds.</li>
          <li>Parents open their child&apos;s link → <b>Track bus</b> to see the bus, the distance, the arrival time and the stops.</li>
          <li>Put every stop on the map (Routes → stop → click the map) so distances and arrival times are meaningful.</li>
        </ol>
      </Card>
    </div>
  );
}
