/**
 * Twilio Voice Integration Server
 * Routes incoming phone calls to the AI podcast stream
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';

dotenv.config();

// Voice Activity Detection parameters
const VAD_THRESHOLD = 500; // RMS threshold for speech detection
const SPEECH_START_FRAMES = 3; // Frames above threshold to start speech
const SPEECH_END_FRAMES = 10; // Frames below threshold to end speech
const MIN_SPEECH_DURATION = 500; // Minimum speech duration in ms

const app = express();
const PORT = process.env.TWILIO_SERVER_PORT || 3001;

// Store active call connections
const activeConnections = new Map();

// Event emitter for caller speech
const callerEvents = new EventEmitter();

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/**
 * Twilio webhook for incoming calls
 * Returns TwiML to connect the call to our WebSocket stream
 */
app.post('/voice', (req, res) => {
  console.log('📞 Incoming call from:', req.body.From);
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Welcome to the A I podcast. You can speak anytime to join the conversation.</Say>
  <Connect>
    <Stream url="wss://${req.headers.host}/media-stream">
      <Parameter name="From" value="${req.body.From}" />
    </Stream>
  </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

/**
 * Status callback for call events
 */
app.post('/status', (req, res) => {
  console.log('📊 Call status:', req.body.CallStatus, 'for', req.body.CallSid);
  res.sendStatus(200);
});

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`🎙️  Twilio server listening on port ${PORT}`);
  console.log(`📞 Webhook URL: http://localhost:${PORT}/voice`);
  console.log(`\n⚠️  Make sure to expose this with ngrok:`);
  console.log(`   ngrok http ${PORT}`);
  console.log(`   Then configure your Twilio number to use: https://YOUR-NGROK-URL/voice\n`);
});

// WebSocket server for media streams
const wss = new WebSocketServer({ server, path: '/media-stream' });

wss.on('connection', (ws) => {
  console.log('🔌 New WebSocket connection');
  
  let streamSid = null;
  let callSid = null;
  
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      
      switch (msg.event) {
        case 'start':
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;
          const callerNumber = msg.start.customParameters?.From || 'Unknown';
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
            callerNumber
          });
          
          // Notify orchestrator about new caller
          if (global.podcastOrchestrator) {
            global.podcastOrchestrator.regularNews(
              `A new caller just joined the podcast!`
            );
          }
          break;
          
        case 'media':
          // Incoming audio from caller (base64 encoded mulaw)
          if (streamSid && activeConnections.has(streamSid)) {
            const connection = activeConnections.get(streamSid);
            const mulawData = Buffer.from(msg.media.payload, 'base64');
            
            // Convert mulaw to PCM for processing
            const pcmData = mulawToPcm(mulawData);
            
            // Voice Activity Detection
            const rms = calculateRMS(pcmData);
            const isSpeech = rms > VAD_THRESHOLD;
            
            if (isSpeech) {
              connection.speechFrames++;
              connection.silentFrames = 0;
              
              // Start of speech
              if (!connection.isSpeaking && connection.speechFrames >= SPEECH_START_FRAMES) {
                connection.isSpeaking = true;
                connection.speechStartTime = Date.now();
                connection.speechBuffer = [];
                console.log(`🎤 Caller ${connection.callerNumber} started speaking`);
                
                // Interrupt podcast
                if (global.podcastOrchestrator?.currentSpeaker) {
                  global.podcastOrchestrator.currentSpeaker.interrupt(global.podcastOrchestrator);
                }
              }
              
              // Collect speech audio
              if (connection.isSpeaking) {
                connection.speechBuffer.push(pcmData);
                
                // Also broadcast caller audio to Twitch/local
                broadcastCallerAudio(pcmData);
              }
            } else {
              connection.silentFrames++;
              connection.speechFrames = 0;
              
              // End of speech
              if (connection.isSpeaking && connection.silentFrames >= SPEECH_END_FRAMES) {
                const duration = Date.now() - connection.speechStartTime;
                
                if (duration >= MIN_SPEECH_DURATION) {
                  console.log(`🎤 Caller ${connection.callerNumber} finished speaking (${duration}ms)`);
                  
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
          
        case 'stop':
          console.log(`🛑 Stream stopped: ${streamSid}`);
          activeConnections.delete(streamSid);
          break;
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket closed');
    if (streamSid) {
      activeConnections.delete(streamSid);
    }
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
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
  const base64Audio = mulawAudio.toString('base64');
  
  // Send to all active calls
  for (const [streamSid, connection] of activeConnections) {
    if (connection.ws.readyState === 1) { // OPEN
      connection.ws.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: {
          payload: base64Audio
        }
      }));
    }
  }
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
  const MULAW_MAX = 0x1FFF;
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
  
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulaw = ~(sign | (exponent << 4) | mantissa);
  
  return mulaw & 0xFF;
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
  const mantissa = mulaw & 0x0F;
  
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
 * Uses linear interpolation for better quality upsampling
 */
function broadcastCallerAudio(pcmBuffer) {
  // Upsample from 8kHz to 24kHz (3x) with linear interpolation
  const inputSamples = pcmBuffer.length / 2;
  const outputSamples = inputSamples * 3;
  const upsampled = Buffer.alloc(outputSamples * 2);
  
  for (let i = 0; i < inputSamples; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    const nextSample = (i + 1 < inputSamples) 
      ? pcmBuffer.readInt16LE((i + 1) * 2) 
      : sample;
    
    const outIdx = i * 6; // 3 output samples per input, 2 bytes each
    
    // Linear interpolation: sample, sample + 1/3 diff, sample + 2/3 diff
    const diff = nextSample - sample;
    upsampled.writeInt16LE(sample, outIdx);
    upsampled.writeInt16LE(Math.round(sample + diff / 3), outIdx + 2);
    upsampled.writeInt16LE(Math.round(sample + (diff * 2) / 3), outIdx + 4);
  }
  
  // Apply a simple low-pass filter to reduce aliasing artifacts
  const filtered = applyLowPassFilter(upsampled);
  
  // Boost volume slightly (phone audio tends to be quiet)
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
 * Simple low-pass filter to smooth upsampled audio
 */
function applyLowPassFilter(pcmBuffer) {
  const output = Buffer.alloc(pcmBuffer.length);
  const samples = pcmBuffer.length / 2;
  
  // Simple 3-tap moving average filter
  for (let i = 0; i < samples; i++) {
    const prev = i > 0 ? pcmBuffer.readInt16LE((i - 1) * 2) : 0;
    const curr = pcmBuffer.readInt16LE(i * 2);
    const next = i < samples - 1 ? pcmBuffer.readInt16LE((i + 1) * 2) : 0;
    
    // Weighted average: 0.25 * prev + 0.5 * curr + 0.25 * next
    const filtered = Math.round(prev * 0.25 + curr * 0.5 + next * 0.25);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, filtered)), i * 2);
  }
  
  return output;
}

/**
 * Boost audio volume
 */
function boostVolume(pcmBuffer, gain) {
  const output = Buffer.alloc(pcmBuffer.length);
  const samples = pcmBuffer.length / 2;
  
  for (let i = 0; i < samples; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    const boosted = Math.round(sample * gain);
    // Clamp to prevent clipping
    output.writeInt16LE(Math.max(-32768, Math.min(32767, boosted)), i * 2);
  }
  
  return output;
}

/**
 * Process caller speech - transcribe and inject into podcast
 * Input: 8kHz PCM from Twilio
 */
async function processCallerSpeech(pcmBuffer, callerNumber) {
  try {
    // Upsample from 8kHz to 16kHz for XAI STT (double each sample)
    const upsampled = Buffer.alloc(pcmBuffer.length * 2);
    for (let i = 0; i < pcmBuffer.length; i += 2) {
      const sample = pcmBuffer.readInt16LE(i);
      const outIdx = i * 2;
      upsampled.writeInt16LE(sample, outIdx);
      upsampled.writeInt16LE(sample, outIdx + 2);
    }
    
    // Transcribe using XAI (expects 16kHz)
    const transcription = await transcribeAudio(upsampled);
    
    if (transcription && transcription.trim()) {
      console.log(`📝 Caller said: "${transcription}"`);
      
      // Inject as user input to podcast
      if (global.podcastOrchestrator) {
        global.podcastOrchestrator.userInput = `[CALLER ${callerNumber}]: ${transcription}`;
      }
    }
  } catch (err) {
    console.error('Error processing caller speech:', err.message);
  }
}

/**
 * Transcribe audio using XAI streaming WebSocket API
 * Audio format: PCM linear16, 16kHz, mono
 */
async function transcribeAudio(pcmBuffer) {
  try {
    const baseUrl = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
    const wsUrl = baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    const uri = `${wsUrl}/realtime/audio/transcriptions`;
    
    const { default: WS } = await import('ws');
    
    return new Promise((resolve) => {
      const ws = new WS(uri, {
        headers: {
          'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        },
      });
      
      let transcript = '';
      let timeout;
      
      ws.on('open', () => {
        // Send config message - XAI expects 16kHz
        ws.send(JSON.stringify({
          type: 'config',
          data: {
            encoding: 'linear16',
            sample_rate_hertz: 16000,
            enable_interim_results: false,
          },
        }));
        
        // Audio is already 16kHz, send directly in chunks
        const chunkSize = 3200; // 100ms at 16kHz, 16-bit
        for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
          const chunk = pcmBuffer.slice(i, i + chunkSize);
          ws.send(JSON.stringify({
            type: 'audio',
            data: {
              audio: chunk.toString('base64'),
            },
          }));
        }
        
        // Send end of audio signal
        ws.send(JSON.stringify({ type: 'audio_end' }));
        
        // Timeout after 5 seconds
        timeout = setTimeout(() => {
          ws.close();
          resolve(transcript || null);
        }, 5000);
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.data?.type === 'speech_recognized') {
            const { transcript: text, is_final } = message.data.data;
            if (is_final && text) {
              transcript += text + ' ';
            }
          }
        } catch (err) {
          // Ignore parse errors
        }
      });
      
      ws.on('close', () => {
        clearTimeout(timeout);
        resolve(transcript.trim() || null);
      });
      
      ws.on('error', (err) => {
        console.error('STT WebSocket error:', err.message);
        clearTimeout(timeout);
        resolve(null);
      });
    });
  } catch (err) {
    console.error('Transcription error:', err.message);
    return null;
  }
}

// Export for use in main app
export { activeConnections };

console.log('✅ Twilio integration ready');
