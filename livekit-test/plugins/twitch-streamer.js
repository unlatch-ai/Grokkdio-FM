/**
 * Twitch Streaming Integration for LiveKit Agent
 * Streams agent audio output to Twitch via RTMP
 */

import { spawn } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";

export class TwitchStreamer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.streamKey = config.streamKey || process.env.TWITCH_STREAM_KEY;
    this.rtmpUrl =
      config.rtmpUrl ||
      process.env.TWITCH_RTMP_URL ||
      "rtmp://live.twitch.tv/app/";
    this.sampleRate = config.sampleRate || 24000;
    this.channels = config.channels || 1;
    this.overlayText = config.overlayText || "AI Podcast";
    this.coverImage = config.coverImage;

    this.ffmpegProcess = null;
    this.isStreaming = false;
    this.keepAliveInterval = null;

    // Subtitle feature flag (disabled by default to avoid SIGBUS issues)
    this.enableSubtitles = config.enableSubtitles || false;

    // Dynamic text overlay (only if enabled)
    this.dynamicText = "";
    this.subtitleFile = path.join(process.cwd(), "twitch-subtitle.txt");

    // Create empty text file only if subtitles are enabled
    if (this.enableSubtitles) {
      fs.writeFileSync(this.subtitleFile, "", "utf8");
    }
  }

  /**
   * Start streaming to Twitch
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isStreaming && this.ffmpegProcess && !this.ffmpegProcess.killed) {
      console.warn("Twitch stream already running");
      return;
    }

    // Clean up any existing process
    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.kill("SIGKILL");
      } catch (err) {
        // Ignore
      }
      this.ffmpegProcess = null;
    }

    if (!this.streamKey) {
      throw new Error("Missing TWITCH_STREAM_KEY");
    }

    console.log("🎥 Starting Twitch stream...");

    // Check for background video
    const backgroundVideo = process.env.BACKGROUND_VIDEO || "./media/gta.mp4";
    const useVideo = fs.existsSync(backgroundVideo);

    // Check for background music
    const backgroundMusic =
      process.env.BACKGROUND_MUSIC ||
      path.join(process.cwd(), "media", "background-music.mp3");
    const hasMusic = fs.existsSync(backgroundMusic);

    if (hasMusic) {
      console.log(`🎵 Found background music: ${backgroundMusic}`);
    } else {
      console.log(`⚠️  No background music found at: ${backgroundMusic}`);
    }

    const ffmpegArgs = [
      // Video input: loop background video or fallback to static
      ...(useVideo
        ? ["-stream_loop", "-1", "-re", "-i", backgroundVideo]
        : this.coverImage && fs.existsSync(this.coverImage)
        ? ["-loop", "1", "-i", this.coverImage]
        : ["-f", "lavfi", "-i", "color=c=#1a1a2e:s=1280x720:r=30"]),

      // Background music input (looped)
      ...(hasMusic ? ["-stream_loop", "-1", "-i", backgroundMusic] : []),

      // Audio input: raw PCM from stdin (podcast voices) - NON-BLOCKING
      "-f",
      "s16le",
      "-ar",
      this.sampleRate.toString(),
      "-ac",
      this.channels.toString(),
      "-thread_queue_size",
      "512",
      "-i",
      "pipe:0",

      // Audio mixing
      ...(hasMusic
        ? [
            "-filter_complex",
            `[${hasMusic ? "1" : "0"}:a]aresample=48000,volume=0.15[music];[${
              hasMusic ? "2" : "1"
            }:a]aresample=async=1:first_pts=0,volume=1.0[voice];[music][voice]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
            "-map",
            "0:v:0",
            "-map",
            "[aout]",
          ]
        : ["-map", "0:v:0", "-map", `${hasMusic ? "2" : "1"}:a:0`]),

      // Scale video and optionally add dynamic subtitle overlay from file
      "-vf",
      this.enableSubtitles
        ? `scale=1280:720,drawtext=textfile=${this.subtitleFile}:reload=1:fontsize=32:fontcolor=white:x=(w-text_w)/2:y=h-100:box=1:boxcolor=black@0.7:boxborderw=10`
        : `scale=1280:720`,

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
      "48000", // Twitch requires 48kHz

      // Output
      "-f",
      "flv",
      `${this.rtmpUrl}${this.streamKey}`,
    ];

    this.ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Handle stdin errors to prevent crashes - CRITICAL!
    this.ffmpegProcess.stdin.on("error", (err) => {
      // Silently ignore EPIPE errors
      if (err.code !== "EPIPE") {
        console.error("FFmpeg stdin error:", err.message);
      }
    });

    this.ffmpegProcess.stderr.on("data", (data) => {
      const output = data.toString();
      // Show all ffmpeg output for debugging
      console.log("FFmpeg:", output);
    });

    this.ffmpegProcess.on("error", (err) => {
      console.error("Failed to start ffmpeg:", err.message);
      console.error("Make sure ffmpeg is installed: brew install ffmpeg");
      this.emit("error", err);
    });

    this.ffmpegProcess.on("close", (code, signal) => {
      console.log(`FFmpeg process exited with code ${code}, signal: ${signal}`);

      const wasStreaming = this.isStreaming;
      this.isStreaming = false;

      if (wasStreaming) {
        console.error("⚠️  FFmpeg stream ended unexpectedly.");
        if (signal === "SIGPIPE") {
          console.error("   → SIGPIPE: RTMP connection to Twitch was broken");
        } else if (signal === "SIGSEGV") {
          console.error("   → SIGSEGV: FFmpeg crashed (memory issue)");
        } else if (code === 1) {
          console.error("   → Exit 1: Likely audio input underflow");
        } else {
          console.error(`   → Unknown: code=${code}, signal=${signal}`);
        }
      }

      this.emit("stopped", { code, signal });
    });

    this.isStreaming = true;

    // Always use keep-alive to prevent stdin starvation
    console.log("🔄 Starting stdin keep-alive (100ms silence every 500ms)");
    this.keepAliveInterval = setInterval(() => {
      if (
        this.isStreaming &&
        this.ffmpegProcess &&
        !this.ffmpegProcess.stdin.destroyed
      ) {
        try {
          // Send 100ms of silence to keep stdin alive
          const silenceBuffer = Buffer.alloc(4800); // 100ms at 24kHz, 16-bit
          this.ffmpegProcess.stdin.write(silenceBuffer);
        } catch (err) {
          // Ignore write errors
        }
      }
    }, 500); // Every 500ms

    this.emit("started");

    console.log("✅ Twitch stream started");
    if (hasMusic) {
      console.log("🎵 Background music enabled (15% volume)");
    }
    console.log(
      `📝 Subtitles: ${this.enableSubtitles ? "enabled" : "disabled"}`
    );
    console.log("📺 Check your stream at: https://twitch.tv/YOUR_USERNAME");
  }

  /**
   * Update subtitle text on stream
   * @param {string} text - Subtitle text to display
   */
  updateSubtitle(text) {
    if (!this.enableSubtitles || !this.isStreaming) return;

    try {
      // Write text to file - ffmpeg will reload it automatically
      fs.writeFileSync(this.subtitleFile, text, "utf8");
    } catch (err) {
      // Ignore errors
    }
  }

  /**
   * Show text overlay on stream (legacy method)
   * @param {string} text - Text to display
   * @param {number} duration - Duration in milliseconds (default 5000)
   */
  showText(text, duration = 5000) {
    if (!this.enableSubtitles) return;

    this.updateSubtitle(text);

    // Auto-hide after duration
    setTimeout(() => {
      this.updateSubtitle("");
    }, duration);
  }

  /**
   * Hide the text overlay
   */
  hideText() {
    if (!this.enableSubtitles) return;

    try {
      fs.writeFileSync(this.subtitleFile, "");
    } catch (err) {
      console.error("Error hiding text:", err.message);
    }
  }

  /**
   * Write audio data to the stream
   * @param {Buffer} audioData - PCM audio buffer
   */
  writeAudio(audioData) {
    if (
      !this.isStreaming ||
      !this.ffmpegProcess ||
      this.ffmpegProcess.stdin.destroyed
    ) {
      return;
    }

    try {
      this.ffmpegProcess.stdin.write(audioData);
    } catch (err) {
      console.error("Error writing audio to stream:", err.message);
      this.emit("error", err);
    }
  }

  /**
   * Stop the Twitch stream
   */
  stop() {
    if (!this.isStreaming) {
      return;
    }

    console.log("🛑 Stopping Twitch stream...");
    this.isStreaming = false;

    // Stop keep-alive
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    // Clean up subtitle file (only if subtitles were enabled)
    if (this.enableSubtitles) {
      try {
        if (fs.existsSync(this.subtitleFile)) {
          fs.unlinkSync(this.subtitleFile);
        }
      } catch (err) {
        // Ignore
      }
    }

    try {
      this.ffmpegProcess.stdin.end();
    } catch (err) {
      console.error("Error ending ffmpeg stdin:", err.message);
    }

    this.ffmpegProcess.kill("SIGINT");
  }

  /**
   * Check if currently streaming
   * @returns {boolean}
   */
  get streaming() {
    return this.isStreaming;
  }
}

export default TwitchStreamer;
