import type { Tweet, Trend } from "./xService";
import { getPersonality, type Personality } from "./personalities";

const GROK_API_BASE = "https://api.x.ai/v1";

export interface TrendSelection {
  selectedTrend: string;
  reasoning: string;
  allTrends: string[];
}

interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GrokToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface GrokChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: GrokToolCall[];
  };
  finish_reason: string;
}

interface GrokResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: GrokChoice[];
}

export interface BackgroundResearch {
  trend: string;
  summary: string;
  tweets: Tweet[];
}

async function callGrokWithWebSearch(messages: GrokMessage[]): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    throw new Error("XAI_API_KEY environment variable is not set");
  }

  const response = await fetch(`${GROK_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-3",
      messages,
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description:
              "Search the web for current information about people, events, topics, or anything else",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query to look up on the web",
                },
              },
              required: ["query"],
            },
          },
        },
      ],
      tool_choice: "auto",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Grok API error: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const data: GrokResponse = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error("No response from Grok API");
  }

  const message = data.choices[0].message;

  // If the model wants to use tools, we need to handle that
  // For now, we'll just return the content if available
  if (message.content) {
    return message.content;
  }

  // If there are tool calls but no content, the model is requesting tool use
  // In a full implementation, you'd execute the tool and continue the conversation
  if (message.tool_calls && message.tool_calls.length > 0) {
    // For the xAI API with built-in web search, the tool is executed server-side
    // and the response includes the result. If we get here, we need to re-call
    // with the tool results, but xAI handles this automatically in most cases.
    return "Research in progress - tool calls detected";
  }

  return "No content generated";
}

export async function researchTweetsBackground(
  trend: string,
  tweets: Tweet[],
  personalityId?: string
): Promise<BackgroundResearch> {
  const personality = getPersonality(personalityId);

  const tweetTexts = tweets
    .map((t, i) => `Tweet ${i + 1}: "${t.text}"`)
    .join("\n");

  // Build the system prompt based on personality
  const systemPrompt = buildSystemPrompt(personality);

  // Build the user prompt based on personality's tweet focus
  const userPrompt = buildUserPrompt(trend, tweetTexts, personality);

  const messages: GrokMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const summary = await callGrokWithWebSearch(messages);

  return {
    trend,
    summary,
    tweets,
  };
}

function buildSystemPrompt(personality: Personality): string {
  return `${personality.researchPrompt}

Remember: You are gathering background research to inform content. The output should be informative research notes, not a script or dialogue.`;
}

function buildUserPrompt(
  trend: string,
  tweetTexts: string,
  personality: Personality
): string {
  const tweetEmphasis =
    personality.tweetFocus === "high"
      ? `FOCUS HEAVILY ON THE TWEETS THEMSELVES. The tweets are your primary source - extract the juiciest, most interesting takes from them. Web research is secondary.`
      : personality.tweetFocus === "low"
      ? `Use web search extensively to provide thorough background research. The tweets are just a starting point.`
      : `Balance your analysis between the tweets and web research for background context.`;

  return `The trending topic is: "${trend}"

Here are the tweets about this topic:
${tweetTexts}

${tweetEmphasis}

Research this topic and provide comprehensive background information framed for this personality. 
Pull out the most interesting/relevant tweets and add context around them.
Make sure your research notes capture the essence of what's happening with this trend.`;
}

export async function searchWeb(query: string): Promise<string> {
  const messages: GrokMessage[] = [
    {
      role: "system",
      content:
        "You are a helpful research assistant. Use web search to find current information and provide a concise summary.",
    },
    {
      role: "user",
      content: `Search the web for: ${query}\n\nProvide a brief summary of what you find.`,
    },
  ];

  return callGrokWithWebSearch(messages);
}

/**
 * Simple Grok call without web search tools - for quick decisions
 */
async function callGrok(messages: GrokMessage[]): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    throw new Error("XAI_API_KEY environment variable is not set");
  }

  const response = await fetch(`${GROK_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-3",
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Grok API error: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const data: GrokResponse = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error("No response from Grok API");
  }

  return data.choices[0].message.content || "No content generated";
}

/**
 * Use AI to select the best trending topic for a given personality
 */
export async function selectTrendForPersonality(
  trends: Trend[],
  personalityId?: string
): Promise<TrendSelection> {
  const personality = getPersonality(personalityId);
  const trendNames = trends.map((t) => t.trend_name);

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

  const userPrompt = `Here are the current trending topics:

${trendList}

Pick ONE trend from this list that best fits the personality. Remember to respond with SELECTED: and REASONING:`;

  const messages: GrokMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const response = await callGrok(messages);

  // Parse the response to extract the selected trend and reasoning
  const selectedMatch = response.match(/SELECTED:\s*(.+?)(?:\n|REASONING:|$)/i);
  const reasoningMatch = response.match(/REASONING:\s*(.+)/is);

  let selectedTrend = selectedMatch?.[1]?.trim() || trendNames[0];
  const reasoning = reasoningMatch?.[1]?.trim() || response;

  // Validate that the selected trend exists in our list
  // Try exact match first, then case-insensitive match
  if (!trendNames.includes(selectedTrend)) {
    const lowerSelected = selectedTrend.toLowerCase();
    const found = trendNames.find((t) => t.toLowerCase() === lowerSelected);
    if (found) {
      selectedTrend = found;
    } else {
      // If still not found, default to first trend
      console.warn(
        `AI selected trend "${selectedTrend}" not found in list, defaulting to first trend`
      );
      selectedTrend = trendNames[0];
    }
  }

  return {
    selectedTrend,
    reasoning,
    allTrends: trendNames,
  };
}
