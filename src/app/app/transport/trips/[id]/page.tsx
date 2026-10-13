import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { PageHeader } from "@/components/ui/ui";
import { LiveMap, type MapMarker } from "@/components/transport/LiveMap";

export default async function TripPath({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase } = await requirePerm("transport.tracking.view");
  const { data } = await supabase.rpc("trip_trace", { p_trip: id });
  const pts = ((data ?? []) as { lat: number; lng: number; at: string }[]);
  if (!pts.length) notFound();
  const line = pts.map((p) => [Number(p.lat), Number(p.lng)] as [number, number]);
  const markers: MapMarker[] = [
    { id: "a", kind: "stop", lat: line[0][0], lng: line[0][1], seq: 1, label: "Start", color: "#16a34a" },
    { id: "b", kind: "stop", lat: line[line.length - 1][0], lng: line[line.length - 1][1], seq: pts.length, label: "Last position", color: "#dc2626" },
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="transport" title="Trip path" subtitle={`${pts.length} recorded points · ${new Date(pts[0].at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`} back={{ href: "/app/transport/trips", label: "Trip history" }} />
      <LiveMap markers={markers} trace={line} fitKey={id} height="70vh" />
    </div>
  );
}
