/**
 * XAI TTS Plugin for LiveKit Agents
 * Streaming text-to-speech using XAI's realtime audio WebSocket API
 * Outputs AudioFrame objects compatible with LiveKit's AudioSource
 */

import WebSocket from "ws";
import { AudioFrame } from "@livekit/rtc-node";

// XAI TTS outputs 24kHz mono 16-bit PCM
const TTS_SAMPLE_RATE = 24000;
const TTS_CHANNELS = 1;

export class XAIStreamingTTS {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.XAI_API_KEY;
    this.baseUrl =
      config.baseUrl || process.env.XAI_BASE_URL || "https://api.x.ai/v1";
    this.voiceId = config.voiceId || "ara";
    this.sampleRate = TTS_SAMPLE_RATE;
    this.channels = TTS_CHANNELS;
  }

  /**
   * Get the WebSocket URI for TTS
   */
  getWsUri() {
    const wsBase = this.baseUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");
    return `${wsBase}/realtime/audio/speech`;
  }

  /**
   * Synthesize text to speech and yield AudioFrame objects
   * @param {string} text - Text to convert to speech
   * @yields {AudioFrame} - Audio frames for LiveKit
   */
  async *synthesizeStream(text) {
    const wsUri = this.getWsUri();

    // Create a promise-based queue for audio chunks
    const audioQueue = [];
    let resolveWaiting = null;
    let isComplete = false;
    let error = null;

    const ws = new WebSocket(wsUri, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    ws.on("open", () => {
      console.log("✅ Connected to XAI streaming TTS");

      // Send config
      ws.send(
        JSON.stringify({
          type: "config",
          data: { voice_id: this.voiceId },
        })
      );

      // Send text
      ws.send(
        JSON.stringify({
          type: "text_chunk",
          data: { text, is_last: true },
        })
      );
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const audioB64 = message?.data?.data?.audio;
        const isLast = message?.data?.data?.is_last;

        if (audioB64 && audioB64.length > 0) {
          // Convert base64 to Int16Array
          const audioBuffer = Buffer.from(audioB64, "base64");
          const totalSamples = audioBuffer.length / 2;

          // Create Int16Array and copy data
          const int16Data = new Int16Array(totalSamples);
          for (let i = 0; i < totalSamples; i++) {
            int16Data[i] = audioBuffer.readInt16LE(i * 2);
          }

          // Create AudioFrame
          const frame = new AudioFrame(
            int16Data,
            TTS_SAMPLE_RATE,
            TTS_CHANNELS,
            totalSamples
          );

          audioQueue.push(frame);

          // Wake up the generator if it's waiting
          if (resolveWaiting) {
            resolveWaiting();
            resolveWaiting = null;
          }
        }

        if (isLast) {
          isComplete = true;
          ws.close();
          if (resolveWaiting) {
            resolveWaiting();
            resolveWaiting = null;
          }
        }
      } catch (err) {
        error = err;
        ws.close();
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      }
    });

    ws.on("error", (err) => {
      console.error("XAI TTS WebSocket error:", err.message || err);
      error = err;
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    });

    ws.on("close", () => {
      isComplete = true;
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    });

    // Yield audio frames as they arrive
    while (!isComplete || audioQueue.length > 0) {
      if (audioQueue.length > 0) {
        yield audioQueue.shift();
      } else if (!isComplete) {
        // Wait for more data
        await new Promise((resolve) => {
          resolveWaiting = resolve;
        });
      }
    }

    if (error) {
      throw new Error(`XAI TTS error: ${error.message}`);
    }
  }

  /**
   * Synthesize text and return complete audio as a single AudioFrame
   * (Useful for shorter phrases)
   * @param {string} text - Text to convert
   * @returns {Promise<AudioFrame>} - Complete audio frame
   */
  async synthesize(text) {
    const frames = [];
    for await (const frame of this.synthesizeStream(text)) {
      frames.push(frame);
    }

    if (frames.length === 0) {
      throw new Error("No audio received from TTS");
    }

    if (frames.length === 1) {
      return frames[0];
    }

    // Combine all frames into one
    const totalSamples = frames.reduce(
      (sum, f) => sum + f.samplesPerChannel,
      0
    );
    const combinedData = new Int16Array(totalSamples);

    let offset = 0;
    for (const frame of frames) {
      combinedData.set(new Int16Array(frame.data.buffer), offset);
      offset += frame.samplesPerChannel;
    }

    return new AudioFrame(
      combinedData,
      TTS_SAMPLE_RATE,
      TTS_CHANNELS,
      totalSamples
    );
  }
}

export default XAIStreamingTTS;
