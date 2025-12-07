# Architecture Overview

## Two Implementations

### 1. `podcast-agent.js` - Traditional Approach
**How it works:**
- Separate LLM API calls → Get text response
- Separate TTS API calls → Convert text to audio
- Sequential processing (slower)

**Use when:**
- You need fine control over LLM and TTS separately
- You want to modify text before TTS
- Testing/debugging individual components

**Run:**
```bash
npm run local
```

---

### 2. `podcast-realtime.js` - Real-time WebSocket Approach ⚡
**How it works:**
- Single WebSocket connection per agent to XAI Realtime API
- Streaming LLM + TTS combined (like phone calls)
- Audio streams as LLM generates text
- Built-in VAD (Voice Activity Detection) for interruptions
- Much faster and more natural

**Use when:**
- You want low-latency, real-time conversations
- You need interruptible agents (like phone calls)
- You want the most natural podcast flow
- **This is what you should use for your end goal!**

**Run:**
```bash
npm run realtime
```

---

## Real-time Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Podcast Orchestrator                    │
│  - Manages 3 agents (Alex, Sam, Jordan)                │
│  - Routes audio to LiveKit or Local Player              │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌─────────┐       ┌─────────┐       ┌─────────┐
   │  Alex   │       │   Sam   │       │ Jordan  │
   │ (Agent) │       │ (Agent) │       │ (Agent) │
   └─────────┘       └─────────┘       └─────────┘
        │                 │                 │
        │ WebSocket       │ WebSocket       │ WebSocket
        ▼                 ▼                 ▼
   ┌──────────────────────────────────────────────┐
   │      XAI Realtime API (wss://api.x.ai)      │
   │  - Streaming LLM (Grok)                     │
   │  - Streaming TTS (Multiple voices)          │
   │  - Server-side VAD                          │
   │  - Interruption handling                    │
   └──────────────────────────────────────────────┘
```

## Audio Flow

### Real-time Mode:
1. **Agent.speak(prompt)** → Send text via WebSocket
2. **XAI processes** → LLM generates text + TTS generates audio simultaneously
3. **Audio streams back** → Via WebSocket as PCM16 24kHz chunks
4. **Orchestrator routes** → To LiveKit or Local Player
5. **User hears** → Low-latency audio output

### Benefits:
- ⚡ **Faster**: Audio starts playing while LLM is still thinking
- 🎯 **Natural**: Sounds like real conversation, not robotic
- 🔊 **Interruptible**: VAD detects when someone else speaks
- 📞 **Phone-ready**: Same API used for Twilio integration

## LiveKit Integration

Both implementations work with `@livekit/agents`:

```javascript
export default defineAgent({
  entry: async (ctx) => {
    const podcast = new RealtimePodcastOrchestrator(topic, duration);
    await podcast.initialize(ctx.room);  // Uses LiveKit room
    await podcast.runPodcast();
  },
});
```

**Local Mode**: Preview window (what Twitch would see)
**LiveKit Mode**: Streams to LiveKit room → WebRTC → Multiple listeners

## Next Steps: Interruptions

To make agents truly interruptible (your end goal):

1. **Add audio input** - Capture mic or room audio
2. **Send to XAI** - Use `realtime.sendAudio(buffer)`
3. **VAD triggers** - XAI detects speech and interrupts current speaker
4. **Agent responds** - Natural back-and-forth conversation

This is already built into the XAI Realtime API! You just need to:
- Capture audio input (from LiveKit room or mic)
- Send it to the realtime WebSocket
- The API handles interruptions automatically

## Recommendation

**Use `podcast-realtime.js`** for your end goal:
- Real-time streaming
- Low latency
- Interruptible conversations
- Natural podcast flow
- Ready for Twitch/Twilio streaming
