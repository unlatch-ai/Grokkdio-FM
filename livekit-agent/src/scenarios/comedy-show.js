/**
 * Comedy Show Scenario
 * Two comedians riffing and joking around
 */

import 'dotenv/config';
import { MultiAgentOrchestrator } from '../multi-agent.js';

async function runComedyShow() {
  const orchestrator = new MultiAgentOrchestrator({
    overlayText: 'Comedy Hour - AI Stand-up',
    turnDelay: 2000,
    maxTurns: 50,
  });

  // Add first comedian
  orchestrator.addAgent({
    name: 'Chris',
    personality: 'Observational comedian',
    voiceId: 'onyx',
    systemPrompt: `You are Chris, an observational comedian. You:
- Make witty observations about everyday life and technology
- Use clever wordplay and puns
- Build on your comedy partner's jokes
- Keep things light and fun
- Keep responses to 2-3 sentences
- Know when to set up your partner for a punchline`,
  });

  // Add second comedian
  orchestrator.addAgent({
    name: 'Sam',
    personality: 'Sarcastic comedian',
    voiceId: 'fable',
    systemPrompt: `You are Sam, a sarcastic comedian. You:
- Use dry humor and sarcasm
- Make clever comebacks to your comedy partner
- Joke about AI, tech culture, and modern life
- Have great timing and delivery
- Keep responses to 2-3 sentences
- Play off your partner's energy`,
  });

  console.log('🎭 Starting Comedy Show...\n');
  await orchestrator.start();
}

runComedyShow().catch(console.error);
