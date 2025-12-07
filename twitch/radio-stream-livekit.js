"use strict";

// LiveKit AI Radio Stream
// Same as radio-stream.js but uses LiveKit instead of ffmpeg
// This makes it easy to add multiple AI agents to the same room

require("dotenv").config();

const {
  Room,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  AudioFrame,
} = require("@livekit/rtc-node");
const {
  AccessToken,
  EgressClient,
  StreamOutput,
  StreamProtocol,
} = require("livekit-server-sdk");
const WebSocket = require("ws");

// === CONFIGURATION ===
const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const TWITCH_STREAM_KEY = process.env.TWITCH_STREAM_KEY || "";
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const BASE_URL = process.env.BASE_URL || "https://api.x.ai/v1";
const ROOM_NAME = "radio-room";

// XAI TTS outputs 24kHz mono 16-bit PCM
const TTS_SAMPLE_RATE = 24000;
const TTS_CHANNELS = 1;

// Simple pool of random phrases
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

function buildRandomMonologue() {
  const sentenceCount = 6 + Math.floor(Math.random() * 6); // 6-11 sentences
  const parts = [];
  for (let i = 0; i < sentenceCount; i++) {
    const idx = Math.floor(Math.random() * RANDOM_PHRASES.length);
    parts.push(RANDOM_PHRASES[idx]);
  }
  return parts.join(" ");
}

// === MAIN ===
async function startRadioStream() {
  // Validate config
  if (!LIVEKIT_URL) {
    console.error("❌ Missing LIVEKIT_URL in .env");
    console.error("   Get this from https://cloud.livekit.io/");
    process.exit(1);
  }
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.error("❌ Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET in .env");
    console.error("   Get these from https://cloud.livekit.io/");
    process.exit(1);
  }
  if (!XAI_API_KEY) {
    console.error("❌ Missing XAI_API_KEY in .env");
    process.exit(1);
  }

  console.log("🚀 Starting LiveKit AI Radio stream...");
  console.log("📡 LiveKit URL:", LIVEKIT_URL);

  // === 1. Generate access token for the agent ===
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: "radio-host",
    name: "DJ Grok",
  });
  token.addGrant({
    room: ROOM_NAME,
    roomJoin: true,
    roomCreate: true,
    canPublish: true,
    canSubscribe: true,
  });
  const jwt = await token.toJwt();
  console.log("🔑 Generated access token for agent");

  // === 2. Connect to LiveKit room ===
  const room = new Room();
  await room.connect(LIVEKIT_URL, jwt, {
    autoSubscribe: false,
  });
  console.log("✅ Connected to LiveKit room:", ROOM_NAME);

  // === 3. Create audio source and track ===
  // Third parameter is queue size in ms (default 1000ms)
  // We use 2000ms buffer - pacing logic will keep it under 500ms anyway
  const audioSource = new AudioSource(TTS_SAMPLE_RATE, TTS_CHANNELS, 10000);
  const track = LocalAudioTrack.createAudioTrack("radio-audio", audioSource);

  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;

  const publication = await room.localParticipant.publishTrack(
    track,
    publishOptions
  );
  console.log("🎙️ Audio track published:", publication.sid);

  // === 4. Start Twitch egress (if stream key provided) ===
  if (TWITCH_STREAM_KEY) {
    await startTwitchEgress();
  } else {
    console.log(
      "⚠️  No TWITCH_STREAM_KEY in .env - audio will only be in LiveKit room"
    );
    console.log(
      "   You can still test by joining the room in LiveKit Playground"
    );
  }

  // === 5. Start XAI TTS loop ===
  let isShuttingDown = false;
  let currentWs = null;
  let nextSessionTimeout = null;

  process.on("SIGINT", async () => {
    console.log("\n🛑 Stopping AI Radio stream...");
    isShuttingDown = true;

    // Clear any pending timeout
    if (nextSessionTimeout) {
      clearTimeout(nextSessionTimeout);
      nextSessionTimeout = null;
    }

    // Close active WebSocket connection
    if (currentWs) {
      currentWs.close();
      currentWs = null;
    }

    await room.disconnect();
    process.exit(0);
  });

  const wsBase = BASE_URL.replace("https://", "wss://").replace(
    "http://",
    "ws://"
  );
  const wsUri = `${wsBase}/realtime/audio/speech`;

  console.log("🔌 Connecting to XAI streaming TTS at", wsUri);

  function startTtsSession() {
    if (isShuttingDown) return;

    const ws = new WebSocket(wsUri, {
      headers: { Authorization: `Bearer ${XAI_API_KEY}` },
    });
    currentWs = ws;

    ws.on("open", () => {
      console.log("✅ Connected to XAI streaming TTS");

      // Send config
      ws.send(
        JSON.stringify({
          type: "config",
          data: { voice_id: "ara" },
        })
      );
      console.log("📤 Sent TTS config (voice: ara)");

      // Build and send text
      const text = buildRandomMonologue();
      console.log("📝 Text length:", text.length, "chars");

      ws.send(
        JSON.stringify({
          type: "text_chunk",
          data: { text, is_last: true },
        })
      );
      console.log("📤 Sent text chunk");
    });

    ws.on("message", async (data) => {
      if (isShuttingDown) return;

      try {
        const message = JSON.parse(data.toString());
        const audioB64 = message?.data?.data?.audio;
        const isLast = message?.data?.data?.is_last;

        if (!audioB64) return;

        // Log queue status before processing
        console.log(
          "queuedDuration(s):",
          audioSource.queuedDuration,
          "queueSize(ms):",
          audioSource.queueSize,
          "closed:",
          audioSource.closed
        );

        // Wait if queue is getting full (pace at message level, not frame level)
        while (audioSource.queuedDuration > 5000 && !isShuttingDown) {
          console.log("Waiting for queue to clear...");
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        // Convert base64 to buffer (16-bit PCM)
        const audioBuffer = Buffer.from(audioB64, "base64");
        const totalSamples = audioBuffer.length / 2;

        // Create Int16Array and copy data from Buffer
        // (Node.js Buffer uses pooling, so we must copy to a fresh ArrayBuffer)
        const int16Data = new Int16Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
          int16Data[i] = audioBuffer.readInt16LE(i * 2);
        }

        // Send the entire chunk as one frame - LiveKit handles internal buffering
        const frame = new AudioFrame(
          int16Data,
          TTS_SAMPLE_RATE,
          TTS_CHANNELS,
          totalSamples
        );

        await audioSource.captureFrame(frame);

        const durationMs = (totalSamples / TTS_SAMPLE_RATE) * 1000;
        console.log(
          `🔊 Sent ${totalSamples} samples (${durationMs.toFixed(0)}ms)`
        );

        if (isLast) {
          console.log("🧩 Finished audio for this phrase.");
          ws.close();
        }
      } catch (err) {
        console.error("Error capturing audio frame:", err);
      }
    });

    ws.on("close", () => {
      currentWs = null;
      if (isShuttingDown) return;
      console.log("🔁 TTS session closed. Scheduling next phrase...");
      // small pause between phrases
      nextSessionTimeout = setTimeout(() => {
        nextSessionTimeout = null;
        if (!isShuttingDown) startTtsSession();
      }, 200);
    });

    ws.on("error", (err) => {
      console.error("XAI TTS WebSocket error:", err.message || err);
      ws.close();
    });
  }

  // Wait a moment for the track to stabilize before sending audio
  console.log("⏳ Waiting for track to stabilize...");
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Kick off the first TTS session
  startTtsSession();

  console.log(`
✅ LiveKit AI Radio started!
🏠 Room: ${ROOM_NAME}
🎙️ Agent: DJ Grok
📺 Twitch: ${TWITCH_STREAM_KEY ? "Egress starting..." : "Not configured"}
🔊 You can join the room at: https://meet.livekit.io/custom?liveKitUrl=${encodeURIComponent(
    LIVEKIT_URL
  )}
Press Ctrl+C to stop
  `);
}

// === Start Twitch Egress ===
async function startTwitchEgress() {
  console.log("📺 Starting Twitch egress...");

  // Convert wss:// to https:// for the API endpoint
  const apiUrl = LIVEKIT_URL.replace("wss://", "https://").replace(
    "ws://",
    "http://"
  );

  const egressClient = new EgressClient(
    apiUrl,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET
  );

  try {
    const output = new StreamOutput({
      protocol: StreamProtocol.RTMP,
      urls: [`rtmp://live.twitch.tv/app/${TWITCH_STREAM_KEY}`],
    });

    const info = await egressClient.startRoomCompositeEgress(
      ROOM_NAME,
      { stream: output },
      {
        layout: "single-speaker",
        audioOnly: false,
      }
    );

    console.log("✅ Twitch egress started:", info.egressId);
    console.log("📺 Stream should appear on Twitch in ~25 seconds");

    return info;
  } catch (err) {
    console.error("❌ Failed to start egress:", err.message);
    console.log(
      "💡 Tip: Make sure Egress is enabled in your LiveKit Cloud project"
    );
    console.log(
      "   Go to https://cloud.livekit.io/ → Your Project → Settings → Egress"
    );
  }
}

// Run
startRadioStream().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
