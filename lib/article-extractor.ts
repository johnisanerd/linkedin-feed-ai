import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface ExtractedMetadata {
  title: string;
  description?: string;
  author?: string;
  publishedAt?: Date;
  image?: string;
  canonicalUrl?: string;
  siteName?: string;
}

export interface ExtractedArticle {
  title: string;
  author?: string;
  content: string;
  contentHtml: string;
  excerpt: string;
  siteName?: string;
  charCount: number;
  publishedAt?: Date;
  canonicalUrl?: string;
  image?: string;
  description?: string;
}

/**
 * Extract metadata from Open Graph, Twitter cards, and JSON-LD before
 * falling back to Readability output.
 */
function extractMetadataFromDom(doc: Document): ExtractedMetadata {
  const meta = (name: string) =>
    doc
      .querySelector(
        `meta[property="${name}"], meta[name="${name}"]`
      )
      ?.getAttribute("content") ?? undefined;

  // JSON-LD (most reliable)
  let jsonLd: any = null;
  for (const script of doc.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    try {
      const parsed = JSON.parse(script.textContent ?? "");
      if (
        parsed?.["@type"] === "Article" ||
        parsed?.["@type"] === "BlogPosting" ||
        parsed?.["@type"] === "NewsArticle"
      ) {
        jsonLd = parsed;
        break;
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }

  const rawTitle =
    jsonLd?.headline ?? meta("og:title") ?? meta("twitter:title");

  const rawDescription =
    jsonLd?.description ?? meta("og:description") ?? meta("description");

  let publishedAt: Date | undefined;
  const rawDate =
    jsonLd?.datePublished ?? meta("article:published_time");
  if (rawDate) {
    try {
      publishedAt = new Date(rawDate);
      if (isNaN(publishedAt.getTime())) publishedAt = undefined;
    } catch {
      publishedAt = undefined;
    }
  }

  return {
    title: rawTitle,
    description: rawDescription,
    author:
      jsonLd?.author?.name ?? meta("article:author") ?? meta("author"),
    publishedAt,
    image: meta("og:image"),
    canonicalUrl:
      doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
      undefined,
    siteName: meta("og:site_name"),
  };
}

/**
 * Run Mozilla Readability on the given HTML document.
 */
function runReadability(doc: Document) {
  const reader = new Readability(doc, {
    charThreshold: 500,
    keepClasses: false,
  });
  return reader.parse();
}

/**
 * Detect whether the page looks like it was rendered client-side
 * (React/Vue/Next.js shell) by checking for empty content despite
 * mount-point elements being present.
 */
function looksLikeSpa(html: string, readabilityResult: any): boolean {
  if (!readabilityResult || readabilityResult.length > 500) return false;
  const spaMounts = [
    'id="root"',
    'id="__next"',
    'id="__nuxt"',
    'id="app"',
    'data-reactroot',
    'id="main-content"',
    'class="next-app"',
  ];
  const hasMount = spaMounts.some((m) => html.includes(m));
  const contentIsShort = !readabilityResult || readabilityResult.length < 500;
  return hasMount && contentIsShort;
}

export interface QualityGateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate that an extracted article is worth storing.
 */
function validateArticle(article: ExtractedArticle): QualityGateResult {
  if (!article.content) return { ok: false, reason: "empty content" };
  if (article.content.length < 500)
    return { ok: false, reason: "too short (< 500 chars)" };
  if (article.content.length > 200_000)
    return { ok: false, reason: "too long (> 200k chars)" };

  // Detect cookie-wall / paywall stubs
  const lower = article.content.toLowerCase();
  const wallKeywords = [
    "accept all cookies",
    "subscribe to read",
    "create a free account to read",
    "this article is for paid subscribers",
    "please enable javascript",
    "turn off your ad blocker",
  ];
  if (
    wallKeywords.some((k) => lower.includes(k)) &&
    article.content.length < 2000
  ) {
    return { ok: false, reason: "looks like a cookie/paywall stub" };
  }

  // Reject pages that are mostly navigation
  const sentences = article.content
    .split(/[.!?]+/)
    .filter((s) => s.trim().length > 20);
  if (sentences.length < 5)
    return { ok: false, reason: "too few real sentences" };

  return { ok: true };
}

/**
 * Fetch a URL's HTML. Respects HTTP errors.
 */
async function fetchHtml(url: string): Promise<{ html: string; url: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch article: ${response.status} ${response.statusText}`
    );
  }

  // Follow redirects and use the final URL for link resolution
  const finalUrl = response.url || url;
  const html = await response.text();
  return { html, url: finalUrl };
}

/**
 * Extract article text and metadata using Mozilla Readability.
 * Falls back to SPA rendering (Playwright) only when the article
 * is too short despite the page having client-side mount points.
 *
 * Returns both the article AND the quality-gate result so callers
 * can decide whether to store or skip.
 */
export async function extractArticle(
  url: string
): Promise<{
  article: ExtractedArticle;
  quality: QualityGateResult;
  html: string;
}> {
  let { html, url: resolvedUrl } = await fetchHtml(url);
  const { window } = parseHTML(html);
  (window.document as any).documentURI = resolvedUrl;
  let readabilityResult = runReadability(window.document);

  // SPA fallback: if content is suspiciously short and the page
  // looks like a React/Vue shell, we would normally use Playwright.
  // For now we just flag it and return whatever we have — the
  // quality gate will reject it and the caller can decide to retry.
  if (looksLikeSpa(html, readabilityResult)) {
    // Future: trigger Playwright render here
    // For now, let the quality gate handle the short content
  }

  if (!readabilityResult) {
    throw new Error("Readability could not extract article from page");
  }

  // Clean up whitespace
  const cleanContent = (readabilityResult.textContent || "")
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();

  // Extract metadata
  const metadata = extractMetadataFromDom(window.document);

  // Prefer Readability title (already cleaned) over raw metadata
  const title =
    readabilityResult.title?.trim() || metadata.title || "Untitled";

  const article: ExtractedArticle = {
    title,
    author: metadata.author,
    content: cleanContent,
    contentHtml: readabilityResult.content || "",
    excerpt: readabilityResult.excerpt || metadata.description || "",
    siteName: readabilityResult.siteName || metadata.siteName,
    charCount: cleanContent.length,
    publishedAt: metadata.publishedAt,
    canonicalUrl: metadata.canonicalUrl,
    image: metadata.image,
    description: metadata.description,
  };

  const quality = validateArticle(article);
  return { article, quality, html };
}

/**
 * Legacy compatibility wrapper that mimics the old
 * fetchArticleText({title, content}) shape.
 *
 * Still used by some callers. Throws on extraction failure
 * or quality-gate rejection.
 */
export async function fetchArticleText(
  url: string
): Promise<{ title: string; content: string }> {
  const { article, quality } = await extractArticle(url);
  if (!quality.ok) {
    throw new Error(`Article rejected: ${quality.reason}`);
  }
  return { title: article.title, content: article.content };
}

/**
 * Compute a content hash for deduplication.
 * SHA-256 of the first 1000 chars of normalized (lowercased, whitespace-collapsed) content.
 */
export function computeContentHash(content: string): string {
  // Use Node.js crypto — safe in Next.js server context
  const { createHash } = require("crypto");
  const normalized = content
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
  return createHash("sha256").update(normalized).digest("hex");
}

// ---------------------------------------------------------------------------
// Link extraction from newsletter issue pages
// ---------------------------------------------------------------------------

export interface ArticleLink {
  url: string;
  title: string;
}

const NON_ARTICLE_PATTERNS = [
  // Social media / platforms
  /twitter\.com/i,
  /x\.com/i,
  /facebook\.com/i,
  /instagram\.com/i,
  /linkedin\.com/i,
  /youtube\.com/i,
  /youtu\.be/i,
  /tiktok\.com/i,
  /reddit\.com/i,
  /medium\.com\/ @/i, // medium profiles, not articles
  // Newsletter / subscription
  /substack\.com\/(subscribe|archive|podcast)/i,
  /mailchi\.mp/i,
  /convertkit\.com/i,
  /buttondown\.email/i,
  /beehiiv\.com/i,
  // Sponsors / ads
  /sponsor/i,
  /advertise/i,
  /promo/i,
  // Generic non-content
  /unsubscribe/i,
  /privacy-policy/i,
  /terms-of-service/i,
  /cdn\./i,
  // Images
  /\.(jpg|jpeg|png|gif|svg|webp|pdf|zip)$/i,
];

/**
 * Check if a URL looks like a real article (not social, sponsor, image, etc.)
 */
function looksLikeArticleLink(url: string): boolean {
  return !NON_ARTICLE_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Extract article links from a newsletter issue / roundup page.
 *
 * Uses Readability to get the main content, then finds all external
 * <a> tags within it.  Filters out social media, sponsors, images, etc.
 *
 * Returns empty array if the page itself is a single article
 * (no / few external links found).
 */
export async function extractArticleLinksFromPage(
  url: string
): Promise<ArticleLink[]> {
  try {
    const { html } = await fetchHtml(url);
    const { window } = parseHTML(html);
    (window.document as any).documentURI = url;
    const readabilityResult = runReadability(window.document);

    if (!readabilityResult) {
      return [];
    }

    // Parse the cleaned HTML to find links
    const contentHtml = readabilityResult.content || "";
    const { window: win2 } = parseHTML(contentHtml);
    (win2.document as any).documentURI = url;
    const doc = win2.document;

    const pageDomain = new URL(url).hostname;
    const links = new Map<string, string>(); // dedup by URL

    for (const anchor of doc.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href");
      if (!href) continue;

      // Resolve relative URLs
      let resolvedUrl: string;
      try {
        resolvedUrl = new URL(href, url).href;
      } catch {
        continue;
      }

      // Skip same-domain links (these are usually navigation, "read more",
      // or links to other issues on the same newsletter)
      const linkDomain = new URL(resolvedUrl).hostname;
      if (linkDomain === pageDomain) continue;

      // Skip anchor-only links
      if (resolvedUrl.startsWith("#")) continue;

      // Skip non-article patterns
      if (!looksLikeArticleLink(resolvedUrl)) continue;

      const title = anchor.textContent?.trim() || resolvedUrl;
      if (title.length < 3) continue; // skip empty / single-char links

      links.set(resolvedUrl, title);
    }

    return Array.from(links.entries()).map(([url, title]) => ({
      url,
      title,
    }));
  } catch {
    return [];
  }
}
