# 🚀 Quick Start Guide

Get your AI podcast running in 3 minutes!

## Prerequisites

1. **Node.js 18+** - [Download here](https://nodejs.org/)
2. **Audio player** - Install one of:
   - `brew install sox` (recommended - more reliable)
   - `brew install ffmpeg` (alternative)
3. **XAI API Key** - Get from [x.ai](https://x.ai)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your XAI API key:

```env
LOCAL_MODE=true
XAI_API_KEY=your-xai-api-key-here
```

That's it! You don't need LiveKit credentials for local mode.

### 3. Run the Podcast

```bash
npm start
```

## What Happens Next

1. A video preview window opens (shows what Twitch would see)
2. Three AI agents (Alex, Sam, Jordan) begin discussing the topic
3. Audio plays synchronized with the video
4. You can interrupt by typing in the terminal
5. The conversation lasts ~5 minutes (configurable)

**Requirements**: `ffmpeg` must be installed (`brew install ffmpeg`)

## Customize

### Change the Topic

Edit `.env`:
```env
PODCAST_TOPIC=Your Custom Topic Here
```

### Change Duration

Edit `.env`:
```env
PODCAST_DURATION=10
```

### Use Different Voices

Edit `podcast-agent.js` and change `voiceId` values:
- `ara` - Energetic voice
- `deedee` - Thoughtful voice  
- `paul` - Witty voice

## Troubleshooting

### "Missing XAI_API_KEY"
- Make sure you created `.env` file
- Add your API key from x.ai

### "Failed to start play" or "Failed to start ffplay"
- Install sox: `brew install sox` (recommended)
- Or install ffmpeg: `brew install ffmpeg`
- Verify with: `play --version` or `ffplay -version`

### No audio output
- Check your speaker volume
- Make sure ffmpeg is installed
- Look for errors in the console

## Next Steps

- **Add LiveKit**: Set `LOCAL_MODE=false` and configure LiveKit credentials
- **Stream to Twitch**: Use the `twitch-streamer.js` plugin
- **Customize personalities**: Edit the `AGENTS` array in `podcast-agent.js`

## Need Help?

Check the full [README.md](./README.md) for detailed documentation.
