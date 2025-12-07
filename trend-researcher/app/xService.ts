const X_API_BASE = "https://api.x.com/2";
const SF_WOEID = 2487956; // San Francisco WOEID

export interface Trend {
  trend_name: string;
  tweet_count?: number;
}

interface TrendsResponse {
  data: Trend[];
}

export interface Tweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

interface TweetsResponse {
  data?: Tweet[];
  meta?: {
    result_count: number;
  };
}

async function fetchWithAuth(url: string): Promise<Response> {
  const bearerToken = process.env.X_BEARER_TOKEN;

  if (!bearerToken) {
    throw new Error("X_BEARER_TOKEN environment variable is not set");
  }

  return fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });
}

export async function getTopTrends(maxTrends: number = 20): Promise<Trend[]> {
  const url = `${X_API_BASE}/trends/by/woeid/${SF_WOEID}?max_trends=${maxTrends}&trend.fields=trend_name,tweet_count`;

  const response = await fetchWithAuth(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch trends: ${response.status} ${response.statusText}`
    );
  }

  const data: TrendsResponse = await response.json();

  if (!data.data || data.data.length === 0) {
    throw new Error("No trends found");
  }

  return data.data;
}

export async function getTopTrend(): Promise<string> {
  const trends = await getTopTrends(1);
  return trends[0].trend_name;
}

export async function getTweetsForTrend(
  trendName: string,
  maxResults: number = 10
): Promise<Tweet[]> {
  const query = `"${trendName}" lang:en -is:retweet`;
  const params = new URLSearchParams({
    query,
    max_results: String(maxResults),
    "tweet.fields": "created_at,author_id,public_metrics,text",
  });

  const url = `${X_API_BASE}/tweets/search/recent?${params.toString()}`;

  const response = await fetchWithAuth(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch tweets: ${response.status} ${response.statusText}`
    );
  }

  const data: TweetsResponse = await response.json();

  return data.data || [];
}

export async function searchTweets(
  query: string,
  maxResults: number = 10
): Promise<Tweet[]> {
  const params = new URLSearchParams({
    query: `${query} lang:en -is:retweet`,
    max_results: String(maxResults),
    "tweet.fields": "created_at,author_id,public_metrics,text",
  });

  const url = `${X_API_BASE}/tweets/search/recent?${params.toString()}`;

  const response = await fetchWithAuth(url);

  if (!response.ok) {
    throw new Error(
      `Failed to search tweets: ${response.status} ${response.statusText}`
    );
  }

  const data: TweetsResponse = await response.json();

  return data.data || [];
}
