"use server";

import { prisma } from "@/lib/prisma";
import { generateLinkedInPost } from "@/lib/gemini";
import { retrieveRelevantArticles } from "../compose/actions";
import { getRandomSamplePosts } from "@/lib/linkedin-style";
import { cleanPostOutput } from "@/lib/prompts";
import { publishPostToLinkedInCore } from "@/lib/automation/publish-core";
import { addToQueue } from "./queue-actions";
import { getNextPreferredPostingTime } from "@/lib/automation/schedule";

interface Version {
  content: string;
  createdAt: string;
}

function getVersions(post: { versions: string | null }): Version[] {
  try {
    return JSON.parse(post.versions || "[]") as Version[];
  } catch {
    return [];
  }
}

export async function getPost(id: string) {
  try {
    return await prisma.generatedPost.findUnique({
      where: { id },
      include: { idea: true },
      omit: { brandedImageData: true },
    });
  } catch (err: any) {
    console.error("getPost error:", err);
    throw new Error(err?.message || "Failed to get post");
  }
}

export async function updatePost(formData: FormData) {
  try {
    const id = formData.get("id") as string;
    const finalContent = formData.get("final_content") as string;
    const status = formData.get("status") as string;

    // Also update the current version in the versions array
    const post = await prisma.generatedPost.findUnique({
      where: { id },
      omit: { brandedImageData: true },
    });
    if (!post) throw new Error("Post not found");

    const versions = getVersions(post);
    const currentIdx = post.currentVersionIndex ?? 0;

    if (versions[currentIdx]) {
      versions[currentIdx].content = finalContent;
    }

    return await prisma.generatedPost.update({
      where: { id },
      data: {
        finalContent,
        status,
        versions: JSON.stringify(versions),
      },
    });
  } catch (err: any) {
    console.error("updatePost error:", err);
    throw new Error(err?.message || "Failed to update post");
  }
}

export async function navigateVersion(id: string, direction: "prev" | "next") {
  try {
    const post = await prisma.generatedPost.findUnique({ where: { id } });
    if (!post) throw new Error("Post not found");

    const versions = getVersions(post);
    const currentIdx = post.currentVersionIndex ?? 0;

    let newIdx = currentIdx;
    if (direction === "prev" && currentIdx > 0) {
      newIdx = currentIdx - 1;
    } else if (direction === "next" && currentIdx < versions.length - 1) {
      newIdx = currentIdx + 1;
    }

    if (newIdx === currentIdx) return post; // No change

    const newContent = versions[newIdx].content;

    return await prisma.generatedPost.update({
      where: { id },
      data: {
        currentVersionIndex: newIdx,
        draftContent: newContent,
        finalContent: newContent,
      },
    });
  } catch (err: any) {
    console.error("navigateVersion error:", err);
    throw new Error(err?.message || "Failed to navigate versions");
  }
}

export async function regeneratePost(id: string) {
  try {
    const post = await prisma.generatedPost.findUnique({
      where: { id },
      include: { idea: true },
    });

    if (!post || !post.idea) {
      throw new Error("Post or idea not found");
    }

    const idea = post.idea;
    const ideaText = `${idea.title} ${idea.description || ""}`;

    // Find active style, or fall back to any style profile
    let style = await prisma.styleProfile.findFirst({
      where: { isActive: true },
    });
    if (!style) {
      style = await prisma.styleProfile.findFirst({
        orderBy: { createdAt: "desc" },
      });
    }
    if (!style) throw new Error("No style profiles found. Create one in /styles first.");

    // Re-retrieve relevant articles with the same idea
    const articles = await retrieveRelevantArticles(ideaText);

    // If using a cloned voice, inject few-shot examples
    let examples: string[] | undefined;
    if (style.isClonedVoice) {
      examples = await getRandomSamplePosts(3);
    }

    // Generate a fresh draft
    const draft = await generateLinkedInPost({
      idea: idea.title,
      ideaDescription: idea.description || undefined,
      stylePrompt: style.promptText,
      articles: articles.map((a: any) => ({
        title: a.title,
        content: a.content,
        url: a.url,
        bestChunk: a.best_chunk,
      })),
      examples,
    });

    const draftWithSources = cleanPostOutput(draft.trim());

    // Create a brand new post row tied to the same idea
    return await prisma.generatedPost.create({
      data: {
        ideaId: idea.id,
        draftContent: draftWithSources,
        finalContent: draftWithSources,
        status: "draft",
      },
    });
  } catch (err: any) {
    console.error("regeneratePost error:", err);
    throw new Error(err?.message || "Failed to regenerate post");
  }
}

export async function savePostContent(id: string, content: string) {
  try {
    const post = await prisma.generatedPost.findUnique({ where: { id } });
    if (!post) throw new Error("Post not found");

    const cleaned = cleanPostOutput(content);

    const versions = getVersions(post);
    const currentIdx = post.currentVersionIndex ?? 0;

    if (versions[currentIdx]) {
      versions[currentIdx].content = cleaned;
    }

    return await prisma.generatedPost.update({
      where: { id },
      data: {
        finalContent: cleaned,
        versions: JSON.stringify(versions),
      },
    });
  } catch (err: any) {
    console.error("savePostContent error:", err);
    throw new Error(err?.message || "Failed to save post content");
  }
}

export async function saveIdeaTitle(ideaId: string, title: string) {
  try {
    return await prisma.dailyIdea.update({
      where: { id: ideaId },
      data: { title },
    });
  } catch (err: any) {
    console.error("saveIdeaTitle error:", err);
    throw new Error(err?.message || "Failed to save title");
  }
}

export async function updatePostStatus(id: string, status: string) {
  try {
    const updated = await prisma.generatedPost.update({
      where: { id },
      data: { status },
    });

    // Auto-queue on approve if enabled
    if (status === "approved") {
      const settings = await prisma.userSettings.findFirst();
      if (settings?.autoPublishApproved) {
        const scheduledAt = await getNextPreferredPostingTime();
        await addToQueue(id, scheduledAt);
      }
    }

    return updated;
  } catch (err: any) {
    console.error("updatePostStatus error:", err);
    throw new Error(err?.message || "Failed to update post status");
  }
}

export async function archivePost(id: string) {
  try {
    return await prisma.generatedPost.update({
      where: { id },
      data: { status: "archived" },
    });
  } catch (err: any) {
    console.error("archivePost error:", err);
    throw new Error(err?.message || "Failed to archive post");
  }
}

export async function toggleSkipImage(id: string, skipImage: boolean) {
  try {
    return await prisma.generatedPost.update({
      where: { id },
      data: { skipImage },
    });
  } catch (err: any) {
    console.error("toggleSkipImage error:", err);
    throw new Error(err?.message || "Failed to update image setting");
  }
}

export async function publishToLinkedIn(id: string, content: string) {
  try {
    if (!content || content.trim().length === 0) {
      throw new Error("Post has no content to publish");
    }

    const result = await publishPostToLinkedInCore(id, content);

    return { success: true, postId: result.postId, postUrl: result.postUrl };
  } catch (err: any) {
    console.error("publishToLinkedIn error:", err);
    throw new Error(err?.message || "Failed to publish to LinkedIn");
  }
}
