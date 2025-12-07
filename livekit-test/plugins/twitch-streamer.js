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
    
    // Dynamic text overlay
    this.dynamicText = '';
    this.textFile = '/tmp/podcast-overlay-text.txt';
    
    // Create empty text file
    fs.writeFileSync(this.textFile, '');
  }

  /**
   * Start streaming to Twitch
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isStreaming) {
      console.warn('Twitch stream already running');
      return;
    }

    if (!this.streamKey) {
      throw new Error('Missing TWITCH_STREAM_KEY');
    }

    console.log('🎥 Starting Twitch stream...');

    // Check for background video
    const backgroundVideo = process.env.BACKGROUND_VIDEO || './media/gta.mp4';
    const useVideo = fs.existsSync(backgroundVideo);

    const ffmpegArgs = [
      // Video input: loop background video or fallback to static
      ...(useVideo
        ? ['-stream_loop', '-1', '-re', '-i', backgroundVideo]
        : this.coverImage && fs.existsSync(this.coverImage)
        ? ['-loop', '1', '-i', this.coverImage]
        : ['-f', 'lavfi', '-i', 'color=c=#1a1a2e:s=1280x720:r=30']
      ),
      
      // Audio input: raw PCM from stdin
      '-f', 's16le',
      '-ar', this.sampleRate.toString(),
      '-ac', this.channels.toString(),
      '-i', 'pipe:0',

      // Map only video from first input, audio from second input
      '-map', '0:v:0',  // Video from background
      '-map', '1:a:0',  // Audio from stdin (podcast)

      // Scale video and add dynamic text overlay from file
      '-vf', `scale=1280:720,drawtext=textfile='${this.textFile}':reload=1:fontsize=60:fontcolor=white:x=(w-text_w)/2:y=100:box=1:boxcolor=black@0.7:boxborderw=15`,

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
      this.isStreaming = false;
      this.emit('stopped', code);
    });

    this.isStreaming = true;
    this.emit('started');
    
    console.log('✅ Twitch stream started');
    console.log('📺 Check your stream at: https://twitch.tv/YOUR_USERNAME');
  }

  /**
   * Show dynamic text overlay
   * @param {string} text - Text to display
   * @param {number} duration - Duration in milliseconds (default 5000)
   */
  showText(text, duration = 5000) {
    try {
      fs.writeFileSync(this.textFile, text);
      console.log(`📝 Twitch overlay: "${text}"`);
      
      // Auto-hide after duration
      setTimeout(() => {
        this.hideText();
      }, duration);
    } catch (err) {
      console.error('Error showing text:', err.message);
    }
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
    if (!this.isStreaming || !this.ffmpegProcess) {
      return;
    }

    console.log('🛑 Stopping Twitch stream...');

    try {
      this.ffmpegProcess.stdin.end();
    } catch (err) {
      console.error('Error ending ffmpeg stdin:', err.message);
    }

    this.ffmpegProcess.kill('SIGINT');
    this.isStreaming = false;
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
