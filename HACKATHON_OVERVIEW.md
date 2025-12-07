# Grokkdio FM - Hackathon Presentation Overview

## The Pitch (30 seconds)

**Grokkdio FM is GTA radio brought to life** - a 24/7 AI-powered radio station streaming on Twitch with multiple AI hosts who have distinct personalities and cloned voices, live phone call-ins where real people can join the conversation, and automatic integration with trending topics from X/Twitter.

---

## How It Works (The Simple Version)

Think of Grokkdio FM as having five main parts working together:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   ┌──────────┐     ┌──────────────┐     ┌──────────────────────┐   │
│   │  INPUTS  │────▶│  RADIO BRAIN │────▶│       OUTPUTS        │   │
│   └──────────┘     └──────────────┘     └──────────────────────┘   │
│        │                  │                        │                │
│   • Phone Callers    • Show Runner            • Twitch Stream      │
│   • X/Twitter Trends • AI Hosts               • Phone Callers      │
│   • Breaking News    • Sound Mixer            • Local Preview      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Five Key Components

### 1. AI Hosts (The Talent)

Three AI personalities with cloned voices that sound like real radio hosts:

| Host | Personality | Voice |
|------|-------------|-------|
| **Alex "The Truth" Martinez** | Libertarian conspiracy theorist who sees cover-ups everywhere | Cloned from reference audio |
| **Dr. Sam "The Skeptic" Chen** | Exhausted voice of reason, workaholic who just wants facts | Cloned from reference audio |
| **Tammy "The Activist" Fairweather** | Unhinged far-leftist who hates Alex's libertarian takes | Cloned from reference audio |

Each host uses:
- **Grok-3** for generating what they say (with emotion brackets like `[yells]`, `[whispers]`)
- **XAI Voice Cloning** for consistent, recognizable voices

### 2. The Show Runner (Orchestrator)

The "brain" that decides:
- **Who talks when** - manages turn-taking between hosts
- **What to react to** - breaking news, phone callers, trending topics
- **When to interrupt** - if something important happens mid-sentence
- **Context memory** - keeps track of what's been said so hosts can reference it

### 3. The Sound Mixer (AudioBus)

A central mixing console that combines:
- Host voices (from AI TTS)
- Background lofi music (at 15% volume)
- Phone caller audio (upsampled and filtered)

Then sends the mixed audio to all outputs simultaneously.

### 4. Phone Lines (Twilio Integration)

Real people can call in and join the show:
- **Dial the number** shown on stream
- **Voice Activity Detection** knows when you're speaking
- **Real-time transcription** converts speech to text
- **AI hosts respond** to what you said
- **Your voice is broadcast** on the Twitch stream

### 5. Social Feed (X/Twitter Trends)

Automatic content injection:
- Fetches trending topics every 2 minutes
- AI selects the most interesting trend for the show format
- Researches background context
- Hosts react: "Jamie, pull up this tweet!"
- Tweet screenshots appear as overlays on stream

---

## The Magic: Response Pipelining

To keep conversation flowing naturally, we use **pipelining**:

```
Time ──────────────────────────────────────────────────────────▶

Alex speaking:  ████████████████████
                         │
                         ▼ (while Alex talks...)
Sam preparing:           ░░░░░░░░░░░░░░░░
                                        │
                                        ▼ (Sam starts immediately)
Sam speaking:                           ████████████████████
```

While one host is speaking, we're already generating the next host's response AND pre-generating their first sentence's audio. This eliminates awkward pauses.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **LLM** | Grok-3 via XAI API |
| **Voice** | XAI Voice Cloning + TTS |
| **Streaming** | FFmpeg → Twitch RTMP |
| **Phone** | Twilio Media Streams + STT |
| **Trends** | X/Twitter API v2 |
| **Screenshots** | Puppeteer |
| **Runtime** | Node.js 18+ |

---

## Demo Flow

For a hackathon demo, show these in order:

1. **Start the stream** - Show the Twitch preview with hosts talking
2. **Inject breaking news** - Type `breaking: Major AI announcement` and watch hosts react
3. **Trigger a trend** - Type `trends` and watch the system fetch, select, and inject a trending topic
4. **Phone call-in** - Have someone call the number and talk to the hosts live
5. **Show the overlay** - Point out the tweet screenshot that appears when discussing trends

---

## Architecture at a Glance

```
                    ┌─────────────────┐
                    │    index.js     │
                    │  (Entry Point)  │
                    └────────┬────────┘
                             │
                             ▼
┌────────────┐    ┌─────────────────────┐    ┌────────────┐
│   Twilio   │───▶│ PodcastOrchestrator │◀───│  X Trends  │
│  Callers   │    │   (Show Runner)     │    │   API      │
└────────────┘    └──────────┬──────────┘    └────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Alex    │  │   Sam    │  │  Tammy   │
        │ (Agent)  │  │ (Agent)  │  │ (Agent)  │
        └────┬─────┘  └────┬─────┘  └────┬─────┘
             │             │             │
             └──────────┬──┴─────────────┘
                        ▼
                  ┌──────────┐
                  │ AudioBus │
                  │ (Mixer)  │
                  └────┬─────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    ┌─────────┐  ┌──────────┐  ┌──────────┐
    │ Twitch  │  │  Local   │  │  Twilio  │
    │ Stream  │  │ Preview  │  │ Callers  │
    └─────────┘  └──────────┘  └──────────┘
```

---

## Key Differentiators

1. **Multi-agent conversation** - Not just one AI, but three with distinct personalities that argue and react to each other

2. **Voice cloning** - Each host sounds consistent and recognizable, not generic TTS

3. **Real-time interactivity** - Phone callers can actually join and influence the conversation

4. **Autonomous content** - Trends are automatically fetched and injected without human intervention

5. **Production-ready streaming** - Full video output with overlays, subtitles, and background music

---

## One-Liner Summary

> "We built a self-driving radio station where AI hosts with cloned voices debate trending topics while real callers phone in live - streaming 24/7 on Twitch."

---

## Links

- **Live Stream**: [twitch.tv/grokkdiofm](https://www.twitch.tv/grokkdiofm)
- **Built with**: XAI (Grok-3 + Voice Cloning), Twilio, X/Twitter API, FFmpeg
