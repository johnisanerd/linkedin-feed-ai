import { prisma } from "@/lib/prisma";
import { createLinkedInPost, uploadMediaToZernio } from "@/lib/zernio";
import { generatePostImage } from "@/lib/post-image-generator";
import { cleanPostOutput } from "@/lib/prompts";

/**
 * Core publish logic shared by manual publish and queue processor.
 * Publishes a post to LinkedIn. If skipImage is false (default), attaches
 * the saved branded image (or generates one if missing).
 * Returns the LinkedIn post result.
 */
export async function publishPostToLinkedInCore(
  postId: string,
  content: string
): Promise<{ postId: string; postUrl?: string }> {
  const accountId = process.env.ZERNIO_LINKEDIN_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("ZERNIO_LINKEDIN_ACCOUNT_ID not configured");
  }

  const post = await prisma.generatedPost.findUnique({
    where: { id: postId },
    include: { idea: true },
  });

  if (!post) throw new Error("Post not found");

  let mediaUrl: string | undefined;

  if (!post.skipImage) {
    // Use saved branded image or generate fallback
    let imageBuffer: Buffer;
    if (post.brandedImageData) {
      imageBuffer = Buffer.from(post.brandedImageData);
    } else {
      imageBuffer = await generatePostImage({
        title: post.idea?.title || "LinkedIn Post",
        content: cleanPostOutput(content),
        authorName: "paschalidi",
      });
    }

    mediaUrl = await uploadMediaToZernio(imageBuffer);
  }

  const result = await createLinkedInPost(content, accountId, mediaUrl);

  // Mark post as posted
  try {
    await prisma.generatedPost.update({
      where: { id: postId },
      data: {
        status: "posted",
        linkedInPostId: result.postId,
        publishedToLinkedInAt: new Date(),
      },
    });
  } catch (dbErr: any) {
    // Log but don't throw — the LinkedIn post is already live.
    // The caller (queue processor or manual publish) can retry the DB update.
    console.error(
      `[publish-core] LinkedIn post ${result.postId} published successfully, but DB update failed:`,
      dbErr?.message || dbErr
    );
  }

  return result;
}
