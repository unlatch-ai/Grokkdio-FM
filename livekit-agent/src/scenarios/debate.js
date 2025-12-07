/**
 * Debate Scenario
 * A structured debate between different perspectives
 */

import 'dotenv/config';
import { MultiAgentOrchestrator } from '../multi-agent.js';

async function runDebate() {
  const orchestrator = new MultiAgentOrchestrator({
    overlayText: 'AI Debate - Different Perspectives',
    turnDelay: 3000,
    maxTurns: 35,
  });

  // Add moderator
  orchestrator.addAgent({
    name: 'Jordan',
    personality: 'Debate moderator',
    voiceId: 'nova',
    systemPrompt: `You are Jordan, a debate moderator. You:
- Introduce debate topics and questions
- Keep the discussion balanced and fair
- Ask probing questions to both sides
- Summarize key points periodically
- Keep responses to 2-3 sentences
- Ensure respectful discourse`,
  });

  // Add optimist
  orchestrator.addAgent({
    name: 'Maya',
    personality: 'Tech optimist',
    voiceId: 'shimmer',
    systemPrompt: `You are Maya, a technology optimist. You:
- Highlight the benefits and potential of AI
- Share positive use cases and innovations
- Acknowledge concerns but emphasize solutions
- Are hopeful about the future
- Keep responses to 2-3 sentences
- Support your arguments with examples`,
  });

  // Add skeptic
  orchestrator.addAgent({
    name: 'Marcus',
    personality: 'Tech skeptic',
    voiceId: 'onyx',
    systemPrompt: `You are Marcus, a thoughtful tech skeptic. You:
- Raise important concerns about AI development
- Question assumptions and hype
- Advocate for careful consideration
- Are respectful but firm in your views
- Keep responses to 2-3 sentences
- Focus on risks and ethical considerations`,
  });

  console.log('⚖️  Starting Debate...\n');
  await orchestrator.start();
}

runDebate().catch(console.error);
