/**
 * Trend Injector
 * Fetches trending topics, selects one via AI, and injects into podcast conversation
 * Also displays related tweets on overlay
 * Ported from trend-researcher with full personality and research logic
 */

import { EventEmitter } from "events";
import {
  getTopTrends,
  getTweetsForTrend,
  getTweetUrl,
} from "./TrendService.js";
import { captureTweet } from "./gettweet.js";
import {
  getPersonality,
  getAvailablePersonalities,
  DEFAULT_PERSONALITY,
} from "./personalities.js";

const GROK_API_BASE = "https://api.x.ai/v1";

export class TrendInjector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.autoInterval = config.autoIntervalMinutes || 2;
    this.personality = config.personality || DEFAULT_PERSONALITY;
    this.player = null; // Set by PodcastOrchestrator
    this.isProcessing = false;
    this.currentTrend = null;
    this.currentTweets = [];
    this.currentResearch = null; // Background research from AI
    this.tweetQueue = [];
    this.autoTimer = null;
    this.startTime = Date.now();

    // Track trends to avoid repetition
    this.observedTrends = new Set(); // All trends we've seen from API
    this.discussedTrends = new Set(); // Trends we've already talked about
    this.maxDiscussedHistory = 50; // Reset after this many to allow repeats
  }

  /**
   * Set the personality for trend selection and research
   * @param {string} personalityId - Personality ID from personalities.js
   */
  setPersonality(personalityId) {
    if (getAvailablePersonalities().includes(personalityId)) {
      this.personality = personalityId;
      console.log(
        `🎭 Trend personality set to: ${getPersonality(personalityId).name}`
      );
    } else {
      console.warn(
        `Unknown personality: ${personalityId}, available: ${getAvailablePersonalities().join(
          ", "
        )}`
      );
    }
  }

  /**
   * Set the video player for tweet overlays
   * @param {object} player - LocalAudioPlayer or TwitchStreamer
   */
  setPlayer(player) {
    this.player = player;
  }

  /**
   * Start auto-fetching trends every N minutes (but not at minute 0)
   */
  startAutoFetch() {
    const intervalMs = this.autoInterval * 60 * 1000;

    console.log(
      `📊 Trend auto-fetch enabled: every ${this.autoInterval} minutes (starting at minute ${this.autoInterval})`
    );

    // First fetch after autoInterval minutes
    this.autoTimer = setTimeout(() => {
      this.fetchAndInject();

      // Then repeat every autoInterval minutes
      this.autoTimer = setInterval(() => {
        this.fetchAndInject();
      }, intervalMs);
    }, intervalMs);
  }

  /**
   * Stop auto-fetching
   */
  stopAutoFetch() {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
  }

  /**
   * Fetch trends, select one via AI, get tweets, research, and inject into conversation
   * @returns {Promise<{trend: string, tweets: Array, research: string, prompt: string}>}
   */
  async fetchAndInject() {
    if (this.isProcessing) {
      console.log("⏳ Already processing trends, skipping...");
      return null;
    }

    this.isProcessing = true;
    const personality = getPersonality(this.personality);
    console.log(
      `\n📊 Fetching trending topics (personality: ${personality.name})...`
    );

    try {
      // 1. Get top trends
      const allTrends = await getTopTrends(15);

      // Track all observed trends
      allTrends.forEach((t) => this.observedTrends.add(t.trend_name));

      // Filter out already discussed trends
      let trends = allTrends.filter(
        (t) => !this.discussedTrends.has(t.trend_name)
      );

      // If all trends have been discussed, reset and allow repeats
      if (trends.length === 0) {
        console.log("🔄 All trends discussed, resetting history...");
        this.discussedTrends.clear();
        trends = allTrends;
      }

      console.log(
        `📋 Found ${allTrends.length} trends (${trends.length} new):`
      );
      trends.slice(0, 5).forEach((t, i) => {
        const count = t.tweet_count
          ? ` (${t.tweet_count.toLocaleString()} tweets)`
          : "";
        console.log(`   ${i + 1}. ${t.trend_name}${count}`);
      });

      // 2. Select best trend for personality via AI (from undiscussed trends only)
      console.log(`\n🤖 AI selecting trend for ${personality.name}...`);
      const { selectedTrend, reasoning } =
        await this._selectTrendForPersonality(trends);
      console.log(`✅ Selected: ${selectedTrend}`);
      console.log(`💭 Reasoning: ${reasoning}`);

      // Mark as discussed immediately
      this.discussedTrends.add(selectedTrend);
      console.log(`📝 Trends discussed so far: ${this.discussedTrends.size}`);

      // 3. Get tweets for the trend
      const tweets = await getTweetsForTrend(selectedTrend, 5);
      console.log(`🐦 Found ${tweets.length} tweets`);

      // 4. Research background with AI (using personality)
      console.log(`\n🔍 Researching background with ${personality.name}...`);
      const research = await this._researchTrend(selectedTrend, tweets);
      console.log(`✨ Research complete`);

      // 5. Store for use
      this.currentTrend = selectedTrend;
      this.currentTweets = tweets;
      this.currentResearch = research;
      this.tweetQueue = [...tweets];

      // 6. Build prompt for agents (includes research)
      const prompt = this._buildTrendPrompt(selectedTrend, tweets, research);

      // 7. Emit event for PodcastOrchestrator to inject
      this.emit("trendReady", {
        trend: selectedTrend,
        tweets,
        research,
        prompt,
      });

      this.isProcessing = false;
      return { trend: selectedTrend, tweets, research, prompt };
    } catch (err) {
      console.error("❌ Error fetching trends:", err.message);
      this.isProcessing = false;
      return null;
    }
  }

  /**
   * Show the next tweet in queue on overlay
   * @returns {Promise<boolean>} True if a tweet was shown
   */
  async showNextTweet() {
    if (!this.player) {
      console.warn("No player set for tweet overlay");
      return false;
    }

    if (this.tweetQueue.length === 0) {
      console.log("No tweets in queue");
      return false;
    }

    const tweet = this.tweetQueue.shift();
    const tweetUrl = getTweetUrl(tweet.id, tweet.author_id);

    console.log(`\n📸 Showing tweet: ${tweet.text.substring(0, 50)}...`);

    try {
      // Capture tweet as image
      const imagePath = await captureTweet(tweetUrl, { darkMode: true });

      // Show on overlay for 1-2 minutes (90 seconds)
      await this.player.showImage(imagePath, {
        duration: 90000,
        deleteAfter: true,
        position: "bottom-left",
        width: 400,
      });

      return true;
    } catch (err) {
      console.error("Error showing tweet:", err.message);
      return false;
    }
  }

  /**
   * Use Grok to select the best trend based on personality
   * @param {Array} trends - List of trends
   * @returns {Promise<{selectedTrend: string, reasoning: string}>}
   */
  async _selectTrendForPersonality(trends) {
    const apiKey = process.env.XAI_API_KEY;
    const personality = getPersonality(this.personality);
    const trendNames = trends.map((t) => t.trend_name);

    if (!apiKey) {
      return {
        selectedTrend: trendNames[0],
        reasoning: "API key not available",
      };
    }

    const trendList = trends
      .map((t, i) => {
        const count = t.tweet_count
          ? ` (${t.tweet_count.toLocaleString()} tweets)`
          : "";
        return `${i + 1}. ${t.trend_name}${count}`;
      })
      .join("\n");

    const systemPrompt = `${personality.trendSelectionPrompt}

IMPORTANT: You must respond in this exact format:
SELECTED: [exact trend name from the list]
REASONING: [your reasoning in 1-2 sentences, in character]

The trend name must match EXACTLY as written in the list (including hashtags, capitalization, etc).`;

    const response = await fetch(`${GROK_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Pick ONE trend from this list:\n\n${trendList}`,
          },
        ],
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      console.warn("AI trend selection failed, using first trend");
      return { selectedTrend: trendNames[0], reasoning: "AI selection failed" };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse the response
    const selectedMatch = content.match(
      /SELECTED:\s*(.+?)(?:\n|REASONING:|$)/i
    );
    const reasoningMatch = content.match(/REASONING:\s*(.+)/is);

    let selectedTrend = selectedMatch?.[1]?.trim() || trendNames[0];
    const reasoning = reasoningMatch?.[1]?.trim() || content;

    // Validate the selected trend exists
    if (!trendNames.includes(selectedTrend)) {
      const found = trendNames.find(
        (t) => t.toLowerCase() === selectedTrend.toLowerCase()
      );
      if (found) {
        selectedTrend = found;
      } else {
        console.warn(
          `AI selected "${selectedTrend}" not in list, using first trend`
        );
        selectedTrend = trendNames[0];
      }
    }

    return { selectedTrend, reasoning };
  }

  /**
   * Research the trend background using Grok with web search
   * @param {string} trend - Trend name
   * @param {Array} tweets - Related tweets
   * @returns {Promise<string>} Research summary
   */
  async _researchTrend(trend, tweets) {
    const apiKey = process.env.XAI_API_KEY;
    const personality = getPersonality(this.personality);

    if (!apiKey) {
      return "Research unavailable - API key not set";
    }

    const tweetTexts = tweets
      .map((t, i) => `Tweet ${i + 1}: "${t.text}"`)
      .join("\n");

    // Build emphasis based on tweet focus
    let tweetEmphasis;
    if (personality.tweetFocus === "high") {
      tweetEmphasis = `FOCUS HEAVILY ON THE TWEETS THEMSELVES. The tweets are your primary source - extract the juiciest, most interesting takes from them. Web research is secondary.`;
    } else if (personality.tweetFocus === "low") {
      tweetEmphasis = `Use web search extensively to provide thorough background research. The tweets are just a starting point.`;
    } else {
      tweetEmphasis = `Balance your analysis between the tweets and web research for background context.`;
    }

    const systemPrompt = `${personality.researchPrompt}

Remember: You are gathering background research to inform content. Keep it concise but informative.`;

    const userPrompt = `The trending topic is: "${trend}"

Here are tweets about this topic:
${tweetTexts}

${tweetEmphasis}

Research this topic and provide a brief but comprehensive summary. Pull out the most interesting tweets and add context.`;

    try {
      const response = await fetch(`${GROK_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-3-fast",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        return "Research failed - API error";
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "No research generated";
    } catch (err) {
      console.error("Research error:", err.message);
      return "Research failed";
    }
  }

  /**
   * Build a prompt for the agents to discuss the trend
   * @param {string} trend - Trend name
   * @param {Array} tweets - Related tweets
   * @param {string} [research] - Background research
   * @returns {string} Prompt for agents
   */
  _buildTrendPrompt(trend, tweets, research = "") {
    const tweetTexts = tweets
      .slice(0, 3)
      .map((t, i) => `  ${i + 1}. "${t.text}"`)
      .join("\n");

    let prompt = `🔥 TRENDING NOW: "${trend}"

Here's what people are saying:
${tweetTexts}`;

    if (research && research.length > 50) {
      prompt += `

📋 BACKGROUND RESEARCH:
${research}`;
    }

    prompt += `

React to this trending topic! Debate it, share your takes, and get heated about it. Reference the tweets and research!`;

    return prompt;
  }

  /**
   * Get the current trend prompt (for manual injection)
   * @returns {string|null}
   */
  getCurrentPrompt() {
    if (!this.currentTrend) return null;
    return this._buildTrendPrompt(
      this.currentTrend,
      this.currentTweets,
      this.currentResearch
    );
  }

  /**
   * Check if there's a pending trend to discuss
   * @returns {boolean}
   */
  hasPendingTrend() {
    return this.currentTrend !== null && this.currentTweets.length > 0;
  }

  /**
   * Clear the current trend (keeps it in discussedTrends)
   */
  clearTrend() {
    this.currentTrend = null;
    this.currentTweets = [];
    this.currentResearch = null;
    this.tweetQueue = [];
  }

  /**
   * Get stats about trend tracking
   * @returns {Object} Stats about observed and discussed trends
   */
  getStats() {
    return {
      observed: this.observedTrends.size,
      discussed: this.discussedTrends.size,
      discussedList: Array.from(this.discussedTrends),
    };
  }

  /**
   * Check if a trend has already been discussed
   * @param {string} trendName - Trend name to check
   * @returns {boolean}
   */
  hasDiscussed(trendName) {
    return this.discussedTrends.has(trendName);
  }

  /**
   * Reset discussed trends history (allows repeats)
   */
  resetDiscussedHistory() {
    console.log(
      `🔄 Resetting discussed trends history (was ${this.discussedTrends.size} trends)`
    );
    this.discussedTrends.clear();
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.stopAutoFetch();
    this.clearTrend();
    // Note: We don't clear discussedTrends here so it persists
  }
}

export default TrendInjector;
