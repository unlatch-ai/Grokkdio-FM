"use strict";

// Twitch AI Radio Stream
// Streams a static image + live, randomly generated XAI TTS audio to Twitch via RTMP

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

// === CONFIGURATION ===
// You can keep this hardcoded for now like stream.js, or switch to process.env later.
const TWITCH_STREAM_KEY = "";
const TWITCH_RTMP_URL = "rtmp://live.twitch.tv/app/";

// XAI realtime TTS (streaming) config
const XAI_API_KEY =
  process.env.XAI_API_KEY ||
  "xai-IW4Fu0ALlntMlBWfD0nJZkaahbHkHOm2Ar6o75MB7Nw9CpwfouEBZtsWM8NTtqnNv7ICOhE850nWU4sz";
const BASE_URL = process.env.BASE_URL || "https://api.x.ai/v1";

// Streaming TTS audio format (matches examples/tts/nodejs/streaming-tts.ts)
const TTS_SAMPLE_RATE = 24000; // 24 kHz
const TTS_CHANNELS = 1; // mono
const TTS_BITS_PER_SAMPLE = 16; // s16le

// Simple pool of random phrases for the AI radio
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

// === START STREAMING ===
async function startRadioStream() {
  if (!TWITCH_STREAM_KEY) {
    console.error("Missing TWITCH_STREAM_KEY");
    process.exit(1);
  }

  if (!XAI_API_KEY) {
    console.error("Missing XAI_API_KEY");
    process.exit(1);
  }

  console.log("Starting Twitch AI Radio stream...");

  // Check if image exists, create a simple one if not
  const imagePath = path.join(__dirname, "cover.png");
  if (!fs.existsSync(imagePath)) {
    console.log("No cover.png found - ffmpeg will create a test pattern");
  }

  // ffmpeg command for streaming
  const ffmpegArgs = [
    // Audio input: raw PCM from stdin (from XAI streaming TTS)
    "-f",
    "s16le",
    "-ar",
    TTS_SAMPLE_RATE.toString(),
    "-ac",
    TTS_CHANNELS.toString(),
    "-i",
    "pipe:0",

    // Video input: static image or test pattern
    ...(fs.existsSync(imagePath)
      ? ["-loop", "1", "-i", imagePath] // Loop the image
      : ["-f", "lavfi", "-i", "color=c=blue:s=1280x720:r=30"]), // Blue background

    // Add text overlay
    "-vf",
    "drawtext=text='XAI Radio Test Stream':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",

    // Video encoding
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-b:v",
    "2500k",
    "-maxrate",
    "2500k",
    "-bufsize",
    "5000k",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "60",
    "-r",
    "30",

    // Audio encoding
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000", // resample to 48kHz for Twitch

    // Output
    "-f",
    "flv",
    `${TWITCH_RTMP_URL}${TWITCH_STREAM_KEY}`,
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Log ffmpeg output
  ffmpeg.stderr.on("data", (data) => {
    console.log(data.toString());
  });

  ffmpeg.on("error", (err) => {
    console.error("Failed to start ffmpeg:", err.message);
    console.error(
      "Make sure ffmpeg is installed: brew install ffmpeg (Mac) or apt-get install ffmpeg (Linux)"
    );
  });

  ffmpeg.on("close", (code) => {
    console.log(`ffmpeg process exited with code ${code}`);
    process.exit(code || 0);
  });

  let isShuttingDown = false;

  process.on("SIGINT", () => {
    console.log("\nStopping AI Radio stream...");
    isShuttingDown = true;
    try {
      ffmpeg.stdin.end();
    } catch (_) {}
    ffmpeg.kill("SIGINT");
    setTimeout(() => process.exit(0), 1000);
  });

  // === XAI STREAMING TTS LOOP ===
  const wsBase = BASE_URL.replace("https://", "wss://").replace(
    "http://",
    "ws://"
  );
  const wsUri = `${wsBase}/realtime/audio/speech`;

  console.log("Connecting to XAI streaming TTS at", wsUri);

  function startTtsSession() {
    if (isShuttingDown) return;

    const ws = new WebSocket(wsUri, {
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
    });

    ws.on("open", () => {
      console.log("✅ Connected to XAI streaming TTS");

      // Send config
      const configMessage = {
        type: "config",
        data: {
          voice_id: "ara",
        },
      };
      ws.send(JSON.stringify(configMessage));
      console.log("📤 Sent config");

      // Build a longer random monologue for this session
      const text = buildRandomMonologue();
      console.log("📝 Text length:", text.length, "chars");

      const textMessage = {
        type: "text_chunk",
        data: {
          text,
          is_last: true, // let the server finish and close
        },
      };
      ws.send(JSON.stringify(textMessage));
      console.log("📤 Sent text chunk");
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const audioB64 = message?.data?.data?.audio;
        const isLast = message?.data?.data?.is_last;
        if (!audioB64) return;

        const audioBuffer = Buffer.from(audioB64, "base64");

        if (!ffmpeg.stdin.destroyed) {
          ffmpeg.stdin.write(audioBuffer, (err) => {
            if (err) {
              console.error(
                "Error writing audio to ffmpeg stdin:",
                err.message
              );
            }
          });
        }

        if (isLast) {
          console.log("🧩 Finished audio chunk set for this phrase.");
          ws.close();
        }
      } catch (err) {
        console.error("Error parsing TTS message:", err);
      }
    });

    ws.on("close", () => {
      if (isShuttingDown) return;
      console.log("🔁 TTS session closed. Scheduling next phrase...");
      // small pause between phrases to keep audio nearly continuous
      setTimeout(() => {
        if (!isShuttingDown) startTtsSession();
      }, 200);
    });

    ws.on("error", (err) => {
      console.error("XAI TTS WebSocket error:", err.message || err);
      ws.close();
    });
  }

  // Kick off the first TTS session
  startTtsSession();

  console.log(`
✅ AI Radio stream started!
📺 Check your stream at: https://twitch.tv/YOUR_USERNAME
⚠️  Stream may take 10-30 seconds to appear
🎵 You should hear continuously changing XAI generated phrases
Press Ctrl+C to stop
  `);
}

startRadioStream().catch((err) => {
  console.error("Unhandled error in AI Radio stream:", err);
  process.exit(1);
});
