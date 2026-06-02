import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processPublishQueue } from "@/lib/automation/publish-queue";
import { logAutomationJob } from "@/lib/automation/log";

/**
 * Publish queue processor cron.
 * Runs daily at 11:00 UTC (per vercel.json).
 * Gated by:
 * 1. autoPublishApproved toggle
 * 2. User's preferred posting time in their timezone
 * 3. Hasn't already successfully published today
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret) {
    const token = authHeader?.replace("Bearer ", "");
    if (token !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const settings = await prisma.userSettings.findFirst();
    if (!settings || !settings.autoPublishApproved) {
      await logAutomationJob(
        "publish-queue",
        "skipped",
        "autoPublishApproved is OFF"
      );
      return NextResponse.json({
        success: true,
        skipped: "autoPublishApproved is OFF",
      });
    }

    const timezone = settings.timezone || "UTC";
    const preferredTime = settings.preferredPostingTime || "09:00";

    // Gate 1: check if current time is at or after preferred posting time
    const now = new Date();
    const nowInTz = new Date(
      now.toLocaleString("en-US", { timeZone: timezone })
    );
    const [preferredHour, preferredMinute] = preferredTime
      .split(":")
      .map(Number);
    const currentHour = nowInTz.getHours();
    const currentMinute = nowInTz.getMinutes();

    if (
      currentHour < preferredHour ||
      (currentHour === preferredHour && currentMinute < preferredMinute)
    ) {
      await logAutomationJob(
        "publish-queue",
        "skipped",
        `Before preferred posting time (${preferredTime} ${timezone})`
      );
      return NextResponse.json({
        success: true,
        skipped: `Before preferred posting time (${preferredTime} ${timezone})`,
      });
    }

    // Gate 2: check if already ran successfully today in user's timezone
    const todayStart = getStartOfDayInTimezone(timezone);
    const alreadyRan = await prisma.automationLog.findFirst({
      where: {
        jobType: "publish-queue",
        status: "success",
        createdAt: { gte: todayStart },
      },
    });

    if (alreadyRan) {
      await logAutomationJob(
        "publish-queue",
        "skipped",
        "Already published today"
      );
      return NextResponse.json({
        success: true,
        skipped: "Already published today",
      });
    }

    const result = await processPublishQueue();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    await logAutomationJob("publish-queue", "failed", error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

function getStartOfDayInTimezone(timezone: string): Date {
  const now = new Date();
  const dateStr = now.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [month, day, year] = dateStr.split("/");
  return new Date(`${year}-${month}-${day}T00:00:00Z`);
}
