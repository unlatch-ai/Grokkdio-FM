https://www.youtube.com/watch?v=9SMqV2HDAyw

# 📻 Grokkdio FM

**GTA radio brought to life** — a 24/7 AI-powered radio station with multiple hosts, live phone call-ins, and real-time trending topics from X.

## What is this?

Grokkdio FM is a live AI radio station streaming on Twitch. Think Lazlow and the gang from GTA, but real and interactive:

- **Multiple AI hosts** with distinct cloned voices and over-the-top personalities
- **Live phone call-ins** — dial in and talk to the hosts on air
- **Real-time content** — topics pulled automatically from X trends
- **24/7 autonomous operation** — always fresh, always live

🎧 **Listen live**: [twitch.tv/grokkdiofm](https://www.twitch.tv/grokkdiofm)

## Features

- 🎙️ **Multi-Voice Conversations** — Multiple Grok voices with cloned personalities talking naturally
- 📞 **Phone Call-Ins** — Twilio integration for real listener participation
- 📺 **Twitch Streaming** — Professional RTMP streaming with video overlays
- 🐦 **X Trends Integration** — Automatic topic injection from trending posts
- 🚨 **Breaking News** — Inject news that hosts react to immediately
- 🎵 **Background Music** — Lofi beats with dynamic audio mixing
- 💬 **Live Subtitles** — Real-time captions on stream

## Quick Start

```bash
cd src
npm install
cp .env.example .env
# Edit .env with your API keys
npm start
```

**Requirements**: Node.js 18+, ffmpeg (`brew install ffmpeg`)

## Environment Variables

```env
# XAI API (required)
XAI_API_KEY=your-xai-api-key

# Twitch Streaming (optional)
TWITCH_ENABLED=true
TWITCH_STREAM_KEY=your-stream-key

# Phone Call-Ins (optional)
TWILIO_ENABLED=true
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
```

## Architecture

```
src/
├── index.js                    # Main entry point
├── twilio-server.js            # Phone call integration
├── lib/
│   ├── PodcastOrchestrator.js  # Conversation orchestration
│   ├── TTSAgent.js             # Voice synthesis per host
│   ├── AudioBus.js             # Multi-stream audio mixing
│   ├── NewsInjector.js         # Breaking/regular news queue
│   └── ImageOverlayManager.js  # Tweet screenshot overlays
└── plugins/
    ├── xai-tts.js              # XAI TTS integration
    ├── xai-tts-clone.js        # Voice cloning
    ├── xai-llm.js              # Grok LLM integration
    ├── twitch-streamer.js      # RTMP streaming to Twitch
    └── local-audio-player.js   # Local preview playback
```

## How It Works

1. **Hosts are initialized** with unique cloned voices via XAI Realtime API
2. **Grok researches** trending topics from X for conversation material
3. **Hosts take turns** speaking, with natural interruptions and reactions
4. **Audio is mixed** (voices + background music) and streamed to Twitch
5. **Phone callers** connect via Twilio, transcribed in real-time, hosts respond live
6. **News can be injected** that hosts react to immediately or reference later

## Live Interaction

### Phone Call-Ins

Listeners can dial in and join the show. Their voice is transcribed and hosts respond live.

### News Injection

Inject news while the podcast is running:

```bash
# Breaking news - immediate reaction
> breaking: Major AI breakthrough announced

# Regular news - background context
> news: Tech stocks rally on AI optimism
```

### Programmatic Control

```javascript
import { PodcastOrchestrator } from './lib/PodcastOrchestrator.js';

const podcast = new PodcastOrchestrator(configs, topic, duration);
await podcast.initialize();
podcast.runPodcast();

// Inject news
podcast.breakingNews('Breaking news headline');
podcast.regularNews('Background context');
```

## Built With

- **XAI Realtime API** — Voice synthesis with cloning
- **XAI Grok** — LLM for conversation and research
- **Twilio** — Phone call integration
- **FFmpeg** — Audio/video processing and streaming
- **Puppeteer** — Tweet screenshot capture

## License

MIT
