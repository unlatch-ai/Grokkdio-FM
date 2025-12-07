/**
 * Real-time Podcast Agent
 * Each agent has its own WebSocket connection to XAI Realtime API
 */

import { XAIRealtimePlugin } from '../plugins/xai-realtime.js';

const RESET_COLOR = '\x1b[0m';

export class RealtimeAgent {
  constructor(config, topic) {
    this.config = config;
    this.topic = topic;
    this.isActive = false;
    this.isSpeaking = false;
    this.audioPlaying = false;
    this.currentTranscript = '';
    this.audioByteCount = 0;
    this.wasInterrupted = false;
    this.interruptionChance = parseFloat(process.env.AI_INTERRUPTION_CHANCE || '0.0');
    this.shouldPlayAudio = true;
    
    // Create realtime connection
    this.realtime = new XAIRealtimePlugin({
      apiKey: process.env.XAI_API_KEY,
      voiceId: config.voiceId,
      instructions: `${config.personality}\n\nTopic: ${topic}. You're in a lively multi-person podcast discussion. Feel free to jump in, agree, disagree, or build on what others say. Be conversational and natural.`
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Collect transcript as it streams
    this.realtime.on('transcript', (delta) => {
      this.currentTranscript += delta;
    });

    // Track audio bytes for duration calculation
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
      this.audioByteCount = 0;
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
    // Reset audio tracking FIRST
    this.shouldPlayAudio = true;
    this.audioByteCount = 0;
    this.wasInterrupted = false;
    this.audioPlaying = true;
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
    
    // Wait for response to complete
    const responsePromise = new Promise((resolve) => {
      this.realtime.once('response.done', () => {
        if (!this.wasInterrupted) {
          resolve();
        }
      });
    });
    
    // Check for interruption
    if (canBeInterrupted) {
      const interruptPromise = new Promise((resolve) => {
        const interruptCheck = setInterval(() => {
          if (this.wasInterrupted) {
            clearInterval(interruptCheck);
            console.log(`${this.config.color}⚡ ${this.config.name} was interrupted!${RESET_COLOR}`);
            resolve();
          }
        }, 50);
      });
      
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
    
    // Calculate remaining audio duration
    const sampleRate = 24000;
    const bytesPerSample = 2;
    const audioDurationMs = (this.audioByteCount / (sampleRate * bytesPerSample)) * 1000;
    const elapsedMs = firstAudioTime ? (Date.now() - firstAudioTime) : 0;
    const remainingMs = Math.max(0, audioDurationMs - elapsedMs + 200);
    
    if (remainingMs > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingMs));
    }
    
    this.audioPlaying = false;
  }

  async interrupt(orchestrator) {
    this.shouldPlayAudio = false;
    this.wasInterrupted = true;
    this.isActive = false;
    this.isSpeaking = false;
    this.audioPlaying = false;
    
    if (this.realtime) {
      this.realtime.cancelResponse();
    }
    
    console.log(`${this.config.color}🛑 ${this.config.name} interrupted${RESET_COLOR}`);
  }

  getName() {
    return this.config.name;
  }

  disconnect() {
    this.realtime.disconnect();
  }
}
