/**
 * Test Audio Generation
 * Tests TTS without Twitch streaming
 */

import 'dotenv/config';
import { XAITTSPlugin } from './plugins/xai-tts.js';
import fs from 'fs';

async function testAudio() {
  console.log('🎵 Testing XAI TTS Audio Generation\n');

  if (!process.env.XAI_API_KEY) {
    console.error('❌ Missing XAI_API_KEY in .env file');
    process.exit(1);
  }

  const tts = new XAITTSPlugin({
    apiKey: process.env.XAI_API_KEY,
    baseUrl: process.env.XAI_BASE_URL,
    voiceId: 'nova',
  });

  const testText = "Hello! This is a test of the XAI text to speech system. If you can hear this, audio generation is working perfectly!";

  console.log('📝 Text:', testText);
  console.log('🎙️  Voice:', 'nova');
  console.log('\n⏳ Generating audio...\n');

  try {
    const audioBuffer = await tts.synthesize(testText);
    
    console.log('✅ Audio generated successfully!');
    console.log('📊 Audio size:', audioBuffer.length, 'bytes');
    console.log('🎵 Format:', tts.getFormat());
    
    // Save to file
    const outputFile = 'test-output.raw';
    fs.writeFileSync(outputFile, audioBuffer);
    console.log(`\n💾 Saved to: ${outputFile}`);
    
    console.log('\n🔊 To play the audio:');
    console.log(`   ffplay -f s16le -ar 24000 -ac 1 ${outputFile}`);
    console.log('\n   Or convert to WAV:');
    console.log(`   ffmpeg -f s16le -ar 24000 -ac 1 -i ${outputFile} test-output.wav`);
    
  } catch (err) {
    console.error('❌ Error generating audio:', err.message);
    process.exit(1);
  }
}

testAudio();
