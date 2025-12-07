/**
 * AI Podcast - Main Entry Point
 * Real-time multi-agent podcast with XAI Realtime API
 */

import { WorkerOptions, cli, defineAgent } from '@livekit/agents';
import { PodcastOrchestrator } from './lib/PodcastOrchestrator.js';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const LOCAL_MODE = process.env.LOCAL_MODE === 'true';

// Agent configurations
const AGENT_CONFIGS = [
  {
    name: 'Alex',
    voiceId: 'ara',
    personality: 'You are Alex, a conspiracy theorist. Keep responses to 1-2 sentences. Be controversal and engaging.',
    color: '\x1b[36m'
  },
  {
    name: 'Sam',
    voiceId: 'deedee',
    personality: 'You are Sam, a thoughtful expert. Keep responses to 1-2 sentences. Provide insights.',
    color: '\x1b[33m'
  },
  {
    name: 'Jordan',
    voiceId: 'paul',
    personality: 'You are Jordan, a witty commentator. Keep responses to 1-2 sentences. Add humor.',
    color: '\x1b[35m'
  }
];

// Define LiveKit agent
export default defineAgent({
  entry: async (ctx) => {
    const topic = process.env.PODCAST_TOPIC || 'The Future of AI and Human Creativity';
    const duration = parseInt(process.env.PODCAST_DURATION || '5');
    
    const podcast = new PodcastOrchestrator(AGENT_CONFIGS, topic, duration);
    await podcast.initialize(ctx.room);
    await podcast.runPodcast();
  },
});

// Main execution
async function main() {
  if (!process.env.XAI_API_KEY) {
    console.error('❌ Missing XAI_API_KEY');
    process.exit(1);
  }

  const topic = process.env.PODCAST_TOPIC || 'The Future of AI and Human Creativity';
  const duration = parseInt(process.env.PODCAST_DURATION || '5');

  console.log('🚀 Starting AI Podcast...');
  console.log(`📝 Topic: ${topic}`);
  console.log(`⏱️  Duration: ${duration} minutes`);
  console.log(`🔌 Mode: ${LOCAL_MODE ? 'Local Preview' : process.env.TWITCH_MODE === 'true' ? 'Twitch Streaming' : 'LiveKit'}\n`);

  if (LOCAL_MODE || process.env.TWITCH_MODE === 'true') {
    // Run locally or stream to Twitch
    const podcast = new PodcastOrchestrator(AGENT_CONFIGS, topic, duration);
    await podcast.initialize(null);
    await podcast.runPodcast();
    process.exit(0);
  } else {
    // Use LiveKit Agents framework
    const workerOptions = new WorkerOptions({
      agent: fileURLToPath(import.meta.url),
    });
    await cli.runApp(workerOptions);
  }
}

process.on('SIGINT', () => {
  console.log('\n⚠️  Shutting down...');
  process.exit(0);
});

main().catch(console.error);
