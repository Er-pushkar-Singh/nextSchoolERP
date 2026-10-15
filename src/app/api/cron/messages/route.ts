import { NextResponse, type NextRequest } from "next/server";
import { processOutbox } from "@/lib/messages";
import { runAssetOverdueJob, runFeeReminderJob } from "@/lib/message-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Message worker. Schedule it every 5 minutes (any scheduler: Vercel Pro cron, cron-job.org, GitHub Actions …):
 *   GET /api/cron/messages              → sends what is due
 *   GET /api/cron/messages?job=reminders → also queues fee reminders (3 days before, due day, +7 / +15 / +30), run once a day
 * Auth: Authorization: Bearer <CRON_SECRET>. MESSAGES_DRY_RUN=1 marks messages sent without calling a provider.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  try {
    const daily = req.nextUrl.searchParams.get("job") === "reminders";
    const reminders = daily ? await runFeeReminderJob() : null;
    const assets = daily ? await runAssetOverdueJob() : null;
    let total = { sent: 0, failed: 0, retry: 0, picked: 0 };
    for (let i = 0; i < 4; i++) {
      const r = await processOutbox({ limit: 50 });
      total = { sent: total.sent + r.sent, failed: total.failed + r.failed, retry: total.retry + r.retry, picked: total.picked + r.picked };
      if (r.picked < 50) break;
    }
    return NextResponse.json({ ok: true, reminders, assets, ...total });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}