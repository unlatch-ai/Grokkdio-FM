# Bidirectional Audio Implementation

## What's New

Your Twilio integration now supports **full bidirectional audio**:

✅ **Callers can speak** and their voice is heard on Twitch/local stream  
✅ **Automatic transcription** of caller speech using XAI Whisper  
✅ **Podcast interruption** - when caller speaks, current speaker stops  
✅ **AI responses** - agents respond to caller input naturally  
✅ **Multiple callers** - all supported simultaneously  

## How It Works

### 1. Voice Activity Detection (VAD)
```javascript
// Monitors RMS (Root Mean Square) of incoming audio
// Threshold: 500
// Start: 3 consecutive frames above threshold
// End: 10 consecutive frames below threshold
```

### 2. Audio Flow

**When caller speaks:**
```
Phone (8kHz mulaw) 
  → WebSocket
  → Convert to PCM
  → VAD Detection
  ├─→ Broadcast to Twitch (upsampled to 24kHz)
  └─→ Transcribe with XAI Whisper
      → Inject as user input
      → AI agents respond
```

### 3. Interruption System

```javascript
// When speech detected:
if (global.podcastOrchestrator?.currentSpeaker) {
  // Interrupt whoever is speaking
  global.podcastOrchestrator.currentSpeaker.interrupt();
}

// Inject transcription
global.podcastOrchestrator.userInput = `[CALLER ${number}]: ${text}`;
```

## Console Output

When a caller speaks, you'll see:
```
🎤 Caller +1234567890 started speaking
🎤 Caller +1234567890 finished speaking (1250ms)
📝 Caller said: "Hey, what do you think about AI safety?"
```

Then the agents will respond naturally to the caller's question.

## Audio Quality

- **Podcast → Caller**: 24kHz → 8kHz (phone quality)
- **Caller → Twitch**: 8kHz → 24kHz (upsampled)
- **Transcription**: Uses full quality for better accuracy

## Configuration

Adjust VAD sensitivity in `twilio-server.js`:

```javascript
const VAD_THRESHOLD = 500;        // Lower = more sensitive
const SPEECH_START_FRAMES = 3;    // Frames to confirm speech start
const SPEECH_END_FRAMES = 10;     // Frames to confirm speech end
const MIN_SPEECH_DURATION = 500;  // Minimum ms to process
```

## Testing

1. Start: `npm run twitch-twilio`
2. Call your Twilio number
3. Listen to the podcast
4. **Say something** - you'll hear yourself on the stream
5. Wait a moment - the AI will respond to you
6. The conversation continues naturally

## Technical Details

### Audio Conversion

**Mulaw → PCM (for processing)**
```javascript
function mulawToPcm(mulawBuffer) {
  // Converts 8-bit mulaw to 16-bit PCM
  // Used for VAD and transcription
}
```

**PCM → Mulaw (for phone)**
```javascript
function pcmToMulaw(pcmBuffer) {
  // Converts 24kHz PCM to 8kHz mulaw
  // Downsamples by factor of 3
}
```

**Upsampling (for broadcast)**
```javascript
// 8kHz → 24kHz by repeating samples
// Simple but effective for voice
```

### XAI Transcription

```javascript
POST https://api.x.ai/v1/audio/transcriptions
{
  "audio": "<base64 PCM>",
  "model": "whisper-1",
  "language": "en"
}
```

## Limitations

- Phone audio is 8kHz (Twilio limitation)
- Upsampling doesn't add real frequency content
- Transcription requires XAI API key
- VAD is simple RMS-based (could use more advanced ML models)

## Future Enhancements

- [ ] Better VAD using WebRTC VAD or ML models
- [ ] Speaker diarization for multiple callers
- [ ] Real-time echo cancellation
- [ ] Caller audio mixing (multiple callers talking)
- [ ] DTMF tone detection for interactive menus
