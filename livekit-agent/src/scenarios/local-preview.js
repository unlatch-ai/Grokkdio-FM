/**
 * Local Preview - See and hear what Twitch would receive
 * Opens a local video player showing the stream
 */

import 'dotenv/config';
import { XAILLMPlugin } from '../plugins/xai-llm.js';
import { XAITTSPlugin } from '../plugins/xai-tts.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import readline from 'readline';

class LocalPreviewAgent extends EventEmitter {
  constructor(config, llm) {
    super();
    this.name = config.name;
    this.systemPrompt = config.systemPrompt;
    this.llm = llm;
    this.tts = new XAITTSPlugin({
      apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL,
      voiceId: config.voiceId,
    });
  }

  async generateResponse(conversationContext) {
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...conversationContext,
    ];
    return await this.llm.chat(messages, {
      temperature: 0.8,
      maxTokens: 150,
    });
  }

  async speak(text) {
    return await this.tts.synthesize(text);
  }
}

class LocalPreview extends EventEmitter {
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
    this.overlayText = config.overlayText || 'AI Podcast - Local Preview';
    this.maxTurns = config.maxTurns || 10;
    this.userInput = null;
    this.isPlayingAudio = false;
    this.shouldStopAudio = false;

    this.ffplayProcess = null;
    this.ffmpegProcess = null;
    
    this.setupInput();
  }

  setupInput() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    console.log('\n💡 Type a topic/question and press Enter to inject it');
    console.log('   Type "quit" to exit\n');

    rl.on('line', (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === 'quit') {
        console.log('\n👋 Stopping...');
        this.stop();
      } else if (trimmed) {
        this.userInput = trimmed;
        
        // If audio is playing, interrupt it immediately
        if (this.isPlayingAudio) {
          this.shouldStopAudio = true;
          console.log(`\n🚨 INTERRUPTING! Stopping current audio...\n`);
        } else {
          console.log(`✅ Queued: "${trimmed}"\n`);
        }
      }
    });
  }

  addAgent(config) {
    const agent = new LocalPreviewAgent(config, this.llm);
    this.agents.push(agent);
    console.log(`✅ Added agent: ${agent.name}`);
  }

  async start() {
    if (this.isRunning) return;

    console.log('🎥 Starting Local Preview...');
    console.log(`👥 Agents: ${this.agents.map(a => a.name).join(', ')}\n`);

    // Start ffmpeg to create video with audio
    await this.startPreview();

    this.isRunning = true;
    this.emit('started');

    await this.runConversation();
  }

  async startPreview() {
    console.log('🎬 Starting video preview...');

    // FFmpeg creates video from audio + static image, outputs to ffplay
    const ffmpegArgs = [
      // Audio input from stdin
      '-f', 's16le',
      '-ar', '24000',
      '-ac', '1',
      '-i', 'pipe:0',

      // Video: blue background with text
      '-f', 'lavfi',
      '-i', 'color=c=#1a1a2e:s=1280x720:r=30',

      // Add text overlay (simplified - no timestamp to avoid escaping issues)
      '-vf', `drawtext=text='${this.overlayText}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=10`,

      // Video encoding
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-r', '30',

      // Audio encoding
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',

      // Output to pipe for ffplay
      '-f', 'mpegts',
      'pipe:1'
    ];

    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Start ffplay to display the video
    const ffplayArgs = [
      '-f', 'mpegts',
      '-i', 'pipe:0',
      '-window_title', 'AI Podcast Preview - What Twitch Would See',
      '-autoexit'
    ];

    this.ffplayProcess = spawn('ffplay', ffplayArgs, {
      stdio: ['pipe', 'inherit', 'pipe']
    });

    // Pipe ffmpeg output to ffplay
    this.ffmpegProcess.stdout.pipe(this.ffplayProcess.stdin);

    this.ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('error') || output.includes('Error')) {
        console.error('FFmpeg error:', output);
      }
    });

    this.ffplayProcess.stderr.on('data', (data) => {
      // Suppress ffplay output
    });

    this.ffmpegProcess.on('error', (err) => {
      console.error('Failed to start ffmpeg:', err.message);
      console.error('Make sure ffmpeg is installed: brew install ffmpeg');
    });

    this.ffplayProcess.on('error', (err) => {
      console.error('Failed to start ffplay:', err.message);
    });

    this.ffplayProcess.on('close', () => {
      console.log('\n🎬 Preview window closed');
      this.stop();
    });

    console.log('✅ Preview window opened\n');
  }

  async runConversation() {
    console.log('🎬 Starting conversation...\n');

    this.conversationHistory.push({
      role: 'user',
      content: `This is a conversation between ${this.agents.map(a => a.name).join(' and ')}. ${this.agents[0].name}, start the conversation.`,
    });

    let turnCount = 0;

    while (this.isRunning && turnCount < this.maxTurns) {
      // Check for user input
      if (this.userInput) {
        const input = this.userInput;
        this.userInput = null;
        
        console.log(`\n🎤 USER INTERRUPTION: "${input}"\n`);
        this.conversationHistory.push({
          role: 'user',
          content: `[URGENT - Listener interrupts to ask]: ${input}. Stop what you're saying and address this immediately.`,
        });
        
        // Reset interruption flag
        this.shouldStopAudio = false;
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

        // Generate audio (don't delay - start immediately)
        console.log(`🎵 Generating audio...`);
        
        // Start audio generation (this continues even if interrupted)
        const audioPromise = currentAgent.speak(response);
        
        // Small delay to avoid rate limiting
        await this.delay(1500);
        
        const audioBuffer = await audioPromise;
        console.log(`✅ Audio generated (${audioBuffer.length} bytes)`);

        // Calculate audio duration in milliseconds
        const sampleRate = 24000;
        const bytesPerSample = 2; // 16-bit = 2 bytes
        const channels = 1;
        const audioDurationMs = (audioBuffer.length / (sampleRate * bytesPerSample * channels)) * 1000;
        
        console.log(`🔊 Playing audio (${Math.round(audioDurationMs / 1000)}s duration)...`);

        // Play audio in chunks to allow interruption
        this.isPlayingAudio = true;
        const interrupted = await this.playInterruptibleAudio(audioBuffer, audioDurationMs);
        this.isPlayingAudio = false;
        
        if (interrupted) {
          console.log('\n⚡ INTERRUPTED! Moving to user request...\n');
          console.log('─'.repeat(60));
          // Don't increment turn or speaker - handle user input immediately
          continue;
        }
        
        console.log('✅ Audio finished playing\n');
        console.log('─'.repeat(60));
        
        this.currentSpeakerIndex = (this.currentSpeakerIndex + 1) % this.agents.length;
        turnCount++;

        // Small pause between speakers
        await this.delay(1000);

      } catch (err) {
        console.error(`Error with agent ${currentAgent.name}:`, err.message);
      }
    }

    console.log('\n🎬 Conversation ended');
    this.stop();
  }

  async playInterruptibleAudio(audioBuffer, totalDurationMs) {
    const chunkSize = 4800; // 100ms chunks at 24kHz * 2 bytes (faster interruption)
    let offset = 0;
    const chunkDurationMs = 100; // Check every 100ms for interruption
    
    while (offset < audioBuffer.length) {
      // Check for interruption BEFORE writing chunk
      if (this.shouldStopAudio) {
        console.log('🛑 Audio interrupted at', Math.round(offset / audioBuffer.length * 100) + '%');
        return true; // Interrupted
      }
      
      // Write chunk
      const chunk = audioBuffer.slice(offset, offset + chunkSize);
      if (this.ffmpegProcess && this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
        this.ffmpegProcess.stdin.write(chunk);
      }
      
      offset += chunkSize;
      
      // Wait for chunk to play (or check for interruption)
      await this.delay(chunkDurationMs);
    }
    
    return false; // Not interrupted
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    if (!this.isRunning) return;

    console.log('\n🛑 Stopping preview...');
    
    if (this.ffmpegProcess && this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
      this.ffmpegProcess.stdin.end();
    }
    
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGINT');
    }

    if (this.ffplayProcess) {
      this.ffplayProcess.kill('SIGINT');
    }

    this.isRunning = false;
    this.emit('stopped');

    console.log('✅ Preview stopped');
    setTimeout(() => process.exit(0), 500);
  }
}

async function runLocalPreview() {
  const preview = new LocalPreview({
    overlayText: 'AI Podcast - Local Preview',
    maxTurns: 10,
  });

  preview.addAgent({
    name: 'Alex',
    voiceId: 'ara',
    systemPrompt: `You are Alex, a podcast host. Keep responses to 2-3 sentences. Discuss AI topics.`,
  });

  preview.addAgent({
    name: 'Sam',
    voiceId: 'rex',
    systemPrompt: `You are Sam, an AI expert. Keep responses to 2-3 sentences. Share insights.`,
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    preview.stop();
  });

  console.log('🎙️  Starting Local Preview...\n');
  await preview.start();
}

runLocalPreview().catch(console.error);
