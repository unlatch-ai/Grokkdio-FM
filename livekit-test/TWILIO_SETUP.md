# Twilio + Twitch Integration

Stream your AI podcast to **both Twitch and phone callers** simultaneously.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# Enable Twilio integration
TWILIO_ENABLED=true
TWILIO_ACCOUNT_SID=AC64ce57a561dd17c16c71b020a10b0392
TWILIO_AUTH_TOKEN=73579c275bd745b959b546ce5d0f13d1
TWILIO_SERVER_PORT=3001

# Enable Twitch streaming
TWITCH_MODE=true
TWITCH_STREAM_KEY=your_stream_key_here
```

### 3. Expose Your Server with ngrok

Twilio needs a public URL to send webhooks. Use ngrok:

```bash
ngrok http 3001
```

You'll get a URL like: `https://abc123.ngrok.io`

### 4. Configure Your Twilio Phone Number

1. Go to [Twilio Console](https://console.twilio.com/)
2. Navigate to Phone Numbers → Manage → Active numbers
3. Click on your phone number
4. Under "Voice Configuration":
   - **A CALL COMES IN**: Webhook
   - **URL**: `https://YOUR-NGROK-URL/voice`
   - **HTTP**: POST
5. Save

### 5. Run the Podcast

```bash
npm run twitch-twilio
```

This will:
- ✅ Start the AI podcast
- ✅ Stream to Twitch
- ✅ Start Twilio webhook server on port 3001
- ✅ Route incoming phone calls to the podcast audio

## How It Works

### Bidirectional Audio Flow

1. **Incoming Call**: Someone calls your Twilio number
2. **Webhook**: Twilio hits `/voice` endpoint
3. **TwiML Response**: Server returns instructions to connect call to WebSocket
4. **Podcast → Caller**: AI podcast audio streams to caller (24kHz → 8kHz mulaw)
5. **Caller → Podcast**: 
   - Voice Activity Detection monitors caller speech
   - When caller speaks, podcast is interrupted
   - Caller audio is broadcast to Twitch/local
   - Speech is transcribed using XAI
   - Transcription injected into podcast as user input
   - AI agents respond to caller

## Architecture

```
AI Podcast (24kHz PCM)
    ├─→ Twitch Stream (RTMP)
    └─→ Twilio Calls (8kHz mulaw via WebSocket)
         ↓
    Caller Speech (8kHz mulaw)
         ↓
    [Voice Activity Detection]
         ↓
    [Broadcast to Twitch] + [Transcribe with XAI]
         ↓
    [Inject as User Input]
         ↓
    AI Agents Respond
```

## Testing

1. Start the server: `npm run twitch-twilio`
2. Call your Twilio number
3. You should hear: "Welcome to the AI podcast. You can speak anytime to join the conversation."
4. Listen to the live podcast audio
5. **Speak into your phone** - your voice will:
   - Interrupt the current speaker
   - Be broadcast to Twitch/local stream
   - Be transcribed
   - Trigger AI agents to respond to you
6. Check Twitch to see both podcast and caller audio streaming

## Troubleshooting

### Call connects but no audio
- Check that `TWILIO_ENABLED=true` in your `.env`
- Verify ngrok is running and URL is correct in Twilio console
- Check console logs for WebSocket connection

### Audio quality issues
- The audio is downsampled from 24kHz to 8kHz for phone calls (Twilio limitation)
- Twitch gets the full 24kHz quality

### Multiple callers
- The system supports multiple simultaneous callers
- All callers hear the same podcast stream
- New callers trigger a news announcement in the podcast

## Features

### Voice Activity Detection (VAD)
- Monitors caller audio for speech
- RMS threshold: 500
- Requires 3 consecutive frames to start speech
- Requires 10 consecutive silent frames to end speech
- Minimum speech duration: 500ms

### Audio Processing
- **Incoming**: 8kHz mulaw → 16-bit PCM
- **Outgoing**: 24kHz PCM → 8kHz mulaw
- **Broadcast**: 8kHz PCM → 24kHz PCM (upsampled for Twitch)

### Transcription
- Uses XAI Whisper API
- Automatic language detection (defaults to English)
- Transcription injected as `[CALLER +1234567890]: <text>`

### Interruption
- Caller speech automatically interrupts current podcast speaker
- Agents respond to caller input just like console input
- Seamless integration with existing podcast flow
