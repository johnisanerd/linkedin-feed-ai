import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyIdeas } from "@/lib/automation/generate-ideas";
import { logAutomationJob } from "@/lib/automation/log";

/**
 * Daily idea generation cron.
 * Runs hourly but gates on:
 * 1. UserSettings.autoGenerateIdeas = true
 * 2. Hasn't already run today in user's timezone
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
    if (!settings || !settings.autoGenerateIdeas) {
      await logAutomationJob("generate-ideas", "skipped", "autoGenerateIdeas is OFF");
      return NextResponse.json({ success: true, skipped: "autoGenerateIdeas is OFF" });
    }

    // Gate: check if already ran today in user's timezone
    const todayStart = getStartOfDayInTimezone(settings.timezone || "UTC");

    const alreadyRan = await prisma.automationLog.findFirst({
      where: {
        jobType: "generate-ideas",
        status: "success",
        createdAt: { gte: todayStart },
      },
    });

    if (alreadyRan) {
      return NextResponse.json({ success: true, skipped: "Already ran today" });
    }

    const ideasPerDay = settings.ideasPerDay || 3;
    const userId = settings.userId;
    const generated: string[] = [];
    const skipped: string[] = [];

    for (let i = 0; i < ideasPerDay; i++) {
      const result = await generateDailyIdeas({
        articleCount: 5,
        styleAware: true,
        recencyFilter: 30,
      });

      if (!result.success) {
        skipped.push(result.error);
        continue;
      }

      await prisma.dailyIdea.create({
        data: {
          title: result.title,
          description: result.description,
          userId,
          status: "draft",
        },
      });

      generated.push(result.title);
    }

    const logMsg = `Generated ${generated.length}/${ideasPerDay} ideas. Generated: [${generated.join(", ")}]. Skipped: [${skipped.join(", ")}]`;
    await logAutomationJob("generate-ideas", "success", logMsg);

    return NextResponse.json({ success: true, generated, skipped });
  } catch (error: any) {
    await logAutomationJob("generate-ideas", "failed", error.message);
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
