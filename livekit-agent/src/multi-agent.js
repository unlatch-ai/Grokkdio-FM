/**
 * Multi-Agent Conversation System
 * Multiple AI agents that can talk to each other and stream to Twitch
 */

import 'dotenv/config';
import { XAILLMPlugin } from './plugins/xai-llm.js';
import { XAITTSPlugin } from './plugins/xai-tts.js';
import { TwitchStreamer } from './integrations/twitch-streamer.js';
import { EventEmitter } from 'events';

class Agent {
  constructor(config) {
    this.name = config.name;
    this.personality = config.personality;
    this.voiceId = config.voiceId;
    this.systemPrompt = config.systemPrompt;
    this.conversationHistory = [];
    
    // Shared LLM and TTS instances
    this.llm = config.llm;
    this.tts = new XAITTSPlugin({
      apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL,
      voiceId: this.voiceId,
    });
  }

  /**
   * Generate a response based on conversation context
   * @param {Array} conversationContext - Full conversation history
   * @returns {Promise<string>} - Agent's response
   */
  async generateResponse(conversationContext) {
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...conversationContext,
    ];

    const response = await this.llm.chat(messages, {
      temperature: 0.8,
      maxTokens: 150, // Keep responses concise for natural conversation
    });

    return response;
  }

  /**
   * Synthesize speech for this agent
   * @param {string} text - Text to speak
   * @returns {Promise<Buffer>} - Audio buffer
   */
  async speak(text) {
    return await this.tts.synthesize(text);
  }
}

class MultiAgentOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Shared LLM instance
    this.llm = new XAILLMPlugin({
      apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL,
    });

    // Initialize agents
    this.agents = [];
    this.conversationHistory = [];
    this.currentSpeakerIndex = 0;
    this.isRunning = false;

    // Twitch streamer
    this.twitchStreamer = new TwitchStreamer({
      streamKey: process.env.TWITCH_STREAM_KEY,
      rtmpUrl: process.env.TWITCH_RTMP_URL,
      sampleRate: 24000,
      channels: 1,
      overlayText: config.overlayText || 'Multi-Agent AI Podcast',
    });

    // Conversation settings
    this.turnDelay = config.turnDelay || 2000; // Delay between speakers (ms)
    this.maxTurns = config.maxTurns || 50; // Max conversation turns
  }

  /**
   * Add an agent to the conversation
   * @param {Object} agentConfig - Agent configuration
   */
  addAgent(agentConfig) {
    const agent = new Agent({
      ...agentConfig,
      llm: this.llm,
    });
    this.agents.push(agent);
    console.log(`✅ Added agent: ${agent.name} (${agent.personality})`);
  }

  /**
   * Start the multi-agent conversation
   */
  async start() {
    if (this.isRunning) {
      console.warn('Multi-agent system already running');
      return;
    }

    if (this.agents.length < 2) {
      throw new Error('Need at least 2 agents for a conversation');
    }

    console.log('🎙️  Starting Multi-Agent Conversation System...');
    console.log(`👥 Agents: ${this.agents.map(a => a.name).join(', ')}`);

    // Start Twitch stream
    await this.twitchStreamer.start();

    this.isRunning = true;
    this.emit('started');

    // Start the conversation
    await this.runConversation();
  }

  /**
   * Run the conversation loop
   */
  async runConversation() {
    console.log('\n🎬 Starting conversation...\n');

    // Opening statement from first agent
    const openingPrompt = this.getOpeningPrompt();
    this.conversationHistory.push({
      role: 'user',
      content: openingPrompt,
    });

    let turnCount = 0;

    while (this.isRunning && turnCount < this.maxTurns) {
      const currentAgent = this.agents[this.currentSpeakerIndex];
      
      try {
        // Generate response
        console.log(`\n💬 ${currentAgent.name} is thinking...`);
        const response = await currentAgent.generateResponse(this.conversationHistory);
        
        // Add to conversation history
        this.conversationHistory.push({
          role: 'assistant',
          content: `${currentAgent.name}: ${response}`,
          speaker: currentAgent.name,
        });

        // Display in console
        console.log(`\n🗣️  ${currentAgent.name}: ${response}\n`);

        // Synthesize speech
        console.log(`🎵 Generating audio for ${currentAgent.name}...`);
        
        // Add delay before TTS to avoid rate limiting
        await this.delay(1500);
        
        const audioBuffer = await currentAgent.speak(response);

        // Stream to Twitch
        if (this.twitchStreamer.streaming) {
          this.twitchStreamer.writeAudio(audioBuffer);
        }

        this.emit('turn', {
          agent: currentAgent.name,
          text: response,
          audioBuffer,
        });

        // Wait before next speaker
        await this.delay(this.turnDelay);

        // Move to next agent
        this.currentSpeakerIndex = (this.currentSpeakerIndex + 1) % this.agents.length;
        turnCount++;

      } catch (err) {
        console.error(`Error with agent ${currentAgent.name}:`, err);
        this.emit('error', err);
      }
    }

    console.log('\n🎬 Conversation ended');
    this.stop();
  }

  /**
   * Get opening prompt for the conversation
   */
  getOpeningPrompt() {
    const agentNames = this.agents.map(a => a.name).join(' and ');
    return `This is a conversation between ${agentNames}. ${this.agents[0].name}, please start the conversation with a greeting and introduce the topic.`;
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Stop the multi-agent system
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('\n🛑 Stopping Multi-Agent System...');
    
    this.twitchStreamer.stop();
    this.isRunning = false;
    this.emit('stopped');

    console.log('✅ Multi-Agent System stopped');
  }

  /**
   * Get conversation transcript
   */
  getTranscript() {
    return this.conversationHistory
      .filter(msg => msg.role === 'assistant')
      .map(msg => msg.content)
      .join('\n\n');
  }
}

// Predefined agent personalities
export const AGENT_PERSONALITIES = {
  HOST: {
    name: 'Alex',
    personality: 'Enthusiastic podcast host',
    voiceId: 'ara',
    systemPrompt: `You are Alex, an enthusiastic podcast host. You:
- Keep the conversation flowing and engaging
- Ask interesting questions to your co-host
- Provide smooth transitions between topics
- Are energetic but not overwhelming
- Keep responses to 2-3 sentences for natural conversation
- Occasionally add humor and fun facts`,
  },

  EXPERT: {
    name: 'Dr. Sarah',
    personality: 'Tech expert and researcher',
    voiceId: 'eve',
    systemPrompt: `You are Dr. Sarah, a tech expert and AI researcher. You:
- Provide insightful technical knowledge
- Explain complex topics in accessible ways
- Share interesting research and developments
- Are thoughtful and articulate
- Keep responses to 2-3 sentences for natural conversation
- Balance expertise with approachability`,
  },

  COMEDIAN: {
    name: 'Chris',
    personality: 'Witty comedian',
    voiceId: 'rex',
    systemPrompt: `You are Chris, a witty comedian and entertainer. You:
- Add humor and levity to conversations
- Make clever observations and jokes
- Keep things light and fun
- Are quick with comebacks and wordplay
- Keep responses to 2-3 sentences for natural conversation
- Know when to be serious too`,
  },

  SKEPTIC: {
    name: 'Morgan',
    personality: 'Thoughtful skeptic',
    voiceId: 'sal',
    systemPrompt: `You are Morgan, a thoughtful skeptic and critical thinker. You:
- Ask probing questions
- Challenge assumptions respectfully
- Provide alternative perspectives
- Are analytical but open-minded
- Keep responses to 2-3 sentences for natural conversation
- Value evidence and reasoning`,
  },

  ENTHUSIAST: {
    name: 'Jamie',
    personality: 'Curious enthusiast',
    voiceId: 'una',
    systemPrompt: `You are Jamie, a curious and enthusiastic learner. You:
- Ask lots of questions
- Show genuine excitement about topics
- Share personal anecdotes and experiences
- Are relatable and down-to-earth
- Keep responses to 2-3 sentences for natural conversation
- Bring fresh perspectives`,
  },
};

// Main execution
async function main() {
  // Validate environment
  if (!process.env.XAI_API_KEY) {
    console.error('❌ Missing XAI_API_KEY in .env file');
    process.exit(1);
  }

  if (!process.env.TWITCH_STREAM_KEY) {
    console.error('❌ Missing TWITCH_STREAM_KEY in .env file');
    process.exit(1);
  }

  // Create orchestrator
  const orchestrator = new MultiAgentOrchestrator({
    overlayText: 'AI Podcast - Multi-Agent Conversation',
    turnDelay: 3000, // 3 seconds between speakers
    maxTurns: 30, // 30 turns total
  });

  // Add agents - you can customize this!
  orchestrator.addAgent(AGENT_PERSONALITIES.HOST);
  orchestrator.addAgent(AGENT_PERSONALITIES.EXPERT);
  orchestrator.addAgent(AGENT_PERSONALITIES.COMEDIAN);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    orchestrator.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down...');
    orchestrator.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  // Start the conversation
  await orchestrator.start();

  console.log('\n📡 Multi-Agent Podcast is live!');
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

export { MultiAgentOrchestrator, Agent };
export default MultiAgentOrchestrator;
