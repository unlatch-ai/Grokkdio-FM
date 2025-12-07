/**
 * XAI TTS Voice Cloning Plugin
 * Uses XAI's voice cloning REST API to synthesize speech from a reference voice file
 * Returns PCM16 24kHz mono buffer (same format as XAITTSPlugin)
 */

import { EventEmitter } from "events";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const MAX_INPUT_LENGTH = 4096;

export class XAITTSClonePlugin extends EventEmitter {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.XAI_API_KEY;
    this.baseUrl = config.baseUrl || "https://us-east-4.api.x.ai/voice-staging";
    this.voiceFile = config.voiceFile; // Path to voice file (m4a, mp3, etc.)
    this.instructions = config.instructions || "audio"; // Voice style instructions

    // Output format (always PCM16 24kHz mono to match XAITTSPlugin)
    this.sampleRate = 24000;
    this.channels = 1;
    this.bitsPerSample = 16;

    // Cached voice file as base64
    this.voiceBase64 = null;
    this.initialized = false;

    // Timeout for API calls (voice clone can be slower)
    this.timeout = config.timeout || 35000; // 35s default timeout (most succeed in 5-8s)
  }

  /**
   * Initialize the plugin by loading the voice file
   * Must be called before synthesize()
   */
  async initialize() {
    if (!this.voiceFile) {
      throw new Error("XAITTSClonePlugin requires a voiceFile path");
    }

    const absolutePath = path.resolve(this.voiceFile);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Voice file not found: ${absolutePath}`);
    }

    const fileBuffer = fs.readFileSync(absolutePath);
    this.voiceBase64 = fileBuffer.toString("base64");
    this.initialized = true;

    const fileSizeKB = (fileBuffer.length / 1024).toFixed(1);
    console.log(
      `🎤 Voice clone loaded: ${path.basename(
        this.voiceFile
      )} (${fileSizeKB} KB)`
    );
  }

  /**
   * Convert text to speech using voice cloning
   * @param {string} text - Text to convert to speech
   * @param {number} retries - Number of retries on failure
   * @returns {Promise<Buffer>} - Audio buffer (PCM16 24kHz mono)
   */
  async synthesize(text, retries = 3) {
    if (!this.initialized) {
      await this.initialize();
    }

    const endpoint = `${this.baseUrl}/api/v1/text-to-speech/generate`;

    // Truncate text to max length
    const inputText = text.substring(0, MAX_INPUT_LENGTH);

    const payload = {
      model: "grok-voice",
      input: inputText,
      response_format: "mp3",
      instructions: this.instructions,
      voice: this.voiceBase64,
      sampling_params: {
        max_new_tokens: 512,
        temperature: 1.0,
        min_p: 0.01,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const startTime = Date.now();

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const apiTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Voice clone API error: ${response.status} - ${errorText}`
        );
      }

      // Get MP3 data
      const mp3Buffer = Buffer.from(await response.arrayBuffer());
      const downloadTime = Date.now() - startTime - apiTime;

      // Convert MP3 → PCM16 24kHz mono
      const convertStart = Date.now();
      const pcmBuffer = await this._convertToPCM16(mp3Buffer);
      const convertTime = Date.now() - convertStart;

      const totalTime = Date.now() - startTime;
      console.log(
        `⏱️  Voice clone: API=${apiTime}ms, convert=${convertTime}ms, total=${totalTime}ms`
      );

      clearTimeout(timeoutId);
      return pcmBuffer;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle timeout specifically
      if (error.name === "AbortError") {
        const timeoutError = new Error(
          `Voice clone API timed out after ${this.timeout}ms`
        );

        // Retry on timeout - retry immediately without delay
        if (retries > 0) {
          console.log(
            `⚠️  Voice clone timeout, retrying immediately... (${retries} retries left)`
          );
          return this.synthesize(text, retries - 1);
        }

        throw timeoutError;
      }
      // Retry on transient errors
      if (retries > 0) {
        const isRetryable =
          error.message.includes("429") ||
          error.message.includes("503") ||
          error.message.includes("ECONNRESET") ||
          error.message.includes("ETIMEDOUT");

        if (isRetryable) {
          console.log(
            `⚠️  Voice clone failed, retrying in 2s... (${retries} retries left)`
          );
          await new Promise((r) => setTimeout(r, 2000));
          return this.synthesize(text, retries - 1);
        }
      }

      throw error;
    }
  }

  /**
   * Convert MP3 buffer to PCM16 24kHz mono using ffmpeg
   * @param {Buffer} mp3Buffer - Input MP3 data
   * @returns {Promise<Buffer>} - PCM16 buffer
   */
  async _convertToPCM16(mp3Buffer) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          "pipe:0", // Input from stdin
          "-f",
          "s16le", // Output format: signed 16-bit little-endian
          "-acodec",
          "pcm_s16le", // PCM codec
          "-ar",
          String(this.sampleRate), // Sample rate: 24kHz
          "-ac",
          String(this.channels), // Channels: mono
          "pipe:1", // Output to stdout
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      const chunks = [];
      let stderrData = "";

      ffmpeg.stdout.on("data", (chunk) => {
        chunks.push(chunk);
      });

      ffmpeg.stderr.on("data", (data) => {
        stderrData += data.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(
            new Error(`ffmpeg conversion failed (code ${code}): ${stderrData}`)
          );
        }
      });

      ffmpeg.on("error", (err) => {
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });

      // Write MP3 data to ffmpeg stdin and close it
      ffmpeg.stdin.on("error", (err) => {
        // Ignore EPIPE errors - ffmpeg may close stdin early
        if (err.code !== "EPIPE") {
          console.error("ffmpeg stdin error:", err.message);
        }
      });

      ffmpeg.stdin.write(mp3Buffer);
      ffmpeg.stdin.end();
    });
  }

  /**
   * Get audio format information
   * @returns {Object} - Audio format details
   */
  getFormat() {
    return {
      sampleRate: this.sampleRate,
      channels: this.channels,
      bitsPerSample: this.bitsPerSample,
      encoding: "pcm_s16le",
    };
  }
}

export default XAITTSClonePlugin;
