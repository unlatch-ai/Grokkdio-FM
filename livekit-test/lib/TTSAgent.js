/**
 * TTS-based Podcast Agent
 * Uses separate LLM + TTS instead of realtime API
 * Supports both preset voices (XAITTSPlugin) and voice cloning (XAITTSClonePlugin)
 */

import { XAILLMPlugin } from "../plugins/xai-llm.js";
import { XAITTSPlugin } from "../plugins/xai-tts.js";
import { XAITTSClonePlugin } from "../plugins/xai-tts-clone.js";

const RESET_COLOR = "\x1b[0m";

export class TTSAgent {
  constructor(config, topic) {
    this.config = config;
    this.topic = topic;
    this.isActive = false;
    this.isSpeaking = false;
    this.audioPlaying = false;
    this.currentTranscript = "";
    this.wasInterrupted = false;
    this.interruptionChance = parseFloat(
      process.env.AI_INTERRUPTION_CHANCE || "0.0"
    );
    this.shouldPlayAudio = true;
    this.conversationHistory = [];

    // Create LLM connection
    this.llm = new XAILLMPlugin({
      apiKey: process.env.XAI_API_KEY,
      model: "grok-3",
      temperature: 0.9,
    });

    // Create TTS connection - use voice cloning if voiceFile is specified
    if (config.voiceFile) {
      this.tts = new XAITTSClonePlugin({
        apiKey: process.env.XAI_API_KEY,
        voiceFile: config.voiceFile,
        instructions: config.voiceInstructions || "audio",
      });
      this.useVoiceCloning = true;
    } else {
      this.tts = new XAITTSPlugin({
        apiKey: process.env.XAI_API_KEY,
        voiceId: config.voiceId,
      });
      this.useVoiceCloning = false;
    }

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
    // Initialize TTS plugin (loads voice file for cloning)
    if (this.tts.initialize) {
      await this.tts.initialize();
    }

    const modeStr = this.useVoiceCloning ? "voice cloning" : "preset voice";
    console.log(
      `${this.config.color}✅ ${this.config.name} initialized (LLM + TTS, ${modeStr})${RESET_COLOR}`
    );
  }

  async generateResponseOnly(prompt) {
    // Just generate text response, don't speak it
    const messages = [
      { role: "system", content: this.systemPrompt },
      ...this.conversationHistory,
      { role: "user", content: prompt },
    ];

    try {
      const response = await this.llm.chat(messages);
      return response;
    } catch (error) {
      console.error(
        `${this.config.color}❌ ${this.config.name} pre-gen error:${RESET_COLOR}`,
        error.message
      );
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
      console.log(
        `${this.config.color}${this.config.name}:${RESET_COLOR} ${text}`
      );

      // Add to history
      if (addToHistory) {
        this.conversationHistory.push({ role: "assistant", content: text });

        if (this.conversationHistory.length > 12) {
          this.conversationHistory = this.conversationHistory.slice(-12);
        }
      }

      // Play pre-generated audio in chunks
      if (this.shouldPlayAudio) {
        console.log(
          `${this.config.color}🔊 Playing pre-generated audio (${audioBuffer.length} bytes)${RESET_COLOR}`
        );

        this.audioPlaying = true;

        // Split into 100ms chunks to prevent buffer overflow
        const chunkSize = 4800; // 100ms at 24kHz, 16-bit
        for (let i = 0; i < audioBuffer.length; i += chunkSize) {
          if (this.wasInterrupted || !this.shouldPlayAudio) break;

          const chunk = audioBuffer.slice(i, i + chunkSize);
          this.emit("audio", chunk);
        }

        // Calculate duration
        const durationMs = (audioBuffer.length / (24000 * 2)) * 1000;

        // Remove emotion brackets from subtitle text
        let cleanText = text.replace(/\[.*?\]/g, "").trim();
        cleanText = cleanText.toLowerCase();
        cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);

        // Emit subtitle event
        this.emit("subtitle", {
          name: this.config.name,
          text: cleanText,
          duration: durationMs,
        });

        // Wait for audio to finish
        await new Promise((resolve) => {
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
        this.emit("finished");
      }
    } catch (error) {
      console.error(
        `${this.config.color}❌ ${this.config.name} error:${RESET_COLOR}`,
        error.message
      );
      throw error;
    } finally {
      this.isActive = false;
      this.isSpeaking = false;
      this.currentTranscript = "";
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
        console.log(
          `${this.config.color}⚡ ${this.config.name} using pre-generated response${RESET_COLOR}`
        );
      } else {
        // Build messages
        const messages = [
          { role: "system", content: this.systemPrompt },
          ...this.conversationHistory,
          { role: "user", content: prompt },
        ];

        // Get LLM response
        console.log(
          `${this.config.color}💭 ${this.config.name} thinking...${RESET_COLOR}`
        );

        const startTime = Date.now();
        response = await this.llm.chat(messages);
        llmTime = Date.now() - startTime;
      }

      this.currentTranscript = response;
      console.log(
        `${this.config.color}${this.config.name}:${RESET_COLOR} ${response}`
      );
      console.log(`${this.config.color}⏱️  LLM: ${llmTime}ms${RESET_COLOR}`);

      // Add to history
      if (addToHistory) {
        this.conversationHistory.push(
          { role: "user", content: prompt },
          { role: "assistant", content: response }
        );

        // Keep history manageable (last 6 messages)
        if (this.conversationHistory.length > 12) {
          this.conversationHistory = this.conversationHistory.slice(-12);
        }
      }

      // Generate audio (start immediately, no extra delay)
      if (this.shouldPlayAudio) {
        console.log(`${this.config.color}🎵 Generating audio...${RESET_COLOR}`);
        const ttsStart = Date.now();
        const audioBuffer = await this.tts.synthesize(response);
        const ttsTime = Date.now() - ttsStart;
        console.log(
          `${this.config.color}⏱️  Generated TTS: ${ttsTime}ms (${audioBuffer.length} bytes)${RESET_COLOR}`
        );

        this.audioPlaying = true;
        this.emit("audio", audioBuffer);

        // Calculate duration
        const durationMs = (audioBuffer.length / (24000 * 2)) * 1000;

        // Remove emotion brackets from subtitle text
        let cleanText = response.replace(/\[.*?\]/g, "").trim();

        // Convert to normal case (lowercase with first letter capitalized)
        cleanText = cleanText.toLowerCase();
        cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);

        // Emit subtitle event with timing info
        this.emit("subtitle", {
          name: this.config.name,
          text: cleanText,
          duration: durationMs,
        });

        // Wait for audio to finish (or be interrupted)
        await new Promise((resolve) => {
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
        this.emit("finished"); // Signal that audio is done
      }
    } catch (error) {
      console.error(
        `${this.config.color}❌ ${this.config.name} error:${RESET_COLOR}`,
        error.message
      );
      throw error;
    } finally {
      this.isActive = false;
      this.isSpeaking = false;
      this.currentTranscript = "";
    }
  }

  // Speak using external shared history (prompt already contains context)
  async speakWithHistory(prompt) {
    this.isActive = true;
    this.isSpeaking = true;
    this.shouldPlayAudio = true;
    this.wasInterrupted = false;

    try {
      // Build messages - use system prompt + external prompt (no internal history)
      const messages = [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: prompt },
      ];

      // Get LLM response
      console.log(
        `${this.config.color}💭 ${this.config.name} thinking...${RESET_COLOR}`
      );

      const startTime = Date.now();
      const response = await this.llm.chat(messages);
      const llmTime = Date.now() - startTime;

      this.currentTranscript = response;
      console.log(
        `${this.config.color}${this.config.name}:${RESET_COLOR} ${response}`
      );
      console.log(`${this.config.color}⏱️  LLM: ${llmTime}ms${RESET_COLOR}`);

      // Generate audio
      if (this.shouldPlayAudio) {
        console.log(`${this.config.color}🎵 Generating audio...${RESET_COLOR}`);
        const ttsStart = Date.now();
        const audioBuffer = await this.tts.synthesize(response);
        const ttsTime = Date.now() - ttsStart;
        console.log(
          `${this.config.color}⏱️  Generated TTS: ${ttsTime}ms (${audioBuffer.length} bytes)${RESET_COLOR}`
        );

        this.audioPlaying = true;
        this.emit("audio", audioBuffer);

        // Calculate duration
        const durationMs = (audioBuffer.length / (24000 * 2)) * 1000;

        // Remove emotion brackets from subtitle text
        let cleanText = response.replace(/\[.*?\]/g, "").trim();
        cleanText = cleanText.toLowerCase();
        cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);

        // Emit subtitle event
        this.emit("subtitle", {
          name: this.config.name,
          text: cleanText,
          duration: durationMs,
        });

        // Wait for audio to finish (or be interrupted)
        await new Promise((resolve) => {
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
        this.emit("finished");
      }

      return response;
    } catch (error) {
      console.error(
        `${this.config.color}❌ ${this.config.name} error:${RESET_COLOR}`,
        error.message
      );
      throw error;
    } finally {
      this.isActive = false;
      this.isSpeaking = false;
    }
  }

  // Generate text response only (for pipelined conversation)
  async generateResponse(prompt) {
    this.isActive = true;
    this.wasInterrupted = false;

    const messages = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: prompt },
    ];

    console.log(
      `${this.config.color}💭 ${this.config.name} thinking...${RESET_COLOR}`
    );

    const startTime = Date.now();
    const response = await this.llm.chat(messages);
    const llmTime = Date.now() - startTime;

    this.currentTranscript = response;
    console.log(
      `${this.config.color}${this.config.name}:${RESET_COLOR} ${response}`
    );
    console.log(`${this.config.color}⏱️  LLM: ${llmTime}ms${RESET_COLOR}`);

    return response;
  }

  // Generate TTS and play audio for already-generated text (for pipelined conversation)
  async playAudio(text) {
    if (!text || this.wasInterrupted) return;

    this.isSpeaking = true;
    this.shouldPlayAudio = true;

    try {
      console.log(`${this.config.color}🎵 Generating audio...${RESET_COLOR}`);
      const ttsStart = Date.now();
      const audioBuffer = await this.tts.synthesize(text);
      const ttsTime = Date.now() - ttsStart;
      console.log(
        `${this.config.color}⏱️  Generated TTS: ${ttsTime}ms (${audioBuffer.length} bytes)${RESET_COLOR}`
      );

      if (this.wasInterrupted) return;

      const durationMs = (audioBuffer.length / (24000 * 2)) * 1000;
      const playStartTime = Date.now();

      console.log(
        `${this.config.color}▶️  PLAY START: fresh audio (${
          audioBuffer.length
        } bytes, ${durationMs.toFixed(0)}ms duration)${RESET_COLOR}`
      );

      this.audioPlaying = true;
      this.emit("audio", audioBuffer);

      // Subtitle - clean up emotion brackets
      let cleanText = text.replace(/\[.*?\]/g, "").trim();
      cleanText = cleanText.toLowerCase();
      cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);

      this.emit("subtitle", {
        name: this.config.name,
        text: cleanText,
        duration: durationMs,
      });

      // Wait for audio to finish (or be interrupted)
      await new Promise((resolve) => {
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

      const playEndTime = Date.now();
      console.log(
        `${this.config.color}⏹️  PLAY END: actually waited ${
          playEndTime - playStartTime
        }ms${RESET_COLOR}`
      );

      this.audioPlaying = false;
      this.emit("finished");
    } finally {
      this.isSpeaking = false;
      this.isActive = false;
    }
  }

  // Play pre-generated audio buffer (skips TTS entirely - for pipelined conversation)
  async playPreGeneratedAudio(text, audioBuffer) {
    if (!audioBuffer || this.wasInterrupted) return;

    this.isSpeaking = true;
    this.shouldPlayAudio = true;
    this.currentTranscript = text;

    try {
      const durationMs = (audioBuffer.length / (24000 * 2)) * 1000 - 2000;
      const playStartTime = Date.now();

      console.log(
        `${this.config.color}▶️  PLAY START: pre-gen audio (${
          audioBuffer.length
        } bytes, ${durationMs.toFixed(0)}ms duration)${RESET_COLOR}`
      );

      if (this.wasInterrupted) return;

      this.audioPlaying = true;
      this.emit("audio", audioBuffer);

      // Subtitle - clean up emotion brackets
      let cleanText = text.replace(/\[.*?\]/g, "").trim();
      cleanText = cleanText.toLowerCase();
      cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);

      this.emit("subtitle", {
        name: this.config.name,
        text: cleanText,
        duration: durationMs,
      });

      // Wait for audio to finish (or be interrupted)
      await new Promise((resolve) => {
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

      const playEndTime = Date.now();
      console.log(
        `${this.config.color}⏹️  PLAY END: actually waited ${
          playEndTime - playStartTime
        }ms${RESET_COLOR}`
      );

      this.audioPlaying = false;
      this.emit("finished");
    } finally {
      this.isSpeaking = false;
      this.isActive = false;
    }
  }

  async interrupt() {
    this.wasInterrupted = true;
    this.shouldPlayAudio = false;
    this.audioPlaying = false;
    console.log(
      `${this.config.color}⚡ ${this.config.name} interrupted!${RESET_COLOR}`
    );
  }

  getName() {
    return this.config.name;
  }

  /**
   * Split text into sentences for sentence-by-sentence playback
   * Handles emotion brackets like [laughs] that shouldn't be split
   */
  splitIntoSentences(text) {
    // Match sentences ending with . ! ? followed by space or end
    // But preserve emotion brackets that might span sentences
    const sentences = [];

    // Split on sentence-ending punctuation followed by space or end
    const parts = text.split(/(?<=[.!?])\s+/);

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        sentences.push(trimmed);
      }
    }

    // If no sentences found, return the whole text as one
    if (sentences.length === 0 && text.trim()) {
      sentences.push(text.trim());
    }

    return sentences;
  }

  /**
   * Play audio sentence-by-sentence with interruption checks between sentences.
   * Generates ALL audio upfront, then plays with overlap for seamless playback.
   *
   * @param {string} text - Full text to speak
   * @param {Function} checkInterruption - Callback that returns true if interrupted
   * @returns {Promise<boolean>} - Returns true if completed, false if interrupted
   */
  async playAudioSentenceBySentence(text, checkInterruption) {
    if (!text || this.wasInterrupted) return false;

    const sentences = this.splitIntoSentences(text);
    console.log(
      `${this.config.color}📝 Split into ${sentences.length} sentences${RESET_COLOR}`
    );

    if (sentences.length === 0) return true;

    this.isSpeaking = true;
    this.shouldPlayAudio = true;
    this.currentTranscript = text;

    try {
      // STEP 1: Generate ALL audio upfront in parallel
      console.log(
        `${this.config.color}🎵 Generating all ${sentences.length} sentence audios upfront...${RESET_COLOR}`
      );
      const ttsStartAll = Date.now();

      const audioBuffers = await Promise.all(
        sentences.map(async (sentence, idx) => {
          const ttsStart = Date.now();
          const audio = await this.tts.synthesize(sentence);
          const ttsTime = Date.now() - ttsStart;
          console.log(
            `${this.config.color}  ✓ Sentence ${idx + 1}: ${ttsTime}ms (${
              audio.length
            } bytes)${RESET_COLOR}`
          );
          return audio;
        })
      );

      const totalTtsTime = Date.now() - ttsStartAll;
      console.log(
        `${this.config.color}⏱️  All TTS done in ${totalTtsTime}ms${RESET_COLOR}`
      );

      // Check for interruption after TTS generation
      if (this.wasInterrupted || (checkInterruption && checkInterruption())) {
        console.log(
          `${this.config.color}🛑 Interrupted after TTS generation${RESET_COLOR}`
        );
        return false;
      }

      // STEP 2: Play sentences with overlap (add next 2s before current ends)
      const OVERLAP_MS = 2000; // Add next sentence 2s before current ends

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const audioBuffer = audioBuffers[i];
        const isLastSentence = i === sentences.length - 1;

        // Check for interruption before each sentence
        if (this.wasInterrupted || (checkInterruption && checkInterruption())) {
          console.log(
            `${this.config.color}🛑 INTERRUPTED before sentence ${i + 1}/${
              sentences.length
            } - stopping playback${RESET_COLOR}`
          );
          this.wasInterrupted = true;
          this.audioPlaying = false;
          return false;
        }

        console.log(
          `${this.config.color}🎤 Playing sentence ${i + 1}/${
            sentences.length
          }: "${sentence}"${RESET_COLOR}`
        );

        // Calculate audio duration
        const durationMs = (audioBuffer.length / (24000 * 2)) * 1000;

        // Start playing this sentence
        const playStartTime = Date.now();
        this.audioPlaying = true;
        this.emit("audio", audioBuffer);

        // Emit subtitle for this sentence
        let cleanText = sentence.replace(/\[.*?\]/g, "").trim();
        cleanText = cleanText.toLowerCase();
        cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);

        this.emit("subtitle", {
          name: this.config.name,
          text: cleanText,
          duration: durationMs,
        });

        // Calculate wait time - reduced overlap for tighter timing
        const waitTime = isLastSentence
          ? durationMs
          : Math.max(100, durationMs - OVERLAP_MS);

        console.log(
          `${this.config.color}   ⏱️  Audio duration: ${durationMs.toFixed(
            0
          )}ms, will wait: ${waitTime.toFixed(0)}ms (overlap: ${
            isLastSentence ? 0 : OVERLAP_MS
          }ms)${RESET_COLOR}`
        );

        // Wait for audio (or until overlap point for next sentence)
        const waitStartTime = Date.now();
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (this.wasInterrupted || !this.shouldPlayAudio) {
              clearInterval(checkInterval);
              resolve();
            }
            if (checkInterruption && checkInterruption()) {
              this.wasInterrupted = true;
              clearInterval(checkInterval);
              resolve();
            }
          }, 50);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, waitTime);
        });

        const actualWait = Date.now() - waitStartTime;
        const totalElapsed = Date.now() - playStartTime;
        console.log(
          `${this.config.color}   ⏹️  Sentence ${
            i + 1
          } wait done - waited ${actualWait}ms (total elapsed since emit: ${totalElapsed}ms)${RESET_COLOR}`
        );

        // If interrupted during playback, stop immediately
        if (this.wasInterrupted) {
          console.log(
            `${this.config.color}🛑 INTERRUPTED during sentence ${
              i + 1
            } - stopping remaining ${
              sentences.length - i - 1
            } sentences${RESET_COLOR}`
          );
          this.audioPlaying = false;
          return false;
        }
      }

      this.audioPlaying = false;
      this.emit("finished");
      return true;
    } finally {
      this.isSpeaking = false;
      this.audioPlaying = false;
      this.isActive = false;
    }
  }

  /**
   * Play pre-generated audio sentence-by-sentence with interruption checks.
   * This version takes the full response text and pre-generated audio for the FIRST sentence,
   * then generates remaining sentences in parallel before playing with overlap.
   *
   * @param {string} text - Full text to speak
   * @param {Buffer} firstSentenceAudio - Pre-generated audio for first sentence (optional)
   * @param {Function} checkInterruption - Callback that returns true if interrupted
   * @returns {Promise<boolean>} - Returns true if completed, false if interrupted
   */
  async playPreGeneratedAudioSentenceBySentence(
    text,
    firstSentenceAudio,
    checkInterruption
  ) {
    if (!text || this.wasInterrupted) return false;

    const sentences = this.splitIntoSentences(text);
    console.log(
      `${this.config.color}📝 Split into ${sentences.length} sentences (first may be prefetched)${RESET_COLOR}`
    );

    if (sentences.length === 0) return true;

    this.isSpeaking = true;
    this.shouldPlayAudio = true;
    this.currentTranscript = text;

    try {
      // STEP 1: Generate ALL audio upfront (use firstSentenceAudio if provided)
      console.log(
        `${this.config.color}🎵 Generating remaining sentence audios...${RESET_COLOR}`
      );
      const ttsStartAll = Date.now();

      const audioBuffers = await Promise.all(
        sentences.map(async (sentence, idx) => {
          // Use pre-generated first sentence if available
          if (idx === 0 && firstSentenceAudio) {
            console.log(
              `${this.config.color}  ✓ Sentence 1: using pre-generated audio (${firstSentenceAudio.length} bytes)${RESET_COLOR}`
            );
            return firstSentenceAudio;
          }

          const ttsStart = Date.now();
          const audio = await this.tts.synthesize(sentence);
          const ttsTime = Date.now() - ttsStart;
          console.log(
            `${this.config.color}  ✓ Sentence ${idx + 1}: ${ttsTime}ms (${
              audio.length
            } bytes)${RESET_COLOR}`
          );
          return audio;
        })
      );

      const totalTtsTime = Date.now() - ttsStartAll;
      console.log(
        `${this.config.color}⏱️  All TTS done in ${totalTtsTime}ms${RESET_COLOR}`
      );

      // Check for interruption after TTS generation
      if (this.wasInterrupted || (checkInterruption && checkInterruption())) {
        console.log(
          `${this.config.color}🛑 Interrupted after TTS generation${RESET_COLOR}`
        );
        return false;
      }

      // STEP 2: Play sentences with minimal overlap for seamless flow
      const OVERLAP_MS = 500; // Reduced overlap - just 500ms for smooth transition

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const audioBuffer = audioBuffers[i];
        const isLastSentence = i === sentences.length - 1;

        // Check for interruption before each sentence
        if (this.wasInterrupted || (checkInterruption && checkInterruption())) {
          console.log(
            `${this.config.color}🛑 INTERRUPTED before sentence ${i + 1}/${
              sentences.length
            } - stopping playback${RESET_COLOR}`
          );
          this.wasInterrupted = true;
          this.audioPlaying = false;
          return false;
        }

        console.log(
          `${this.config.color}🎤 Playing sentence ${i + 1}/${
            sentences.length
          }: "${sentence}"${RESET_COLOR}`
        );

        // Calculate audio duration
        const durationMs = (audioBuffer.length / (24000 * 2)) * 1000;

        // Start playing this sentence
        const playStartTime = Date.now();
        this.audioPlaying = true;
        this.emit("audio", audioBuffer);

        // Emit subtitle for this sentence
        let cleanText = sentence.replace(/\[.*?\]/g, "").trim();
        cleanText = cleanText.toLowerCase();
        cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);

        this.emit("subtitle", {
          name: this.config.name,
          text: cleanText,
          duration: durationMs,
        });

        // Calculate wait time - reduced overlap for tighter timing
        const waitTime = isLastSentence
          ? durationMs
          : Math.max(100, durationMs - OVERLAP_MS);

        console.log(
          `${this.config.color}   ⏱️  Audio duration: ${durationMs.toFixed(
            0
          )}ms, will wait: ${waitTime.toFixed(0)}ms (overlap: ${
            isLastSentence ? 0 : OVERLAP_MS
          }ms)${RESET_COLOR}`
        );

        // Wait for audio (or until overlap point for next sentence)
        const waitStartTime = Date.now();
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (this.wasInterrupted || !this.shouldPlayAudio) {
              clearInterval(checkInterval);
              resolve();
            }
            if (checkInterruption && checkInterruption()) {
              this.wasInterrupted = true;
              clearInterval(checkInterval);
              resolve();
            }
          }, 50);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, waitTime);
        });

        const actualWait = Date.now() - waitStartTime;
        const totalElapsed = Date.now() - playStartTime;
        console.log(
          `${this.config.color}   ⏹️  Sentence ${
            i + 1
          } wait done - waited ${actualWait}ms (total elapsed since emit: ${totalElapsed}ms)${RESET_COLOR}`
        );

        // If interrupted during playback, stop immediately
        if (this.wasInterrupted) {
          console.log(
            `${this.config.color}🛑 INTERRUPTED during sentence ${
              i + 1
            } - stopping remaining ${
              sentences.length - i - 1
            } sentences${RESET_COLOR}`
          );
          this.audioPlaying = false;
          return false;
        }
      }

      this.audioPlaying = false;
      this.emit("finished");
      return true;
    } finally {
      this.isSpeaking = false;
      this.audioPlaying = false;
      this.isActive = false;
    }
  }

  async cleanup() {
    // Nothing to cleanup for LLM + TTS
  }
}

// Make it an EventEmitter
import { EventEmitter } from "events";
Object.setPrototypeOf(TTSAgent.prototype, EventEmitter.prototype);
