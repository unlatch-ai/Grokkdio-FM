/**
 * Twilio-LiveKit Bridge
 * Connects incoming Twilio calls directly to LiveKit room
 * This way Twilio gets ALL audio (agents, music, everything)
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { Room, RoomEvent } from '@livekit/rtc-node';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.TWILIO_SERVER_PORT || 3001;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Store active bridges (Twilio call <-> LiveKit room)
const activeBridges = new Map();

/**
 * Twilio webhook - returns TwiML to connect call to WebSocket
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

const server = app.listen(PORT, () => {
  console.log(`\n📞 Twilio-LiveKit Bridge listening on port ${PORT}`);
  console.log(`⚠️  Expose with: ngrok http ${PORT}\n`);
});

const wss = new WebSocketServer({ server, path: '/media-stream' });

wss.on('connection', async (ws) => {
  console.log('🔌 Twilio WebSocket connected');
  
  let streamSid = null;
  let callSid = null;
  let livekitRoom = null;
  let audioTrack = null;
  
  ws.on('message', async (message) => {
    const msg = JSON.parse(message);
    
    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      callSid = msg.start.callSid;
      const callerNumber = msg.start.customParameters?.From || 'Unknown';
      
      console.log(`🎬 Call started: ${streamSid} from ${callerNumber}`);
      
      // Connect to LiveKit room
      try {
        livekitRoom = new Room();
        
        // Subscribe to audio tracks
        livekitRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          console.log(`🎵 Subscribed to track from ${participant.identity}`);
          
          if (track.kind === 'audio') {
            audioTrack = track;
            
            // Stream LiveKit audio to Twilio
            track.on('audioFrame', (frame) => {
              // Convert LiveKit audio to Twilio format
              const twilioAudio = convertToTwilioFormat(frame.data);
              
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  event: 'media',
                  streamSid,
                  media: {
                    payload: twilioAudio
                  }
                }));
              }
            });
          }
        });
        
        // Connect to room
        const url = process.env.LIVEKIT_URL || 'ws://localhost:7880';
        const token = await generateLivekitToken(callerNumber);
        
        await livekitRoom.connect(url, token);
        console.log(`✅ Connected to LiveKit room`);
        
        activeBridges.set(streamSid, {
          ws,
          livekitRoom,
          callerNumber
        });
        
      } catch (err) {
        console.error('❌ Failed to connect to LiveKit:', err.message);
      }
    }
    
    if (msg.event === 'media') {
      // Caller audio - send to LiveKit room
      if (livekitRoom) {
        const mulawData = Buffer.from(msg.media.payload, 'base64');
        const pcmData = mulawToPcm(mulawData);
        
        // TODO: Publish caller audio to LiveKit room
        // This requires creating an audio source and publishing it
      }
    }
    
    if (msg.event === 'stop') {
      console.log(`🛑 Call ended: ${streamSid}`);
      
      if (livekitRoom) {
        await livekitRoom.disconnect();
      }
      
      activeBridges.delete(streamSid);
    }
  });
  
  ws.on('close', async () => {
    console.log('🔌 WebSocket closed');
    
    if (livekitRoom) {
      await livekitRoom.disconnect();
    }
    
    if (streamSid) {
      activeBridges.delete(streamSid);
    }
  });
});

/**
 * Generate LiveKit access token for caller
 */
async function generateLivekitToken(callerIdentity) {
  const { AccessToken } = await import('livekit-server-sdk');
  
  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: `caller-${callerIdentity}`,
      name: `Caller ${callerIdentity}`,
    }
  );
  
  token.addGrant({
    room: 'podcast-room',
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });
  
  return token.toJwt();
}

/**
 * Convert LiveKit audio frame to Twilio mulaw format
 */
function convertToTwilioFormat(pcmBuffer) {
  // LiveKit typically sends 48kHz PCM
  // Need to downsample to 8kHz and convert to mulaw
  const downsampled = downsample48to8(pcmBuffer);
  const mulaw = pcmToMulaw(downsampled);
  return mulaw.toString('base64');
}

/**
 * Downsample from 48kHz to 8kHz
 */
function downsample48to8(pcmBuffer) {
  // 48kHz to 8kHz = 6:1 ratio
  const inputSamples = pcmBuffer.length / 2;
  const outputSamples = Math.floor(inputSamples / 6);
  const output = Buffer.alloc(outputSamples * 2);
  
  for (let i = 0, o = 0; o < outputSamples; i += 6, o++) {
    if (i * 2 < pcmBuffer.length) {
      output.writeInt16LE(pcmBuffer.readInt16LE(i * 2), o * 2);
    }
  }
  
  return output;
}

/**
 * PCM to mulaw conversion
 */
function pcmToMulaw(pcmBuffer) {
  const output = Buffer.alloc(pcmBuffer.length / 2);
  
  for (let i = 0; i < pcmBuffer.length; i += 2) {
    const sample = pcmBuffer.readInt16LE(i);
    output[i / 2] = linearToMulaw(sample);
  }
  
  return output;
}

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
 * Mulaw to PCM conversion
 */
function mulawToPcm(mulawBuffer) {
  const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);
  
  for (let i = 0; i < mulawBuffer.length; i++) {
    const sample = mulawToLinear(mulawBuffer[i]);
    pcmBuffer.writeInt16LE(sample, i * 2);
  }
  
  return pcmBuffer;
}

function mulawToLinear(mulaw) {
  mulaw = ~mulaw;
  const sign = mulaw & 0x80;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0F;
  
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample = sample - 0x84;
  
  return sign ? -sample : sample;
}

console.log('✅ Twilio-LiveKit bridge ready');
