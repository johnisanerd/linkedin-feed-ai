import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPost, updatePostStatus, toggleSkipImage } from "../actions";
import { addToQueue, removeFromQueue, getQueueItem } from "../queue-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle, CalendarPlus, CalendarMinus } from "lucide-react";
import Link from "next/link";

// Post state can change via cron (publish) or other tabs (edits). Always render fresh.
export const dynamic = "force-dynamic";
import { VersionToolbar } from "./version-toolbar";
import { PostEditor } from "./post-editor";
import PostImagePreview from "./post-image-preview";
import { TitleEditor } from "./title-editor";
import { getNextPreferredPostingTime } from "@/lib/automation/schedule";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getPost(id);

  if (!post) {
    notFound();
  }

  const idea = post.idea;
  const queueItem = await getQueueItem(id);
  const nextPreferredTime = await getNextPreferredPostingTime();

  // Parse versions for display
  let versions: Array<{ content: string; createdAt: string }> = [];
  try {
    versions = JSON.parse(post.versions || "[]");
  } catch {
    versions = [];
  }
  const currentIdx = post.currentVersionIndex ?? 0;
  const totalVersions = Math.max(versions.length, 1);
  const displayIndex = Math.min(currentIdx, totalVersions - 1);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/posts">
          <Button variant="ghost" size="default">
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Posts
          </Button>
        </Link>
      </div>

      <div>
        {idea ? (
          <TitleEditor ideaId={idea.id} initialTitle={idea.title} />
        ) : (
          <h1 className="text-4xl font-bold tracking-tight">Generated Post</h1>
        )}
        <div className="flex items-center gap-2 mt-4">
          <Badge
            variant={
              post.status === "approved"
                ? "default"
                : post.status === "posted"
                ? "secondary"
                : "outline"
            }
          >
            {post.status}
          </Badge>
          <span className="text-base text-muted-foreground">
            {new Date(post.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Post Editor */}
        <div className="lg:col-span-2 space-y-4">
          {/* Version Toolbar */}
          {totalVersions > 1 && (
            <VersionToolbar
              postId={id}
              currentIndex={displayIndex}
              totalVersions={totalVersions}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Draft</CardTitle>
              <CardDescription>
                Edit your LinkedIn post — changes are saved automatically
                {totalVersions > 1 && (
                  <span className="ml-2 text-xs font-medium text-primary">
                    (viewing version {displayIndex + 1} of {totalVersions})
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PostEditor
                postId={id}
                initialContent={post.finalContent || post.draftContent}
                isPublished={!!post.publishedToLinkedInAt}
              />
            </CardContent>
          </Card>
        </div>

        {/* Meta Info */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-xl">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {idea && (
              <div>
                <p className="text-base font-medium">Original Idea</p>
                <p className="text-base text-muted-foreground">
                  {idea.title}
                </p>
                {idea.description && (
                  <p className="text-base text-muted-foreground mt-1">
                    {idea.description}
                  </p>
                )}
              </div>
            )}

            <div>
              <p className="text-base font-medium">Word Count</p>
              <p className="text-base text-muted-foreground">
                {(post.finalContent || post.draftContent).split(/\s+/).length}{" "}
                words
              </p>
            </div>

            <div>
              <p className="text-base font-medium">Character Count</p>
              <p className="text-base text-muted-foreground">
                {(post.finalContent || post.draftContent).length} characters
              </p>
            </div>

            {/* Branded Image Preview */}
            <PostImagePreview postId={id} />

            {/* Skip image toggle */}
            {!post.publishedToLinkedInAt && (
              <form
                action={async (formData: FormData) => {
                  "use server";
                  const skipImage = formData.get("skipImage") === "on";
                  await toggleSkipImage(id, skipImage);
                  revalidatePath(`/posts/${id}`);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="checkbox"
                  id="skipImage"
                  name="skipImage"
                  defaultChecked={post.skipImage}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <label htmlFor="skipImage" className="text-sm text-muted-foreground cursor-pointer">
                  Publish without image
                </label>
                <Button type="submit" variant="ghost" size="sm" className="ml-auto text-xs h-auto py-1 px-2">
                  Save
                </Button>
              </form>
            )}

            {post.status === "approved" && !queueItem && (
              <form
                action={async () => {
                  "use server";
                  await updatePostStatus(id, "posted");
                  revalidatePath(`/posts/${id}`);
                  revalidatePath("/posts");
                }}
              >
                <Button type="submit" variant="default" className="w-full">
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark as Posted
                </Button>
              </form>
            )}

            {post.status === "approved" && !queueItem && (
              <form
                action={async (formData: FormData) => {
                  "use server";
                  const scheduledAtStr = formData.get("scheduledAt") as string;
                  const scheduledAt = scheduledAtStr
                    ? new Date(scheduledAtStr)
                    : await getNextPreferredPostingTime();
                  await addToQueue(id, scheduledAt);
                  revalidatePath(`/posts/${id}`);
                  revalidatePath("/posts");
                }}
                className="space-y-2"
              >
                <input
                  type="datetime-local"
                  name="scheduledAt"
                  defaultValue={nextPreferredTime.toISOString().slice(0, 16)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <Button type="submit" variant="outline" className="w-full">
                  <CalendarPlus className="h-4 w-4 mr-2" />
                  Add to Queue
                </Button>
              </form>
            )}

            {queueItem && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Queue status:</span>{" "}
                  {queueItem.status === "pending"
                    ? `Scheduled for ${new Date(queueItem.scheduledAt).toLocaleString()}`
                    : queueItem.status === "published"
                    ? `Published on ${new Date(queueItem.publishedAt!).toLocaleString()}`
                    : `Failed: ${queueItem.error || "Unknown error"}`}
                </div>
                {queueItem.status === "pending" && (
                  <form
                    action={async () => {
                      "use server";
                      await removeFromQueue(id);
                      revalidatePath(`/posts/${id}`);
                      revalidatePath("/posts");
                    }}
                  >
                    <Button type="submit" variant="outline" className="w-full text-red-600">
                      <CalendarMinus className="h-4 w-4 mr-2" />
                      Remove from Queue
                    </Button>
                  </form>
                )}
              </div>
            )}

            {post.publishedToLinkedInAt && (
              <div>
                <p className="text-base font-medium text-blue-600">
                  Published to LinkedIn
                </p>
                <p className="text-base text-muted-foreground">
                  {new Date(post.publishedToLinkedInAt).toLocaleDateString()} at{" "}
                  {new Date(post.publishedToLinkedInAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                {post.linkedInPostId && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Post ID: {post.linkedInPostId}
                  </p>
                )}
              </div>
            )}

            {/* Version History */}
            {versions.length > 0 && (
              <div>
                <p className="text-base font-medium">Version History</p>
                <div className="space-y-1 mt-1">
                  {versions.map((v, i) => (
                    <div
                      key={i}
                      className={`text-sm px-2 py-1 rounded ${
                        i === displayIndex
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      Version {i + 1} —{" "}
                      {new Date(v.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
