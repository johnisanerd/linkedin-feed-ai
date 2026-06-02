import { prisma } from "@/lib/prisma";
import { publishPostToLinkedInCore } from "./publish-core";
import { logAutomationJob } from "./log";

/**
 * Process the publish queue: find the oldest pending item and publish it.
 * Respects the daily max posts limit and user timezone.
 *
 * Returns what happened so the cron can log it.
 */
export async function processPublishQueue(): Promise<{
  action: "published" | "skipped" | "failed" | "empty";
  postId?: string;
  error?: string;
}> {
  const settings = await prisma.userSettings.findFirst();

  // If no settings or auto-publish is off, still process manually queued items
  // The toggle only controls auto-enqueue on approve; the cron always processes the queue
  const timezone = settings?.timezone || "UTC";
  const maxPosts = settings?.maxPostsPerDay ?? 1;

  // Count how many posts were published today in user's timezone
  const todayStart = getStartOfDayInTimezone(timezone);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const publishedToday = await prisma.generatedPost.count({
    where: {
      publishedToLinkedInAt: {
        gte: todayStart,
        lt: todayEnd,
      },
    },
  });

  if (publishedToday >= maxPosts) {
    return { action: "skipped", error: "Daily publish limit reached" };
  }

  // Find oldest pending queue item scheduled for now or earlier
  const queueItem = await prisma.publishQueue.findFirst({
    where: {
      status: "pending",
      scheduledAt: { lte: new Date() },
    },
    include: { post: true },
    orderBy: { scheduledAt: "asc" },
  });

  if (!queueItem) {
    return { action: "empty" };
  }

  const postId = queueItem.postId;
  const content = queueItem.post.finalContent || queueItem.post.draftContent;

  try {
    const result = await publishPostToLinkedInCore(postId, content);

    // Explicitly mark the post as posted (defensive: publish-core should also do this,
    // but we ensure it here in case of partial failures or connection issues)
    await prisma.generatedPost.update({
      where: { id: postId },
      data: {
        status: "posted",
        linkedInPostId: result.postId,
        publishedToLinkedInAt: new Date(),
      },
    });

    // Mark queue item as published
    await prisma.publishQueue.update({
      where: { id: queueItem.id },
      data: {
        status: "published",
        publishedAt: new Date(),
      },
    });

    await logAutomationJob(
      "publish-queue",
      "success",
      `Published post ${postId} to LinkedIn: ${result.postUrl}`
    );

    return { action: "published", postId };
  } catch (err: any) {
    const errorMsg = err?.message || "Unknown publish error";

    // Mark queue item as failed
    await prisma.publishQueue.update({
      where: { id: queueItem.id },
      data: {
        status: "failed",
        error: errorMsg,
      },
    });

    await logAutomationJob("publish-queue", "failed", `Post ${postId}: ${errorMsg}`);

    return { action: "failed", postId, error: errorMsg };
  }
}

function getStartOfDayInTimezone(timezone: string): Date {
  const now = new Date();
  // Get the current date string in the target timezone
  const dateStr = now.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [month, day, year] = dateStr.split("/");
  // Return that date at midnight UTC
  return new Date(`${year}-${month}-${day}T00:00:00Z`);
}
