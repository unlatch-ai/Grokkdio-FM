# 🎙️ LiveKit Multi-Agent Podcast Demo

A demo application that creates podcast-style conversations between multiple AI agents with different personalities, powered by **LiveKit Agents**, **XAI's Grok LLM**, and **XAI TTS**.

## Features

- 🤖 **Multiple AI Personalities**: Three distinct podcast hosts (Alex, Sam, and Jordan) with unique voices and personalities
- 🎵 **Real-time Audio Streaming**: Uses LiveKit for real-time audio delivery
- 🧠 **XAI Grok LLM**: Powered by XAI's Grok model for intelligent conversations
- 🗣️ **XAI TTS**: High-quality text-to-speech using XAI's voice synthesis
- 🎬 **Extensible**: Ready to add Twitch streaming and Twilio integration

## Architecture

This demo uses the `@livekit/agents` framework, which provides:

- Automatic room management
- Worker-based agent deployment
- Built-in lifecycle management
- Easy scaling and distribution

### Agent Personalities

1. **Alex** (Host) - Energetic and curious, keeps the conversation lively
2. **Sam** (Expert) - Thoughtful analyst who provides deep insights
3. **Jordan** (Commentator) - Witty and humorous, adds levity to discussions

## Prerequisites

- Node.js 18+
- LiveKit Server (local or cloud)
- XAI API Key ([get one here](https://x.ai))
- ffmpeg (optional, for Twitch streaming)

## Installation

1. **Clone and install dependencies:**

```bash
npm install
```

2. **Set up environment variables:**

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# LiveKit Configuration
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# XAI API Configuration
XAI_API_KEY=your-xai-api-key-here

# Podcast Configuration
PODCAST_TOPIC=The Future of AI and Human Creativity
PODCAST_DURATION=5

# Display Options
ENABLE_SUBTITLES=false  # Set to 'true' to show real-time subtitles on video (Twitch/Local)
```

## Running LiveKit Server Locally

If you don't have a LiveKit server, you can run one locally:

```bash
# Using Docker
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  -e LIVEKIT_KEYS="your-api-key: your-api-secret" \
  livekit/livekit-server --dev

# Or download the binary from https://github.com/livekit/livekit/releases
```

## Usage

### Quick Start - Local Mode (Recommended for Testing)

The easiest way to test the podcast is to run it locally without LiveKit:

```bash
# Set LOCAL_MODE=true in your .env file, then:
npm run local
```

This will:

1. Start the podcast immediately
2. Play audio directly on your computer speakers
3. No LiveKit server required!

**Requirements**: `ffmpeg` must be installed (`brew install ffmpeg`)

### Production Mode - LiveKit Streaming

For production use with LiveKit:

1. Set `LOCAL_MODE=false` in your `.env` file
2. Configure your LiveKit credentials
3. Start the agent:

```bash
npm start
```

The agent will:

1. Connect to your LiveKit server
2. Wait for a room to be created
3. Start the podcast conversation when a participant joins
4. Stream audio to all connected participants

### Connect to the Podcast (LiveKit Mode)

You can connect to the podcast using:

1. **LiveKit Web Client**: Use the LiveKit Playground or build a custom web client
2. **LiveKit CLI**:
   ```bash
   livekit-cli join-room --url ws://localhost:7880 --room podcast-room
   ```

### Customize the Podcast

Edit environment variables in `.env`:

- `PODCAST_TOPIC`: Change the discussion topic
- `PODCAST_DURATION`: Adjust length in minutes (default: 5)

Or modify the agent personalities in `podcast-agent.js`:

```javascript
const AGENTS = [
  {
    name: "YourAgent",
    voiceId: "ara", // Available: ara, deedee, paul
    personality: "Your custom personality prompt...",
    color: "\x1b[36m",
  },
];
```

## Project Structure

```
livekit-test/
├── podcast-agent.js          # Main agent implementation
├── plugins/
│   ├── xai-llm.js           # XAI Grok LLM integration
│   ├── xai-tts.js           # XAI TTS integration
│   ├── local-audio-player.js # Local audio playback (for testing)
│   └── twitch-streamer.js   # Twitch streaming (future)
├── package.json
├── .env.example
└── README.md
```

## How It Works

1. **Agent Initialization**: The `PodcastAgent` class extends LiveKit's `Agent` base class
2. **Room Connection**: When a room is created, the agent automatically joins
3. **Conversation Flow**:
   - Host (Alex) introduces the topic
   - Agents take turns responding using XAI Grok LLM
   - Each response is converted to speech using XAI TTS
   - Audio is streamed to the LiveKit room in real-time
4. **Audio Streaming**: PCM audio frames are captured and published to LiveKit

## Future Enhancements

- [ ] **Twitch Streaming**: Stream podcast to Twitch using the included `twitch-streamer.js` plugin
- [ ] **Twilio Integration**: Enable phone call participation
- [ ] **Interactive Mode**: Allow audience questions and participation
- [ ] **Recording**: Save podcast episodes
- [ ] **Multiple Rooms**: Support concurrent podcast sessions

## API Reference

### PodcastAgent

Main agent class that manages the podcast conversation.

```javascript
class PodcastAgent extends Agent {
  async start(room)      // Called when agent joins a room
  async runPodcast()     // Orchestrates the conversation
  async playAudio(buffer) // Streams audio to the room
}
```

### PodcastPersonality

Represents an individual podcast host personality.

```javascript
class PodcastPersonality {
  async generateResponse(context) // Generate LLM response
  async speak(text)               // Convert text to speech
  getName()                       // Get personality name
}
```

## Troubleshooting

### Agent doesn't start

- Verify `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are correct
- Ensure LiveKit server is running and accessible
- Check that XAI API key is valid

### No audio output

- Confirm audio track is being published (check logs)
- Verify XAI TTS is working (check for TTS errors in logs)
- Ensure client is properly connected to the room

### Rate limiting errors

- XAI TTS has rate limits; the plugin includes automatic retry logic
- Consider adding delays between TTS calls if needed

## Contributing

Contributions are welcome! Feel free to:

- Add new agent personalities
- Improve conversation flow
- Add streaming integrations (Twitch, YouTube, etc.)
- Enhance audio quality

## License

MIT

## Resources

- [LiveKit Agents Documentation](https://docs.livekit.io/agents/)
- [XAI API Documentation](https://docs.x.ai/)
- [LiveKit Server Setup](https://docs.livekit.io/home/self-hosting/deployment/)
