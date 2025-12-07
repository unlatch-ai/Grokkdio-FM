# Grokkdio FM - Architecture Documentation

## Overview

Grokkdio FM is a 24/7 AI-powered radio station that streams to Twitch with multiple AI hosts, live phone call-ins, and real-time X/Twitter trend integration. The system is built on Node.js and uses XAI's Grok-3 LLM and voice synthesis APIs.

---

## Detailed Architecture Diagram

```mermaid
flowchart TB
    subgraph Entry["Entry Point & Runtime Selection"]
        IDX["index.js<br/>• Defines 3 AI host personalities<br/>• Selects runtime mode<br/>• Initializes orchestrator"]
    end

    subgraph Core["Core Radio Brain"]
        PO["PodcastOrchestrator<br/>• Conversation flow control<br/>• Turn-taking with pipelining<br/>• Interruption handling<br/>• Shared conversation history"]
        
        subgraph Agents["AI Host Agents"]
            A1["TTSAgent: Alex<br/>'The Truth' Martinez<br/>Libertarian Conspiracy Theorist"]
            A2["TTSAgent: Dr. Sam<br/>'The Skeptic' Chen<br/>Exhausted Voice of Reason"]
            A3["TTSAgent: Tammy<br/>'The Activist' Fairweather<br/>Unhinged Far-Leftist"]
        end
        
        subgraph Injectors["Content Injectors"]
            NI["NewsInjector<br/>• Breaking news queue<br/>• Regular news context"]
            TRI["TrendInjector<br/>• Auto-fetch X trends<br/>• AI trend selection<br/>• Background research"]
        end
        
        TO["TextOverlayManager<br/>• Typewriter subtitles<br/>• Dynamic text display"]
    end

    subgraph LLMTTS["XAI Services (External)"]
        XLLM["XAILLMPlugin<br/>Grok-3 LLM<br/>api.x.ai/v1/chat/completions"]
        XTTS["XAITTSPlugin<br/>Streaming TTS<br/>WebSocket: wss://api.x.ai"]
        XCLONE["XAITTSClonePlugin<br/>Voice Cloning REST API<br/>us-east-4.api.x.ai/voice-staging"]
    end

    subgraph Trends["X/Twitter Integration"]
        TS["TrendService<br/>• getTopTrends()<br/>• getTweetsForTrend()<br/>• searchTweets()"]
        PERS["personalities.js<br/>• redneck, normie, valley_girl<br/>• professor, surfer_dude<br/>• podcast_host (default)"]
        GT["gettweet.js<br/>Puppeteer tweet screenshots"]
    end

    subgraph AudioOut["Audio Routing & Outputs"]
        AB[("AudioBus<br/>Central Audio Router<br/>• addOutput()<br/>• writeAudio()")]
        
        subgraph Outputs["Output Destinations"]
            LP["LocalAudioPlayer<br/>• FFmpeg + FFplay<br/>• Video preview window<br/>• Background music mixing"]
            TW["TwitchStreamer<br/>• FFmpeg RTMP<br/>• Video overlays<br/>• Background music<br/>• Call-to-action text"]
            LK["LiveKit Audio Track<br/>• AudioSource 24kHz<br/>• Room publishing"]
            TWIOL["Twilio Output<br/>• PCM → mulaw<br/>• 24kHz → 8kHz downsample"]
        end
    end

    subgraph Calls["Phone Call Integration (Twilio)"]
        TWS["twilio-server.js<br/>Express + WebSocket Server"]
        TWAPI["Twilio Media Streams<br/>• Real-time audio<br/>• Built-in STT"]
        VAD["Voice Activity Detection<br/>• RMS threshold<br/>• Speech start/end detection"]
    end

    subgraph Visual["Visual Overlay System"]
        IMG["ImageOverlayManager<br/>• PNG overlay management<br/>• Fade effects"]
        TWEET["TweetOverlay<br/>• showTweetOverlay()"]
    end

    subgraph External["External Services"]
        XAPI["X/Twitter API<br/>api.x.com/2"]
        TWILIO["Twilio Cloud<br/>Phone Network"]
        TWITCH["Twitch RTMP<br/>live.twitch.tv"]
    end

    %% Entry connections
    IDX --> PO
    IDX -.->|"TWILIO_ENABLED"| TWS
    IDX -.->|"LiveKit mode"| LK

    %% Core orchestration
    PO --> A1 & A2 & A3
    PO --> NI
    PO --> TRI
    PO --> TO
    PO --> AB

    %% Agent to LLM/TTS
    A1 & A2 & A3 --> XLLM
    A1 --> XCLONE
    A2 --> XCLONE
    A3 --> XCLONE
    A1 & A2 & A3 -.->|"fallback"| XTTS

    %% Trend system
    TRI --> TS
    TRI --> PERS
    TRI --> GT
    TS --> XAPI
    TRI -->|"trend prompt"| PO

    %% Audio routing
    AB --> LP
    AB --> TW
    AB --> LK
    AB --> TWIOL

    %% Output destinations
    TW --> TWITCH
    TWIOL --> TWAPI

    %% Twilio flow
    TWILIO <--> TWAPI
    TWAPI <--> TWS
    TWS -->|"caller transcription"| PO
    TWS -->|"caller audio"| VAD
    VAD -->|"broadcast"| LP & TW

    %% Visual overlays
    TO --> LP & TW
    TWEET --> GT
    IMG --> LP & TW
    TRI -->|"tweet overlay"| TWEET

    %% Styling
    classDef external fill:#f9f,stroke:#333,stroke-width:2px
    classDef core fill:#bbf,stroke:#333,stroke-width:2px
    classDef audio fill:#bfb,stroke:#333,stroke-width:2px
    
    class XAPI,TWILIO,TWITCH,XLLM,XTTS,XCLONE external
    class PO,A1,A2,A3,NI,TRI core
    class AB,LP,TW,LK,TWIOL audio
```

---

## Component Interaction Diagram

```mermaid
sequenceDiagram
    participant User as User/CLI
    participant PO as PodcastOrchestrator
    participant Agent as TTSAgent
    participant LLM as Grok-3 LLM
    participant TTS as Voice Clone TTS
    participant AB as AudioBus
    participant Out as Outputs (Twitch/Local)

    Note over PO: Conversation Loop Start
    
    PO->>Agent: buildPrompt(context + history)
    Agent->>LLM: generateResponse(prompt)
    LLM-->>Agent: text response with [emotion brackets]
    
    Note over Agent: Split into sentences
    
    loop For each sentence
        Agent->>TTS: synthesize(sentence)
        TTS-->>Agent: PCM audio buffer
        Agent->>AB: emit('audio', buffer)
        AB->>Out: writeAudio(buffer)
        Agent->>PO: emit('subtitle', text)
    end

    Note over PO: Pre-generate next speaker while current plays
    
    alt Breaking News
        User->>PO: breaking: news text
        PO->>Agent: interrupt()
        PO->>Agent: handleBreakingNews()
    else Trend Injection
        PO->>PO: pendingTrendPrompt ready
        PO->>Agent: handleTrendInjection()
    else Phone Caller
        Note over PO: Twilio transcription arrives
        PO->>Agent: handleUserInput()
    end
```

---

## Data Flow Diagram

```mermaid
flowchart LR
    subgraph Inputs["Input Sources"]
        CLI["CLI Commands<br/>breaking:/news:/trends"]
        PHONE["Phone Callers<br/>via Twilio"]
        XTRENDS["X/Twitter Trends<br/>Auto-fetch every 2min"]
    end

    subgraph Processing["Processing Pipeline"]
        ORCH["Orchestrator<br/>Turn Management"]
        AGENTS["AI Agents<br/>Text Generation"]
        VOICE["Voice Synthesis<br/>TTS/Cloning"]
    end

    subgraph Mixing["Audio Mixing"]
        BUS["AudioBus"]
        MUSIC["Background Music<br/>15% volume"]
        CALLER["Caller Audio<br/>Upsampled + Filtered"]
    end

    subgraph Outputs["Output Streams"]
        TWITCH["Twitch RTMP<br/>1280x720 30fps"]
        LOCAL["Local Preview<br/>FFplay Window"]
        LIVEKIT["LiveKit Room<br/>24kHz Audio"]
        TWILIOOUT["Twilio Callers<br/>8kHz mulaw"]
    end

    CLI --> ORCH
    PHONE --> ORCH
    XTRENDS --> ORCH

    ORCH --> AGENTS
    AGENTS --> VOICE
    VOICE --> BUS

    MUSIC --> BUS
    CALLER --> BUS

    BUS --> TWITCH
    BUS --> LOCAL
    BUS --> LIVEKIT
    BUS --> TWILIOOUT
```

---

## Runtime Modes

The system supports three runtime modes, selected via environment variables:

| Mode | Env Variable | Output | Use Case |
|------|-------------|--------|----------|
| **Local Preview** | `LOCAL_MODE=true` | FFplay window | Development/testing |
| **Twitch Streaming** | `TWITCH_MODE=true` | RTMP to Twitch | Production streaming |
| **LiveKit** | Default (no flags) | LiveKit room | WebRTC distribution |

---

## LiveKit Integration (ASCII Diagram)

Grokkdio FM uses the **LiveKit Agents Framework** (`@livekit/agents`) as its default runtime mode. This enables real-time WebRTC audio distribution to multiple listeners through LiveKit rooms.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LIVEKIT AGENTS FRAMEWORK                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         index.js                                    │   │
│   │                                                                     │   │
│   │   import { WorkerOptions, cli, defineAgent } from "@livekit/agents" │   │
│   │                                                                     │   │
│   │   export default defineAgent({                                      │   │
│   │     entry: async (ctx) => {                                         │   │
│   │       const podcast = new PodcastOrchestrator(AGENT_CONFIGS, topic) │   │
│   │       await podcast.initialize(ctx.room)  ◄── LiveKit Room passed   │   │
│   │       await podcast.runPodcast()                                    │   │
│   │     }                                                               │   │
│   │   })                                                                │   │
│   │                                                                     │   │
│   │   // Starts LiveKit worker via CLI                                  │   │
│   │   cli.runApp(new WorkerOptions({ agent: ... }))                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    PodcastOrchestrator.initialize(room)             │   │
│   │                                                                     │   │
│   │   import { AudioSource } from "@livekit/rtc-node"                   │   │
│   │                                                                     │   │
│   │   if (room) {                                                       │   │
│   │     // Create 24kHz mono audio source                               │   │
│   │     this.audioSource = new AudioSource(24000, 1)                    │   │
│   │                                                                     │   │
│   │     // Publish audio track to LiveKit room                          │   │
│   │     await room.localParticipant.publishTrack({                      │   │
│   │       source: this.audioSource,                                     │   │
│   │       name: "podcast-audio"                                         │   │
│   │     })                                                              │   │
│   │                                                                     │   │
│   │     // Register with AudioBus for unified routing                   │   │
│   │     audioBus.addOutput({                                            │   │
│   │       name: "LiveKit",                                              │   │
│   │       writeAudio: (buffer) => this.audioSource.captureFrame(buffer) │   │
│   │     })                                                              │   │
│   │   }                                                                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

                                    │
                                    │ Audio flows through AudioBus
                                    ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│                              AUDIO FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   TTSAgent ──► emit('audio', buffer) ──► AudioBus.writeAudio(buffer)        │
│                                              │                              │
│                                              ▼                              │
│                          ┌───────────────────────────────────┐              │
│                          │         AudioBus (Singleton)      │              │
│                          │                                   │              │
│                          │   outputs.forEach(output =>       │              │
│                          │     output.writeAudio(buffer)     │              │
│                          │   )                               │              │
│                          └───────────────────────────────────┘              │
│                                              │                              │
│                    ┌─────────────┬───────────┼───────────┬─────────────┐    │
│                    ▼             ▼           ▼           ▼             ▼    │
│              ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│              │ LiveKit  │ │  Twitch  │ │  Local   │ │  Twilio  │           │
│              │  Room    │ │  RTMP    │ │  FFplay  │ │  Callers │           │
│              └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                   │                                                         │
│                   ▼                                                         │
│         audioSource.captureFrame(buffer)                                    │
│                   │                                                         │
│                   ▼                                                         │
│         ┌─────────────────────────────────┐                                 │
│         │     LiveKit Cloud / Server      │                                 │
│         │                                 │                                 │
│         │   Room: "podcast-room"          │                                 │
│         │   Track: "podcast-audio"        │                                 │
│         │   Format: 24kHz PCM mono        │                                 │
│         └─────────────────────────────────┘                                 │
│                   │                                                         │
│                   ▼                                                         │
│         ┌─────────────────────────────────┐                                 │
│         │      WebRTC Subscribers         │                                 │
│         │                                 │                                 │
│         │   • Web browsers                │                                 │
│         │   • Mobile apps                 │                                 │
│         │   • Other LiveKit clients       │                                 │
│         └─────────────────────────────────┘                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### LiveKit-Twilio Bridge (Alternative Architecture)

There's also a `twilio-livekit-bridge.js` that connects phone callers directly to a LiveKit room:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TWILIO-LIVEKIT BRIDGE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Phone Caller                                                              │
│       │                                                                     │
│       ▼                                                                     │
│   ┌──────────────────┐                                                      │
│   │   Twilio Cloud   │                                                      │
│   │   (Phone Network)│                                                      │
│   └────────┬─────────┘                                                      │
│            │ WebSocket (Media Streams)                                      │
│            ▼                                                                │
│   ┌──────────────────────────────────────────────────────────────────┐      │
│   │                  twilio-livekit-bridge.js                        │      │
│   │                                                                  │      │
│   │   • Express server on port 3001                                  │      │
│   │   • /voice endpoint returns TwiML with <Stream>                  │      │
│   │   • /media-stream WebSocket handles bidirectional audio          │      │
│   │                                                                  │      │
│   │   On call start:                                                 │      │
│   │     1. Connect to LiveKit room using @livekit/rtc-node           │      │
│   │     2. Generate access token with livekit-server-sdk             │      │
│   │     3. Subscribe to room's audio tracks                          │      │
│   │                                                                  │      │
│   │   Audio flow:                                                    │      │
│   │     LiveKit → downsample 48kHz→8kHz → PCM→mulaw → Twilio caller  │      │
│   │     Twilio caller → mulaw→PCM → (TODO: publish to LiveKit room)  │      │
│   └──────────────────────────────────────────────────────────────────┘      │
│            │                                                                │
│            │ @livekit/rtc-node                                              │
│            ▼                                                                │
│   ┌──────────────────┐                                                      │
│   │   LiveKit Room   │                                                      │
│   │   "podcast-room" │                                                      │
│   └──────────────────┘                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key LiveKit Components Used

| Package | Purpose |
|---------|---------|
| `@livekit/agents` | Agent framework - `defineAgent()`, `WorkerOptions`, `cli.runApp()` |
| `@livekit/rtc-node` | Real-time communication - `AudioSource`, `Room`, `RoomEvent` |
| `livekit-server-sdk` | Server-side utilities - `AccessToken` generation |

### LiveKit Environment Variables

```bash
# Required for LiveKit mode (when neither LOCAL_MODE nor TWITCH_MODE is set)
LIVEKIT_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
```

---

## Key Component Responsibilities

### PodcastOrchestrator
- Central conversation controller
- Manages turn-taking between 3 AI hosts
- Implements response pipelining (pre-generates next response while current plays)
- Handles interruptions (breaking news, user input, trends)
- Maintains shared conversation history for context

### TTSAgent
- Represents a single AI host with personality
- Uses Grok-3 for text generation with emotion brackets
- Uses voice cloning for consistent character voices
- Sentence-by-sentence playback with interruption support
- Emits audio and subtitle events

### AudioBus
- Singleton audio router
- Distributes PCM audio to all registered outputs
- Simple interface: `addOutput()`, `removeOutput()`, `writeAudio()`

### TrendInjector
- Fetches trending topics from X/Twitter API
- Uses AI to select most interesting trend for show format
- Performs background research on selected trend
- Builds prompts with trend context and top tweets
- Triggers tweet screenshot overlays

### twilio-server.js
- Express server for Twilio webhooks
- WebSocket server for Media Streams
- Voice Activity Detection for caller speech
- Bidirectional audio: podcast → caller, caller → stream
- Real-time transcription integration

---

## Audio Format Specifications

| Component | Sample Rate | Channels | Bit Depth | Format |
|-----------|-------------|----------|-----------|--------|
| Internal Pipeline | 24kHz | Mono | 16-bit | PCM s16le |
| Twitch Output | 48kHz | Stereo | - | AAC 128kbps |
| Twilio Input | 8kHz | Mono | 8-bit | mulaw |
| Twilio Output | 8kHz | Mono | 8-bit | mulaw |
| Voice Clone API | - | - | - | MP3 → PCM |

---

## Environment Variables

```bash
# Required
XAI_API_KEY=your-xai-api-key

# Runtime Mode (pick one)
LOCAL_MODE=true          # Local preview
TWITCH_MODE=true         # Twitch streaming
# (neither = LiveKit mode)

# Twitch Streaming
TWITCH_STREAM_KEY=your-stream-key
TWITCH_RTMP_URL=rtmp://live.twitch.tv/app/

# Phone Call-Ins
TWILIO_ENABLED=true
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
TWILIO_SERVER_PORT=3001

# X/Twitter Trends
X_BEARER_TOKEN=your-bearer-token

# Optional
BACKGROUND_VIDEO=./media/gta.mp4
BACKGROUND_MUSIC=./media/background-music.mp3
ENABLE_SUBTITLES=true
AI_INTERRUPTION_CHANCE=0.0
```

---

## File Structure

```
src/
├── index.js                      # Entry point, agent configs, mode selection
├── twilio-server.js              # Phone call integration server
├── twilio-livekit-bridge.js      # LiveKit-Twilio bridge (alternative)
│
├── lib/
│   ├── PodcastOrchestrator.js    # Central conversation orchestration
│   ├── TTSAgent.js               # Individual AI host agent
│   ├── AudioBus.js               # Central audio routing
│   ├── NewsInjector.js           # Breaking/regular news management
│   ├── TrendInjector.js          # X trends fetching and injection
│   ├── TrendService.js           # X/Twitter API client
│   ├── TextOverlay.js            # Subtitle/text overlay manager
│   ├── TweetOverlay.js           # Tweet screenshot overlay helper
│   ├── ImageOverlayManager.js    # PNG overlay management
│   ├── gettweet.js               # Puppeteer tweet capture
│   └── personalities.js          # Trend selection personalities
│
├── plugins/
│   ├── xai-llm.js                # Grok LLM API wrapper
│   ├── xai-tts.js                # XAI streaming TTS (WebSocket)
│   ├── xai-tts-clone.js          # XAI voice cloning (REST)
│   ├── xai-realtime.js           # XAI Realtime API (alternative)
│   ├── twitch-streamer.js        # FFmpeg RTMP streaming
│   └── local-audio-player.js     # Local preview player
│
└── media/
    ├── alex-jones.m4a            # Voice clone reference (Alex)
    ├── parsa.m4a                  # Voice clone reference (Sam)
    ├── tammy.m4a                  # Voice clone reference (Tammy)
    ├── background-music.mp3      # Lofi background music
    ├── dial_in.mp3               # Phone dial-in sound effect
    └── hang_up.mp3               # Phone hang-up sound effect
```
