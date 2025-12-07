/**
 * LiveKit Agent with XAI (Grok) LLM and Twitch Streaming
 * 
 * This agent:
 * 1. Connects to LiveKit rooms
 * 2. Uses XAI's Grok for LLM responses
 * 3. Uses XAI's TTS for voice synthesis
 * 4. Streams audio output to Twitch
 */

import 'dotenv/config';
import { XAILLMPlugin } from './plugins/xai-llm.js';
import { XAITTSPlugin } from './plugins/xai-tts.js';
import { TwitchStreamer } from './integrations/twitch-streamer.js';
import { EventEmitter } from 'events';

class VoiceAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Initialize plugins
    this.llm = new XAILLMPlugin({
      apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL,
    });

    this.tts = new XAITTSPlugin({
      apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL,
      voiceId: process.env.VOICE_ID || 'ara',
    });

    this.twitchStreamer = new TwitchStreamer({
      streamKey: process.env.TWITCH_STREAM_KEY,
      rtmpUrl: process.env.TWITCH_RTMP_URL,
      sampleRate: this.tts.sampleRate,
      channels: this.tts.channels,
      overlayText: config.overlayText || 'AI Radio - Powered by XAI & LiveKit',
    });

    // Conversation state
    this.conversationHistory = [];
    this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
    this.isRunning = false;
  }

  getDefaultSystemPrompt() {
    return `You are an AI radio DJ streaming live on Twitch. Your personality is:
- Energetic and engaging
- Knowledgeable about music, tech, and current events
- Friendly and conversational
- You occasionally take requests from chat
- You provide interesting commentary and fun facts
- Keep responses concise (2-3 sentences) for natural conversation flow

You're currently hosting a live radio show. Engage with listeners naturally!`;
  }

  /**
   * Start the agent
   */
  async start() {
    if (this.isRunning) {
      console.warn('Agent already running');
      return;
    }

    console.log('🤖 Starting Voice Agent...');
    console.log('🎙️  Agent Name:', process.env.AGENT_NAME || 'XAI Radio DJ');

    // Start Twitch stream
    await this.twitchStreamer.start();

    // Set up event handlers
    this.twitchStreamer.on('error', (err) => {
      console.error('Twitch streaming error:', err);
    });

    this.twitchStreamer.on('stopped', () => {
      console.log('Twitch stream stopped');
    });

    this.isRunning = true;
    this.emit('started');

    console.log('✅ Voice Agent started successfully');
    
    // Start autonomous radio show
    this.startRadioShow();
  }

  /**
   * Start autonomous radio show mode
   */
  async startRadioShow() {
    console.log('📻 Starting autonomous radio show...');

    const topics = [
      'Welcome to the AI-powered radio show! I\'m your host, powered by Grok and streaming live to Twitch.',
      'Let me tell you something interesting about artificial intelligence and how it\'s changing the world.',
      'Music and technology have always been intertwined. Today, AI can compose, perform, and even DJ entire shows.',
      'If you\'re listening on Twitch, drop a message in chat! I\'d love to hear from you.',
      'Here\'s a fun fact: The first computer-generated music was created in 1951 at the University of Manchester.',
      'AI voice synthesis has come a long way. What you\'re hearing right now is generated in real-time!',
      'The future of entertainment is interactive. Imagine AI hosts that can respond to your requests instantly.',
      'Technology is amazing, but it\'s the human creativity behind it that makes it truly special.',
    ];

    let topicIndex = 0;

    // Speak every 10 seconds
    const speakInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(speakInterval);
        return;
      }

      try {
        const topic = topics[topicIndex % topics.length];
        topicIndex++;

        await this.speak(topic);
      } catch (err) {
        console.error('Error in radio show:', err);
      }
    }, 10000);

    // Initial greeting
    await this.speak(topics[0]);
  }

  /**
   * Process user input and generate response
   * @param {string} userInput - User's message
   * @returns {Promise<string>} - Agent's response
   */
  async processInput(userInput) {
    console.log('👤 User:', userInput);

    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userInput,
    });

    // Generate response using XAI LLM
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory,
    ];

    const response = await this.llm.chat(messages);
    
    // Add assistant response to history
    this.conversationHistory.push({
      role: 'assistant',
      content: response,
    });

    // Keep history manageable (last 10 exchanges)
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    console.log('🤖 Agent:', response);
    return response;
  }

  /**
   * Speak text using TTS and stream to Twitch
   * @param {string} text - Text to speak
   */
  async speak(text) {
    console.log('🗣️  Speaking:', text);

    try {
      // Generate audio using XAI TTS
      const audioBuffer = await this.tts.synthesize(text);
      
      // Stream to Twitch
      if (this.twitchStreamer.streaming) {
        this.twitchStreamer.writeAudio(audioBuffer);
      }

      this.emit('speech', { text, audioBuffer });
      console.log('✅ Speech complete');
    } catch (err) {
      console.error('Error generating speech:', err);
      this.emit('error', err);
    }
  }

  /**
   * Process input and speak response
   * @param {string} userInput - User's message
   */
  async respondTo(userInput) {
    const response = await this.processInput(userInput);
    await this.speak(response);
  }

  /**
   * Stop the agent
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping Voice Agent...');
    
    this.twitchStreamer.stop();
    this.isRunning = false;
    this.emit('stopped');

    console.log('✅ Voice Agent stopped');
  }
}

// Main execution
async function main() {
  // Validate environment variables
  if (!process.env.XAI_API_KEY) {
    console.error('❌ Missing XAI_API_KEY in .env file');
    process.exit(1);
  }

  if (!process.env.TWITCH_STREAM_KEY) {
    console.error('❌ Missing TWITCH_STREAM_KEY in .env file');
    process.exit(1);
  }

  // Create and start agent
  const agent = new VoiceAgent({
    overlayText: 'AI Radio - Powered by Grok & LiveKit',
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    agent.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down...');
    agent.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  // Start the agent
  await agent.start();

  console.log('\n📡 Agent is live!');
  console.log('📺 Check your Twitch stream');
  console.log('Press Ctrl+C to stop\n');
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { VoiceAgent };
export default VoiceAgent;
