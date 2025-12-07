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
    this.coverImage = config.coverImage || null;
    this.overlayText = config.overlayText || 'AI Radio - Powered by XAI & LiveKit';
    
    this.ffmpegProcess = null;
    this.isStreaming = false;
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

    const ffmpegArgs = [
      // Audio input: raw PCM from stdin
      '-f', 's16le',
      '-ar', this.sampleRate.toString(),
      '-ac', this.channels.toString(),
      '-i', 'pipe:0',

      // Video input: static image or color background
      ...(this.coverImage && fs.existsSync(this.coverImage)
        ? ['-loop', '1', '-i', this.coverImage]
        : ['-f', 'lavfi', '-i', 'color=c=#1a1a2e:s=1280x720:r=30']
      ),

      // Add text overlay
      '-vf', `drawtext=text='${this.overlayText}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=10`,

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
