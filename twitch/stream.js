// Twitch Hello World Stream
// Streams a static image with audio tone to Twitch via RTMP

require("dotenv").config();

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ensureHelloAudioFile } = require("./xaiHelloAudio");

// === CONFIGURATION ===
const TWITCH_STREAM_KEY = ''; // Get from https://dashboard.twitch.tv/settings/stream
const TWITCH_RTMP_URL = 'rtmp://live.twitch.tv/app/';

// Audio settings
const SAMPLE_RATE = 48000; // Twitch prefers 48kHz
const CHANNELS = 2; // Stereo
const FREQUENCY = 440; // A4 note (Hz)

// === GENERATE TEST AUDIO ===
// Creates a simple sine wave tone

// === START STREAMING ===
async function startStream() {
  console.log("Starting Twitch stream...");

  let audioPath;
  try {
    audioPath = await ensureHelloAudioFile();
  } catch (err) {
    console.error(
      "Failed to prepare XAI hello world audio:",
      err.message || err
    );
    process.exit(1);
  }

  // Check if image exists, create a simple one if not
  const imagePath = "cover.png";
  if (!fs.existsSync(imagePath)) {
    console.log("No cover.png found - ffmpeg will create a test pattern");
  }

  // ffmpeg command for streaming
  const ffmpegArgs = [
    // Audio input: loop XAI generated hello world MP3
    "-stream_loop",
    "-1",
    "-i",
    audioPath,

    // Video input: static image or test pattern
    ...(fs.existsSync(imagePath)
      ? ["-loop", "1", "-i", imagePath] // Loop the image
      : ["-f", "lavfi", "-i", "color=c=blue:s=1280x720:r=30"]), // Blue background

    // Add text overlay
    "-vf",
    "drawtext=text='Hello Twitch - AI Radio Test':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",

    // Video encoding
    "-c:v",
    "libx264", // H.264 codec
    "-preset",
    "veryfast", // Encoding speed (faster = less CPU)
    "-b:v",
    "2500k", // Video bitrate
    "-maxrate",
    "2500k",
    "-bufsize",
    "5000k",
    "-pix_fmt",
    "yuv420p", // Pixel format
    "-g",
    "60", // Keyframe interval
    "-r",
    "30", // 30 fps

    // Audio encoding
    "-c:a",
    "aac", // AAC codec
    "-b:a",
    "128k", // Audio bitrate
    "-ar",
    "48000", // Resample to 48kHz

    // Output
    "-f",
    "flv", // Flash Video format for RTMP
    `${TWITCH_RTMP_URL}${TWITCH_STREAM_KEY}`,
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "pipe", "pipe"],
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
    console.log(`Stream ended with code ${code}`);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nStopping stream...");
    ffmpeg.kill("SIGINT");
    setTimeout(() => process.exit(0), 1000);
  });

  console.log(`
✅ Stream started!
📺 Check your stream at: https://twitch.tv/YOUR_USERNAME
⚠️  Stream may take 10-30 seconds to appear
🎵 You should hear an XAI generated "hello world" message
Press Ctrl+C to stop
  `);
}

// === MAIN ===
if (!TWITCH_STREAM_KEY) {
  console.error(`
❌ ERROR: Please set your Twitch stream key!

Steps to get your stream key:
1. Go to https://dashboard.twitch.tv/settings/stream
2. Copy your "Primary Stream Key"
3. Add TWITCH_STREAM_KEY to your .env file
4. Run again: node stream.js

⚠️  Keep your stream key SECRET - don't commit it to git!
  `);
  process.exit(1);
}

startStream();
