"use server";

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { fetchRSSFeed, filterRecentItems, RSSItem } from "@/lib/rss-parser";
import { extractArticle, extractArticleLinksFromPage, computeContentHash } from "@/lib/article-extractor";
import { chunkArticle } from "@/lib/chunker";
import { generateEmbedding, formatEmbeddingForPostgres } from "@/lib/gemini";
import { parseHTML } from "linkedom";

function resolveUrl(link: string, feedUrl: string): string {
  if (!link) return "";
  if (link.startsWith("http://") || link.startsWith("https://")) {
    return link;
  }
  try {
    return new URL(link, feedUrl).href;
  } catch {
    return link;
  }
}

function getItemLink(item: RSSItem, feedUrl: string): string {
  const raw = item.link || (item as any).guid || "";
  return resolveUrl(raw, feedUrl);
}

interface SyncResult {
  sourceId: string;
  sourceName: string;
  success: boolean;
  ingested: number;
  skipped: number;
  failed: number;
  total: number;
  error?: string;
}

/**
 * Ingest a single article: extract, chunk, embed each chunk, store.
 */
async function ingestSingleArticle(
  url: string,
  sourceId: string,
  fallbackTitle: string
): Promise<{ articleId: string; stored: boolean; reason?: string }> {
  try {
    const { article, quality } = await extractArticle(url);

    if (!quality.ok) {
      console.warn(`Skipping ${url}: ${quality.reason}`);
      return { articleId: "", stored: false, reason: quality.reason };
    }

    // URL dedup
    const existingUrl = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM articles WHERE url = ${url} LIMIT 1
    `;
    if (existingUrl.length > 0) {
      return {
        articleId: existingUrl[0].id,
        stored: false,
        reason: "duplicate url",
      };
    }

    // Content-hash dedup
    const contentHash = computeContentHash(article.content);
    const existingHash = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM articles WHERE content_hash = ${contentHash} LIMIT 1
    `;
    if (existingHash.length > 0) {
      return {
        articleId: existingHash[0].id,
        stored: false,
        reason: "duplicate content hash",
      };
    }

    const articleId = randomUUID();
    const chunks = chunkArticle(article.content);

    // Insert article (no embedding — lives on chunks now)
    await prisma.$executeRaw`
      INSERT INTO articles (
        id, source_id, title, url, content,
        excerpt, author, published_at, content_hash,
        canonical_url, site_name, char_count, extraction_method, created_at
      )
      VALUES (
        ${articleId},
        ${sourceId},
        ${article.title || fallbackTitle || "Untitled"},
        ${url},
        ${article.content},
        ${article.excerpt || null},
        ${article.author || null},
        ${article.publishedAt || null},
        ${contentHash},
        ${article.canonicalUrl || null},
        ${article.siteName || null},
        ${article.charCount},
        ${"readability"},
        NOW()
      )
    `;

    // Embed each chunk with taskType=RETRIEVAL_DOCUMENT and article title
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk.text, {
        taskType: "RETRIEVAL_DOCUMENT",
        title: article.title,
      });
      const embeddingLiteral = formatEmbeddingForPostgres(embedding);

      await prisma.$executeRaw`
        INSERT INTO article_chunks (id, article_id, chunk_index, text, char_start, char_end, embedding, created_at)
        VALUES (
          ${randomUUID()},
          ${articleId},
          ${chunk.index},
          ${chunk.text},
          ${chunk.charStart},
          ${chunk.charEnd},
          ${embeddingLiteral}::vector(768),
          NOW()
        )
      `;
    }

    return { articleId, stored: true };
  } catch (error) {
    console.error(`Failed to ingest article ${url}:`, error);
    return { articleId: "", stored: false, reason: String(error) };
  }
}

/**
 * Extract article links from raw HTML content (e.g. from RSS content:encoded).
 */
function extractLinksFromHtml(html: string, baseUrl: string): Array<{ url: string; title: string }> {
  const { window } = parseHTML(html);
  (window.document as any).documentURI = baseUrl;
  const doc = window.document;

  const baseDomain = new URL(baseUrl).hostname;
  const links = new Map<string, string>();

  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    let resolvedUrl: string;
    try {
      resolvedUrl = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    const linkDomain = new URL(resolvedUrl).hostname;
    if (linkDomain === baseDomain) continue;
    if (resolvedUrl.startsWith("#")) continue;
    if (resolvedUrl.match(/\.(jpg|jpeg|png|gif|svg|webp|pdf|zip)$/i)) continue;

    const title = anchor.textContent?.trim() || resolvedUrl;
    if (title.length < 3) continue;

    links.set(resolvedUrl, title);
  }

  return Array.from(links.entries()).map(([url, title]) => ({ url, title }));
}

/**
 * Determine if an RSS item is a direct article or a link-roundup issue page.
 *
 * Heuristic:
 *   1. If RSS item has content, parse it for external article links.
 *   2. If >= 3 external links found in content → it's a roundup.
 *   3. Otherwise, fetch the page and extract links.
 *   4. If >= 3 external links on the page → it's a roundup.
 *   5. Otherwise → direct article.
 */
async function classifyItem(item: RSSItem, feedUrl: string): Promise<{
  type: "direct" | "roundup";
  links: Array<{ url: string; title: string }>;
}> {
  const itemLink = getItemLink(item, feedUrl);
  const itemContent = item.content || item.description || "";

  // If RSS provides content, check it first for article links
  if (itemContent.length > 0 && itemContent.includes("<a ")) {
    const contentLinks = extractLinksFromHtml(itemContent, itemLink);
    if (contentLinks.length >= 3) {
      return { type: "roundup", links: contentLinks };
    }
  }

  // Fetch the page and extract links
  const articleLinks = await extractArticleLinksFromPage(itemLink);

  if (articleLinks.length >= 3) {
    return { type: "roundup", links: articleLinks };
  }

  // Fallback: treat as direct article
  return { type: "direct", links: [{ url: itemLink, title: item.title }] };
}

export async function syncRSSFeed(
  sourceId: string,
  feedUrl: string,
  options: { isFirstSync?: boolean } = {}
): Promise<SyncResult> {
  const sourceName =
    (
      await prisma.newsletterSource.findUnique({
        where: { id: sourceId },
        select: { name: true },
      })
    )?.name || feedUrl;

  try {
    const feed = await fetchRSSFeed(feedUrl);

    // On first sync, only grab recent items to avoid ingesting years of archives.
    const items = options.isFirstSync
      ? filterRecentItems(feed.items, 30)
      : feed.items;

    let ingestedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Collect all item URLs for batch duplicate check
    const itemLinks = items
      .map((item) => getItemLink(item, feedUrl))
      .filter(Boolean);
    const existingArticles = await prisma.$queryRaw<Array<{ url: string }>>`
      SELECT url FROM articles WHERE url = ANY(${itemLinks}::text[])
    `;
    const existingUrls = new Set(existingArticles.map((a) => a.url));

    for (const item of items) {
      const itemLink = getItemLink(item, feedUrl);
      if (!itemLink) {
        failedCount++;
        continue;
      }

      // Skip if the item URL itself is already in DB
      if (existingUrls.has(itemLink)) {
        skippedCount++;
        continue;
      }

      // Classify: direct article or roundup?
      const classification = await classifyItem(item, feedUrl);

      if (classification.type === "roundup") {
        // Ingest each article link from the roundup
        let roundupIngested = 0;
        let roundupSkipped = 0;
        let roundupFailed = 0;

        for (const link of classification.links) {
          if (existingUrls.has(link.url)) {
            roundupSkipped++;
            continue;
          }

          const result = await ingestSingleArticle(
            link.url,
            sourceId,
            link.title
          );

          if (result.stored) {
            roundupIngested++;
            existingUrls.add(link.url);
          } else if (result.reason?.includes("duplicate")) {
            roundupSkipped++;
          } else {
            roundupFailed++;
          }
        }

        ingestedCount += roundupIngested;
        skippedCount += roundupSkipped;
        failedCount += roundupFailed;

        // Mark the issue page itself as "tracked" so we don't re-process it
        existingUrls.add(itemLink);
      } else {
        // Direct article
        const result = await ingestSingleArticle(
          itemLink,
          sourceId,
          item.title
        );

        if (result.stored) {
          ingestedCount++;
          existingUrls.add(itemLink);
        } else if (result.reason?.includes("duplicate")) {
          skippedCount++;
        } else {
          failedCount++;
        }
      }
    }

    // Update source last_fetched_at
    await prisma.newsletterSource.update({
      where: { id: sourceId },
      data: { lastFetchedAt: new Date() },
    });

    return {
      sourceId,
      sourceName,
      success: true,
      ingested: ingestedCount,
      skipped: skippedCount,
      failed: failedCount,
      total: items.length,
    };
  } catch (error: any) {
    console.error(`Failed to sync RSS feed ${feedUrl}:`, error);
    return {
      sourceId,
      sourceName,
      success: false,
      ingested: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      error: error.message || "Failed to sync RSS feed",
    };
  }
}

export async function syncAllRSSFeeds(): Promise<SyncResult[]> {
  const sources = await prisma.newsletterSource.findMany({
    where: { type: "rss" },
    orderBy: { createdAt: "desc" },
  });

  const results: SyncResult[] = [];

  for (const source of sources) {
    if (!source.url) continue;
    const isFirstSync = !source.lastFetchedAt;
    const result = await syncRSSFeed(source.id, source.url, { isFirstSync });
    results.push(result);
  }

  return results;
}
