import "dotenv/config";
import {
  researchTopics,
  getAvailablePersonalities,
  getPersonality,
} from "../app/researcherService";

function printUsage() {
  console.log("Usage: npx tsx scripts/run-research.ts [personality]");
  console.log("\nAvailable personalities:");
  getAvailablePersonalities().forEach((id) => {
    const p = getPersonality(id);
    console.log(`  - ${id}: ${p.name} - ${p.description}`);
  });
  console.log("\nDefault: redneck");
}

async function main() {
  try {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
      printUsage();
      return;
    }

    const personality = args[0] || undefined;

    if (personality && !getAvailablePersonalities().includes(personality)) {
      console.error(`Unknown personality: ${personality}`);
      printUsage();
      process.exit(1);
    }

    const selectedPersonality = getPersonality(personality);
    console.log(`📝 ${selectedPersonality.description}\n`);
    console.log("Starting research...");

    const result = await researchTopics({ personality });

    console.log("\n" + "=".repeat(60));
    console.log("📰 FINAL RESULTS");
    console.log("=".repeat(60));
    console.log(`\n🎯 Selected Trend: ${result.trend}`);
    console.log(`🎭 Personality: ${result.personality}`);
    console.log(
      `\n💭 Selection Reasoning:\n   "${result.trendSelection.reasoning}"`
    );
    console.log(`\n🐦 Tweets (${result.tweets.length}):`);
    result.tweets.forEach((tweet, i) => {
      const text =
        tweet.text.length > 100
          ? tweet.text.substring(0, 100) + "..."
          : tweet.text;
      console.log(`   ${i + 1}. ${text}`);
    });
    console.log(`\n📋 Background Research:\n${result.backgroundResearch}`);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
