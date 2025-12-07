# LiveKit Agent with XAI (Grok) & Twitch Streaming

An AI-powered voice agent that uses XAI's Grok LLM and TTS to create an autonomous radio DJ that streams live to Twitch.

## 🎯 Features

- **XAI Grok LLM**: Intelligent conversational AI using Grok
- **XAI TTS**: High-quality voice synthesis (24kHz, 16-bit PCM)
- **Twitch Streaming**: Live RTMP streaming to Twitch
- **Event-Driven Architecture**: Built on LiveKit's agent framework
- **Autonomous Mode**: AI DJ that speaks continuously
- **Interactive Mode**: Can respond to user input

## 🏗️ Architecture

```
┌─────────────────┐
│   Voice Agent   │
│   (Node.js)     │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼──────┐
│  XAI  │ │ Twitch  │
│ Grok  │ │ Stream  │
│ + TTS │ │ (RTMP)  │
└───────┘ └─────────┘
```

## 📋 Prerequisites

- **Node.js** 18+ 
- **FFmpeg** (for Twitch streaming)
- **XAI API Key** from [console.x.ai](https://console.x.ai/)
- **Twitch Account** with stream key

### Install FFmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd livekit-agent
npm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
# XAI API Configuration
XAI_API_KEY=your_xai_api_key_here
XAI_BASE_URL=https://api.x.ai/v1

# Twitch Configuration
TWITCH_STREAM_KEY=your_twitch_stream_key
TWITCH_RTMP_URL=rtmp://live.twitch.tv/app/

# Agent Configuration
AGENT_NAME=XAI Radio DJ
VOICE_ID=ara
```

### 3. Get Your Twitch Stream Key

1. Go to [Twitch Dashboard](https://dashboard.twitch.tv/)
2. Navigate to **Settings** → **Stream**
3. Copy your **Primary Stream Key**
4. Paste it into `.env` as `TWITCH_STREAM_KEY`

### 4. Run the Agent

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

### 5. Watch Your Stream

1. Go to `https://twitch.tv/YOUR_USERNAME`
2. The stream may take 10-30 seconds to appear
3. You should see video with text overlay and hear AI-generated speech

## 🎮 Usage

### Autonomous Radio Show Mode

By default, the agent runs as an autonomous radio DJ:

- Speaks every 10 seconds
- Cycles through interesting topics
- Streams continuously to Twitch

### Interactive Mode

To make the agent respond to specific input, modify `src/agent.js`:

```javascript
// Instead of startRadioShow(), use:
await agent.respondTo("Tell me about AI");
```

### Custom System Prompt

Customize the agent's personality in `src/agent.js`:

```javascript
const agent = new VoiceAgent({
  systemPrompt: `You are a tech podcast host who loves discussing AI, coding, and innovation...`,
  overlayText: 'My Custom Stream Title',
});
```

## 🔧 Configuration Options

### XAI LLM Settings

Edit `src/plugins/xai-llm.js`:

```javascript
this.model = 'grok-beta';        // Model name
this.temperature = 0.7;          // Creativity (0-1)
this.maxTokens = 1024;           // Response length
```

### XAI TTS Settings

Edit `src/plugins/xai-tts.js`:

```javascript
this.voiceId = 'ara';            // Voice ID
this.sampleRate = 24000;         // Audio quality
```

Available voices: `ara`, `nova`, `echo`, `fable`, `onyx`, `shimmer`

### Twitch Stream Settings

Edit `src/integrations/twitch-streamer.js`:

```javascript
// Video settings
'-b:v', '2500k',                 // Video bitrate
'-r', '30',                      // Frame rate

// Audio settings
'-b:a', '128k',                  // Audio bitrate
'-ar', '48000',                  // Sample rate (Twitch requires 48kHz)
```

## 📁 Project Structure

```
livekit-agent/
├── src/
│   ├── agent.js                 # Main agent logic
│   ├── plugins/
│   │   ├── xai-llm.js          # XAI Grok LLM plugin
│   │   └── xai-tts.js          # XAI TTS plugin
│   └── integrations/
│       └── twitch-streamer.js  # Twitch RTMP streaming
├── package.json
├── .env.example
└── README.md
```

## 🎨 Customization

### Add Custom Cover Image

1. Create a 1280x720 PNG image
2. Save it as `cover.png` in the project root
3. Update `src/integrations/twitch-streamer.js`:

```javascript
this.coverImage = path.join(process.cwd(), 'cover.png');
```

### Change Overlay Text

```javascript
const agent = new VoiceAgent({
  overlayText: 'Your Custom Text Here',
});
```

### Add Chat Integration

To respond to Twitch chat, integrate with `tmi.js`:

```bash
npm install tmi.js
```

Then add chat listener in `src/agent.js`:

```javascript
import tmi from 'tmi.js';

const client = new tmi.Client({
  channels: ['your_channel']
});

client.on('message', async (channel, tags, message) => {
  await agent.respondTo(message);
});

client.connect();
```

## 🐛 Troubleshooting

### FFmpeg Not Found

```bash
# Verify FFmpeg is installed
ffmpeg -version

# If not, install it
brew install ffmpeg  # macOS
```

### Stream Not Appearing on Twitch

- Wait 30 seconds (Twitch has delay)
- Check your stream key is correct
- Verify you're looking at the right channel
- Check FFmpeg logs for errors

### Audio Quality Issues

- Ensure XAI API key is valid
- Check network connection
- Verify TTS sample rate matches FFmpeg input

### XAI API Errors

- Verify API key in `.env`
- Check XAI API status
- Ensure you have API credits

## 🔗 Integration with LiveKit

While this implementation doesn't require a LiveKit server for basic operation, you can integrate with LiveKit rooms:

1. Set up a LiveKit server (cloud or self-hosted)
2. Add LiveKit SDK:
   ```bash
   npm install livekit-client
   ```
3. Connect to rooms and handle participants

See [LiveKit Agents JS docs](https://github.com/livekit/agents-js) for full integration.

## 📚 Resources

- [XAI API Documentation](https://docs.x.ai/)
- [LiveKit Agents JS](https://github.com/livekit/agents-js)
- [Twitch Streaming Guide](https://dev.twitch.tv/docs/video-broadcast/)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)

## 🤝 Contributing

This is a hackathon project! Feel free to:

- Add new features
- Improve error handling
- Add tests
- Enhance documentation

## 📄 License

MIT License - feel free to use this for your own projects!

## 🎉 Credits

Built with:
- **XAI** for Grok LLM and TTS
- **LiveKit** for agent framework inspiration
- **Twitch** for streaming platform
- **FFmpeg** for media processing

---

**Happy Streaming! 🎙️📺**
