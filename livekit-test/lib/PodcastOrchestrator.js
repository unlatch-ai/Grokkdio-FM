/**
 * Podcast Orchestrator
 * Manages multiple agents, audio routing, and conversation flow
 */

import { AudioSource } from "@livekit/rtc-node";
import { LocalAudioPlayer } from "../plugins/local-audio-player.js";
import { TwitchStreamer } from "../plugins/twitch-streamer.js";
import { TTSAgent } from "./TTSAgent.js";
import { NewsInjector } from "./NewsInjector.js";
import { TextOverlayManager } from "./TextOverlay.js";
import { showTweetOverlay } from "./TweetOverlay.js";
import { TrendInjector } from "./TrendInjector.js";
import { audioBus } from "./AudioBus.js";
import { sendAudioToTwilioCalls } from "../twilio-server.js";
import readline from "readline";

const LOCAL_MODE = process.env.LOCAL_MODE === "true";
const TWITCH_MODE = process.env.TWITCH_MODE === "true";
const RESET_COLOR = "\x1b[0m";

export class PodcastOrchestrator {
  constructor(agentConfigs, topic) {
    this.agentConfigs = agentConfigs;
    this.topic = topic;
    this.agents = [];
    this.audioSource = null;
    this.localPlayer = null;
    this.twitchStreamer = null;
    this.isRunning = false;
    this.currentSpeaker = null;
    this.userInput = null;
    this.rl = null;
    this.newsInjector = new NewsInjector();
    this.trendInjector = new TrendInjector({ autoIntervalMinutes: 2 });
    this.textOverlay = null; // Will be initialized after localPlayer
    this.sharedHistory = []; // Shared conversation history between agents
    this.pendingTrendPrompt = null; // Trend prompt waiting to be injected
  }

  setupInput() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "",
    });

    console.log("\n💡 Commands:");
    console.log("   Type a comment to interrupt the podcast");
    console.log('   Type "breaking: <news>" for breaking news');
    console.log('   Type "news: <news>" for regular news');
    console.log('   Type "text: <message>" to show overlay text (5s)');
    console.log('   Type "tweet: <url>" to show a tweet overlay (15s)');
    console.log('   Type "trends" to fetch and inject a trending topic');
    console.log('   Type "quit" to exit\n');

    this.rl.on("line", async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === "quit") {
        console.log("\n👋 Stopping podcast...");
        this.cleanup();
        process.exit(0);
      } else if (trimmed.toLowerCase().startsWith("breaking:")) {
        const news = trimmed.substring(9).trim();
        this.newsInjector.injectBreakingNews(news);

        // Interrupt current speaker
        if (this.currentSpeaker) {
          await this.currentSpeaker.interrupt();
        } else {
          for (const agent of this.agents) {
            if (agent.audioPlaying) {
              await agent.interrupt();
              break;
            }
          }
        }
      } else if (trimmed.toLowerCase().startsWith("news:")) {
        const news = trimmed.substring(5).trim();
        this.newsInjector.injectRegularNews(news);
      } else if (trimmed.toLowerCase().startsWith("text:")) {
        const text = trimmed.substring(5).trim();
        this.textOverlay.showText(text, 5000);

        // Also show on Twitch if streaming
        if (this.twitchStreamer) {
          this.twitchStreamer.showText(text, 5000);
        }
      } else if (trimmed.toLowerCase().startsWith("tweet:")) {
        const tweetUrl = trimmed.substring(6).trim();
        console.log(`\n📸 Capturing tweet: ${tweetUrl}`);

        // Get the active player
        const player = this.twitchStreamer || this.localPlayer;
        if (player) {
          showTweetOverlay(player, tweetUrl, { duration: 90000 })
            .then(() => console.log("✅ Tweet overlay shown"))
            .catch((err) => console.error("❌ Tweet error:", err.message));
        } else {
          console.log("⚠️  No video player active for overlay");
        }
      } else if (trimmed.toLowerCase() === "trends") {
        console.log("\n📊 Fetching trending topics...");
        this.trendInjector
          .fetchAndInject()
          .then((result) => {
            if (result) {
              this.pendingTrendPrompt = result.prompt;
              console.log(
                `\n🔥 Trend ready: "${result.trend}" - will inject on next turn`
              );

              // Interrupt current speaker to inject trend faster
              if (this.currentSpeaker) {
                this.currentSpeaker.interrupt();
              }
            }
          })
          .catch((err) => console.error("❌ Trend error:", err.message));
      } else if (trimmed) {
        this.userInput = trimmed;
        console.log(`\n🎤 YOU: "${trimmed}"\n`);

        // Interrupt current speaker
        if (this.currentSpeaker) {
          await this.currentSpeaker.interrupt();
        } else {
          for (const agent of this.agents) {
            if (agent.audioPlaying) {
              console.log(
                `${agent.config.color}🛑 Interrupting ${agent.config.name}'s audio${RESET_COLOR}`
              );
              await agent.interrupt();
              break;
            }
          }
        }
      }
    });
  }

  async initialize(room) {
    console.log("🎙️  Initializing Real-time Podcast...\n");

    this.setupInput();

    // Set up audio output and register with audio bus
    if (TWITCH_MODE) {
      this.twitchStreamer = new TwitchStreamer({
        streamKey: process.env.TWITCH_STREAM_KEY,
        overlayText: `AI Podcast: ${this.topic}`,
        enableSubtitles: process.env.ENABLE_SUBTITLES === "true",
      });
      this.twitchStreamer.name = "Twitch";
      await this.twitchStreamer.start();
      audioBus.addOutput(this.twitchStreamer);
      console.log("🎥 Twitch stream started");

      // Initialize text overlay with Twitch streamer reference
      this.textOverlay = new TextOverlayManager(this.twitchStreamer);

      // Listen for stream failures
      this.twitchStreamer.on("stopped", ({ code, signal }) => {
        console.error(`🚨 Stream died! code=${code}, signal=${signal}`);
        this.isRunning = false;
      });
    } else if (LOCAL_MODE) {
      this.localPlayer = new LocalAudioPlayer({
        overlayText: `AI Podcast: ${this.topic}`,
        showVideo: true,
        enableSubtitles: process.env.ENABLE_SUBTITLES === "true",
      });
      this.localPlayer.name = "Local";
      await this.localPlayer.start();
      audioBus.addOutput(this.localPlayer);

      // Initialize text overlay with local player reference
      this.textOverlay = new TextOverlayManager(this.localPlayer);
    } else if (room) {
      this.audioSource = new AudioSource(24000, 1);
      await room.localParticipant.publishTrack({
        source: this.audioSource,
        name: "podcast-audio",
      });
      console.log("🎵 Audio track published to LiveKit");

      // Wrap audioSource for audio bus
      const livekitOutput = {
        name: "LiveKit",
        writeAudio: (buffer) => this.audioSource.captureFrame(buffer),
      };
      audioBus.addOutput(livekitOutput);

      // Initialize text overlay without local player
      this.textOverlay = new TextOverlayManager();
    }

    // Fallback if text overlay wasn't initialized
    if (!this.textOverlay) {
      this.textOverlay = new TextOverlayManager();
    }

    // Create agents
    console.log("\n🤖 Creating agents...");
    for (const config of this.agentConfigs) {
      const agent = new TTSAgent(config, this.topic);

      // Handle audio output - route through audio bus
      agent.on("audio", (audioBuffer) => {
        // Send to audio bus - it will distribute to all outputs
        audioBus.writeAudio(audioBuffer);
      });

      // Handle subtitles with typewriter effect
      agent.on("subtitle", (data) => {
        this.textOverlay.showTypingText(data.name, data.text, data.duration);
      });

      this.agents.push(agent);
    }

    // Set up trend injector with player for tweet overlays
    const player = this.twitchStreamer || this.localPlayer;
    if (player) {
      this.trendInjector.setPlayer(player);
    }

    // Listen for trend ready events (from auto-fetch)
    this.trendInjector.on("trendReady", ({ trend, prompt }) => {
      console.log(`\n🔥 Auto-trend ready: "${trend}"`);
      this.pendingTrendPrompt = prompt;
    });

    // Start auto-fetching trends every 5 minutes (but not at minute 0)
    if (process.env.X_BEARER_TOKEN) {
      this.trendInjector.startAutoFetch();
    } else {
      console.log("⚠️  X_BEARER_TOKEN not set - trend auto-fetch disabled");
    }

    console.log("\n🎬 All agents ready!\n");
  }

  async runPodcast() {
    console.log("🎬 Starting real-time podcast...");
    console.log(`📝 Topic: ${this.topic}\n`);

    this.isRunning = true;

    // Opening - first agent introduces (no pipelining for first turn)
    const host = this.agents[0];
    const otherAgent = this.agents[1];

    await this.agentSpeak(
      host,
      `Give a very brief (1-2 sentence) intro and greet ${otherAgent.getName()}. Keep it short and punchy about "${
        this.topic
      }".`
    );

    // Main conversation loop with pipelining and sentence-by-sentence playback
    let currentSpeakerIdx = 1; // Start with agent B since A just introduced
    let preGenerated = null; // Pre-generated { text, firstSentenceAudio } for next speaker

    // Interruption checker callback - used by sentence-by-sentence playback
    const checkInterruption = () => {
      return this.newsInjector.hasBreakingNews() || this.userInput;
    };

    while (this.isRunning) {
      // ===== CHECK FOR INTERRUPTIONS BEFORE EACH TURN =====

      // Priority 1: Breaking news
      if (this.newsInjector.hasBreakingNews()) {
        preGenerated = null; // Invalidate pre-generated content
        await this.handleBreakingNews();
        continue;
      }

      // Priority 2: User input
      if (this.userInput) {
        preGenerated = null; // Invalidate pre-generated content
        await this.handleUserInput();
        continue;
      }

      // Priority 3: Trending topic injection
      if (this.pendingTrendPrompt) {
        preGenerated = null; // Invalidate pre-generated content
        await this.handleTrendInjection();
        continue;
      }

      // ===== NORMAL TURN (with pipelining) =====
      const turnStartTime = Date.now();
      const speaker = this.agents[currentSpeakerIdx];
      const other = this.agents[1 - currentSpeakerIdx];

      console.log(
        `\n${"=".repeat(
          60
        )}\n🎯 TURN START: ${speaker.getName()} at ${new Date().toISOString()}\n${"=".repeat(
          60
        )}`
      );

      // Build prompt with shared history context
      let basePrompt = `Continue the conversation with ${other.getName()} about ${
        this.topic
      }. Respond to what was just said.`;
      basePrompt += this.newsInjector.getRegularNewsContext();
      const prompt = this.buildPrompt(basePrompt);

      // Use pre-generated content if available (text + first sentence audio)
      let responseText;
      let audioPromise;

      if (preGenerated && preGenerated.text) {
        console.log(
          `${speaker.config.color}⚡ Using pre-generated text${
            preGenerated.firstSentenceAudio ? " + first sentence audio" : ""
          }${RESET_COLOR}`
        );
        responseText = preGenerated.text;
        speaker.currentTranscript = responseText;

        // Add to shared history immediately
        this.sharedHistory.push({
          speaker: speaker.getName(),
          content: responseText,
        });

        // Play sentence-by-sentence with interruption checks
        this.currentSpeaker = speaker;
        audioPromise = speaker.playPreGeneratedAudioSentenceBySentence(
          responseText,
          preGenerated.firstSentenceAudio,
          checkInterruption
        );
        preGenerated = null;
      } else {
        // No pre-generated content, generate fresh
        responseText = await speaker.generateResponse(prompt);

        // Add to shared history immediately
        this.sharedHistory.push({
          speaker: speaker.getName(),
          content: responseText,
        });

        // Play sentence-by-sentence with interruption checks
        this.currentSpeaker = speaker;
        audioPromise = speaker.playAudioSentenceBySentence(
          responseText,
          checkInterruption
        );
      }

      // While audio plays, pre-generate next agent's TEXT + FIRST SENTENCE AUDIO
      const nextSpeakerIdx = 1 - currentSpeakerIdx;
      const nextSpeaker = this.agents[nextSpeakerIdx];
      let nextBasePrompt = `Continue the conversation with ${speaker.getName()} about ${
        this.topic
      }. Respond to what was just said.`;
      nextBasePrompt += this.newsInjector.getRegularNewsContext();
      const nextPrompt = this.buildPrompt(nextBasePrompt);

      // Pre-generate text AND first sentence audio in parallel with current playback
      let preGenReady = false;
      let preGenReadyTime = null;
      const preGenStartTime = Date.now();

      const preGenPromise = (async () => {
        try {
          const text = await nextSpeaker.generateResponse(nextPrompt);
          if (!text) return null;

          // Generate TTS for first sentence only (for faster startup)
          const sentences = nextSpeaker.splitIntoSentences(text);
          const firstSentence = sentences[0];

          console.log(
            `${nextSpeaker.config.color}🎵 Pre-generating first sentence audio...${RESET_COLOR}`
          );
          const ttsStart = Date.now();
          const firstSentenceAudio = await nextSpeaker.tts.synthesize(
            firstSentence
          );
          const ttsTime = Date.now() - ttsStart;
          console.log(
            `${nextSpeaker.config.color}⏱️  Pre-gen first sentence TTS: ${ttsTime}ms (${firstSentenceAudio.length} bytes)${RESET_COLOR}`
          );

          // Mark pre-generation as complete
          preGenReady = true;
          preGenReadyTime = Date.now();
          console.log(
            `${nextSpeaker.config.color}✅ Pre-gen COMPLETE at ${
              preGenReadyTime - preGenStartTime
            }ms${RESET_COLOR}`
          );

          return { text, firstSentenceAudio };
        } catch (err) {
          console.error("Pre-generation failed:", err.message);
          return null;
        }
      })();

      // Wait for audio to finish (interruption checks happen inside sentence-by-sentence)
      const audioStartWait = Date.now();
      const completed = await audioPromise;
      const audioDoneTime = Date.now();
      console.log(
        `\n🔊 ${
          speaker.config.color
        }${speaker.getName()} AUDIO DONE${RESET_COLOR} (${
          completed ? "completed" : "interrupted"
        }, waited ${audioDoneTime - audioStartWait}ms)`
      );
      console.log(
        `   Pre-gen ready: ${preGenReady ? "YES ✅" : "NO ⏳"} (ready at ${
          preGenReadyTime ? preGenReadyTime - preGenStartTime + "ms" : "not yet"
        })`
      );

      this.currentSpeaker = null;

      // Get pre-generated content (should be ready by now)
      if (
        !speaker.wasInterrupted &&
        !this.userInput &&
        !this.newsInjector.hasBreakingNews()
      ) {
        const awaitPreGenStart = Date.now();
        preGenerated = await preGenPromise;
        const awaitPreGenEnd = Date.now();
        console.log(
          `   Awaiting preGenPromise took: ${
            awaitPreGenEnd - awaitPreGenStart
          }ms`
        );
      } else {
        preGenerated = null; // Discard if interrupted
      }

      // If interrupted, don't switch speakers - let interrupt handler decide
      if (speaker.wasInterrupted) {
        continue;
      }

      // Log before switching to next speaker
      console.log(
        `\n🎤 SWITCHING to ${nextSpeaker.getName()} (preGenerated: ${
          preGenerated ? "YES" : "NO"
        })\n`
      );

      // Switch speakers for next turn
      currentSpeakerIdx = nextSpeakerIdx;
    }

    // Closing
    if (this.isRunning) {
      await this.agentSpeak(host, "Wrap up the podcast and thank everyone.");
    }

    console.log("\n🎬 Podcast complete!");
    this.cleanup();
  }

  // Helper to build prompt with shared history context
  buildPrompt(basePrompt) {
    const historyContext = this.sharedHistory
      .slice(-20)
      .map((entry) => `${entry.speaker}: ${entry.content}`)
      .join("\n");

    return historyContext
      ? `Conversation so far:\n${historyContext}\n\n${basePrompt}`
      : basePrompt;
  }

  // Non-pipelined speak (for opening, breaking news, user input)
  async agentSpeak(agent, prompt) {
    this.currentSpeaker = agent;

    const fullPrompt = this.buildPrompt(prompt);
    const response = await agent.generateResponse(fullPrompt);

    this.sharedHistory.push({
      speaker: agent.getName(),
      content: response,
    });

    await agent.playAudio(response);
    this.currentSpeaker = null;
  }

  async handleBreakingNews() {
    const newsItem = this.newsInjector.getNextBreakingNews();
    const newsContent = newsItem.content;
    console.log(`\n🚨 BREAKING NEWS: ${newsContent}\n`);

    // Immediately interrupt current speaker for hard cut
    if (this.currentSpeaker) {
      console.log(
        `${this.currentSpeaker.config.color}🛑 HARD INTERRUPT - Stopping ${this.currentSpeaker.config.name} immediately!${RESET_COLOR}`
      );
      await this.currentSpeaker.interrupt();
    }

    // Add to shared history
    this.sharedHistory.push({
      speaker: "BREAKING NEWS",
      content: newsContent,
    });

    // Both agents react to breaking news with fast interruption
    for (const agent of this.agents) {
      await this.agentSpeakFast(
        agent,
        `BREAKING NEWS just came in: "${newsContent}". React to this news urgently!`
      );

      // Check if another breaking news came in or user input
      if (this.newsInjector.hasBreakingNews() || this.userInput) break;
    }
  }

  // Fast speak for breaking news - generates text + first sentence audio, then plays with sentence-by-sentence
  async agentSpeakFast(agent, prompt) {
    this.currentSpeaker = agent;

    // Build full prompt with history
    const fullPrompt = this.buildPrompt(prompt);

    // Generate full text response
    const response = await agent.generateResponse(fullPrompt);

    // Add to shared history
    this.sharedHistory.push({
      speaker: agent.getName(),
      content: response,
    });

    // Generate first sentence audio only for fast startup
    const sentences = agent.splitIntoSentences(response);
    const firstSentence = sentences[0];

    console.log(
      `${agent.config.color}🎵 Pre-generating first sentence audio for fast interrupt...${RESET_COLOR}`
    );
    const ttsStart = Date.now();
    const firstSentenceAudio = await agent.tts.synthesize(firstSentence);
    const ttsTime = Date.now() - ttsStart;
    console.log(
      `${agent.config.color}⏱️  Pre-gen first sentence TTS: ${ttsTime}ms (${firstSentenceAudio.length} bytes)${RESET_COLOR}`
    );

    // Now play with sentence-by-sentence (uses pre-generated first sentence)
    const checkInterruption = () => {
      return this.newsInjector.hasBreakingNews() || this.userInput;
    };

    await agent.playPreGeneratedAudioSentenceBySentence(
      response,
      firstSentenceAudio,
      checkInterruption
    );

    this.currentSpeaker = null;
  }

  async handleUserInput() {
    const comment = this.userInput;
    this.userInput = null;

    // Immediately interrupt current speaker for hard cut
    if (this.currentSpeaker) {
      console.log(
        `${this.currentSpeaker.config.color}🛑 HARD INTERRUPT - Stopping ${this.currentSpeaker.config.name} immediately!${RESET_COLOR}`
      );
      await this.currentSpeaker.interrupt();
    }

    // Add to shared history
    this.sharedHistory.push({
      speaker: "Listener",
      content: comment,
    });

    console.log(`\n🎤 Listener: "${comment}"\n`);

    // Pick a random agent to respond (no pipelining during interrupts)
    const responder =
      this.agents[Math.floor(Math.random() * this.agents.length)];
    console.log(
      `${responder.config.color}${responder.config.name} responding to listener...${RESET_COLOR}`
    );

    await this.agentSpeak(
      responder,
      `A listener just said: "${comment}". Respond to them briefly.`
    );
  }

  async handleTrendInjection() {
    const prompt = this.pendingTrendPrompt;
    this.pendingTrendPrompt = null;

    console.log(`\n📊 TRENDING TOPIC INJECTION\n`);

    // Add to shared history
    this.sharedHistory.push({
      speaker: "TRENDING",
      content: prompt,
    });

    // Show the first tweet on overlay FIRST, then wait a moment before talking
    console.log("📸 Displaying tweet first...");
    try {
      await this.trendInjector.showNextTweet();
      // Small delay to let viewers see the tweet before talking starts
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (err) {
      console.error("Tweet overlay error:", err.message);
    }

    // First agent reacts to the trend
    const firstAgent = this.agents[0];
    await this.agentSpeak(
      firstAgent,
      `${prompt}\n\nYou just saw this tweet trending! React to it - what's your take?`
    );

    // Check for interrupts
    if (this.newsInjector.hasBreakingNews() || this.userInput) {
      this.trendInjector.clearTrend();
      return;
    }

    // Show next tweet before second agent speaks
    if (this.trendInjector.tweetQueue.length > 0) {
      console.log("📸 Showing next tweet...");
      this.trendInjector.showNextTweet().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Second agent responds
    const secondAgent = this.agents[1];
    await this.agentSpeak(
      secondAgent,
      `${prompt}\n\nYour co-host just gave their take. Now respond - agree, argue, or add your own conspiracy/explanation!`
    );

    // Clear the trend after discussion (keeps it in discussedTrends)
    this.trendInjector.clearTrend();
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
        samplesPerChannel: audioBuffer.length / 2,
      };
      this.audioSource.captureFrame(frame);
    }
  }

  cleanup() {
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.rl) {
      this.rl.close();
    }

    if (this.localPlayer) {
      this.localPlayer.stop();
    }

    if (this.twitchStreamer) {
      this.twitchStreamer.stop();
    }

    for (const agent of this.agents) {
      agent.cleanup();
    }

    if (this.trendInjector) {
      this.trendInjector.cleanup();
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
