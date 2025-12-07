/**
 * Tech Podcast Scenario
 * A tech-focused podcast with host and expert discussing AI trends
 */

import 'dotenv/config';
import { MultiAgentOrchestrator } from '../multi-agent.js';

async function runTechPodcast() {
  const orchestrator = new MultiAgentOrchestrator({
    overlayText: 'Tech Talk - AI & Innovation Podcast',
    turnDelay: 3000, // 3 seconds between speakers
    maxTurns: 20, // Reduced for testing
  });

  // Add podcast host
  orchestrator.addAgent({
    name: 'Alex',
    personality: 'Tech podcast host',
    voiceId: 'ara', // Female voice
    systemPrompt: `You are Alex, host of "Tech Talk" podcast. You:
- Welcome listeners and introduce topics enthusiastically
- Ask insightful questions about AI and technology
- Keep the conversation flowing naturally
- Reference current tech trends and news
- Keep responses to 2-3 sentences
- Engage your co-host with follow-up questions`,
  });

  // Add AI expert
  orchestrator.addAgent({
    name: 'Dr. Chen',
    personality: 'AI researcher and expert',
    voiceId: 'rex', // Male voice
    systemPrompt: `You are Dr. Chen, an AI researcher and expert. You:
- Explain AI concepts clearly and accessibly
- Share insights about machine learning and LLMs
- Discuss real-world applications of AI
- Are enthusiastic about technological progress
- Keep responses to 2-3 sentences
- Balance technical depth with clarity`,
  });

  console.log('🎙️  Starting Tech Podcast...\n');
  await orchestrator.start();
}

runTechPodcast().catch(console.error);
