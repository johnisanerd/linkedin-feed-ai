import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { syncAllRSSFeeds } from "@/app/(app)/sources/rss-actions";
import { logAutomationJob } from "@/lib/automation/log";
import { revalidatePath } from "next/cache";

export async function GET(request: NextRequest) {
  // Protect cron endpoint with a secret
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret) {
    const token = authHeader?.replace("Bearer ", "");
    if (token !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const results = await syncAllRSSFeeds();
    const totalIngested = results.reduce((sum, r) => sum + r.ingested, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

    await logAutomationJob(
      "rss-sync",
      totalFailed > 0 ? "success" : "success",
      `Feeds: ${results.length}, Ingested: ${totalIngested}, Failed: ${totalFailed}`
    );

    if (totalIngested > 0) {
      after(() => {
        revalidatePath("/sources");
        revalidatePath("/dashboard");
        revalidatePath("/compose");
      });
    }

    return NextResponse.json({
      success: true,
      feeds: results.length,
      ingested: totalIngested,
      failed: totalFailed,
      details: results,
    });
  } catch (error: any) {
    await logAutomationJob("rss-sync", "failed", error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
