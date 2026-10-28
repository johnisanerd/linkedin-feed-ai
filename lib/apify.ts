const APIFY_BASE_URL = "https://api.apify.com/v2";
const ACTOR_ID = "johnvc~linkedin-posts-api";

function getApiKey(): string {
  const apiKey = process.env.APIFY_API_TOKEN;
  if (!apiKey) {
    throw new Error(
      "APIFY_API_TOKEN is not set.\n\n" +
        "Add your Apify API token to .env.local:\n" +
        "APIFY_API_TOKEN=your_apify_api_token\n\n" +
        "Get one at: https://console.apify.com/account/integrations"
    );
  }
  return apiKey;
}

function getWebhookUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return null;
  // Localhost won't work for webhooks — Apify can't reach it
  if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    return null;
  }
  return `${baseUrl}/api/webhooks/apify`;
}

interface ApifyPost {
  text?: string;
  datePosted?: string;
  postUrl?: string;
  error_message?: string;
  postedAtISO?: string;
  postedAtTimestamp?: number;
  url?: string;
  numLikes?: number;
  numComments?: number;
  likes?: number;
  comments?: number;
  authorFullName?: string;
  authorName?: string;
  date?: string;
  likesCount?: number;
  commentsCount?: number;
}

export interface ScrapedPost {
  text: string;
  postedAt: string | null;
  url: string | null;
  engagement: {
    likes: number;
    comments: number;
  };
}

function parsePosts(items: ApifyPost[]): {
  posts: ScrapedPost[];
  displayName: string | null;
} {
  const postItems = items.filter((item) => !item.error_message);

  const posts: ScrapedPost[] = postItems
    .filter((item) => item.text && item.text.trim().length > 10)
    .map((item) => ({
      text: item.text!.trim(),
      postedAt: item.datePosted || item.postedAtISO || item.date || null,
      url: item.postUrl || item.url || null,
      engagement: {
        likes: item.numLikes ?? item.likes ?? item.likesCount ?? 0,
        comments: item.numComments ?? item.comments ?? item.commentsCount ?? 0,
      },
    }));

  const displayName =
    postItems[0]?.authorFullName || postItems[0]?.authorName || null;

  return { posts, displayName };
}

/**
 * Build ad-hoc webhook config for Apify.
 * Tells Apify to POST to our webhook endpoint when the run succeeds or fails.
 */
function buildWebhookConfig(): string | null {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) return null;

  const config = [
    {
      eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED"],
      requestUrl: webhookUrl,
      payloadTemplate: '{"runId":"{{resource.id}}","status":"{{resource.status}}"}',
    },
  ];

  return Buffer.from(JSON.stringify(config)).toString("base64");
}

/**
 * Start an Apify scrape for a LinkedIn profile.
 * Returns the runId immediately — does NOT wait for completion.
 * If deployed, registers an ad-hoc webhook so Apify calls us back.
 * If local, caller must poll or fetch manually.
 */
export async function startLinkedInScrape(
  profileUrl: string
): Promise<string> {
  const apiKey = getApiKey();

  let url = `${APIFY_BASE_URL}/acts/${ACTOR_ID}/runs?token=${apiKey}`;
  const webhooks = buildWebhookConfig();
  if (webhooks) {
    url += `&webhooks=${encodeURIComponent(webhooks)}`;
  }

  const runResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      profileUrls: [profileUrl],
      maxPostsPerProfile: 50,
    }),
  });

  if (!runResponse.ok) {
    const error = await runResponse.text();
    if (runResponse.status === 404) {
      throw new Error(
        "Apify actor not found. The actor may have been renamed or removed. " +
          "Check https://apify.com/store for available LinkedIn scrapers."
      );
    }
    if (runResponse.status === 401) {
      throw new Error(
        "Apify API token is invalid. Check your APIFY_API_TOKEN in .env.local"
      );
    }
    throw new Error(`Apify run failed: ${runResponse.status} ${error}`);
  }

  const runData = await runResponse.json();
  return runData.data.id;
}

export type ScrapeStatus =
  | { status: "running"; message: string }
  | { status: "succeeded"; posts: ScrapedPost[]; displayName: string | null }
  | { status: "failed"; message: string };

/**
 * Check the status of an Apify run.
 * If succeeded, fetches and returns the posts.
 * If still running, returns a status indicator.
 * If failed, returns an error.
 */
export async function checkScrapeStatus(
  runId: string
): Promise<ScrapeStatus> {
  const apiKey = getApiKey();

  const statusRes = await fetch(
    `${APIFY_BASE_URL}/actor-runs/${runId}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  if (!statusRes.ok) {
    throw new Error(`Failed to check Apify run status: ${statusRes.status}`);
  }

  const statusData = await statusRes.json();
  const status = statusData.data.status;

  if (status === "RUNNING" || status === "READY" || status === "REBUILDING") {
    return { status: "running", message: `Scrape status: ${status}` };
  }

  if (status !== "SUCCEEDED") {
    return {
      status: "failed",
      message: `Scraper failed with status: ${status}. The profile may be private or LinkedIn blocked the request.`,
    };
  }

  // Fetch results
  const datasetRes = await fetch(
    `${APIFY_BASE_URL}/actor-runs/${runId}/dataset/items`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  if (!datasetRes.ok) {
    return {
      status: "failed",
      message: `Failed to fetch Apify dataset: ${datasetRes.status}`,
    };
  }

  const items: ApifyPost[] = await datasetRes.json();
  const { posts, displayName } = parsePosts(items);

  return { status: "succeeded", posts, displayName };
}

/**
 * Fetch posts directly from an Apify dataset URL.
 * Used for manual fallback when user pastes a dataset URL.
 */
export async function fetchFromDatasetUrl(
  datasetUrl: string
): Promise<{
  posts: ScrapedPost[];
  displayName: string | null;
}> {
  const res = await fetch(datasetUrl);

  if (!res.ok) {
    throw new Error(`Failed to fetch dataset: ${res.status} ${await res.text()}`);
  }

  const items: ApifyPost[] = await res.json();
  return parsePosts(items);
}

/**
 * Legacy convenience function: start + wait (up to 90s).
 * Kept for scripts/one-offs. UI should use start + poll.
 */
export async function fetchLinkedInPosts(
  profileUrl: string
): Promise<{
  posts: ScrapedPost[];
  displayName: string | null;
}> {
  const runId = await startLinkedInScrape(profileUrl);

  const maxWait = 90_000;
  const pollInterval = 3000;
  let elapsed = 0;

  while (true) {
    const result = await checkScrapeStatus(runId);

    if (result.status === "succeeded") {
      return {
        posts: result.posts,
        displayName: result.displayName,
      };
    }

    if (result.status === "failed") {
      throw new Error(result.message);
    }

    if (elapsed >= maxWait) {
      throw new Error(
        "Apify scraper timed out after 90 seconds. The actor may still be running. Use the polling UI instead."
      );
    }

    await new Promise((r) => setTimeout(r, pollInterval));
    elapsed += pollInterval;
  }
}
