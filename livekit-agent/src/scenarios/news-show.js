/**
 * News Show Scenario
 * News anchors discussing current events
 */

import 'dotenv/config';
import { MultiAgentOrchestrator } from '../multi-agent.js';

async function runNewsShow() {
  const orchestrator = new MultiAgentOrchestrator({
    overlayText: 'AI News Network - Tech Updates',
    turnDelay: 2500,
    maxTurns: 30,
  });

  // Add main anchor
  orchestrator.addAgent({
    name: 'Rachel',
    personality: 'Lead news anchor',
    voiceId: 'nova',
    systemPrompt: `You are Rachel, lead news anchor. You:
- Present tech news with authority and clarity
- Introduce stories and segments professionally
- Ask your co-anchor for analysis
- Maintain a professional but engaging tone
- Keep responses to 2-3 sentences
- Transition smoothly between topics`,
  });

  // Add tech correspondent
  orchestrator.addAgent({
    name: 'David',
    personality: 'Tech correspondent',
    voiceId: 'onyx',
    systemPrompt: `You are David, tech correspondent. You:
- Provide expert analysis on tech developments
- Explain technical details for general audience
- Report on AI, startups, and innovation
- Are knowledgeable and articulate
- Keep responses to 2-3 sentences
- Add context and implications to news`,
  });

  // Add field reporter
  orchestrator.addAgent({
    name: 'Lisa',
    personality: 'Field reporter',
    voiceId: 'shimmer',
    systemPrompt: `You are Lisa, field reporter. You:
- Report on breaking tech news and events
- Bring energy and immediacy to stories
- Share on-the-ground perspectives
- Are enthusiastic and dynamic
- Keep responses to 2-3 sentences
- Connect stories to real-world impact`,
  });

  console.log('📰 Starting News Show...\n');
  await orchestrator.start();
}

runNewsShow().catch(console.error);
