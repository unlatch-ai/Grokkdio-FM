/**
 * TTS-based Podcast Agent
 * Uses separate LLM + TTS instead of realtime API
 */

import { XAILLMPlugin } from '../plugins/xai-llm.js';
import { XAITTSPlugin } from '../plugins/xai-tts.js';

const RESET_COLOR = '\x1b[0m';

export class TTSAgent {
  constructor(config, topic) {
    this.config = config;
    this.topic = topic;
    this.isActive = false;
    this.isSpeaking = false;
    this.audioPlaying = false;
    this.currentTranscript = '';
    this.wasInterrupted = false;
    this.interruptionChance = parseFloat(process.env.AI_INTERRUPTION_CHANCE || '0.0');
    this.shouldPlayAudio = true;
    this.conversationHistory = [];
    
    // Create LLM connection
    this.llm = new XAILLMPlugin({
      apiKey: process.env.XAI_API_KEY,
      model: 'grok-3',
      temperature: 0.9,
    });

    // Create TTS connection
    this.tts = new XAITTSPlugin({
      apiKey: process.env.XAI_API_KEY,
      voiceId: config.voiceId,
    });

    // Few-shot examples for emotion brackets
    const fewShotExamples = `

FEW-SHOT EXAMPLES - THIS IS HOW YOU MUST RESPOND:

Example 1:
User: "What do you think about AI?"
You: "[yells] WAKE UP! [laughs maniacally] AI is already HERE! [whispers intensely] They're watching everything... [gasps dramatically] EVERYTHING!"

Example 2:
User: "Respond to the introduction."
You: "[shouts] THANKS FOR HAVING ME! [excited] This topic is INSANE! [whispers] The truth is out there..."

Example 3:
User: "Continue the discussion."
You: "[sighs heavily] Look, [rolls eyes] that's not how it works... [laughs sarcastically] at ALL."

REMEMBER: EVERY response must have [emotion brackets] like the examples above!`;

    // System prompt
    this.systemPrompt = `${config.personality}${fewShotExamples}\n\nTopic: ${topic}. You're in a lively multi-person podcast discussion. ALWAYS use [emotion brackets] in your responses.`;
  }

  async initialize() {
    console.log(`${this.config.color}✅ ${this.config.name} initialized (LLM + TTS mode)${RESET_COLOR}`);
  }

  async generateResponseOnly(prompt) {
    // Just generate text response, don't speak it
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: prompt }
    ];

    try {
      const response = await this.llm.chat(messages);
      return response;
    } catch (error) {
      console.error(`${this.config.color}❌ ${this.config.name} pre-gen error:${RESET_COLOR}`, error.message);
      return null;
    }
  }

  async speakPreGenerated(text, audioBuffer, addToHistory = true) {
    this.isActive = true;
    this.isSpeaking = true;
    this.shouldPlayAudio = true;
    this.wasInterrupted = false;

    try {
      this.currentTranscript = text;
      console.log(`${this.config.color}${this.config.name}:${RESET_COLOR} ${text}`);

      // Add to history
      if (addToHistory) {
        this.conversationHistory.push(
          { role: 'assistant', content: text }
        );

        if (this.conversationHistory.length > 20) {
          this.conversationHistory = this.conversationHistory.slice(-20);
        }
      }

      // Play pre-generated audio
      if (this.shouldPlayAudio) {
        console.log(`${this.config.color}🔊 Playing pre-generated audio (${audioBuffer.length} bytes)${RESET_COLOR}`);
        
        this.audioPlaying = true;
        this.emit('audio', audioBuffer);
        
        // Calculate duration
        const durationMs = (audioBuffer.length / (24000 * 2)) * 1000;
        
        // Remove emotion brackets from subtitle text
        let cleanText = text.replace(/\[.*?\]/g, '').trim();
        cleanText = cleanText.toLowerCase();
        cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);
        
        // Emit subtitle event
        this.emit('subtitle', {
          name: this.config.name,
          text: cleanText,
          duration: durationMs
        });
        
        // Wait for audio to finish
        await new Promise(resolve => {
          const checkInterval = setInterval(() => {
            if (this.wasInterrupted || !this.shouldPlayAudio) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, durationMs);
        });

        this.audioPlaying = false;
        this.emit('finished');
      }

    } catch (error) {
      console.error(`${this.config.color}❌ ${this.config.name} error:${RESET_COLOR}`, error.message);
      throw error;
    } finally {
      this.isActive = false;
      this.isSpeaking = false;
      this.currentTranscript = '';
    }
  }

  async speak(prompt, addToHistory = true, preGeneratedResponse = null) {
    this.isActive = true;
    this.isSpeaking = true;
    this.shouldPlayAudio = true;
    this.wasInterrupted = false;

    try {
      let response;
      let llmTime = 0;

      // Use pre-generated response if available
      if (preGeneratedResponse) {
        response = preGeneratedResponse;
        console.log(`${this.config.color}⚡ ${this.config.name} using pre-generated response${RESET_COLOR}`);
      } else {
        // Build messages
        const messages = [
          { role: 'system', content: this.systemPrompt },
          ...this.conversationHistory,
          { role: 'user', content: prompt }
        ];

        // Get LLM response
        console.log(`${this.config.color}💭 ${this.config.name} thinking...${RESET_COLOR}`);
        
        const startTime = Date.now();
        response = await this.llm.chat(messages);
        llmTime = Date.now() - startTime;
      }
      
      this.currentTranscript = response;
      console.log(`${this.config.color}${this.config.name}:${RESET_COLOR} ${response}`);
      console.log(`${this.config.color}⏱️  LLM: ${llmTime}ms${RESET_COLOR}`);

      // Add to history
      if (addToHistory) {
        this.conversationHistory.push(
          { role: 'user', content: prompt },
          { role: 'assistant', content: response }
        );

        // Keep history manageable (last 10 messages)
        if (this.conversationHistory.length > 20) {
          this.conversationHistory = this.conversationHistory.slice(-20);
        }
      }

      // Generate audio (start immediately, no extra delay)
      if (this.shouldPlayAudio) {
        console.log(`${this.config.color}🎵 Generating audio...${RESET_COLOR}`);
        const ttsStart = Date.now();
        const audioBuffer = await this.tts.synthesize(response);
        const ttsTime = Date.now() - ttsStart;
        console.log(`${this.config.color}⏱️  TTS: ${ttsTime}ms (${audioBuffer.length} bytes)${RESET_COLOR}`);
        
        this.audioPlaying = true;
        this.emit('audio', audioBuffer);
        
        // Calculate duration
        const durationMs = (audioBuffer.length / (24000 * 2)) * 1000;
        
        // Remove emotion brackets from subtitle text
        let cleanText = response.replace(/\[.*?\]/g, '').trim();
        
        // Convert to normal case (lowercase with first letter capitalized)
        cleanText = cleanText.toLowerCase();
        cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);
        
        // Emit subtitle event with timing info
        this.emit('subtitle', {
          name: this.config.name,
          text: cleanText,
          duration: durationMs
        });
        
        // Wait for audio to finish (or be interrupted)
        await new Promise(resolve => {
          const checkInterval = setInterval(() => {
            if (this.wasInterrupted || !this.shouldPlayAudio) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, durationMs);
        });

        this.audioPlaying = false;
        this.emit('finished'); // Signal that audio is done
      }

    } catch (error) {
      console.error(`${this.config.color}❌ ${this.config.name} error:${RESET_COLOR}`, error.message);
      throw error;
    } finally {
      this.isActive = false;
      this.isSpeaking = false;
      this.currentTranscript = '';
    }
  }

  async interrupt(orchestrator) {
    this.wasInterrupted = true;
    this.shouldPlayAudio = false;
    this.audioPlaying = false;
    console.log(`${this.config.color}⚡ ${this.config.name} interrupted!${RESET_COLOR}`);
  }

  getName() {
    return this.config.name;
  }

  async cleanup() {
    // Nothing to cleanup for LLM + TTS
  }
}

// Make it an EventEmitter
import { EventEmitter } from 'events';
Object.setPrototypeOf(TTSAgent.prototype, EventEmitter.prototype);
