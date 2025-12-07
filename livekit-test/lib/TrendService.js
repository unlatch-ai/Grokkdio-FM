/**
 * Trend Service - X/Twitter API integration
 * Fetches trending topics and tweets
 */

const X_API_BASE = "https://api.x.com/2";
const US_WOEID = 23424977; // United States WOEID

/**
 * @typedef {Object} Trend
 * @property {string} trend_name
 * @property {number} [tweet_count]
 */

/**
 * @typedef {Object} Tweet
 * @property {string} id
 * @property {string} text
 * @property {string} [created_at]
 * @property {string} [author_id]
 * @property {Object} [public_metrics]
 */

async function fetchWithAuth(url) {
  const bearerToken = process.env.X_BEARER_TOKEN;

  if (!bearerToken) {
    throw new Error("X_BEARER_TOKEN environment variable is not set");
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });

  return response;
}

/**
 * Get top trending topics
 * @param {number} maxTrends - Maximum number of trends to fetch
 * @returns {Promise<Trend[]>}
 */
export async function getTopTrends(maxTrends = 10) {
  const url = `${X_API_BASE}/trends/by/woeid/${US_WOEID}?max_trends=${maxTrends}&trend.fields=trend_name,tweet_count`;

  const response = await fetchWithAuth(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch trends: ${response.status} - ${text}`);
  }

  const data = await response.json();

  if (!data.data || data.data.length === 0) {
    throw new Error("No trends found");
  }

  return data.data;
}

const GROK_API_BASE = "https://api.x.ai/v1";

/**
 * Use Grok 4 with x_search tool to discover edgy, highly trending topics
 * Returns same format as getTopTrends for easy replacement
 * @param {Set|Array} seenTrends - Trends already discussed (to avoid repetition)
 * @param {number} maxTrends - Maximum number of trends to return
 * @returns {Promise<Trend[]>} Array of trends with trend_name property
 */
export async function getEdgyTrendsWithGrok(seenTrends = [], maxTrends = 15) {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    throw new Error("XAI_API_KEY environment variable is not set");
  }

  // Convert Set to Array if needed
  const seenArray =
    seenTrends instanceof Set ? Array.from(seenTrends) : seenTrends;

  const seenTrendsList =
    seenArray.length > 0
      ? `\n\nALREADY DISCUSSED (avoid these):\n${seenArray
          .map((t) => `- ${t}`)
          .join("\n")}`
      : "";

  const systemPrompt = `Find ${maxTrends} trending controversial topics on X/Twitter for a podcast. Focus on drama, debates, and breaking news. Avoid boring announcements.${seenTrendsList}`;

  const userPrompt = `What are ${maxTrends} hot topics on X right now? Keywords only, no search operators.

TRENDS:
1. topic keywords
...up to ${maxTrends}`;

  // Timeout for the research request (30 seconds)
  const TIMEOUT_MS = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  console.log(
    "Searching for edgy trends with Grok... prompts:",
    systemPrompt,
    userPrompt
  );
  try {
    // Use Responses API (not Chat Completions) for x_search tool
    const response = await fetch(`${GROK_API_BASE}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{ type: "x_search" }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Grok API error: ${response.status} - ${text}`);
    }

    const data = await response.json();

    // Responses API: find the assistant message in output array
    // Structure: data.output[] -> find item with type:"message" and role:"assistant" -> content[0].text
    let content = "";
    if (data.output && Array.isArray(data.output)) {
      const assistantMessage = data.output.find(
        (item) => item.type === "message" && item.role === "assistant"
      );
      if (assistantMessage?.content?.[0]?.text) {
        content = assistantMessage.content[0].text;
      }
    }

    // Parse the response - look for TRENDS section
    const trendsMatch = content.match(/TRENDS:\s*([\s\S]+)/i);

    // Parse trend queries (handle numbered list format)
    let trendQueries = [];
    if (trendsMatch) {
      const trendsText = trendsMatch[1];
      // Match numbered items like "1. query" or "1) query" or just lines
      const lines = trendsText
        .split("\n")
        .map((line) => line.replace(/^\d+[\.\)]\s*/, "").trim())
        .filter((line) => line.length > 0);

      trendQueries = lines.slice(0, maxTrends);
    }

    // Fallback if parsing failed - try to extract any lines that look like trends
    if (trendQueries.length === 0) {
      console.warn("Failed to parse Grok response, attempting fallback parse");
      const lines = content
        .split("\n")
        .map((line) => line.replace(/^\d+[\.\)]\s*/, "").trim())
        .filter((line) => line.length > 3 && line.length < 100);
      trendQueries = lines.slice(0, maxTrends);
    }

    // Convert to same format as getTopTrends: { trend_name, tweet_count }
    // Set high tweet_count so they pass the minTweetCount filter in TrendInjector
    const trends = trendQueries.map((query) => ({
      trend_name: query,
      tweet_count: 100000, // Grok already selected high-engagement topics
    }));

    console.log(`🔥 Grok found ${trends.length} edgy trends`);
    return trends;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.error(
        `⚠️ Grok trend search timed out after ${
          TIMEOUT_MS / 1000
        }s, falling back to normal trends`
      );
    } else {
      console.error(
        `⚠️ Grok trend search error: ${err.message}, falling back to normal trends`
      );
    }
    // Fall back to normal Twitter API trends
    return getTopTrends(maxTrends);
  }
}

/**
 * Use Grok with x_search to get ONE trending topic AND one tweet URL in a single call.
 * Returns the trend, tweet URL (ready to use with captureTweet), and reasoning.
 * Uses JSON structured output for reliable parsing.
 * @param {Set|Array} seenTrends - Trends already discussed (to avoid repetition)
 * @returns {Promise<{trend: string, tweetUrl: string, reasoning: string}>}
 */
export async function getEdgyTrendWithTweets(seenTrends = []) {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    throw new Error("XAI_API_KEY environment variable is not set");
  }

  // Convert Set to Array if needed
  const seenArray =
    seenTrends instanceof Set ? Array.from(seenTrends) : seenTrends;

  const seenTrendsList =
    seenArray.length > 0
      ? ` Avoid these already-discussed topics: ${seenArray
          .slice(-10)
          .join(", ")}.`
      : "";

  const systemPrompt = `You find trending controversial topics on X/Twitter. Search X and return ONE hot topic with ONE viral tweet about it.${seenTrendsList} Respond with valid JSON only.`;

  const userPrompt = `Search X for 1 hot controversial topic people are arguing about right now. Find the most viral tweet about it. Return JSON with: trend (keywords only), tweet_url (full x.com URL), reasoning (why this trend and tweet).`;

  // JSON schema for structured output
  const jsonSchema = {
    name: "trend_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        trend: {
          type: "string",
          description:
            "The trending topic name (keywords only, no URLs or markdown)",
        },
        tweet_url: {
          type: "string",
          description:
            "Full tweet URL like https://x.com/username/status/123456789",
        },
        reasoning: {
          type: "string",
          description:
            "Brief explanation of why this trend is hot and why this tweet was selected",
        },
      },
      required: ["trend", "tweet_url", "reasoning"],
      additionalProperties: false,
    },
  };

  const TIMEOUT_MS = 60000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  console.log("🔥 Grok searching for trend + tweet (JSON mode)...");

  try {
    const response = await fetch(`${GROK_API_BASE}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{ type: "x_search" }],
        text: {
          format: {
            type: "json_schema",
            ...jsonSchema,
          },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Grok API error: ${response.status} - ${text}`);
    }

    const data = await response.json();

    // Extract assistant message content
    let content = "";
    if (data.output && Array.isArray(data.output)) {
      const assistantMessage = data.output.find(
        (item) => item.type === "message" && item.role === "assistant"
      );
      if (assistantMessage?.content?.[0]?.text) {
        content = assistantMessage.content[0].text;
      }
    }

    // Parse the JSON response
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error("Failed to parse JSON response:", content);
      throw new Error("Invalid JSON response from Grok");
    }

    const trend = parsed.trend || "Unknown Trend";
    const tweetUrl = parsed.tweet_url || "";
    const reasoning = parsed.reasoning || "Selected as trending topic";

    console.log(`🔥 Grok found trend: "${trend}"`);
    console.log(`🐦 Tweet URL: ${tweetUrl || "(none found)"}`);
    console.log(`💭 Reasoning: ${reasoning.substring(0, 100)}...`);

    return { trend, tweetUrl, reasoning };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.error(
        `⚠️ Grok combined search timed out after ${TIMEOUT_MS / 1000}s`
      );
    } else {
      console.error(`⚠️ Grok combined search error: ${err.message}`);
    }
    throw err; // Let caller handle fallback
  }
}

/**
 * Get tweets for a specific trend
 * @param {string} trendName - The trend to search for
 * @param {number} maxResults - Maximum number of tweets (supports up to 200 via pagination)
 * @returns {Promise<Tweet[]>}
 */
export async function getTweetsForTrend(trendName, maxResults = 250) {
  const query = `"${trendName}" lang:en -is:retweet`; // this filters out retweets which is good
  const allTweets = [];
  let nextToken = null;

  // API max is 100 per request, paginate if needed
  while (allTweets.length < maxResults) {
    const remaining = maxResults - allTweets.length;
    const count = Math.min(100, Math.max(10, remaining));

    const params = new URLSearchParams({
      query,
      max_results: String(count),
      "tweet.fields": "created_at,author_id,public_metrics,text",
    });

    if (nextToken) {
      params.set("next_token", nextToken);
    }

    const url = `${X_API_BASE}/tweets/search/recent?${params.toString()}`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch tweets: ${response.status} - ${text}`);
    }

    const data = await response.json();
    const tweets = data.data || [];
    allTweets.push(...tweets);

    // Check for more pages
    nextToken = data.meta?.next_token;
    if (!nextToken || tweets.length === 0) break;
  }

  return allTweets;
}

/**
 * Use Grok with x_search to find the most popular tweets about a topic (semantic search)
 * Returns same format as getTweetsForTrend for easy replacement
 * @param {string} trendName - The trend/topic to search for
 * @param {number} maxTweets - Maximum number of tweets to return (default 10)
 * @returns {Promise<Tweet[]>} Array of tweets with id, text, author_id, public_metrics
 */
export async function getTweetsWithGrok(trendName, maxTweets = 10) {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    console.error("❌ XAI_API_KEY not set, falling back to keyword search");
    return getTweetsForTrend(trendName, maxTweets);
  }

  console.log(`🔍 Grok searching tweets for: "${trendName}"`);

  const systemPrompt = `You are a tweet researcher. Your job is to find the most popular and engaging tweets about a given topic using x_search.

After searching, return the tweets in a structured format. Focus on tweets that:
- Have high engagement (likes, retweets, views)
- Are from verified or notable accounts when possible
- Represent interesting takes or breaking information
- Are in English

For each tweet, extract:
- The tweet ID (from the URL, it's the number after /status/)
- The author's username
- The full tweet text
- Approximate view/like counts if visible

Return EXACTLY this format for each tweet:
TWEET:
ID: [tweet_id_number]
AUTHOR: [username]
TEXT: [full tweet text]
VIEWS: [number or 0 if unknown]
---`;

  const userPrompt = `Search X/Twitter for the ${maxTweets} most popular and engaging tweets about: "${trendName}"

Find tweets that are getting the most attention right now. Return them in the exact format specified.`;

  const TIMEOUT_MS = 45000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${GROK_API_BASE}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{ type: "x_search" }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `❌ Grok tweet search failed: ${response.status} - ${text}`
      );
      return getTweetsForTrend(trendName, maxTweets);
    }

    const data = await response.json();
    // console.log("Grok tweet search data:", data);

    // Extract assistant message from Responses API format
    let content = "";
    if (data.output && Array.isArray(data.output)) {
      const assistantMessage = data.output.find(
        (item) => item.type === "message" && item.role === "assistant"
      );
      if (assistantMessage?.content?.[0]?.text) {
        content = assistantMessage.content[0].text;
      }
    }

    // Parse tweets from response
    const tweets = [];
    const tweetBlocks = content
      .split(/TWEET:\s*/i)
      .filter((block) => block.trim());

    for (const block of tweetBlocks) {
      const idMatch = block.match(/ID:\s*(\d+)/i);
      const authorMatch = block.match(/AUTHOR:\s*@?(\w+)/i);
      const textMatch = block.match(/TEXT:\s*(.+?)(?=\nVIEWS:|\n---|$)/is);
      const viewsMatch = block.match(/VIEWS:\s*([\d,]+)/i);

      if (idMatch && textMatch) {
        const views = viewsMatch
          ? parseInt(viewsMatch[1].replace(/,/g, ""), 10) || 0
          : 0;

        tweets.push({
          id: idMatch[1],
          text: textMatch[1].trim(),
          author_id: authorMatch?.[1] || "unknown",
          public_metrics: {
            impression_count: views,
            like_count: 0,
            retweet_count: 0,
          },
        });
      }
    }

    console.log(`🐦 Grok found ${tweets.length} tweets for "${trendName}"`);

    // If Grok didn't find any tweets, fall back to keyword search
    if (tweets.length === 0) {
      console.log(
        "⚠️  Grok returned no parseable tweets, falling back to keyword search"
      );
      return getTweetsForTrend(trendName, maxTweets);
    }

    return tweets.slice(0, maxTweets);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.error(
        `⚠️  Grok tweet search timed out after ${TIMEOUT_MS / 1000}s`
      );
    } else {
      console.error(`❌ Grok tweet search error: ${err.message}`);
    }
    // Fall back to keyword search
    return getTweetsForTrend(trendName, maxTweets);
  }
}

/**
 * Search tweets by query
 * @param {string} query - Search query
 * @param {number} maxResults - Maximum number of tweets (supports up to 200 via pagination)
 * @returns {Promise<Tweet[]>}
 */
export async function searchTweets(query, maxResults = 100) {
  const fullQuery = `${query} lang:en -is:retweet`;
  const allTweets = [];
  let nextToken = null;

  while (allTweets.length < maxResults) {
    const remaining = maxResults - allTweets.length;
    const count = Math.min(100, Math.max(10, remaining));

    const params = new URLSearchParams({
      query: fullQuery,
      max_results: String(count),
      "tweet.fields": "created_at,author_id,public_metrics,text",
    });

    if (nextToken) {
      params.set("next_token", nextToken);
    }

    const url = `${X_API_BASE}/tweets/search/recent?${params.toString()}`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to search tweets: ${response.status} - ${text}`);
    }

    const data = await response.json();
    const tweets = data.data || [];
    allTweets.push(...tweets);

    nextToken = data.meta?.next_token;
    if (!nextToken || tweets.length === 0) break;
  }

  return allTweets;
}

/**
 * Get a tweet URL from tweet ID (for overlay display)
 * @param {string} tweetId - Tweet ID
 * @param {string} [authorId] - Author ID (optional, uses placeholder if not provided)
 * @returns {string} Tweet URL
 */
export function getTweetUrl(tweetId, authorId = "i") {
  return `https://twitter.com/${authorId}/status/${tweetId}`;
}

export default {
  getTopTrends,
  getEdgyTrendsWithGrok,
  getEdgyTrendWithTweets,
  getTweetsForTrend,
  getTweetsWithGrok,
  searchTweets,
  getTweetUrl,
};
