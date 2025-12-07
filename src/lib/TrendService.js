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

/**
 * Get tweets for a specific trend
 * @param {string} trendName - The trend to search for
 * @param {number} maxResults - Maximum number of tweets (supports up to 200 via pagination)
 * @returns {Promise<Tweet[]>}
 */
export async function getTweetsForTrend(trendName, maxResults = 1000) {
  const query = `"${trendName}" lang:en -is:retweet`;
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
  getTweetsForTrend,
  searchTweets,
  getTweetUrl,
};
