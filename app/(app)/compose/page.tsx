import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getIdeasForCompose,
  getActiveStyleProfile,
  getAllStyleProfiles,
  previewSources,
  generatePost,
} from "./actions";
import { AlertCircle } from "lucide-react";
import ComposeForm from "./compose-form";

// Ideas list + style profiles are mutated by cron. Force dynamic.
export const dynamic = "force-dynamic";

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ idea?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ideas = await getIdeasForCompose();
  const activeStyle = await getActiveStyleProfile();
  const allStyles = await getAllStyleProfiles();

  const preselectedIdea = params.idea;
  const error = params.error;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Composer</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Generate a LinkedIn post from one or more ideas and your sources
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:bg-red-950 dark:border-red-800">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Generation Failed
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 whitespace-pre-line">
                {decodeURIComponent(error)}
              </p>
            </div>
          </div>
        </div>
      )}

      {ideas.length === 0 ? (
        <div className="rounded-lg border p-4 text-muted-foreground text-base">
          No ideas available.{" "}
          <a href="/ideas" className="underline">
            Add an idea first
          </a>
          .
        </div>
      ) : (
        <ComposeForm
          ideas={ideas}
          styles={allStyles}
          activeStyleId={activeStyle?.id || allStyles[0]?.id || ""}
          preselectedIdea={preselectedIdea}
          previewAction={previewSources}
          generateAction={async (formData) => {
            "use server";
            let postId: string | undefined;
            try {
              const post = await generatePost(formData);
              postId = post.id;
              revalidatePath("/posts");
            } catch (err: any) {
              const message = err?.message || "Failed to compose post";
              redirect(`/compose?error=${encodeURIComponent(message)}`);
            }
            redirect(`/posts/${postId}`);
          }}
        />
      )}
    </div>
  );
}
