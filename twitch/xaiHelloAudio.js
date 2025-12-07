"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const XAI_API_BASE_URL = process.env.BASE_URL || "https://api.x.ai/v1";
const XAI_TTS_URL = `${XAI_API_BASE_URL}/audio/speech`;
const XAI_CHAT_URL = `${XAI_API_BASE_URL}/chat/completions`;
const HELLO_AUDIO_FILENAME = "hello-xai.mp3";

const API_KEY = process.env.XAI_API_KEY;

// Twitter/X API configuration
const TWITTER_API_BASE = "https://api.x.com/2";
const TWITTER_TRENDS_URL = `${TWITTER_API_BASE}/trends/by/woeid/2487956`;
const TWITTER_SEARCH_URL = `${TWITTER_API_BASE}/tweets/search/recent`;
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

async function fetchTwitterTrends() {
  console.log("Fetching Twitter trends...");

  try {
    const response = await fetch(
      `${TWITTER_TRENDS_URL}?max_trends=20&trend.fields=trend_name,tweet_count`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        `Failed to fetch Twitter trends: ${response.status} - ${errorText}`
      );
      return null;
    }

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      console.log(`Found ${data.data.length} trending topics`);
      return data.data;
    }

    return null;
  } catch (error) {
    console.warn("Error fetching Twitter trends:", error.message);
    return null;
  }
}

async function fetchTweetsForTrend(trendName) {
  console.log(`Fetching tweets for trend: "${trendName}"...`);

  try {
    // Build the search query - searching for the trend in English, no retweets
    const query = `"${trendName}" lang:en -is:retweet`;
    const params = new URLSearchParams({
      query: query,
      max_results: "10",
      "tweet.fields": "created_at,author_id,public_metrics,text",
    });

    const response = await fetch(`${TWITTER_SEARCH_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Failed to fetch tweets: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      console.log(`Found ${data.data.length} tweets about "${trendName}"`);
      return data.data;
    }

    return null;
  } catch (error) {
    console.warn("Error fetching tweets:", error.message);
    return null;
  }
}

async function generateRandomText() {
  console.log("Generating random text with Grok...");

  // Fetch current Twitter trends
  const trends = await fetchTwitterTrends();

  let systemPrompt;
  let userPrompt;

  if (trends && trends.length > 0) {
    // Get the top trend
    const topTrend = trends[0];
    const trendName = topTrend.trend_name;
    const tweetCount = topTrend.tweet_count
      ? topTrend.tweet_count.toLocaleString()
      : "thousands of";

    console.log(`Top trend: "${trendName}" with ${tweetCount} tweets`);

    // Fetch actual tweets about this trend
    const tweets = await fetchTweetsForTrend(trendName);

    let tweetContent = "";
    if (tweets && tweets.length > 0) {
      // Format the tweets for the prompt
      tweetContent = tweets
        .slice(0, 5)
        .map((tweet, i) => `Tweet ${i + 1}: "${tweet.text}"`)
        .join("\n");
      console.log(`Using ${Math.min(tweets.length, 5)} tweets for context`);
    }

    systemPrompt = `You're a wild, high-energy San Francisco radio host. React to this trending topic and what people are saying. Be funny and unhinged. 2-3 sentences max.

Trending: "${trendName}" (${tweetCount} tweets)
${tweetContent ? `\nTweets:\n${tweetContent}` : ""}`;

    userPrompt = `Hot take on "${trendName}"!`;
  } else {
    systemPrompt = `You're a wild, high-energy San Francisco radio host. Give a quick greeting. Be funny. 2 sentences max.`;
    userPrompt = "Give me a greeting for the radio!";
  }

  const response = await fetch(XAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-3-latest",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      max_tokens: 150,
      temperature: 1.0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to generate text with Grok: ${response.status} - ${errorText}`
    );
  }

  const data = await response.json();
  const generatedText = data.choices[0].message.content.trim();
  console.log(`Generated text: "${generatedText}"`);
  return generatedText;
}

async function generateHelloAudioFile() {
  const audioPath = path.join(__dirname, HELLO_AUDIO_FILENAME);

  if (!API_KEY) {
    throw new Error("XAI_API_KEY is required to generate audio");
  }

  // Generate random text using Grok
  const text = await generateRandomText();

  console.log("Converting text to speech...");

  const response = await fetch(XAI_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      voice: "Ara",
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to generate TTS audio: ${response.status} - ${errorText}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(audioPath, buffer);

  console.log(`XAI audio saved to ${audioPath} (${buffer.length} bytes)`);

  return audioPath;
}

// Keep the old function name for backwards compatibility
async function ensureHelloAudioFile() {
  return generateHelloAudioFile();
}

module.exports = {
  ensureHelloAudioFile,
  generateHelloAudioFile,
  generateRandomText,
  fetchTwitterTrends,
  fetchTweetsForTrend,
  HELLO_AUDIO_FILENAME,
};
