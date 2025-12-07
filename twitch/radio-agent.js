/**
 * LiveKit AI Radio Agent
 *
 * A simplified radio stream agent using the LiveKit Agents framework.
 * Much cleaner than the manual approach in radio-stream-livekit.js
 *
 * Usage:
 *   node radio-agent.js dev     # Run in development mode
 *   node radio-agent.js start   # Run in production mode
 */

import "dotenv/config";
import { WorkerOptions, cli, defineAgent } from "@livekit/agents";
import {
  LocalAudioTrack,
  AudioSource,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { XAIStreamingTTS } from "./plugins/xai-tts-livekit.js";
import { startTwitchEgress } from "./utils/egress.js";

// === CONFIGURATION ===
const TTS_SAMPLE_RATE = 24000;
const TTS_CHANNELS = 1;

// === RANDOM PHRASES ===
const RANDOM_PHRASES = [
  "Welcome to the XAI radio test stream on Twitch.",
  "You are currently listening to an experimental AI that generates speech in real time.",
  "Nothing you hear is prerecorded; everything is stitched together on the fly.",
  "Imagine this as a sandbox where you can prototype interactive audio ideas for your own projects.",
  "This stream could one day read live chat messages, narrate game events, or host a talk show with guests.",
  "Right now, I am simply rambling in order to keep the audio channel alive and interesting.",
  "The words you hear can be swapped for any dynamic data source you like, including APIs, logs, or chat prompts.",
  "Because this is text to speech, we can easily localize the content, change voices, or alter the speaking style.",
  "Developers often start with a basic hello world and then expand into more complex conversational flows.",
  "Consider what you would build if this voice could react to what is happening on your Twitch stream in real time.",
  "You might build a commentator that explains what you are coding, or a character that reacts to in game events.",
  "The important part is that the pipeline from text to audio is now wired directly into your broadcasting stack.",
  "From here, you can experiment with longer narratives, generative stories, or even scripted podcast segments.",
  "If you are hearing this, the audio integration between your local machine, XAI, and Twitch is working correctly.",
  "Feel free to leave this running in the background while you iterate on new ideas and content formats.",
  "This concludes one segment of the monologue, but a new stream of thoughts will follow shortly.",
];

/**
 * Build a random monologue from the phrase pool
 */
function buildRandomMonologue() {
  const sentenceCount = 6 + Math.floor(Math.random() * 6); // 6-11 sentences
  const parts = [];
  for (let i = 0; i < sentenceCount; i++) {
    const idx = Math.floor(Math.random() * RANDOM_PHRASES.length);
    parts.push(RANDOM_PHRASES[idx]);
  }
  return parts.join(" ");
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main radio agent entry point
 */
async function radioAgentEntry(ctx) {
  console.log("🎙️ Radio agent connected to room:", ctx.room.name);
  console.log("👤 Agent identity:", ctx.room.localParticipant?.identity);

  // Validate API key
  if (!process.env.XAI_API_KEY) {
    console.error("❌ Missing XAI_API_KEY in environment");
    return;
  }

  // === 1. Initialize TTS ===
  const tts = new XAIStreamingTTS({
    apiKey: process.env.XAI_API_KEY,
    voiceId: process.env.VOICE_ID || "ara",
  });
  console.log("🔊 TTS initialized with voice:", tts.voiceId);

  // === 2. Create and publish audio track ===
  const audioSource = new AudioSource(TTS_SAMPLE_RATE, TTS_CHANNELS, 10000);
  const track = LocalAudioTrack.createAudioTrack("radio-audio", audioSource);

  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;

  const publication = await ctx.room.localParticipant.publishTrack(
    track,
    publishOptions
  );
  console.log("🎙️ Audio track published:", publication.sid);

  // === 3. Start Twitch egress (optional) ===
  let egressInfo = null;
  if (process.env.TWITCH_STREAM_KEY) {
    // Wait a moment for the track to stabilize
    await sleep(1000);
    egressInfo = await startTwitchEgress(ctx.room.name);
  } else {
    console.log("⚠️  No TWITCH_STREAM_KEY - audio only in LiveKit room");
    console.log(
      "   Join at: https://meet.livekit.io/custom?liveKitUrl=" +
        encodeURIComponent(process.env.LIVEKIT_URL || "")
    );
  }

  // === 4. Main radio loop ===
  let running = true;

  // Handle shutdown gracefully
  ctx.addShutdownCallback(async () => {
    console.log("🛑 Shutdown requested...");
    running = false;
  });

  console.log(`
✅ LiveKit AI Radio Agent started!
🏠 Room: ${ctx.room.name}
🎙️ Agent: DJ Grok
📺 Twitch: ${egressInfo ? "Streaming" : "Not configured"}
Press Ctrl+C to stop
  `);

  // Wait for track to stabilize
  await sleep(1000);

  // Run the radio show
  while (running) {
    try {
      const text = buildRandomMonologue();
      console.log("📝 Generating speech for", text.length, "chars...");

      // Stream TTS audio to the track
      let frameCount = 0;
      let totalSamples = 0;

      for await (const frame of tts.synthesizeStream(text)) {
        if (!running) break;

        // Pace the audio to avoid buffer overflow
        while (audioSource.queuedDuration > 5000 && running) {
          await sleep(100);
        }

        await audioSource.captureFrame(frame);
        frameCount++;
        totalSamples += frame.samplesPerChannel;
      }

      const durationMs = (totalSamples / TTS_SAMPLE_RATE) * 1000;
      console.log(
        `🔊 Sent ${frameCount} frames (${durationMs.toFixed(0)}ms total)`
      );

      // Small pause between monologues
      if (running) {
        console.log("🧩 Finished phrase, pausing...");
        await sleep(500);
      }
    } catch (err) {
      console.error("Error in radio loop:", err);
      // Wait before retrying
      await sleep(2000);
    }
  }

  console.log("👋 Radio agent shutting down");
}

// === AGENT DEFINITION ===
export default defineAgent({
  entry: radioAgentEntry,
});

// === CLI RUNNER ===
cli.runApp(
  new WorkerOptions({
    agent: import.meta.filename,
    workerType: "room",
  })
);
