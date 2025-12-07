/**
 * Tech Podcast Scenario - Local Playback
 * Plays audio locally instead of streaming to Twitch
 */

import 'dotenv/config';
import { XAILLMPlugin } from '../plugins/xai-llm.js';
import { XAITTSPlugin } from '../plugins/xai-tts.js';
import { spawn } from 'child_process';

class LocalAgent {
  constructor(config, llm) {
    this.name = config.name;
    this.personality = config.personality;
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

async function runLocalPodcast() {
  console.log('🎙️  Starting Local Tech Podcast (with audio playback)...\n');

  const llm = new XAILLMPlugin({
    apiKey: process.env.XAI_API_KEY,
    baseUrl: process.env.XAI_BASE_URL,
  });

  const agents = [
    new LocalAgent({
      name: 'Alex',
      personality: 'Tech podcast host',
      voiceId: 'ara',
      systemPrompt: `You are Alex, host of "Tech Talk" podcast. Keep responses to 2-3 sentences. Ask engaging questions about AI and technology.`,
    }, llm),
    new LocalAgent({
      name: 'Dr. Chen',
      personality: 'AI researcher',
      voiceId: 'rex',
      systemPrompt: `You are Dr. Chen, an AI researcher. Keep responses to 2-3 sentences. Explain AI concepts clearly and share insights.`,
    }, llm),
  ];

  const conversationHistory = [];
  conversationHistory.push({
    role: 'user',
    content: `This is a conversation between Alex and Dr. Chen about AI. Alex, please start with a greeting and introduce the topic.`,
  });

  // Start ffplay for audio playback
  let ffplayProcess = null;
  try {
    ffplayProcess = spawn('ffplay', [
      '-f', 's16le',
      '-ar', '24000',
      '-channels', '1',
      '-nodisp',
      '-autoexit',
      '-loglevel', 'quiet',
      '-',
    ], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log('🔊 Audio player started\n');
  } catch (err) {
    console.warn('⚠️  Could not start audio player. Install ffmpeg: brew install ffmpeg');
    console.log('Audio will be generated but not played.\n');
  }

  let currentSpeakerIndex = 0;
  const numTurns = 6;

  for (let turn = 0; turn < numTurns; turn++) {
    const currentAgent = agents[currentSpeakerIndex];
    
    try {
      console.log(`💬 ${currentAgent.name} is thinking...`);
      
      const response = await currentAgent.generateResponse(conversationHistory);
      
      conversationHistory.push({
        role: 'assistant',
        content: `${currentAgent.name}: ${response}`,
        speaker: currentAgent.name,
      });

      console.log(`\n🗣️  ${currentAgent.name}: ${response}\n`);

      // Generate and play audio
      console.log(`🎵 Generating audio...`);
      await new Promise(r => setTimeout(r, 1500)); // Rate limit delay
      
      const audioBuffer = await currentAgent.speak(response);
      
      if (ffplayProcess && ffplayProcess.stdin && !ffplayProcess.stdin.destroyed) {
        try {
          ffplayProcess.stdin.write(audioBuffer, (err) => {
            if (err) {
              console.error('Error writing to ffplay:', err.message);
            }
          });
          console.log(`🔊 Playing audio (${audioBuffer.length} bytes)\n`);
        } catch (err) {
          console.error('Error playing audio:', err.message);
        }
      } else {
        console.warn('⚠️  Audio player not available');
      }

      console.log('─'.repeat(60));
      
      currentSpeakerIndex = (currentSpeakerIndex + 1) % agents.length;
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`\n❌ Error with ${currentAgent.name}:`, err.message);
      break;
    }
  }

  if (ffplayProcess && ffplayProcess.stdin && !ffplayProcess.stdin.destroyed) {
    ffplayProcess.stdin.end();
  }

  console.log('\n✅ Podcast complete!');
}

runLocalPodcast().catch(console.error);
