/**
 * Custom XAI TTS Plugin for LiveKit Agents
 * Implements streaming text-to-speech using XAI's realtime audio API
 */

import WebSocket from "ws";
import { EventEmitter } from "events";

export class XAITTSPlugin extends EventEmitter {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.XAI_API_KEY;
    this.baseUrl =
      config.baseUrl || process.env.XAI_BASE_URL || "https://api.x.ai/v1";
    this.voiceId = config.voiceId || process.env.VOICE_ID || "ara";
    this.sampleRate = 24000; // XAI TTS outputs 24kHz
    this.channels = 1; // mono
    this.bitsPerSample = 16; // s16le
    this.connectionTimeout = config.connectionTimeout || 10000; // 10s connection timeout
    this.responseTimeout = config.responseTimeout || 35000; // 35s total response timeout
  }

  /**
   * Convert text to speech using XAI's streaming TTS
   * @param {string} text - Text to convert to speech
   * @param {number} retries - Number of retries on failure
   * @returns {Promise<Buffer>} - Audio buffer (PCM16)
   */
  async synthesize(text, retries = 5) {
    return new Promise((resolve, reject) => {
      const audioChunks = [];
      const wsBase = this.baseUrl
        .replace("https://", "wss://")
        .replace("http://", "ws://");
      const wsUri = `${wsBase}/realtime/audio/speech`;

      const ws = new WebSocket(wsUri, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      let connectionOpened = false;
      let resolved = false;

      // Connection timeout - if WebSocket doesn't open in time
      const connectionTimeout = setTimeout(() => {
        if (!connectionOpened && !resolved) {
          resolved = true;
          ws.close();
          reject(
            new Error(
              `TTS WebSocket connection timeout (${this.connectionTimeout}ms)`
            )
          );
        }
      }, this.connectionTimeout);

      // Response timeout - if we don't get complete audio in time
      const responseTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ws.close();
          if (audioChunks.length > 0) {
            console.warn(
              `⚠️  TTS response timeout, returning partial audio (${audioChunks.length} chunks)`
            );
            resolve(Buffer.concat(audioChunks));
          } else {
            reject(
              new Error(
                `TTS response timeout (${this.responseTimeout}ms) - no audio received`
              )
            );
          }
        }
      }, this.responseTimeout);

      const cleanup = () => {
        clearTimeout(connectionTimeout);
        clearTimeout(responseTimeout);
      };

      ws.on("open", () => {
        connectionOpened = true;
        clearTimeout(connectionTimeout); // Clear connection timeout on success

        // Send config
        const configMsg = {
          type: "config",
          data: {
            voice_id: this.voiceId,
          },
        };
        ws.send(JSON.stringify(configMsg));

        // Small delay before sending text (some APIs need this)
        setTimeout(() => {
          // Send text
          const textMsg = {
            type: "text_chunk",
            data: {
              text: text,
              is_last: true,
            },
          };
          ws.send(JSON.stringify(textMsg));
        }, 100);
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());

          // XAI response structure: message.data.data.audio
          const audioB64 = message?.data?.data?.audio;
          const isLast = message?.data?.data?.is_last;

          // Add audio chunk if present (last message may have empty audio)
          if (audioB64 && audioB64.length > 0) {
            const audioBuffer = Buffer.from(audioB64, "base64");
            audioChunks.push(audioBuffer);
          }

          // Check if this is the last chunk
          if (isLast) {
            cleanup();
            ws.close();
            if (!resolved) {
              resolved = true;
              resolve(Buffer.concat(audioChunks));
            }
          }
        } catch (err) {
          cleanup();
          if (!resolved) {
            resolved = true;
            reject(new Error(`Failed to parse TTS message: ${err.message}`));
          }
        }
      });

      ws.on("error", (err) => {
        cleanup();
        if (!resolved) {
          resolved = true;
          reject(new Error(`XAI TTS WebSocket error: ${err.message}`));
        }
      });

      ws.on("close", async (code, reason) => {
        cleanup();
        if (!resolved) {
          if (audioChunks.length > 0) {
            // Got some audio but connection closed before is_last
            resolved = true;
            resolve(Buffer.concat(audioChunks));
          } else {
            resolved = true;
            const reasonText = reason ? reason.toString() : "none";

            // Retry on rate limit (code 1006)
            if (code === 1006 && retries > 0) {
              console.log(
                `⚠️  Rate limit hit, retrying in 2s... (${retries} retries left)`
              );
              await new Promise((r) => setTimeout(r, 2000));
              try {
                const result = await this.synthesize(text, retries - 1);
                resolve(result);
              } catch (err) {
                reject(err);
              }
            } else {
              const errorMsg = connectionOpened
                ? `TTS connection closed without audio. Code: ${code}, Reason: ${reasonText}. Text length: ${text.length} chars.`
                : `TTS connection failed to open. Code: ${code}, Reason: ${reasonText}. Check your XAI_API_KEY.`;
              reject(new Error(errorMsg));
            }
          }
        }
      });
    });
  }

  /**
   * Stream text to speech in real-time
   * @param {string} text - Text to convert
   * @returns {AsyncGenerator<Buffer>} - Stream of audio chunks
   */
  async *streamSynthesize(text) {
    const wsBase = this.baseUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");
    const wsUri = `${wsBase}/realtime/audio/speech`;

    const ws = new WebSocket(wsUri, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    const audioQueue = [];
    let isComplete = false;
    let error = null;

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "config",
          data: {
            voice_id: this.voiceId,
          },
        })
      );

      ws.send(
        JSON.stringify({
          type: "text_chunk",
          data: {
            text: text,
            is_last: true,
          },
        })
      );
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const audioB64 = message?.data?.data?.audio;
        const isLast = message?.data?.data?.is_last;

        if (audioB64) {
          const audioBuffer = Buffer.from(audioB64, "base64");
          audioQueue.push(audioBuffer);
        }

        if (isLast) {
          isComplete = true;
          ws.close();
        }
      } catch (err) {
        error = err;
        ws.close();
      }
    });

    ws.on("error", (err) => {
      error = err;
    });

    // Yield audio chunks as they arrive
    while (!isComplete && !error) {
      if (audioQueue.length > 0) {
        yield audioQueue.shift();
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    // Yield remaining chunks
    while (audioQueue.length > 0) {
      yield audioQueue.shift();
    }

    if (error) {
      throw new Error(`XAI TTS streaming error: ${error.message}`);
    }
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

export default XAITTSPlugin;
