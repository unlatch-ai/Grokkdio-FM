/**
 * Test Multi-Agent System (No Twitch Required)
 * Tests the conversation logic without streaming
 */

import 'dotenv/config';
import { XAILLMPlugin } from './plugins/xai-llm.js';
import { XAITTSPlugin } from './plugins/xai-tts.js';

class TestAgent {
  constructor(config) {
    this.name = config.name;
    this.personality = config.personality;
    this.systemPrompt = config.systemPrompt;
    this.llm = config.llm;
  }

  async generateResponse(conversationContext) {
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...conversationContext,
    ];

    const response = await this.llm.chat(messages, {
      temperature: 0.8,
      maxTokens: 150,
    });

    return response;
  }
}

async function testConversation() {
  console.log('🧪 Testing Multi-Agent Conversation (No Streaming)\n');

  // Check API key
  if (!process.env.XAI_API_KEY) {
    console.error('❌ Missing XAI_API_KEY in .env file');
    console.log('💡 Copy .env.example to .env and add your XAI API key');
    process.exit(1);
  }

  // Create shared LLM
  const llm = new XAILLMPlugin({
    apiKey: process.env.XAI_API_KEY,
    baseUrl: process.env.XAI_BASE_URL,
  });

  // Create two test agents
  const agents = [
    new TestAgent({
      name: 'Alex',
      personality: 'Enthusiastic host',
      systemPrompt: `You are Alex, an enthusiastic podcast host. Keep responses to 2-3 sentences. Ask engaging questions and keep the conversation flowing.`,
      llm,
    }),
    new TestAgent({
      name: 'Sam',
      personality: 'Tech expert',
      systemPrompt: `You are Sam, a tech expert. Keep responses to 2-3 sentences. Share interesting insights about AI and technology.`,
      llm,
    }),
  ];

  console.log(`👥 Agents: ${agents.map(a => a.name).join(' and ')}\n`);
  console.log('─'.repeat(60));

  // Conversation history
  const conversationHistory = [];
  
  // Opening prompt
  conversationHistory.push({
    role: 'user',
    content: `This is a conversation between Alex and Sam about artificial intelligence. Alex, please start with a greeting and introduce the topic.`,
  });

  // Run 6 turns (3 per agent)
  const numTurns = 6;
  let currentSpeakerIndex = 0;

  for (let turn = 0; turn < numTurns; turn++) {
    const currentAgent = agents[currentSpeakerIndex];
    
    try {
      console.log(`\n💬 ${currentAgent.name} is thinking...`);
      
      // Generate response
      const response = await currentAgent.generateResponse(conversationHistory);
      
      // Add to history
      conversationHistory.push({
        role: 'assistant',
        content: `${currentAgent.name}: ${response}`,
        speaker: currentAgent.name,
      });

      // Display
      console.log(`\n🗣️  ${currentAgent.name}:`);
      console.log(`   ${response}`);
      console.log('─'.repeat(60));

      // Switch speaker
      currentSpeakerIndex = (currentSpeakerIndex + 1) % agents.length;

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      console.error(`\n❌ Error with ${currentAgent.name}:`, err.message);
      
      if (err.message.includes('401') || err.message.includes('403')) {
        console.log('\n💡 Check your XAI_API_KEY in .env file');
      } else if (err.message.includes('429')) {
        console.log('\n💡 Rate limit hit. Wait a moment and try again.');
      }
      
      process.exit(1);
    }
  }

  console.log('\n✅ Test completed successfully!');
  console.log('\n📝 Conversation transcript:');
  console.log('═'.repeat(60));
  conversationHistory
    .filter(msg => msg.role === 'assistant')
    .forEach(msg => {
      console.log(`\n${msg.content}`);
    });
  console.log('\n═'.repeat(60));
  
  console.log('\n🎉 Multi-agent system is working!');
  console.log('\n📺 To stream to Twitch, run:');
  console.log('   npm run tech-podcast');
  console.log('   npm run comedy');
  console.log('   npm run debate');
  console.log('   npm run news');
}

testConversation().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
