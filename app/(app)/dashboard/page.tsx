import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Sparkles, ClipboardList, ArrowRight, Clock, Rss, Lightbulb, Calendar } from "lucide-react";
import Link from "next/link";
import { getAutomationStatus } from "@/lib/automation/status";
import { addToQueue } from "../posts/queue-actions";
import { getNextPreferredPostingTime } from "@/lib/automation/schedule";
import { revalidatePath } from "next/cache";

// Dashboard reads DB (ideas, automation status, queue) that cron mutates in the background.
// Without this, the page is statically rendered at build time and goes stale until a user
// action triggers revalidatePath. Cron writes would be invisible.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ideas = await prisma.dailyIdea.findMany({
    where: { status: "draft" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const posts = await prisma.generatedPost.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { idea: true },
  });

  const draftCount = ideas.length;
  const pendingReview = posts.filter((p) => p.status === "draft").length;
  const approvedCount = posts.filter((p) => p.status === "approved").length;

  const automation = await getAutomationStatus();

  // Fetch next queued post
  const nextQueueItem = await prisma.publishQueue.findFirst({
    where: { status: "pending" },
    include: { post: { include: { idea: true } } },
    orderBy: { scheduledAt: "asc" },
  });

  // Fetch approved posts that are NOT queued
  const approvedNotQueued = await prisma.generatedPost.findMany({
    where: {
      status: "approved",
      queueItem: { is: null },
    },
    include: { idea: true },
    orderBy: { createdAt: "asc" },
    take: 3,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Generate and manage your LinkedIn content
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Draft Ideas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{draftCount}</div>
            <p className="text-sm text-muted-foreground mt-1">
              Waiting to be written
            </p>
            <Link href="/ideas">
              <Button className="mt-4 w-full" size="default">
                <Plus className="h-5 w-5 mr-2" />
                Add Idea
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingReview}</div>
            <p className="text-sm text-muted-foreground mt-1">
              Posts to review
            </p>
            <Link href="/posts">
              <Button className="mt-4 w-full" variant="secondary" size="default">
                <ClipboardList className="h-5 w-5 mr-2" />
                Review
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Ready to Post</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{approvedCount}</div>
            <p className="text-sm text-muted-foreground mt-1">
              Approved posts
            </p>
            <Link href="/ideas">
              <Button className="mt-4 w-full" variant="outline" size="default">
                <Sparkles className="h-5 w-5 mr-2" />
                Generate
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Next Up Card */}
        <Card className={nextQueueItem ? "border-blue-200 bg-blue-50/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Next Up
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextQueueItem ? (
              <div className="space-y-2">
                <div className="text-lg font-bold text-blue-900 truncate">
                  {nextQueueItem.post.idea?.title || "Post"}
                </div>
                <div className="text-sm text-muted-foreground">
                  Scheduled for{" "}
                  <span className="font-medium text-foreground">
                    {new Date(nextQueueItem.scheduledAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {automation.queueLength - 1 > 0
                    ? `+${automation.queueLength - 1} more in queue`
                    : "Last item in queue"}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-lg font-bold text-muted-foreground">
                  Nothing queued
                </div>
                <p className="text-sm text-muted-foreground">
                  Approve a post to auto-queue it for publishing
                </p>
              </div>
            )}
            <Link href="/posts">
              <Button className="mt-4 w-full" variant="outline" size="default">
                <ClipboardList className="h-5 w-5 mr-2" />
                Manage Queue
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Approved but not queued */}
      {approvedNotQueued.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ready to Publish</CardTitle>
            <CardDescription>
              {approvedNotQueued.length} approved post{approvedNotQueued.length !== 1 ? "s" : ""} waiting to be queued
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {approvedNotQueued.map((post) => (
                <div
                  key={post.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">{post.idea?.title || "Post"}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(post.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <form
                    action={async () => {
                      "use server";
                      const scheduledAt = await getNextPreferredPostingTime();
                      await addToQueue(post.id, scheduledAt);
                      revalidatePath("/dashboard");
                      revalidatePath("/posts");
                    }}
                  >
                    <Button type="submit" size="sm">
                      Queue for Publishing
                    </Button>
                  </form>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Automation Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Rss className="h-4 w-4" />
                Next RSS Sync
              </div>
              <p className="text-lg font-medium">{automation.nextRssSync}</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lightbulb className="h-4 w-4" />
                Next Idea Gen
              </div>
              <p className="text-lg font-medium">{automation.nextIdeaGen}</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                Queue
              </div>
              <p className="text-lg font-medium">
                {automation.queueLength} pending
                {automation.nextPublish && (
                  <span className="text-sm text-muted-foreground block">
                    Next: {automation.nextPublish}
                  </span>
                )}
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ClipboardList className="h-4 w-4" />
                Recent Logs
              </div>
              <div className="space-y-1">
                {automation.recentLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No runs yet</p>
                ) : (
                  automation.recentLogs.slice(0, 3).map((log) => (
                    <p key={log.id} className="text-sm">
                      <span
                        className={`inline-block w-2 h-2 rounded-full mr-1 ${
                          log.status === "success"
                            ? "bg-green-500"
                            : log.status === "failed"
                            ? "bg-red-500"
                            : "bg-yellow-500"
                        }`}
                      />
                      {log.jobType} — {log.status}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Ideas</CardTitle>
          </CardHeader>
          <CardContent>
            {ideas.length === 0 ? (
              <p className="text-base text-muted-foreground">
                No ideas yet. Add one to get started.
              </p>
            ) : (
              <div className="space-y-3">
                {ideas.map((idea) => (
                  <Link
                    key={idea.id}
                    href={`/ideas`}
                    className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted transition-colors"
                  >
                    <div>
                      <p className="font-medium text-base">{idea.title}</p>
                      {idea.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {idea.description}
                        </p>
                      )}
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Posts</CardTitle>
          </CardHeader>
          <CardContent>
            {posts.length === 0 ? (
              <p className="text-base text-muted-foreground">
                No posts generated yet. Go to Ideas and generate your first post.
              </p>
            ) : (
              <div className="space-y-3">
                {posts.map((post) => (
                  <Link
                    key={post.id}
                    href={`/posts/${post.id}`}
                    className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted transition-colors"
                  >
                    <div>
                      <p className="text-base line-clamp-2">
                        {post.finalContent || post.draftContent}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {post.status} · {new Date(post.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
