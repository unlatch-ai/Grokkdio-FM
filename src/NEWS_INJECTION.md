# News Injection Feature

The podcast supports injecting news in real-time while it's running!

## Two Types of News

### 1. Breaking News 🚨
**Immediate interruption** - Agents stop what they're doing and discuss it right away.

```bash
# While podcast is running, type:
breaking: AI achieves AGI breakthrough
```

**What happens:**
1. Current speaker is interrupted
2. All agents react to the breaking news
3. Each agent shares their perspective
4. Conversation continues

### 2. Regular News 📰
**Background context** - Agents might reference it later in conversation.

```bash
# While podcast is running, type:
news: New study shows AI improves productivity by 40%
```

**What happens:**
1. News is added to the context
2. Agents continue current conversation
3. They might naturally reference it later
4. Doesn't interrupt the flow

## Usage Examples

### During a podcast about AI:

```bash
$ npm start

🎬 Starting real-time podcast...
📝 Topic: The Future of AI and Human Creativity

💡 Commands:
   Type a comment to interrupt the podcast
   Type "breaking: <news>" for breaking news
   Type "news: <news>" for regular news
   Type "quit" to exit

🎤 Alex speaking...
Alex: Welcome to our podcast...

> breaking: OpenAI releases GPT-5

🚨 BREAKING NEWS: OpenAI releases GPT-5

🛑 Interrupting Alex's audio
Alex: Wow! GPT-5 just dropped! This is huge for AI development...
Sam: The implications for creative work are staggering...
Jordan: Finally, an AI that can understand my jokes!

> news: Microsoft acquires another AI startup

📰 NEWS: Microsoft acquires another AI startup

# Agents continue talking, might reference it later
Sam: Speaking of acquisitions like that Microsoft deal...
```

## Programmatic API

You can also inject news programmatically:

```javascript
import { PodcastOrchestrator } from './lib/PodcastOrchestrator.js';

const podcast = new PodcastOrchestrator(configs, topic, duration);
await podcast.initialize();

// Start podcast in background
podcast.runPodcast();

// Inject breaking news
podcast.breakingNews('Major AI breakthrough announced');

// Inject regular news
podcast.regularNews('New AI regulation proposed');
```

## Use Cases

### Live Event Coverage
```bash
breaking: SpaceX successfully lands on Mars
breaking: Historic climate agreement signed
```

### Market Updates
```bash
news: Tech stocks rally on AI optimism
breaking: Major tech company announces layoffs
```

### Product Launches
```bash
breaking: Apple announces AI-powered iPhone
news: New AI coding assistant released
```

### Research Announcements
```bash
breaking: Scientists achieve nuclear fusion breakthrough
news: Study links AI usage to increased creativity
```

## Tips

1. **Breaking news** for time-sensitive, important updates
2. **Regular news** for background context and trends
3. Keep news concise (1-2 sentences)
4. Use natural language
5. Multiple breaking news items will be discussed in order

## Architecture

The news injection system uses:
- `NewsInjector` class - Manages news queue
- Breaking news queue - FIFO, immediate discussion
- Regular news context - Available for agents to reference
- Interrupt mechanism - Cleanly stops current speaker

## Example Session

```bash
# Start podcast
npm start

# Let it run for a minute...

# Inject breaking news
> breaking: Major earthquake hits California

# Agents discuss immediately

# Add context
> news: Emergency services responding

# Participate yourself
> How can AI help with disaster response?

# More breaking news
> breaking: Tech companies pledge $100M in aid

# Continue...
```

Enjoy dynamic, real-time podcast conversations! 🎙️📰
