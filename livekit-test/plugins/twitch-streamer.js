/**
 * Twitch Streaming Integration for LiveKit Agent
 * Streams agent audio output to Twitch via RTMP
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export class TwitchStreamer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.streamKey = config.streamKey || process.env.TWITCH_STREAM_KEY;
    this.rtmpUrl = config.rtmpUrl || process.env.TWITCH_RTMP_URL || 'rtmp://live.twitch.tv/app/';
    this.sampleRate = config.sampleRate || 24000;
    this.channels = config.channels || 1;
    this.overlayText = config.overlayText || 'AI Podcast';
    this.coverImage = config.coverImage;
    
    this.ffmpegProcess = null;
    this.isStreaming = false;
    this.keepAliveInterval = null;
    
    // Dynamic text overlay
    this.dynamicText = '';
    this.subtitleFile = path.join(process.cwd(), 'twitch-subtitle.txt');
    
    // Create empty text file
    fs.writeFileSync(this.subtitleFile, '', 'utf8');
  }

  /**
   * Start streaming to Twitch
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isStreaming && this.ffmpegProcess && !this.ffmpegProcess.killed) {
      console.warn('Twitch stream already running');
      return;
    }

    // Clean up any existing process
    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.kill('SIGKILL');
      } catch (err) {
        // Ignore
      }
      this.ffmpegProcess = null;
    }

    if (!this.streamKey) {
      throw new Error('Missing TWITCH_STREAM_KEY');
    }

    console.log('🎥 Starting Twitch stream...');

    // Check for background video
    const backgroundVideo = process.env.BACKGROUND_VIDEO || './media/gta.mp4';
    const useVideo = fs.existsSync(backgroundVideo);

    // Check for background music
    const backgroundMusic = process.env.BACKGROUND_MUSIC || path.join(process.cwd(), 'media', 'background-music.mp3');
    const hasMusic = fs.existsSync(backgroundMusic);
    
    if (hasMusic) {
      console.log(`🎵 Found background music: ${backgroundMusic}`);
    } else {
      console.log(`⚠️  No background music found at: ${backgroundMusic}`);
    }

    const ffmpegArgs = [
      // Video input: loop background video or fallback to static
      ...(useVideo
        ? ['-stream_loop', '-1', '-re', '-i', backgroundVideo]
        : this.coverImage && fs.existsSync(this.coverImage)
        ? ['-loop', '1', '-i', this.coverImage]
        : ['-f', 'lavfi', '-i', 'color=c=#1a1a2e:s=1280x720:r=30']
      ),
      
      // Audio input: raw PCM from stdin (podcast voices)
      '-f', 's16le',
      '-ar', this.sampleRate.toString(),
      '-ac', this.channels.toString(),
      '-i', 'pipe:0',

      // Background music input (optional, looped)
      ...(hasMusic
        ? ['-stream_loop', '-1', '-i', backgroundMusic, '-filter_complex', 
           '[1:a]volume=1.0[voice];[2:a]volume=0.15[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]',
           '-map', '0:v:0', '-map', '[aout]']
        : ['-map', '0:v:0', '-map', '1:a:0']
      ),

      // Scale video and add dynamic subtitle overlay from file
      '-vf', `scale=1280:720,drawtext=textfile=${this.subtitleFile}:reload=1:fontsize=32:fontcolor=white:x=(w-text_w)/2:y=h-100:box=1:boxcolor=black@0.7:boxborderw=10`,

      // Video encoding
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', '2500k',
      '-maxrate', '2500k',
      '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p',
      '-g', '60',
      '-r', '30',

      // Audio encoding
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000', // Twitch requires 48kHz

      // Output
      '-f', 'flv',
      `${this.rtmpUrl}${this.streamKey}`
    ];

    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Handle stdin errors to prevent crashes - CRITICAL!
    this.ffmpegProcess.stdin.on('error', (err) => {
      // Silently ignore EPIPE errors
      if (err.code !== 'EPIPE') {
        console.error('FFmpeg stdin error:', err.message);
      }
    });

    this.ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      // Show all ffmpeg output for debugging
      console.log('FFmpeg:', output);
    });

    this.ffmpegProcess.on('error', (err) => {
      console.error('Failed to start ffmpeg:', err.message);
      console.error('Make sure ffmpeg is installed: brew install ffmpeg');
      this.emit('error', err);
    });

    this.ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg process exited with code ${code}`);
      
      // Mark as not streaming immediately
      const wasStreaming = this.isStreaming;
      this.isStreaming = false;
      
      // Don't auto-restart - it causes issues
      // The stream should be manually restarted if needed
      if (wasStreaming) {
        console.error('⚠️  FFmpeg stream ended unexpectedly. This usually means:');
        console.error('   - Audio input stopped or had gaps');
        console.error('   - Network connection to Twitch failed');
        console.error('   - Stream key is invalid');
      }
      
      this.emit('stopped', code);
    });

    this.isStreaming = true;
    
    // Start keep-alive silence generator (sends silence every 100ms to prevent starvation)
    this.keepAliveInterval = setInterval(() => {
      if (this.isStreaming && this.ffmpegProcess && !this.ffmpegProcess.stdin.destroyed) {
        try {
          // Send 100ms of silence
          const silenceBuffer = Buffer.alloc(4800); // 100ms at 24kHz, 16-bit
          this.ffmpegProcess.stdin.write(silenceBuffer);
        } catch (err) {
          // Ignore write errors
        }
      }
    }, 100);
    
    this.emit('started');
    
    console.log('✅ Twitch stream started');
    if (hasMusic) {
      console.log('🎵 Background music enabled (15% volume)');
    }
    console.log('📺 Check your stream at: https://twitch.tv/YOUR_USERNAME');
  }

  /**
   * Update subtitle text on stream
   * @param {string} text - Subtitle text to display
   */
  updateSubtitle(text) {
    if (!this.isStreaming) return;
    
    try {
      // Write text to file - ffmpeg will reload it automatically
      fs.writeFileSync(this.subtitleFile, text, 'utf8');
    } catch (err) {
      // Ignore errors
    }
  }

  /**
   * Show text overlay on stream (legacy method)
   * @param {string} text - Text to display
   * @param {number} duration - Duration in milliseconds (default 5000)
   */
  showText(text, duration = 5000) {
    this.updateSubtitle(text);
    
    // Auto-hide after duration
    setTimeout(() => {
      this.updateSubtitle('');
    }, duration);
  }

  /**
   * Hide the text overlay
   */
  hideText() {
    try {
      fs.writeFileSync(this.textFile, '');
    } catch (err) {
      console.error('Error hiding text:', err.message);
    }
  }

  /**
   * Write audio data to the stream
   * @param {Buffer} audioData - PCM audio buffer
   */
  writeAudio(audioData) {
    if (!this.isStreaming || !this.ffmpegProcess || this.ffmpegProcess.stdin.destroyed) {
      return;
    }

    try {
      this.ffmpegProcess.stdin.write(audioData);
    } catch (err) {
      console.error('Error writing audio to stream:', err.message);
      this.emit('error', err);
    }
  }

  /**
   * Stop the Twitch stream
   */
  stop() {
    if (!this.isStreaming) {
      return;
    }

    console.log('🛑 Stopping Twitch stream...');
    this.isStreaming = false;
    
    // Stop keep-alive
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    
    // Clean up subtitle file
    try {
      if (fs.existsSync(this.subtitleFile)) {
        fs.unlinkSync(this.subtitleFile);
      }
    } catch (err) {
      // Ignore
    }

    try {
      this.ffmpegProcess.stdin.end();
    } catch (err) {
      console.error('Error ending ffmpeg stdin:', err.message);
    }

    this.ffmpegProcess.kill('SIGINT');
  }

  /**
   * Check if currently streaming
   * @returns {boolean}
   */
  get streaming() {
    return this.isStreaming;
  }
}

export default TwitchStreamer;
