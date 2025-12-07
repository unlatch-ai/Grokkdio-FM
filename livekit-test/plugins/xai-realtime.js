/**
 * XAI Realtime API Plugin for LiveKit Agents
 * Uses XAI's realtime WebSocket API for streaming LLM + TTS
 * Endpoint: wss://api.x.ai/v1/chat/voice
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class XAIRealtimePlugin extends EventEmitter {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.XAI_API_KEY;
    this.baseUrl = config.baseUrl || process.env.XAI_REALTIME_URL || 'wss://api.x.ai/v1/chat/voice';
    this.voiceId = config.voiceId || 'ara';
    this.instructions = config.instructions || 'You are a helpful AI assistant.';
    this.ws = null;
    this.isConnected = false;
    this.conversationId = null;
  }

  /**
   * Connect to XAI Realtime API
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      console.log('🔌 Connecting to XAI Realtime API...');
      
      this.ws = new WebSocket(this.baseUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const timeout = setTimeout(() => {
        this.ws.close();
        reject(new Error('XAI Realtime API connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅ Connected to XAI Realtime API');
        this.isConnected = true;
        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error('❌ XAI Realtime API error:', error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔌 XAI Realtime API closed - Code: ${code}, Reason: ${reason.toString()}`);
        this.isConnected = false;
        this.emit('disconnected');
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });
    });
  }

  /**
   * Handle incoming messages from XAI
   * @param {Buffer} data - Raw message data
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());

      // Skip logging audio chunks
      if (message.type !== 'response.output_audio.delta' && 
          message.type !== 'input_audio_buffer.append') {
        console.log(`📩 XAI: ${message.type}`);
      }

      switch (message.type) {
        case 'conversation.created':
          this.conversationId = message.conversation?.id;
          console.log(`📞 Conversation created: ${this.conversationId}`);
          this.emit('conversation.created', message);
          break;

        case 'session.updated':
          console.log('⚙️  Session configured');
          this.emit('session.updated', message);
          break;

        case 'response.output_audio.delta':
          // Streaming audio from XAI (PCM16 24kHz)
          if (message.delta) {
            const audioBuffer = Buffer.from(message.delta, 'base64');
            this.emit('audio', audioBuffer);
          }
          break;

        case 'response.output_audio_transcript.delta':
          // Streaming text transcript
          this.emit('transcript', message.delta);
          break;

        case 'response.created':
          console.log('🤖 Bot started speaking');
          this.emit('response.started');
          break;

        case 'response.done':
          console.log('🤖 Bot finished speaking');
          this.emit('response.done');
          break;

        case 'input_audio_buffer.speech_started':
          console.log('🎤 User started speaking (VAD)');
          this.emit('speech.started');
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log('🛑 User stopped speaking (VAD)');
          this.emit('speech.stopped');
          break;

        case 'error':
          console.error('❌ XAI API Error:', JSON.stringify(message, null, 2));
          this.emit('error', message);
          break;

        case 'ping':
          // Silently handle pings
          break;

        default:
          // Silently handle other events
          break;
      }
    } catch (error) {
      console.error('Error parsing XAI message:', error);
    }
  }

  /**
   * Configure the session with instructions and voice
   * @param {Object} config - Session configuration
   */
  async configureSession(config = {}) {
    const sessionConfig = {
      type: 'session.update',
      session: {
        instructions: config.instructions || this.instructions,
        voice: config.voiceId || this.voiceId,
        audio: {
          input: {
            format: {
              type: 'audio/pcm',  // PCM format
              rate: 24000,        // 24kHz sample rate
            },
          },
          output: {
            format: {
              type: 'audio/pcm',  // PCM format
              rate: 24000,        // 24kHz sample rate
            },
          },
        },
        turn_detection: {
          type: 'server_vad',  // Server-side voice activity detection
        }
      }
    };

    this.send(sessionConfig);
    console.log('⚙️  Session configuration sent');
  }

  /**
   * Send a text message to the conversation
   * @param {string} text - Text to send
   */
  async sendText(text) {
    const conversationItem = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: text
          }
        ]
      }
    };

    this.send(conversationItem);

    // Trigger response generation
    const responseCreate = { type: 'response.create' };
    this.send(responseCreate);
  }

  /**
   * Send audio to the conversation
   * @param {Buffer} audioBuffer - PCM16 audio buffer
   */
  async sendAudio(audioBuffer) {
    const audioMessage = {
      type: 'input_audio_buffer.append',
      audio: audioBuffer.toString('base64')
    };

    this.send(audioMessage);
  }

  /**
   * Commit the audio buffer (trigger processing)
   */
  async commitAudio() {
    const commitMessage = { type: 'input_audio_buffer.commit' };
    this.send(commitMessage);
  }

  /**
   * Cancel the current response
   */
  async cancelResponse() {
    const cancelMessage = { type: 'response.cancel' };
    this.send(cancelMessage);
    console.log('🛑 Response cancelled');
  }

  /**
   * Send a message to XAI
   * @param {Object} message - Message object
   */
  send(message) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot send message - WebSocket not connected');
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect from XAI Realtime API
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}

export default XAIRealtimePlugin;
