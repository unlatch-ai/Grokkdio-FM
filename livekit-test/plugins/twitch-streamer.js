/**
 * Twitch Streaming Integration for LiveKit Agent
 * Streams agent audio output to Twitch via RTMP
 */

import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { ImageOverlayManager } from "../lib/ImageOverlayManager.js";

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
    
    // Image overlay manager
    this.imageOverlay = new ImageOverlayManager({
      overlayFile: path.join(process.cwd(), "twitch-overlay.png"),
    });
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

    // Input indices: 0=video, 1=music(if exists), 2or1=voice, +1=overlay (via pipe:3)
    const musicIdx = hasMusic ? 1 : -1;
    const voiceIdx = hasMusic ? 2 : 1;
    const overlayIdx = hasMusic ? 3 : 2;

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

      // Overlay input: raw RGBA frames via pipe:3 (fd 3)
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", "1280x720",
      "-r", "2", // 2 fps is enough for overlay updates
      "-thread_queue_size", "16",
      "-i", "pipe:3",

      // Complex filter: audio mixing + video overlay
      "-filter_complex",
      hasMusic
        ? `[${musicIdx}:a]aresample=48000,volume=0.15[music];[${voiceIdx}:a]aresample=async=1:first_pts=0,volume=1.0[voice];[music][voice]amix=inputs=2:duration=first:dropout_transition=0[aout];[0:v]scale=1280:720[base];[${overlayIdx}:v]format=rgba[ovl];[base][ovl]overlay=(W-w)/2:(H-h)/2:eof_action=pass[vout]`
        : `[${voiceIdx}:a]aresample=async=1:first_pts=0,volume=1.0[aout];[0:v]scale=1280:720[base];[${overlayIdx}:v]format=rgba[ovl];[base][ovl]overlay=(W-w)/2:(H-h)/2:eof_action=pass[vout]`,

      "-map", "[vout]",
      "-map", "[aout]",

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

    // Spawn with 4 stdio: stdin (audio), stdout, stderr, and fd3 (overlay frames)
    this.ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });

    // Get the overlay pipe (fd 3)
    this.overlayPipe = this.ffmpegProcess.stdio[3];
    
    // Handle overlay pipe errors
    this.overlayPipe.on("error", (err) => {
      if (err.code !== "EPIPE" && !this._isRestarting) {
        console.error("Overlay pipe error:", err.message);
      }
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
      // console.log("FFmpeg:", output);
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

    // Start overlay frame pusher - sends RGBA frames at 2fps
    this._startOverlayFramePusher();

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
   * Start the overlay frame pusher - continuously sends RGBA frames to FFmpeg
   * This allows dynamic overlay updates without restarting the stream
   */
  _startOverlayFramePusher() {
    // Frame size: 1280x720 RGBA = 3,686,400 bytes
    const FRAME_SIZE = 1280 * 720 * 4;
    
    // Create transparent frame (all zeros = transparent black)
    this._transparentFrame = Buffer.alloc(FRAME_SIZE);
    
    // Current overlay frame (starts as transparent)
    this._currentOverlayFrame = this._transparentFrame;
    
    // Push frames at 2fps (every 500ms)
    this.overlayFrameInterval = setInterval(() => {
      if (!this.isStreaming || !this.overlayPipe || this.overlayPipe.destroyed) {
        return;
      }
      
      try {
        this.overlayPipe.write(this._currentOverlayFrame);
      } catch (err) {
        // Ignore write errors
      }
    }, 500);
    
    console.log("🖼️  Overlay frame pusher started (2 fps)");
  }

  /**
   * Convert a PNG image to raw RGBA buffer
   * @param {string} imagePath - Path to PNG file
   * @param {object} options - Size and position options
   * @returns {Buffer|null} Raw RGBA buffer or null on error
   */
  _pngToRgba(imagePath, options = {}) {
    const {
      width = 420,        // Overlay width (smaller than full screen)
      position = 'bottom-left',  // 'top-left', 'top-right', 'bottom-left', 'bottom-right'
      margin = 20,        // Margin from edge
    } = options;

    // Calculate position offsets
    let x, y;
    switch (position) {
      case 'top-left':
        x = margin;
        y = margin;
        break;
      case 'top-right':
        x = 1280 - width - margin;
        y = margin;
        break;
      case 'bottom-right':
        x = 1280 - width - margin;
        y = `H-h-${margin}`;  // Will be calculated by ffmpeg
        break;
      case 'bottom-left':
      default:
        x = margin;
        y = `H-h-${margin}`;
        break;
    }

    try {
      // Use ffmpeg to convert PNG to raw RGBA:
      // 1. Scale to desired width (maintain aspect ratio)
      // 2. Pad to 1280x720 with transparency, positioned in corner
      const result = execSync(
        `ffmpeg -y -i "${imagePath}" -vf "scale=${width}:-1,pad=1280:720:${x}:(720-ih-${margin}):color=0x00000000,format=rgba" -f rawvideo -pix_fmt rgba -`,
        { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return result;
    } catch (err) {
      console.error("Error converting PNG to RGBA:", err.message);
      return null;
    }
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
   * Show an image overlay - dynamically updates without stream restart
   * @param {string} imagePath - Path to PNG image
   * @param {object} options - Options
   * @param {number} options.duration - Display duration in ms (default: 15000)
   * @param {boolean} options.deleteAfter - Delete image after hiding (default: true)
   * @param {number} options.width - Overlay width in px (default: 420)
   * @param {string} options.position - 'top-left', 'top-right', 'bottom-left', 'bottom-right' (default: 'bottom-left')
   * @param {number} options.margin - Margin from edge in px (default: 20)
   */
  async showImage(imagePath, options = {}) {
    const { duration = 15000, deleteAfter = true, width, position, margin } = options;
    
    if (!this.isStreaming) {
      console.warn("Cannot show overlay - not streaming");
      return;
    }

    // Convert PNG to RGBA frame with position/size options
    console.log(`🖼️  Loading overlay: ${path.basename(imagePath)}`);
    const rgbaFrame = this._pngToRgba(imagePath, { width, position, margin });
    
    if (!rgbaFrame) {
      console.error("Failed to load overlay image");
      return;
    }

    // Update the current frame - frame pusher will send it
    this._currentOverlayFrame = rgbaFrame;
    console.log(`✅ Overlay active for ${duration / 1000}s`);
    
    // Schedule hiding after duration
    if (this._overlayTimeout) {
      clearTimeout(this._overlayTimeout);
    }
    
    this._overlayTimeout = setTimeout(() => {
      this.hideImage();
      // Delete source if requested
      if (deleteAfter && imagePath && fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
          console.log(`🗑️  Deleted: ${path.basename(imagePath)}`);
        } catch (err) {
          // Ignore
        }
      }
    }, duration);
  }

  /**
   * Hide the current image overlay
   */
  hideImage() {
    if (this._overlayTimeout) {
      clearTimeout(this._overlayTimeout);
      this._overlayTimeout = null;
    }
    
    // Switch back to transparent frame
    if (this._transparentFrame) {
      this._currentOverlayFrame = this._transparentFrame;
      console.log("🖼️  Overlay hidden");
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

    // Stop overlay frame pusher
    if (this.overlayFrameInterval) {
      clearInterval(this.overlayFrameInterval);
      this.overlayFrameInterval = null;
    }
    
    // Clear overlay timeout
    if (this._overlayTimeout) {
      clearTimeout(this._overlayTimeout);
      this._overlayTimeout = null;
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
