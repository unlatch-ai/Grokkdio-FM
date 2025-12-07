/**
 * Local Audio Player for LiveKit Agent
 * Plays agent audio output locally with video preview
 * Uses same primitives as TwitchStreamer for consistency
 */

import { spawn } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { ImageOverlayManager } from "../lib/ImageOverlayManager.js";

export class LocalAudioPlayer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.sampleRate = config.sampleRate || 24000;
    this.channels = config.channels || 1;
    this.overlayText = config.overlayText || "AI Podcast - Local Preview";
    this.showVideo = config.showVideo !== false; // Default to true

    this.ffmpegProcess = null;
    this.ffplayProcess = null;
    this.isPlaying = false;
    this.isRestarting = false;

    // Subtitle feature flag (disabled by default to match Twitch behavior)
    this.enableSubtitles = config.enableSubtitles || false;

    // Dynamic text overlay (only if enabled)
    this.dynamicText = "";
    this.dynamicTextTimeout = null;
    this.subtitleFile = path.join(process.cwd(), "subtitle.txt");

    // Create empty subtitle file
    if (this.enableSubtitles) {
      fs.writeFileSync(this.subtitleFile, "", "utf8");
    }
    // Image overlay manager
    this.imageOverlay = new ImageOverlayManager();
  }

  /**
   * Start playing audio locally with video preview
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isPlaying && this.ffmpegProcess && !this.ffmpegProcess.killed) {
      console.warn("Audio player already running");
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

    console.log("🔊 Starting local preview...");

    if (this.showVideo) {
      // Create video preview with audio (like Twitch would see)
      await this.startVideoPreview();
    } else {
      // Audio only mode
      await this.startAudioOnly();
    }

    this.isPlaying = true;
    this.emit("started");

    console.log("✅ Local preview started");
    console.log(
      `📝 Subtitles: ${this.enableSubtitles ? "enabled" : "disabled"}`
    );
  }

  async startVideoPreview() {
    console.log("🎬 Starting video preview window...");

    // Escape special characters in overlay text for ffmpeg
    const escapedText = this.overlayText
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");

    // Check if background video exists
    const backgroundVideo = process.env.BACKGROUND_VIDEO || "./media/gta.mp4";

    // Check for background music
    const backgroundMusic =
      process.env.BACKGROUND_MUSIC ||
      path.join(process.cwd(), "media", "background-music.mp3");
    const hasMusic = fs.existsSync(backgroundMusic);

    if (hasMusic) {
      console.log(`🎵 Found background music: ${backgroundMusic}`);
    }

    // FFmpeg loops video and overlays audio + text
    const ffmpegArgs = [
      // Loop the background video (no audio)
      "-stream_loop",
      "-1",
      "-re", // Read input at native frame rate
      "-i",
      backgroundVideo,

      // Audio input from stdin (podcast audio)
      "-f",
      "s16le",
      "-ar",
      this.sampleRate.toString(),
      "-ac",
      this.channels.toString(),
      "-i",
      "pipe:0",

      // Background music input (optional, looped)
      ...(hasMusic
        ? [
            "-stream_loop",
            "-1",
            "-i",
            backgroundMusic,
            "-filter_complex",
            "[1:a]aresample=async=1:first_pts=0,volume=1.0[voice];[2:a]volume=0.15[music];[voice][music]amix=inputs=2:duration=longest:dropout_transition=0[aout]",
            "-map",
            "0:v:0",
            "-map",
            "[aout]",
          ]
        : ["-map", "0:v:0", "-map", "1:a:0"]),

      // Scale video, add image overlay, and add dynamic text overlay from file
      "-vf",
      `scale=1280:720[base];movie=${this.imageOverlay.getOverlayPath()}:loop=0,format=rgba[ovl];[base][ovl]overlay=(W-w)/2:(H-h)/2:format=auto:shortest=0,drawtext=textfile=${this.subtitleFile}:reload=1:fontsize=32:fontcolor=white:x=(w-text_w)/2:y=h-100:box=1:boxcolor=black@0.7:boxborderw=10`,

      // Video encoding
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",

      // Audio encoding
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",

      // Prevent conversion failure
      "-shortest", // Stop when shortest input ends
      "-fflags",
      "+genpts", // Generate presentation timestamps

      // Output to pipe for ffplay
      "-f",
      "mpegts",
      "pipe:1",
    ];

    this.ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Handle stdin errors to prevent crashes - CRITICAL!
    this.ffmpegProcess.stdin.on("error", (err) => {
      // Silently ignore EPIPE errors during restart
      if (err.code !== "EPIPE" && !this.isRestarting) {
        console.error("FFmpeg stdin error:", err.message);
      }
    });

    // Also handle process errors
    this.ffmpegProcess.on("error", (err) => {
      if (!this.isRestarting) {
        console.error("FFmpeg process error:", err.message);
      }
    });

    // Start ffplay to display the video
    const ffplayArgs = [
      "-f",
      "mpegts",
      "-i",
      "pipe:0",
      "-window_title",
      "AI Podcast Preview - What Twitch Would See",
      "-autoexit",
    ];

    this.ffplayProcess = spawn("ffplay", ffplayArgs, {
      stdio: ["pipe", "inherit", "pipe"],
    });

    // Handle stdin errors on ffplay too
    this.ffplayProcess.stdin.on("error", (err) => {
      if (err.code !== "EPIPE" && !this.isRestarting) {
        console.error("FFplay stdin error:", err.message);
      }
    });

    // Pipe ffmpeg output to ffplay
    this.ffmpegProcess.stdout.pipe(this.ffplayProcess.stdin);

    this.ffmpegProcess.stderr.on("data", (data) => {
      const output = data.toString();
      if (output.includes("error") || output.includes("Error")) {
        console.error("FFmpeg error:", output);
      }
    });

    this.ffplayProcess.on("error", (err) => {
      if (!this.isRestarting) {
        console.error("Failed to start ffplay:", err.message);
        this.emit("error", err);
      }
    });

    this.ffplayProcess.on("close", (code) => {
      console.log(`\n🎬 Preview window closed (code: ${code})`);

      const wasPlaying = this.isPlaying;
      this.isPlaying = false;

      // Kill ffmpeg too
      if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
        this.ffmpegProcess.kill("SIGKILL");
      }

      // Don't auto-restart - user likely closed it intentionally
      this.emit("stopped");
    });

    console.log("✅ Preview window opened");
  }

  async startAudioOnly() {
    // Fallback to audio-only using sox
    const playArgs = [
      "-t",
      "raw",
      "-r",
      this.sampleRate.toString(),
      "-e",
      "signed-integer",
      "-b",
      "16",
      "-c",
      this.channels.toString(),
      "-",
      "-q",
    ];

    this.ffmpegProcess = spawn("play", playArgs, {
      stdio: ["pipe", "ignore", "pipe"],
    });

    // Handle stdin errors to prevent crashes
    this.ffmpegProcess.stdin.on("error", (err) => {
      if (err.code !== "EPIPE" && !this.isRestarting) {
        console.error("Audio player stdin error:", err.message);
      }
    });

    this.ffmpegProcess.on("error", (err) => {
      if (!this.isRestarting) {
        console.error("Failed to start audio player:", err.message);
        console.error("Make sure sox is installed: brew install sox");
        this.emit("error", err);
      }
    });

    this.ffmpegProcess.on("close", (code) => {
      if (!this.isRestarting && code !== 0 && code !== null) {
        console.log(`Audio player exited with code ${code}`);
      }
      if (!this.isRestarting) {
        this.isPlaying = false;
        this.emit("stopped", code);
      }
    });
  }

  /**
   * Write audio data to play locally
   * @param {Buffer} audioData - PCM audio buffer
   */
  writeAudio(audioData) {
    if (
      !this.isPlaying ||
      !this.ffmpegProcess ||
      this.ffmpegProcess.stdin.destroyed ||
      this.isRestarting
    ) {
      return;
    }

    try {
      this.ffmpegProcess.stdin.write(audioData);
    } catch (err) {
      // Silently ignore write errors during restart
      if (!this.isRestarting) {
        console.error("Error writing audio to player:", err.message);
      }
    }
  }

  /**
   * Update subtitle text on video
   * @param {string} text - Subtitle text to display
   */
  updateSubtitle(text) {
    if (!this.enableSubtitles || !this.isPlaying) return;

    try {
      // Write text to file - ffmpeg will reload it automatically
      fs.writeFileSync(this.subtitleFile, text, "utf8");
    } catch (err) {
      // Ignore errors
    }
  }

  /**
   * Show an image overlay with fade in/out
   * @param {string} imagePath - Path to PNG image
   * @param {object} options - Options (duration, fadeIn, fadeOut)
   */
  showImage(imagePath, options = {}) {
    return this.imageOverlay.showImage(imagePath, options);
  }

  /**
   * Hide the current image overlay
   */
  hideImage() {
    return this.imageOverlay.hideImage();
  }

  /**
   * Clear audio buffer (interrupt current playback)
   * Restarts the player to truly clear all buffers
   */
  async clearAudio() {
    if (!this.isPlaying || this.isRestarting) {
      return;
    }

    console.log("🔄 Clearing audio buffer...");

    // Set flag to prevent writes during restart
    this.isRestarting = true;

    // Wait a moment for any pending writes to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // DON'T remove listeners - instead kill processes first
    // The error handlers will catch any EPIPE errors
    if (this.ffmpegProcess) {
      try {
        // Close stdin gracefully first
        if (this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
          this.ffmpegProcess.stdin.end();
        }
      } catch (err) {
        // Ignore
      }

      try {
        this.ffmpegProcess.kill("SIGKILL");
      } catch (err) {
        // Ignore kill errors
      }
    }

    if (this.ffplayProcess) {
      try {
        if (this.ffplayProcess.stdin && !this.ffplayProcess.stdin.destroyed) {
          this.ffplayProcess.stdin.end();
        }
      } catch (err) {
        // Ignore
      }

      try {
        this.ffplayProcess.kill("SIGKILL");
      } catch (err) {
        // Ignore kill errors
      }
    }

    // Small delay to ensure processes are dead
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Restart the player
    if (this.showVideo) {
      await this.startVideoPreview();
    } else {
      await this.startAudioOnly();
    }

    // Clear the flag
    this.isRestarting = false;

    console.log("✅ Audio buffer cleared");
  }

  /**
   * Stop the local audio player
   */
  stop() {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill("SIGINT");
    }

    if (this.ffplayProcess) {
      this.ffplayProcess.kill("SIGINT");
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

    this.isPlaying = false;
  }

  /**
   * Check if currently playing
   * @returns {boolean}
   */
  get playing() {
    return this.isPlaying;
  }
}

export default LocalAudioPlayer;
