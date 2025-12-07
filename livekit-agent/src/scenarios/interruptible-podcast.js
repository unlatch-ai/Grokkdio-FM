/**
 * Interruptible Podcast - Real-time interruptions
 * Agents can interrupt each other, and you can interrupt them mid-speech
 */

import 'dotenv/config';
import { XAILLMPlugin } from '../plugins/xai-llm.js';
import { XAITTSPlugin } from '../plugins/xai-tts.js';
import { TwitchStreamer } from '../integrations/twitch-streamer.js';
import { EventEmitter } from 'events';
import readline from 'readline';

class InterruptibleAgent extends EventEmitter {
  constructor(config, llm) {
    super();
    this.name = config.name;
    this.personality = config.personality;
    this.systemPrompt = config.systemPrompt;
    this.voiceId = config.voiceId;
    this.interruptionChance = config.interruptionChance || 0.3; // 30% chance to interrupt
    
    this.llm = llm;
    this.tts = new XAITTSPlugin({
      apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL,
      voiceId: this.voiceId,
    });
    
    this.isSpeaking = false;
    this.shouldStop = false;
  }

  async generateResponse(conversationContext) {
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...conversationContext,
    ];

    return await this.llm.chat(messages, {
      temperature: 0.9,
      maxTokens: 100, // Shorter for more dynamic conversation
    });
  }

  async speak(text) {
    this.isSpeaking = true;
    this.shouldStop = false;
    
    try {
      const audioBuffer = await this.tts.synthesize(text);
      return audioBuffer;
    } finally {
      this.isSpeaking = false;
    }
  }

  stopSpeaking() {
    this.shouldStop = true;
    this.isSpeaking = false;
  }

  shouldInterrupt() {
    // Random chance to interrupt
    return Math.random() < this.interruptionChance;
  }
}

class InterruptiblePodcast extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.llm = new XAILLMPlugin({
      apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL,
    });

    this.agents = [];
    this.conversationHistory = [];
    this.currentSpeakerIndex = 0;
    this.isRunning = false;
    this.userInterruption = null;
    this.agentInterruption = null;

    this.twitchStreamer = new TwitchStreamer({
      streamKey: process.env.TWITCH_STREAM_KEY,
      rtmpUrl: process.env.TWITCH_RTMP_URL,
      sampleRate: 24000,
      channels: 1,
      overlayText: config.overlayText || 'Interruptible AI Podcast',
    });

    this.maxTurns = config.maxTurns || 50;
    this.setupInteractiveInput();
  }

  setupInteractiveInput() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    console.log('\n💡 Interrupt Mode:');
    console.log('   - Type anything and press Enter to INTERRUPT the current speaker');
    console.log('   - Type "quit" to exit\n');

    rl.on('line', (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === 'quit') {
        console.log('\n👋 Stopping podcast...');
        this.stop();
        process.exit(0);
      } else if (trimmed) {
        this.userInterruption = trimmed;
        console.log(`\n🚨 INTERRUPTING with: "${trimmed}"\n`);
      }
    });
  }

  addAgent(config) {
    const agent = new InterruptibleAgent(config, this.llm);
    this.agents.push(agent);
    console.log(`✅ Added agent: ${agent.name}`);
  }

  async start() {
    if (this.isRunning) return;

    console.log('🎙️  Starting Interruptible Podcast...');
    console.log(`👥 Agents: ${this.agents.map(a => a.name).join(', ')}`);

    await this.twitchStreamer.start();

    this.isRunning = true;
    this.emit('started');

    await this.runConversation();
  }

  async runConversation() {
    console.log('\n🎬 Starting conversation...\n');

    // Opening
    this.conversationHistory.push({
      role: 'user',
      content: `This is a dynamic conversation between ${this.agents.map(a => a.name).join(' and ')}. ${this.agents[0].name}, start the conversation about AI.`,
    });

    let turnCount = 0;

    while (this.isRunning && turnCount < this.maxTurns) {
      const currentAgent = this.agents[this.currentSpeakerIndex];
      
      try {
        console.log(`💬 ${currentAgent.name} is thinking...`);
        
        const response = await currentAgent.generateResponse(this.conversationHistory);
        
        this.conversationHistory.push({
          role: 'assistant',
          content: `${currentAgent.name}: ${response}`,
          speaker: currentAgent.name,
        });

        console.log(`\n🗣️  ${currentAgent.name}: ${response}\n`);

        // Generate audio
        console.log(`🎵 Generating audio...`);
        await this.delay(1500);
        
        const audioBuffer = await currentAgent.speak(response);

        // Start playing audio
        console.log(`🔊 Playing audio (${audioBuffer.length} bytes)...`);
        
        // Play audio in chunks to allow interruption
        const interrupted = await this.playInterruptibleAudio(audioBuffer, currentAgent);

        if (interrupted) {
          console.log(`\n⚡ ${currentAgent.name} was INTERRUPTED!\n`);
          
          // Handle interruption
          if (this.userInterruption) {
            // User interrupted
            const userInput = this.userInterruption;
            this.userInterruption = null;
            
            this.conversationHistory.push({
              role: 'user',
              content: `[INTERRUPTION] User says: "${userInput}". Acknowledge the interruption and respond.`,
            });
            
            console.log(`👤 USER: ${userInput}\n`);
          } else if (this.agentInterruption !== null) {
            // Agent interrupted
            const interruptingAgentIndex = this.agentInterruption;
            this.agentInterruption = null;
            
            this.currentSpeakerIndex = interruptingAgentIndex;
            console.log(`🎤 ${this.agents[interruptingAgentIndex].name} jumps in!\n`);
            continue;
          }
        }

        await this.delay(1000);

        // Check if another agent wants to interrupt
        for (let i = 0; i < this.agents.length; i++) {
          if (i !== this.currentSpeakerIndex && this.agents[i].shouldInterrupt()) {
            this.agentInterruption = i;
            break;
          }
        }

        // Move to next agent (unless interrupted)
        if (this.agentInterruption === null) {
          this.currentSpeakerIndex = (this.currentSpeakerIndex + 1) % this.agents.length;
        }
        
        turnCount++;

      } catch (err) {
        console.error(`Error with agent ${currentAgent.name}:`, err.message);
      }
    }

    console.log('\n🎬 Conversation ended');
    this.stop();
  }

  async playInterruptibleAudio(audioBuffer, agent) {
    const chunkSize = 48000; // 1 second of audio at 24kHz * 2 bytes
    let offset = 0;
    let interrupted = false;

    while (offset < audioBuffer.length && !interrupted) {
      // Check for interruptions
      if (this.userInterruption || this.agentInterruption !== null) {
        interrupted = true;
        agent.stopSpeaking();
        break;
      }

      // Write chunk to Twitch
      const chunk = audioBuffer.slice(offset, offset + chunkSize);
      if (this.twitchStreamer.streaming) {
        this.twitchStreamer.writeAudio(chunk);
      }

      offset += chunkSize;
      
      // Small delay to allow interruption checking
      await this.delay(100);
    }

    return interrupted;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    if (!this.isRunning) return;

    console.log('\n🛑 Stopping podcast...');
    
    this.twitchStreamer.stop();
    this.isRunning = false;
    this.emit('stopped');

    console.log('✅ Podcast stopped');
  }
}

async function runInterruptiblePodcast() {
  const podcast = new InterruptiblePodcast({
    overlayText: 'Interruptible AI Podcast - Live Interruptions',
    maxTurns: 50,
  });

  // Add agents with different interruption personalities
  podcast.addAgent({
    name: 'Alex',
    personality: 'Enthusiastic host who sometimes interrupts',
    voiceId: 'ara',
    interruptionChance: 0.25,
    systemPrompt: `You are Alex, an enthusiastic podcast host. You:
- Sometimes get excited and jump in
- Keep responses to 1-2 sentences
- React naturally to interruptions
- Build on others' points`,
  });

  podcast.addAgent({
    name: 'Sam',
    personality: 'Opinionated expert who interrupts often',
    voiceId: 'rex',
    interruptionChance: 0.4,
    systemPrompt: `You are Sam, an opinionated AI expert. You:
- Often interrupt with strong opinions
- Keep responses to 1-2 sentences
- Challenge others' points
- Are passionate about AI`,
  });

  podcast.addAgent({
    name: 'Jordan',
    personality: 'Thoughtful contributor, rarely interrupts',
    voiceId: 'sal',
    interruptionChance: 0.15,
    systemPrompt: `You are Jordan, a thoughtful contributor. You:
- Rarely interrupt, prefer to listen
- Keep responses to 1-2 sentences
- Add nuanced perspectives
- Are diplomatic`,
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    podcast.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  console.log('🎙️  Starting Interruptible Podcast...\n');
  await podcast.start();
}

runInterruptiblePodcast().catch(console.error);
