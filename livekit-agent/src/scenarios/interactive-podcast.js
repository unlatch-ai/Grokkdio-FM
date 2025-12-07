/**
 * Interactive Podcast - Inject topics during conversation
 * Press Enter to inject a topic or question
 */

import 'dotenv/config';
import { MultiAgentOrchestrator } from '../multi-agent.js';
import readline from 'readline';

class InteractivePodcast extends MultiAgentOrchestrator {
  constructor(config) {
    super(config);
    this.userInjections = [];
    this.setupInteractiveInput();
  }

  setupInteractiveInput() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    console.log('\n💡 Interactive Mode: Type a topic/question and press Enter to inject it into the conversation');
    console.log('   Example: "What about AI ethics?"');
    console.log('   Type "quit" to exit\n');

    rl.on('line', (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === 'quit') {
        console.log('\n👋 Stopping podcast...');
        this.stop();
        process.exit(0);
      } else if (trimmed) {
        this.userInjections.push(trimmed);
        console.log(`✅ Queued: "${trimmed}"\n`);
      }
    });
  }

  async runConversation() {
    console.log('\n🎬 Starting conversation...\n');

    // Opening statement
    const openingPrompt = this.getOpeningPrompt();
    this.conversationHistory.push({
      role: 'user',
      content: openingPrompt,
    });

    let turnCount = 0;

    while (this.isRunning && turnCount < this.maxTurns) {
      // Check for user injections
      if (this.userInjections.length > 0) {
        const injection = this.userInjections.shift();
        console.log(`\n🎤 USER INJECTION: "${injection}"\n`);
        
        // Add user injection to conversation
        this.conversationHistory.push({
          role: 'user',
          content: `[Listener question/topic]: ${injection}. Please address this in your next response.`,
        });
      }

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

        // Synthesize speech
        console.log(`🎵 Generating audio for ${currentAgent.name}...`);
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
}

async function runInteractivePodcast() {
  const podcast = new InteractivePodcast({
    overlayText: 'Interactive AI Podcast - Live Q&A',
    turnDelay: 3000,
    maxTurns: 50,
  });

  // Add podcast host
  podcast.addAgent({
    name: 'Alex',
    personality: 'Interactive podcast host',
    voiceId: 'ara',
    systemPrompt: `You are Alex, host of an interactive podcast. You:
- Welcome listener questions and topics enthusiastically
- Acknowledge when addressing listener input
- Keep responses to 2-3 sentences
- Engage naturally with your co-host
- Transition smoothly between topics`,
  });

  // Add expert
  podcast.addAgent({
    name: 'Dr. Chen',
    personality: 'AI expert',
    voiceId: 'rex',
    systemPrompt: `You are Dr. Chen, an AI researcher. You:
- Answer listener questions clearly
- Provide expert insights
- Keep responses to 2-3 sentences
- Build on your co-host's points
- Make complex topics accessible`,
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    podcast.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  console.log('🎙️  Starting Interactive Podcast...\n');
  await podcast.start();
}

runInteractivePodcast().catch(console.error);
