/**
 * Twilio Voice Integration Server
 * Routes incoming phone calls to the AI podcast stream
 */

import express from "express";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { EventEmitter } from "events";
import { spawn } from "child_process";
import path from "path";

dotenv.config();

// Voice Activity Detection parameters
const VAD_THRESHOLD = 400; // RMS threshold for speech detection (lower = more sensitive)
const SPEECH_START_FRAMES = 3; // Frames above threshold to start speech
const SPEECH_END_FRAMES = 50; // Frames below threshold to end speech
const MIN_SPEECH_DURATION = 500; // Minimum speech duration in ms

const app = express();
const PORT = process.env.TWILIO_SERVER_PORT || 3001;

// Store active call connections
const activeConnections = new Map();

// Event emitter for caller speech
const callerEvents = new EventEmitter();

// Track if we've sent initial audio
let hasStartedStreaming = false;

// Audio paths for call events
const DIAL_IN_AUDIO = path.join(process.cwd(), 'media', 'dial_in.mp3');
const HANG_UP_AUDIO = path.join(process.cwd(), 'media', 'hang_up.mp3');

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/**
 * Twilio webhook for incoming calls
 * Returns TwiML to connect the call to our WebSocket stream
 */
app.post("/voice", (req, res) => {
  console.log("📞 Incoming call from:", req.body.From);

  // Use Twilio's Media Stream with built-in transcription
  // transcriptionTrack="inbound_track" enables real-time STT on caller audio
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Welcome to the A I podcast. You can speak anytime to join the conversation.</Say>
  <Connect>
    <Stream url="wss://${req.headers.host}/media-stream">
      <Parameter name="From" value="${req.body.From}" />
      <Transcription track="inbound_track" statusCallbackUrl="https://${req.headers.host}/transcription" />
    </Stream>
  </Connect>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

/**
 * Twilio Transcription webhook
 * Called when Twilio's real-time transcription produces results
 */
app.post("/transcription", (req, res) => {
  const event = req.body.TranscriptionEvent;
  const text = req.body.TranscriptionText;
  const trackName = req.body.Track;

  // Log all transcription events
  console.log(`🎙️ Twilio transcription event: ${event}`);

  if (event === "transcription-content" && text && text.trim()) {
    console.log(`📝 Twilio STT: "${text}"`);

    // Get caller number from active connections
    let callerNumber = "Unknown";
    for (const [, conn] of activeConnections) {
      if (conn.callerNumber) {
        callerNumber = conn.callerNumber;
        break;
      }
    }

    // Inject into podcast - fire and forget, don't block
    if (global.podcastOrchestrator) {
      global.podcastOrchestrator.userInput = `[CALLER ${callerNumber}]: ${text}`;
    }
  }

  res.sendStatus(200);
});

/**
 * Status callback for call events
 */
app.post("/status", (req, res) => {
  console.log("📊 Call status:", req.body.CallStatus, "for", req.body.CallSid);
  res.sendStatus(200);
});

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`🎙️  Twilio server listening on port ${PORT}`);
  console.log(`📞 Webhook URL: http://localhost:${PORT}/voice`);
  console.log(`\n⚠️  Make sure to expose this with ngrok:`);
  console.log(`   ngrok http ${PORT}`);
  console.log(
    `   Then configure your Twilio number to use: https://YOUR-NGROK-URL/voice\n`
  );
});

// WebSocket server for media streams
const wss = new WebSocketServer({ server, path: "/media-stream" });

wss.on("connection", (ws) => {
  console.log("🔌 New WebSocket connection");

  let streamSid = null;
  let callSid = null;

  ws.on("message", (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case "start":
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;
          const callerNumber = msg.start.customParameters?.From || "Unknown";
          console.log(`🎬 Stream started: ${streamSid} from ${callerNumber}`);

          // Store connection with speech detection state
          activeConnections.set(streamSid, {
            ws,
            callSid,
            audioBuffer: [],
            speechBuffer: [],
            isSpeaking: false,
            speechStartTime: null,
            silentFrames: 0,
            speechFrames: 0,
            callerNumber,
          });

          // Send initial silence to establish stream
          const initialSilence = Buffer.alloc(960); // 20ms at 24kHz
          sendAudioToTwilioCalls(initialSilence);

          // Play dial-in sound on stream
          playAudioOnStream(DIAL_IN_AUDIO);

          // Notify orchestrator about new caller
          if (global.podcastOrchestrator) {
            global.podcastOrchestrator.regularNews(
              `A new caller just joined the podcast!`
            );
          }
          break;

        case "media":
          // Incoming audio from caller (base64 encoded mulaw)
          if (streamSid && activeConnections.has(streamSid)) {
            const connection = activeConnections.get(streamSid);
            const mulawData = Buffer.from(msg.media.payload, "base64");

            // Convert mulaw to PCM for processing
            const pcmData = mulawToPcm(mulawData);

            // Voice Activity Detection
            const rms = calculateRMS(pcmData);
            const isSpeech = rms > VAD_THRESHOLD;

            if (isSpeech) {
              connection.speechFrames++;
              connection.silentFrames = 0;

              // Start of speech
              if (
                !connection.isSpeaking &&
                connection.speechFrames >= SPEECH_START_FRAMES
              ) {
                connection.isSpeaking = true;
                connection.speechStartTime = Date.now();
                connection.speechBuffer = [];
                console.log(
                  `🎤 Caller ${connection.callerNumber} started speaking`
                );

                // Interrupt podcast
                if (global.podcastOrchestrator?.currentSpeaker) {
                  global.podcastOrchestrator.currentSpeaker.interrupt(
                    global.podcastOrchestrator
                  );
                }
              }

              // Collect speech audio (store raw mulaw for STT, PCM for broadcast)
              if (connection.isSpeaking) {
                connection.speechBuffer.push(mulawData); // Store mulaw for Realtime API

                // Also broadcast caller audio to Twitch/local (needs PCM)
                broadcastCallerAudio(pcmData);
              }
            } else {
              connection.silentFrames++;
              connection.speechFrames = 0;

              // End of speech
              if (
                connection.isSpeaking &&
                connection.silentFrames >= SPEECH_END_FRAMES
              ) {
                const duration = Date.now() - connection.speechStartTime;

                if (duration >= MIN_SPEECH_DURATION) {
                  console.log(
                    `🎤 Caller ${connection.callerNumber} finished speaking (${duration}ms)`
                  );

                  // Combine speech buffer
                  const fullSpeech = Buffer.concat(connection.speechBuffer);

                  // Transcribe and process
                  processCallerSpeech(fullSpeech, connection.callerNumber);
                }

                connection.isSpeaking = false;
                connection.speechBuffer = [];
              }
            }
          }
          break;

        case "stop":
          console.log(`🛑 Stream stopped: ${streamSid}`);
          if (activeConnections.has(streamSid)) {
            const connection = activeConnections.get(streamSid);
            const callerNumber = connection.callerNumber || "Unknown";
            console.log(`📞 Caller ${callerNumber} disconnected`);

            // Play hang-up sound on stream
            playAudioOnStream(HANG_UP_AUDIO);

            // Notify orchestrator about caller leaving
            if (global.podcastOrchestrator) {
              global.podcastOrchestrator.userInput = `[CALLER ${callerNumber} DISCONNECTED]: The caller has hung up and left the show.`;
              console.log(
                `📢 Notified orchestrator: Caller ${callerNumber} disconnected`
              );
            }

            activeConnections.delete(streamSid);
          }
          break;
      }
    } catch (err) {
      console.error("Error processing message:", err);
    }
  });

  ws.on("close", () => {
    console.log("🔌 WebSocket closed");
    // Cleanup any remaining connection (fallback if 'stop' wasn't received)
    if (streamSid && activeConnections.has(streamSid)) {
      activeConnections.delete(streamSid);
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

/**
 * Send audio to all connected Twilio calls
 * @param {Buffer} audioBuffer - PCM audio buffer (24kHz, 16-bit, mono)
 */
export function sendAudioToTwilioCalls(audioBuffer) {
  if (activeConnections.size === 0) return;

  // Convert PCM to mulaw for Twilio
  const mulawAudio = pcmToMulaw(audioBuffer);
  const base64Audio = mulawAudio.toString("base64");

  // Send to all active calls
  for (const [streamSid, connection] of activeConnections) {
    if (connection.ws.readyState === 1) {
      // OPEN
      connection.ws.send(
        JSON.stringify({
          event: "media",
          streamSid,
          media: {
            payload: base64Audio,
          },
        })
      );
    }
  }
}

/**
 * Queue audio for continuous streaming
 * @param {Buffer} audioBuffer - PCM audio buffer (24kHz, 16-bit, mono)
 */
export function queueAudioForTwilio(audioBuffer) {
  if (activeConnections.size === 0) return;

  // Send directly without buffering to avoid latency/corruption
  sendAudioToTwilioCalls(audioBuffer);
}

/**
 * Convert PCM to mulaw (simplified version)
 * Twilio expects 8kHz mulaw, so we also need to downsample from 24kHz
 */
function pcmToMulaw(pcmBuffer) {
  // Downsample from 24kHz to 8kHz (take every 3rd sample)
  const downsampled = Buffer.alloc(Math.floor(pcmBuffer.length / 6));

  for (let i = 0, j = 0; i < pcmBuffer.length - 1; i += 6, j++) {
    // Read 16-bit PCM sample
    const sample = pcmBuffer.readInt16LE(i);
    // Convert to mulaw
    downsampled[j] = linearToMulaw(sample);
  }

  return downsampled;
}

/**
 * Linear PCM to mulaw conversion
 */
function linearToMulaw(sample) {
  const MULAW_MAX = 0x1fff;
  const MULAW_BIAS = 33;

  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;

  sample = sample + MULAW_BIAS;
  let exponent = 7;
  let expMask = 0x4000;

  while ((sample & expMask) === 0 && exponent > 0) {
    exponent--;
    expMask >>= 1;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const mulaw = ~(sign | (exponent << 4) | mantissa);

  return mulaw & 0xff;
}

/**
 * Convert mulaw to PCM for processing
 */
function mulawToPcm(mulawBuffer) {
  const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);

  for (let i = 0; i < mulawBuffer.length; i++) {
    const mulaw = mulawBuffer[i];
    const sample = mulawToLinear(mulaw);
    pcmBuffer.writeInt16LE(sample, i * 2);
  }

  return pcmBuffer;
}

/**
 * Mulaw to linear PCM conversion
 */
function mulawToLinear(mulaw) {
  mulaw = ~mulaw;
  const sign = mulaw & 0x80;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0f;

  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample = sample - 0x84;

  return sign ? -sample : sample;
}

/**
 * Calculate RMS (Root Mean Square) for voice activity detection
 */
function calculateRMS(pcmBuffer) {
  let sum = 0;
  for (let i = 0; i < pcmBuffer.length; i += 2) {
    const sample = pcmBuffer.readInt16LE(i);
    sum += sample * sample;
  }
  return Math.sqrt(sum / (pcmBuffer.length / 2));
}

/**
 * Broadcast caller audio to Twitch/local streams
 * Uses cubic interpolation + strong low-pass filter for best quality
 */
function broadcastCallerAudio(pcmBuffer) {
  // Upsample from 8kHz to 24kHz using cubic interpolation
  const upsampled = upsampleCubic(pcmBuffer);

  // Apply strong low-pass filter to reduce artifacts
  const filtered = applyStrongLowPass(upsampled);

  // Boost volume (phone audio is quiet)
  const boosted = boostVolume(filtered, 1.5);

  // Send to local player and Twitch
  if (global.podcastOrchestrator) {
    if (global.podcastOrchestrator.localPlayer) {
      global.podcastOrchestrator.localPlayer.writeAudio(boosted);
    }
    if (global.podcastOrchestrator.twitchStreamer) {
      global.podcastOrchestrator.twitchStreamer.writeAudio(boosted);
    }
  }
}

/**
 * Cubic interpolation (Catmull-Rom spline) - high quality upsampling
 */
function upsampleCubic(pcmBuffer) {
  const inputSamples = pcmBuffer.length / 2;
  const output = Buffer.alloc(inputSamples * 6); // 3x, 2 bytes each

  for (let i = 0; i < inputSamples; i++) {
    const s0 =
      i > 0 ? pcmBuffer.readInt16LE((i - 1) * 2) : pcmBuffer.readInt16LE(0);
    const s1 = pcmBuffer.readInt16LE(i * 2);
    const s2 = i + 1 < inputSamples ? pcmBuffer.readInt16LE((i + 1) * 2) : s1;
    const s3 = i + 2 < inputSamples ? pcmBuffer.readInt16LE((i + 2) * 2) : s2;

    // Catmull-Rom spline interpolation
    for (let j = 0; j < 3; j++) {
      const t = j / 3;
      const t2 = t * t;
      const t3 = t2 * t;

      const sample =
        0.5 *
        (2 * s1 +
          (-s0 + s2) * t +
          (2 * s0 - 5 * s1 + 4 * s2 - s3) * t2 +
          (-s0 + 3 * s1 - 3 * s2 + s3) * t3);

      output.writeInt16LE(
        Math.max(-32768, Math.min(32767, Math.round(sample))),
        i * 6 + j * 2
      );
    }
  }
  return output;
}

/**
 * Strong 5-tap low-pass filter (Gaussian-like)
 */
function applyStrongLowPass(pcmBuffer) {
  const output = Buffer.alloc(pcmBuffer.length);
  const samples = pcmBuffer.length / 2;

  for (let i = 0; i < samples; i++) {
    const s_2 = i > 1 ? pcmBuffer.readInt16LE((i - 2) * 2) : 0;
    const s_1 = i > 0 ? pcmBuffer.readInt16LE((i - 1) * 2) : 0;
    const s0 = pcmBuffer.readInt16LE(i * 2);
    const s1 = i < samples - 1 ? pcmBuffer.readInt16LE((i + 1) * 2) : 0;
    const s2 = i < samples - 2 ? pcmBuffer.readInt16LE((i + 2) * 2) : 0;

    const filtered = Math.round(
      s_2 * 0.1 + s_1 * 0.2 + s0 * 0.4 + s1 * 0.2 + s2 * 0.1
    );
    output.writeInt16LE(Math.max(-32768, Math.min(32767, filtered)), i * 2);
  }
  return output;
}

/**
 * Boost audio volume with clipping protection
 */
function boostVolume(pcmBuffer, gain) {
  const output = Buffer.alloc(pcmBuffer.length);
  const samples = pcmBuffer.length / 2;

  for (let i = 0; i < samples; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    const boosted = Math.round(sample * gain);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, boosted)), i * 2);
  }
  return output;
}

/**
 * Process caller speech - transcribe and inject into podcast
 * Input: mulaw audio buffer from Twilio (base64 chunks collected)
 * Fire-and-forget - doesn't block the main flow
 */
function processCallerSpeech(mulawBuffer, callerNumber) {
  // Fire and forget - don't await
  transcribeAsync(mulawBuffer, callerNumber).catch((err) => {
    console.error("Error processing caller speech:", err.message);
  });
}

/**
 * Async transcription - runs in background
 */
async function transcribeAsync(mulawBuffer, callerNumber) {
  console.log(`🎙️ Transcribing ${mulawBuffer.length} bytes (async)...`);
  const transcription = await transcribeWithRealtimeAPI(mulawBuffer);

  if (transcription && transcription.trim()) {
    console.log(`📝 Caller ${callerNumber}: "${transcription}"`);

    // Inject as user input to podcast
    if (global.podcastOrchestrator) {
      global.podcastOrchestrator.userInput = `[CALLER ${callerNumber}]: ${transcription}`;
    }
  } else {
    console.log(`🎙️ No speech detected from ${callerNumber}`);
  }
}

/**
 * Transcribe audio using XAI Realtime API with native PCMU support
 * Based on telephony example - uses input_audio_buffer.append
 */
async function transcribeWithRealtimeAPI(mulawBuffer) {
  try {
    const apiUrl = process.env.XAI_BASE_URL || "https://api.x.ai/v1";
    const wsUrl = apiUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");
    const uri = `${wsUrl}/realtime`;

    const { default: WebSocket } = await import("ws");

    return new Promise((resolve) => {
      const ws = new WebSocket(uri, {
        headers: {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      let transcript = "";
      let timeout;
      let sessionConfigured = false;

      ws.on("open", () => {
        console.log("🎙️ Connected to XAI Realtime API");
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === "conversation.created") {
            // Send session config with PCMU format and transcription enabled
            ws.send(
              JSON.stringify({
                type: "session.update",
                session: {
                  audio: {
                    input: { format: { type: "audio/pcmu" } },
                    output: { format: { type: "audio/pcmu" } },
                  },
                  turn_detection: null, // Disable VAD - we handle it ourselves
                  input_audio_transcription: { model: "grok-2-public" }, // Enable transcription
                },
              })
            );
          } else if (message.type === "session.updated") {
            sessionConfigured = true;
            console.log("🎙️ Session configured, sending audio...");

            // Send audio in chunks (mulaw, 8kHz)
            const chunkSize = 160; // 20ms at 8kHz mulaw
            for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
              const chunk = mulawBuffer.slice(
                i,
                Math.min(i + chunkSize, mulawBuffer.length)
              );
              ws.send(
                JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: chunk.toString("base64"),
                })
              );
            }

            // Commit the audio buffer - this triggers transcription
            ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

            // DON'T request response.create - we only want transcription, not AI response
            // Wait for transcription to come back
            timeout = setTimeout(() => {
              ws.close();
              resolve(transcript || null);
            }, 3000);
          } else if (
            message.type ===
            "conversation.item.input_audio_transcription.completed"
          ) {
            // Got transcription!
            if (message.transcript) {
              transcript = message.transcript;
              console.log(`🎙️ Transcription: "${transcript}"`);
              clearTimeout(timeout);
              ws.close();
            }
          } else if (message.type === "input_audio_buffer.committed") {
            console.log("🎙️ Audio committed, waiting for transcription...");
          } else if (message.type === "error") {
            console.error(
              "🎙️ Realtime API error:",
              message.error?.message || JSON.stringify(message)
            );
          }
        } catch (err) {
          // Ignore parse errors
        }
      });

      ws.on("close", () => {
        clearTimeout(timeout);
        resolve(transcript.trim() || null);
      });

      ws.on("error", (err) => {
        console.error("🎙️ Realtime WebSocket error:", err.message);
        clearTimeout(timeout);
        resolve(null);
      });
    });
  } catch (err) {
    console.error("Transcription error:", err.message);
    return null;
  }
}

/**
 * Play an MP3 file on the stream (local preview + Twitch)
 * Uses ffmpeg to decode MP3 to raw PCM (24kHz, 16-bit, mono)
 * @param {string} audioPath - Path to the MP3 file
 */
function playAudioOnStream(audioPath) {
  if (!global.podcastOrchestrator) {
    console.warn('⚠️ Cannot play audio - orchestrator not ready');
    return;
  }

  const { localPlayer, twitchStreamer } = global.podcastOrchestrator;
  
  if (!localPlayer && !twitchStreamer) {
    console.warn('⚠️ Cannot play audio - no output available');
    return;
  }

  console.log(`🔊 Playing: ${path.basename(audioPath)}`);

  // Use ffmpeg to decode MP3 to raw PCM (24kHz, 16-bit, mono)
  const ffmpeg = spawn('ffmpeg', [
    '-i', audioPath,
    '-f', 's16le',
    '-ar', '24000',
    '-ac', '1',
    '-acodec', 'pcm_s16le',
    'pipe:1'
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  ffmpeg.stdout.on('data', (pcmData) => {
    // Write to both outputs
    if (localPlayer) {
      localPlayer.writeAudio(pcmData);
    }
    if (twitchStreamer) {
      twitchStreamer.writeAudio(pcmData);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('Error playing audio:', err.message);
  });

  ffmpeg.on('close', (code) => {
    if (code === 0) {
      console.log(`✅ Finished playing: ${path.basename(audioPath)}`);
    }
  });
}

/**
 * Twilio Audio Output Adapter
 * Implements the audio bus interface
 */
export const twilioOutput = {
  name: "Twilio",
  writeAudio: (audioBuffer) => {
    queueAudioForTwilio(audioBuffer);
  },
};

// Export for use in main app
export { activeConnections };

console.log("✅ Twilio integration ready");
