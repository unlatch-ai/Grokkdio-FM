/**
 * Real-time Multi-Agent Podcast using XAI Realtime API
 * 
 * Features:
 * - Streaming WebSocket connections for each agent
 * - Real-time audio generation (LLM + TTS combined)
 * - Interruptible conversations with VAD
 * - Low-latency audio streaming
 */

import { WorkerOptions, cli, defineAgent } from '@livekit/agents';
import { AudioSource } from '@livekit/rtc-node';
import { XAIRealtimePlugin } from './plugins/xai-realtime.js';
import { LocalAudioPlayer } from './plugins/local-audio-player.js';
import { TwitchStreamer } from './plugins/twitch-streamer.js';
import { fileURLToPath } from 'node:url';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

const LOCAL_MODE = process.env.LOCAL_MODE === 'true';
const TWITCH_MODE = process.env.TWITCH_MODE === 'true';

// Podcast agent personalities
const AGENTS = [
  {
    name: 'Alex',
    voiceId: 'ara',
    personality: 'You are Alex, an enthusiastic podcast host. Keep responses to 1-2 sentences. Be conversational and engaging.',
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

const RESET_COLOR = '\x1b[0m';

/**
 * Real-time Podcast Agent
 * Each agent has its own WebSocket connection to XAI Realtime API
 */
class RealtimeAgent {
  constructor(config, topic) {
    this.config = config;
    this.topic = topic;
    this.isActive = false;
    this.isSpeaking = false;
    this.audioPlaying = false; // True while audio is being output
    this.currentTranscript = '';
    this.audioByteCount = 0;
    this.wasInterrupted = false;
    this.interruptionChance = parseFloat(process.env.AI_INTERRUPTION_CHANCE || '0.0'); // Configurable via env
    this.shouldPlayAudio = true; // Flag to control audio output
    
    // Create realtime connection
    this.realtime = new XAIRealtimePlugin({
      apiKey: process.env.XAI_API_KEY,
      voiceId: config.voiceId,
      instructions: `${config.personality}\n\nTopic: ${topic}. You're in a lively multi-person podcast discussion. Feel free to jump in, agree, disagree, or build on what others say. Be conversational and natural.`
    });

    // Set up event handlers
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Collect transcript as it streams
    this.realtime.on('transcript', (delta) => {
      this.currentTranscript += delta;
    });

    // Track audio bytes for duration calculation
    // Only count if we're actually playing this audio
    this.realtime.on('audio', (audioBuffer) => {
      if (this.shouldPlayAudio) {
        this.audioByteCount += audioBuffer.length;
      }
    });

    // Log when agent speaks
    this.realtime.on('response.started', () => {
      this.isActive = true;
      this.isSpeaking = true;
      this.shouldPlayAudio = true;
      this.audioByteCount = 0; // Reset counter
      console.log(`${this.config.color}🎤 ${this.config.name} speaking...${RESET_COLOR}`);
    });

    this.realtime.on('response.done', () => {
      if (this.currentTranscript) {
        console.log(`${this.config.color}${this.config.name}:${RESET_COLOR} ${this.currentTranscript}`);
      }
      this.isActive = false;
      this.isSpeaking = false;
      this.currentTranscript = '';
    });

    // Handle interruptions
    this.realtime.on('speech.started', () => {
      console.log(`${this.config.color}⚡ ${this.config.name} interrupted!${RESET_COLOR}`);
    });

    // Handle errors
    this.realtime.on('error', (error) => {
      console.error(`${this.config.color}❌ ${this.config.name} error:${RESET_COLOR}`, error);
    });
  }

  async initialize() {
    await this.realtime.connect();
    
    // Wait for session to be ready
    await new Promise((resolve) => {
      this.realtime.once('conversation.created', () => {
        this.realtime.configureSession({
          instructions: this.realtime.instructions,
          voiceId: this.config.voiceId
        });
      });
      
      this.realtime.once('session.updated', resolve);
    });

    console.log(`✅ ${this.config.name} connected`);
  }

  async speak(prompt, canBeInterrupted = true) {
    // Reset audio tracking FIRST - critical to set shouldPlayAudio immediately
    this.shouldPlayAudio = true;
    this.audioByteCount = 0;
    this.wasInterrupted = false;
    this.audioPlaying = true; // Mark that audio will be playing
    let firstAudioTime = null;
    let audioStarted = false;
    
    // Track when first audio arrives
    const firstAudioHandler = () => {
      if (!firstAudioTime) {
        firstAudioTime = Date.now();
        audioStarted = true;
      }
    };
    this.realtime.on('audio', firstAudioHandler);
    
    // Send prompt to generate response
    await this.realtime.sendText(prompt);
    
    // Wait for response to complete (audio is already streaming)
    // Can be interrupted by external call to interrupt()
    const responsePromise = new Promise((resolve) => {
      this.realtime.once('response.done', () => {
        if (!this.wasInterrupted) {
          resolve();
        }
      });
    });
    
    // Check for interruption very frequently if allowed
    if (canBeInterrupted) {
      const interruptPromise = new Promise((resolve) => {
        const interruptCheck = setInterval(() => {
          if (this.wasInterrupted) {
            clearInterval(interruptCheck);
            console.log(`${this.config.color}⚡ ${this.config.name} was interrupted!${RESET_COLOR}`);
            resolve();
          }
        }, 50); // Check every 50ms for faster interruption
      });
      
      // Wait for either response to complete OR interruption
      await Promise.race([responsePromise, interruptPromise]);
    } else {
      await responsePromise;
    }
    
    // Remove the first audio handler
    this.realtime.off('audio', firstAudioHandler);
    
    // If interrupted, don't wait for remaining audio
    if (this.wasInterrupted) {
      this.audioPlaying = false;
      return;
    }
    
    // Calculate how long the audio should take to play
    // PCM 24kHz, 16-bit, mono: 2 bytes per sample
    const sampleRate = 24000;
    const bytesPerSample = 2;
    const audioDurationMs = (this.audioByteCount / (sampleRate * bytesPerSample)) * 1000;
    
    // Calculate how much time has elapsed since FIRST AUDIO (not since start)
    const elapsedMs = firstAudioTime ? (Date.now() - firstAudioTime) : 0;
    
    // Wait for remaining audio duration (if any)
    const remainingMs = Math.max(0, audioDurationMs - elapsedMs + 200); // Add 200ms buffer
    
    if (remainingMs > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingMs));
    }
    
    // Audio finished playing
    this.audioPlaying = false;
  }

  async interrupt(orchestrator) {
    // FIRST: Stop audio from being sent (most critical)
    this.shouldPlayAudio = false;
    this.wasInterrupted = true;
    this.isActive = false;
    this.isSpeaking = false;
    this.audioPlaying = false;
    
    // SECOND: Cancel the response at XAI (stops new audio generation)
    if (this.realtime) {
      this.realtime.cancelResponse();
    }
    
    // Don't restart the video window - too slow
    // Just let the buffered audio finish and new audio won't play
    
    console.log(`${this.config.color}🛑 ${this.config.name} interrupted${RESET_COLOR}`);
  }

  getName() {
    return this.config.name;
  }

  disconnect() {
    this.realtime.disconnect();
  }
}

/**
 * Real-time Podcast Orchestrator
 * Manages multiple agents and audio routing
 */
class RealtimePodcastOrchestrator {
  constructor(topic, duration) {
    this.topic = topic;
    this.duration = duration;
    this.agents = [];
    this.audioSource = null;
    this.localPlayer = null;
    this.twitchStreamer = null;
    this.isRunning = false;
    this.currentSpeakerIndex = 0;
    this.currentSpeaker = null;
    this.userInput = null;
    this.rl = null;
  }

  setupInput() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    console.log('\n💡 Type your comment and press Enter to interrupt the podcast');
    console.log('   Type "quit" to exit\n');

    this.rl.on('line', async (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === 'quit') {
        console.log('\n👋 Stopping podcast...');
        this.cleanup();
        process.exit(0);
      } else if (trimmed) {
        this.userInput = trimmed;
        console.log(`\n🎤 YOU: "${trimmed}"\n`);
        
        // Interrupt current speaker OR any agent still playing audio
        if (this.currentSpeaker) {
          await this.currentSpeaker.interrupt(this);
        } else {
          // Check if any agent is still playing audio
          for (const agent of this.agents) {
            if (agent.audioPlaying) {
              console.log(`${agent.config.color}🛑 Interrupting ${agent.config.name}'s audio${RESET_COLOR}`);
              await agent.interrupt(this);
              break;
            }
          }
        }
      }
    });
  }

  async initialize(room) {
    console.log('🎙️  Initializing Real-time Podcast...\n');
    
    // Set up CLI input
    this.setupInput();
    
    // Set up audio output
    if (TWITCH_MODE) {
      // Twitch streaming mode
      this.twitchStreamer = new TwitchStreamer({
        streamKey: process.env.TWITCH_STREAM_KEY,
        rtmpUrl: process.env.TWITCH_RTMP_URL,
        sampleRate: 24000,
        channels: 1,
        overlayText: `AI Podcast - ${this.topic}`
      });
      await this.twitchStreamer.start();
      console.log('📺 Streaming to Twitch!');
    } else if (LOCAL_MODE) {
      this.localPlayer = new LocalAudioPlayer({
        sampleRate: 24000,
        channels: 1,
        overlayText: `AI Podcast - ${this.topic}`,
        showVideo: true
      });
      await this.localPlayer.start();
    } else if (room) {
      this.audioSource = new AudioSource(24000, 1);
      await room.localParticipant.publishTrack({
        source: this.audioSource,
        name: 'podcast-audio'
      });
      console.log('🎵 Audio track published to LiveKit');
    }

    // Initialize all agents with realtime connections
    for (const config of AGENTS) {
      const agent = new RealtimeAgent(config, this.topic);
      await agent.initialize();
      
      // Route audio from each agent to output
      // Only play if agent's shouldPlayAudio flag is true
      agent.realtime.on('audio', (audioBuffer) => {
        if (this.isRunning && agent.shouldPlayAudio) {
          this.playAudio(audioBuffer);
        }
      });
      
      this.agents.push(agent);
    }

    console.log('\n🎬 All agents ready!\n');
  }

  async runPodcast() {
    console.log('🎬 Starting real-time podcast...');
    console.log(`📝 Topic: ${this.topic}\n`);
    
    this.isRunning = true;
    let turnCount = 0;
    const maxTurns = this.duration * 3;

    // Opening - host introduces (can't be interrupted)
    const host = this.agents[0];
    await host.speak(
      `Introduce the podcast topic "${this.topic}" and welcome ${this.agents[1].getName()} and ${this.agents[2].getName()}.`,
      false // Don't allow interruption on intro
    );
    turnCount++;

    // Main conversation - agents take turns with possible interruptions
    while (this.isRunning && turnCount < maxTurns) {
      // Check if user interrupted
      if (this.userInput) {
        const userComment = this.userInput;
        this.userInput = null;
        
        // Pick a random agent to respond to user
        const responder = this.agents[Math.floor(Math.random() * this.agents.length)];
        console.log(`${responder.config.color}${responder.config.name} responding to you...${RESET_COLOR}`);
        
        this.currentSpeaker = responder;
        await responder.speak(
          `A listener just said: "${userComment}". Respond to their comment directly and briefly.`,
          true
        );
        this.currentSpeaker = null;
        turnCount++;
        
        await new Promise(resolve => setTimeout(resolve, 600));
        continue;
      }
      
      for (let i = 0; i < this.agents.length && this.isRunning; i++) {
        const currentAgent = this.agents[i];
        const otherAgents = this.agents.filter((_, idx) => idx !== i);
        
        // Build conversational prompt
        const prompt = turnCount === 1 && i > 0
          ? `Respond to the introduction. Share your initial thoughts on ${this.topic}.`
          : `Continue the discussion. Build on what was just said about ${this.topic}.`;
        
        // Track current speaker
        this.currentSpeaker = currentAgent;
        
        // Start speaking (can be interrupted)
        const speakPromise = currentAgent.speak(prompt, true);
        
        // Frequently check if another agent wants to interrupt OR user interrupted
        const interruptCheck = setInterval(() => {
          if (!currentAgent.isActive || currentAgent.wasInterrupted) {
            clearInterval(interruptCheck);
            return;
          }
          
          // Check for user interruption (high priority)
          if (this.userInput) {
            clearInterval(interruptCheck);
            currentAgent.interrupt(this); // Fire and forget - don't await in interval
            return;
          }
          
          // Random chance for each other agent to interrupt
          for (const otherAgent of otherAgents) {
            if (Math.random() < otherAgent.interruptionChance * 0.05) { // Adjusted for faster checks
              console.log(`${otherAgent.config.color}💬 ${otherAgent.config.name} wants to jump in!${RESET_COLOR}`);
              
              // Interrupt current speaker
              currentAgent.interrupt(this); // Fire and forget - don't await in interval
              clearInterval(interruptCheck);
              
              // Let the interrupter speak
              setTimeout(async () => {
                this.currentSpeaker = otherAgent;
                await otherAgent.speak(
                  `Jump in and respond to what was just said. Be brief and conversational.`
                );
                this.currentSpeaker = null;
                turnCount++;
              }, 200);
              
              break;
            }
          }
        }, 200); // Check every 200ms for faster response
        
        await speakPromise;
        clearInterval(interruptCheck);
        this.currentSpeaker = null;
        
        if (!currentAgent.wasInterrupted) {
          turnCount++;
        }
        
        // Check if user interrupted during this turn
        if (this.userInput) {
          // Don't pause, handle user input immediately
          break; // Exit the for loop to handle user input
        }
        
        // Brief pause between speakers
        await new Promise(resolve => setTimeout(resolve, 600));
        
        if (turnCount >= maxTurns) break;
      }
    }

    // Closing
    if (this.isRunning) {
      await host.speak('Wrap up the podcast and thank everyone.', false);
    }

    console.log('\n🎬 Podcast complete!');
    this.cleanup();
  }

  playAudio(audioBuffer) {
    if (!this.isRunning) return;
    
    if (TWITCH_MODE && this.twitchStreamer) {
      this.twitchStreamer.writeAudio(audioBuffer);
    } else if (LOCAL_MODE && this.localPlayer) {
      this.localPlayer.writeAudio(audioBuffer);
    } else if (this.audioSource) {
      const frame = {
        data: audioBuffer,
        sampleRate: 24000,
        numChannels: 1,
        samplesPerChannel: audioBuffer.length / 2
      };
      this.audioSource.captureFrame(frame);
    }
  }

  cleanup() {
    this.isRunning = false;
    
    for (const agent of this.agents) {
      agent.disconnect();
    }
    
    if (this.twitchStreamer) {
      this.twitchStreamer.stop();
    }
    
    if (this.localPlayer) {
      this.localPlayer.stop();
    }
    
    if (this.rl) {
      this.rl.close();
    }
  }
}

// Define LiveKit agent
export default defineAgent({
  entry: async (ctx) => {
    const topic = process.env.PODCAST_TOPIC || 'The Future of AI and Human Creativity';
    const duration = parseInt(process.env.PODCAST_DURATION || '5');
    
    const podcast = new RealtimePodcastOrchestrator(topic, duration);
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

  console.log('🚀 Starting Real-time Podcast...');
  console.log(`📝 Topic: ${topic}`);
  console.log(`⏱️  Duration: ${duration} minutes`);
  console.log(`🔌 Mode: ${LOCAL_MODE ? 'Local Preview' : 'LiveKit Streaming'}\n`);

  if (LOCAL_MODE) {
    // Run locally
    const podcast = new RealtimePodcastOrchestrator(topic, duration);
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
