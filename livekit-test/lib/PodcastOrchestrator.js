/**
 * Podcast Orchestrator
 * Manages multiple agents, audio routing, and conversation flow
 */

import { AudioSource } from '@livekit/rtc-node';
import { LocalAudioPlayer } from '../plugins/local-audio-player.js';
import { TwitchStreamer } from '../plugins/twitch-streamer.js';
import { RealtimeAgent } from './RealtimeAgent.js';
import { NewsInjector } from './NewsInjector.js';
import { TextOverlayManager } from './TextOverlay.js';
import readline from 'readline';

const LOCAL_MODE = process.env.LOCAL_MODE === 'true';
const TWITCH_MODE = process.env.TWITCH_MODE === 'true';
const RESET_COLOR = '\x1b[0m';

export class PodcastOrchestrator {
  constructor(agentConfigs, topic, duration) {
    this.agentConfigs = agentConfigs;
    this.topic = topic;
    this.duration = duration;
    this.agents = [];
    this.audioSource = null;
    this.localPlayer = null;
    this.twitchStreamer = null;
    this.isRunning = false;
    this.currentSpeaker = null;
    this.userInput = null;
    this.rl = null;
    this.newsInjector = new NewsInjector();
    this.textOverlay = new TextOverlayManager();
  }

  setupInput() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    console.log('\n💡 Commands:');
    console.log('   Type a comment to interrupt the podcast');
    console.log('   Type "breaking: <news>" for breaking news');
    console.log('   Type "news: <news>" for regular news');
    console.log('   Type "text: <message>" to show overlay text (5s)');
    console.log('   Type "quit" to exit\n');

    this.rl.on('line', async (input) => {
      const trimmed = input.trim();
      
      if (trimmed.toLowerCase() === 'quit') {
        console.log('\n👋 Stopping podcast...');
        this.cleanup();
        process.exit(0);
      } else if (trimmed.toLowerCase().startsWith('breaking:')) {
        const news = trimmed.substring(9).trim();
        this.newsInjector.injectBreakingNews(news);
        
        // Interrupt current speaker
        if (this.currentSpeaker) {
          await this.currentSpeaker.interrupt(this);
        } else {
          for (const agent of this.agents) {
            if (agent.audioPlaying) {
              await agent.interrupt(this);
              break;
            }
          }
        }
      } else if (trimmed.toLowerCase().startsWith('news:')) {
        const news = trimmed.substring(5).trim();
        this.newsInjector.injectRegularNews(news);
      } else if (trimmed.toLowerCase().startsWith('text:')) {
        const text = trimmed.substring(5).trim();
        this.textOverlay.showText(text, 5000);
        
        // Also show on Twitch if streaming
        if (this.twitchStreamer) {
          this.twitchStreamer.showText(text, 5000);
        }
      } else if (trimmed) {
        this.userInput = trimmed;
        console.log(`\n🎤 YOU: "${trimmed}"\n`);
        
        // Interrupt current speaker
        if (this.currentSpeaker) {
          await this.currentSpeaker.interrupt(this);
        } else {
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
    
    this.setupInput();
    
    // Set up audio output
    if (TWITCH_MODE) {
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

    // Initialize all agents
    for (const config of this.agentConfigs) {
      const agent = new RealtimeAgent(config, this.topic);
      await agent.initialize();
      
      // Route audio from each agent to output
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

    // Opening
    const host = this.agents[0];
    await host.speak(
      `Introduce the podcast topic "${this.topic}" and welcome ${this.agents[1].getName()} and ${this.agents[2].getName()}.`,
      false
    );
    turnCount++;

    // Main conversation loop
    while (this.isRunning && turnCount < maxTurns) {
      // Check for breaking news
      if (this.newsInjector.hasBreakingNews()) {
        const news = this.newsInjector.getNextBreakingNews();
        console.log(`\n🚨 Discussing breaking news...\n`);
        
        // All agents react to breaking news
        for (const agent of this.agents) {
          this.currentSpeaker = agent;
          await agent.speak(this.newsInjector.getBreakingNewsPrompt(news), true);
          this.currentSpeaker = null;
          turnCount++;
          
          if (this.userInput || this.newsInjector.hasBreakingNews()) break;
          await new Promise(resolve => setTimeout(resolve, 600));
        }
        continue;
      }
      
      // Check for user input
      if (this.userInput) {
        const userComment = this.userInput;
        this.userInput = null;
        
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
      
      // Regular conversation
      for (let i = 0; i < this.agents.length && this.isRunning; i++) {
        const currentAgent = this.agents[i];
        const otherAgents = this.agents.filter((_, idx) => idx !== i);
        
        // Build prompt with optional news context
        let prompt = turnCount === 1 && i > 0
          ? `Respond to the introduction. Share your initial thoughts on ${this.topic}.`
          : `Continue the discussion. Build on what was just said about ${this.topic}.`;
        
        prompt += this.newsInjector.getRegularNewsContext();
        
        this.currentSpeaker = currentAgent;
        const speakPromise = currentAgent.speak(prompt, true);
        
        // Check for interruptions
        const interruptCheck = setInterval(() => {
          if (!currentAgent.isActive || currentAgent.wasInterrupted) {
            clearInterval(interruptCheck);
            return;
          }
          
          if (this.userInput || this.newsInjector.hasBreakingNews()) {
            clearInterval(interruptCheck);
            currentAgent.interrupt(this);
            return;
          }
          
          // AI interruptions
          for (const otherAgent of otherAgents) {
            if (Math.random() < otherAgent.interruptionChance * 0.05) {
              console.log(`${otherAgent.config.color}💬 ${otherAgent.config.name} wants to jump in!${RESET_COLOR}`);
              currentAgent.interrupt(this);
              clearInterval(interruptCheck);
              
              setTimeout(async () => {
                this.currentSpeaker = otherAgent;
                await otherAgent.speak(`Jump in and respond to what was just said. Be brief and conversational.`);
                this.currentSpeaker = null;
                turnCount++;
              }, 200);
              
              break;
            }
          }
        }, 200);
        
        await speakPromise;
        clearInterval(interruptCheck);
        this.currentSpeaker = null;
        
        if (!currentAgent.wasInterrupted) {
          turnCount++;
        }
        
        if (this.userInput || this.newsInjector.hasBreakingNews()) {
          break;
        }
        
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

  // Public API for news injection
  breakingNews(news) {
    this.newsInjector.injectBreakingNews(news);
  }

  regularNews(news) {
    this.newsInjector.injectRegularNews(news);
  }
}
