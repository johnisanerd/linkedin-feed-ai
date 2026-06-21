import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PostList from "./post-list";
import { archivePost } from "./actions";

// Posts + queue are mutated by the publish cron. Force dynamic to avoid stale lists.
export const dynamic = "force-dynamic";

export default async function PostsPage() {
  const posts = await prisma.generatedPost.findMany({
    where: { status: { not: "archived" } },
    orderBy: [
      // Sort posted status last, then by createdAt desc
      { status: "asc" },
      { createdAt: "desc" },
    ],
    include: { idea: true },
    omit: { brandedImageData: true },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Generated Posts</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Review, edit, and track your LinkedIn posts
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Post History</CardTitle>
        </CardHeader>
        <CardContent>
          <PostList
            posts={posts}
            onArchive={async (id) => {
              "use server";
              await archivePost(id);
              revalidatePath("/posts");
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
