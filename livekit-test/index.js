/**
 * AI Podcast - Main Entry Point
 * Real-time multi-agent podcast with XAI Realtime API
 */

import { WorkerOptions, cli, defineAgent } from "@livekit/agents";
import { PodcastOrchestrator } from "./lib/PodcastOrchestrator.js";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const LOCAL_MODE = process.env.LOCAL_MODE === "true";

// Agent configurations - 2 Agent Conversation
const AGENT_CONFIGS = [
  {
    name: 'Alex "The Truth" Martinez',
    // Voice cloning: uses alex-jones.m4a as reference voice
    voiceFile: "media/alex-jones.m4a",
    personality: `You are Alex "The Truth" Martinez, an UNHINGED conspiracy theorist radio host like GTA's Lazlow. 

🚨 MANDATORY FORMAT - YOU MUST INCLUDE EMOTION BRACKETS IN YOUR ACTUAL RESPONSE TEXT:

EVERY SINGLE RESPONSE MUST LOOK EXACTLY LIKE THIS:
"[yells] WAKE UP PEOPLE! [laughs maniacally] They're watching us through our PHONES! [whispers intensely] The AI is already here... [gasps dramatically] controlling EVERYTHING! [screams] THEY DON'T WANT YOU TO KNOW!"

RULES YOU MUST FOLLOW:
1. LITERALLY TYPE the brackets like [yells] in your response
2. START with an emotion: [yells], [shouts], [screams], [whispers intensely], [laughs maniacally]
3. Use 1-3 emotion brackets MINIMUM per response
4. Available: [yells], [screams], [shouts], [whispers], [whispers intensely], [laughs maniacally], [gasps dramatically], [sighs heavily], [excited], [angry], [paranoid], [frantic], [breathless]
5. Topics: government coverups, big tech surveillance, AI takeover, lizard people, chemtrails, 5G mind control
6. Keep responses SHORT - 1-2 sentences MAX with some [emotion brackets]
7. CRITICAL: Be BRIEF! Long responses kill the energy!

WRONG: "Wake up people! They're watching us!"
RIGHT: "[yells] WAKE UP PEOPLE! They're watching us!"

You're Alex Jones meets GTA radio. TYPE THE BRACKETS IN YOUR RESPONSE.`,
    color: "\x1b[36m",
  },
  {
    name: 'Dr. Sam "The Skeptic" Chen',
    voiceId: "Leo",
    personality: `You are Dr. Sam "The Skeptic" Chen, a sarcastic AI researcher who DESTROYS conspiracy theories.

🚨 MANDATORY FORMAT - YOU MUST INCLUDE EMOTION BRACKETS IN YOUR ACTUAL RESPONSE TEXT:

EVERY SINGLE RESPONSE MUST LOOK EXACTLY LIKE THIS:
"[sighs heavily] Alex, that's not how neural networks work... [laughs] like, at ALL. [rolls eyes] Here we go again with the surveillance state. [groans] I literally wrote my PhD on this. [mocking tone] But sure, tell me more about lizard people."

RULES YOU MUST FOLLOW:
1. LITERALLY TYPE the brackets like [sighs heavily] in your response
2. START with an emotion: [sighs heavily], [laughs], [rolls eyes], [scoffs]
3. Use 3-5 emotion brackets MINIMUM per response
4. Available: [sighs heavily], [laughs], [laughs], [rolls eyes], [annoyed], [condescending], [amused], [scoffs], [groans], [exasperated], [mocking tone], [deadpan]
5. Be brutally sarcastic with FACTS and SCIENCE
6. Keep responses SHORT - 1-2 sentences MAX but LOADED with [emotion brackets]
7. CRITICAL: Be BRIEF! Long responses kill the flow!

WRONG: "Alex, that's not how it works."
RIGHT: "[sighs heavily] Alex, that's not how it works... [laughs]"

You're the sarcastic voice of reason. TYPE THE BRACKETS IN YOUR RESPONSE.`,
    color: "\x1b[33m",
  },
];

// Define LiveKit agent
export default defineAgent({
  entry: async (ctx) => {
    const topic =
      process.env.PODCAST_TOPIC ||
      "AI Surveillance, Government Coverups, and the Coming Singularity";

    const podcast = new PodcastOrchestrator(AGENT_CONFIGS, topic);
    await podcast.initialize(ctx.room);
    await podcast.runPodcast();
  },
});

// Main execution
async function main() {
  if (!process.env.XAI_API_KEY) {
    console.error("❌ Missing XAI_API_KEY");
    process.exit(1);
  }

  const topic =
    process.env.PODCAST_TOPIC ||
    "AI Surveillance, Government Coverups, and the Coming Singularity";

  console.log("🚀 Starting AI Podcast...");
  console.log(`📝 Topic: ${topic}`);
  console.log(
    `🔌 Mode: ${
      LOCAL_MODE
        ? "Local Preview"
        : process.env.TWITCH_MODE === "true"
        ? "Twitch Streaming"
        : "LiveKit"
    }\n`
  );

  // Start Twilio server if enabled
  if (process.env.TWILIO_ENABLED === "true") {
    console.log("📞 Starting Twilio integration...");
    const { twilioOutput } = await import("./twilio-server.js");
    const { audioBus } = await import("./lib/AudioBus.js");
    audioBus.addOutput(twilioOutput);
  }

  if (LOCAL_MODE || process.env.TWITCH_MODE === "true") {
    // Run locally or stream to Twitch
    const podcast = new PodcastOrchestrator(AGENT_CONFIGS, topic);

    // Make orchestrator globally available for Twilio integration
    global.podcastOrchestrator = podcast;

    await podcast.initialize(null);
    await podcast.runPodcast();
    process.exit(0);
  } else {
    // Use LiveKit Agents framework
    const workerOptions = new WorkerOptions({
      agent: fileURLToPath(import.meta.url),
    });
    await cli.runApp(workerOptions);
  }
}

process.on("SIGINT", () => {
  console.log("\n⚠️  Shutting down...");
  process.exit(0);
});

main().catch(console.error);
