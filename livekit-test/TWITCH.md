# Streaming to Twitch

Your real-time podcast is ready to stream to Twitch!

## Setup

### 1. Get Your Twitch Stream Key

1. Go to [Twitch Dashboard](https://dashboard.twitch.tv/)
2. Navigate to **Settings** → **Stream**
3. Copy your **Stream Key** (keep this secret!)

### 2. Configure Environment

Add to your `.env` file:

```env
# Twitch Configuration
TWITCH_MODE=true
TWITCH_STREAM_KEY=live_xxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxx
TWITCH_RTMP_URL=rtmp://live.twitch.tv/app
```

**Note:** The RTMP URL varies by region. Common ones:
- US West: `rtmp://live-sjc.twitch.tv/app`
- US East: `rtmp://live-iad.twitch.tv/app`
- Europe: `rtmp://live-fra.twitch.tv/app`
- Asia: `rtmp://live-sin.twitch.tv/app`

Or use the auto-detect: `rtmp://live.twitch.tv/app`

### 3. Start Streaming

```bash
npm run realtime:twitch
```

## What Happens

1. 🎬 The podcast starts
2. 📺 Video stream starts sending to Twitch
3. 🎙️ Three AI agents have a conversation
4. 💬 You can interrupt by typing in the CLI
5. 🌐 Your Twitch viewers see and hear everything in real-time!

## Features

- ✅ **Real-time conversation** - Agents talk naturally
- ✅ **Interruptible** - Agents can interrupt each other
- ✅ **CLI control** - You can interrupt and participate
- ✅ **Video overlay** - Shows podcast title on screen
- ✅ **Low latency** - Using XAI Realtime API

## Video Settings

The stream outputs:
- **Resolution:** 1280x720 (720p)
- **Frame rate:** 30 fps
- **Audio:** 48kHz AAC stereo
- **Video:** H.264 with ultrafast preset

## Customization

### Change the overlay text

Edit in `.env`:
```env
PODCAST_TOPIC=Your Custom Topic
```

The overlay will show: "AI Podcast - Your Custom Topic"

### Change video background

Edit `plugins/twitch-streamer.js` line with `color=c=#1a1a2e` to change background color.

### Change text style

Edit the `drawtext` filter in `plugins/twitch-streamer.js` to customize font, size, position, etc.

## Troubleshooting

### Stream not appearing on Twitch

1. Check your stream key is correct
2. Make sure you're using the right RTMP server for your region
3. Wait 10-20 seconds - Twitch has a delay
4. Check Twitch dashboard to see if stream is "Live"

### Audio/Video out of sync

This shouldn't happen with the real-time API, but if it does:
- Restart the stream
- Check your internet connection
- Try a different RTMP server closer to you

### Poor quality

The stream uses `ultrafast` preset for low latency. To improve quality:
- Edit `plugins/twitch-streamer.js`
- Change `-preset ultrafast` to `-preset fast` or `-preset medium`
- Note: This increases latency

## CLI Commands While Streaming

- Type any message and press Enter to interrupt and participate
- Type `quit` to stop the stream

## Example Session

```bash
$ npm run realtime:twitch

🚀 Starting Real-time Podcast...
📝 Topic: The Future of AI and Human Creativity
⏱️  Duration: 5 minutes
🔌 Mode: Twitch Streaming

🎙️  Initializing Real-time Podcast...

💡 Type your comment and press Enter to interrupt the podcast
   Type "quit" to exit

🔌 Connecting to XAI Realtime API...
✅ Connected to XAI Realtime API
📞 Conversation created: xxx
⚙️  Session configured
✅ Alex connected
✅ Sam connected
✅ Jordan connected

🎬 All agents ready!

📺 Streaming to Twitch!

🎬 Starting real-time podcast...
📝 Topic: The Future of AI and Human Creativity

🎤 Alex speaking...
Alex: Welcome to our podcast...

> What about ethics?
🎤 YOU: "What about ethics?"

🛑 Interrupting Alex's audio
Sam responding to you...
Sam: Great question! Ethics in AI is crucial...
```

## Going Live

1. Start the stream: `npm run realtime:twitch`
2. Go to your Twitch channel
3. You should see the stream live!
4. Share your channel link with viewers
5. Interact with the podcast via CLI

Enjoy your AI-powered live podcast! 🎙️📺
