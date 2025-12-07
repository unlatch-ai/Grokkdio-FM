import { getTopTrends, getTweetsForTrend } from "./xService";
import type { Tweet } from "./xService";
import {
  researchTweetsBackground,
  selectTrendForPersonality,
} from "./webService";
import { getPersonality, DEFAULT_PERSONALITY } from "./personalities";

export interface ResearchResult {
  trend: string;
  tweets: Tweet[];
  backgroundResearch: string;
  personality: string;
  trendSelection: {
    allTrends: string[];
    reasoning: string;
  };
}

export interface ResearchOptions {
  personality?: string;
}

/**
 * Get the top trending topic, its tweets, and background research using Grok
 * The personality influences which trend is selected from the available trends.
 * @param options - Optional configuration including personality
 */
export async function researchTopics(
  options?: ResearchOptions
): Promise<ResearchResult> {
  const personalityId = options?.personality || DEFAULT_PERSONALITY;
  const personality = getPersonality(personalityId);

  console.log(
    `\n🎭 Using personality: ${personality.name} (${personality.id})`
  );

  // Fetch multiple trends
  console.log(`\n📊 Fetching trending topics...`);
  const trends = await getTopTrends(15);

  console.log(`\n📋 Available trends:`);
  trends.forEach((t, i) => {
    const count = t.tweet_count
      ? ` (${t.tweet_count.toLocaleString()} tweets)`
      : "";
    console.log(`   ${i + 1}. ${t.trend_name}${count}`);
  });

  // Use AI to select the best trend for this personality
  console.log(`\n🤖 AI selecting trend for ${personality.name}...`);
  const trendSelection = await selectTrendForPersonality(trends, personalityId);

  console.log(`\n✅ Selected trend: ${trendSelection.selectedTrend}`);
  console.log(`💭 Reasoning: ${trendSelection.reasoning}`);

  // Get tweets for the selected trend
  const tweets = await getTweetsForTrend(trendSelection.selectedTrend);
  console.log(`\n🐦 Found ${tweets.length} tweets`);

  console.log(
    `\n🔍 Researching background information with ${personality.name}...`
  );
  const research = await researchTweetsBackground(
    trendSelection.selectedTrend,
    tweets,
    personalityId
  );
  console.log(`✨ Background research complete`);

  return {
    trend: trendSelection.selectedTrend,
    tweets,
    backgroundResearch: research.summary,
    personality: personality.id,
    trendSelection: {
      allTrends: trendSelection.allTrends,
      reasoning: trendSelection.reasoning,
    },
  };
}

// Re-export types and utilities from services for convenience
export type { Tweet } from "./xService";
export type { BackgroundResearch } from "./webService";
export { getAvailablePersonalities, getPersonality } from "./personalities";
export type { Personality } from "./personalities";
