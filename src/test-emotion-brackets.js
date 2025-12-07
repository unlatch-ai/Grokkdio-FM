/**
 * Test XAI TTS with Emotion Brackets
 * Tests if XAI TTS can handle [emotion] tags
 */

import 'dotenv/config';
import { XAITTSPlugin } from './plugins/xai-tts.js';
import { spawn } from 'child_process';
import fs from 'fs';

async function testEmotionBrackets() {
  console.log('🎭 Testing XAI TTS with Emotion Brackets\n');

  const tts = new XAITTSPlugin({
    apiKey: process.env.XAI_API_KEY,
    voiceId: 'ara',
  });

  const testCases = [
    {
      name: 'No brackets (baseline)',
      text: 'Hello everyone, welcome to the show!'
    },
    {
      name: 'With emotion brackets',
      text: '[yells] HELLO EVERYONE! [laughs] Welcome to the show! [whispers] This is amazing...'
    },
    {
      name: 'Multiple emotions',
      text: '[excited] Hey there! [gasps] Oh my god! [whispers intensely] The truth is out there... [screams] WAKE UP!'
    },
    {
      name: 'Conspiracy style',
      text: '[yells] WAKE UP PEOPLE! [laughs maniacally] They\'re watching us! [whispers] The AI... [gasps dramatically] it\'s already here!'
    }
  ];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n📝 Test ${i + 1}: ${testCase.name}`);
    console.log(`   Text: "${testCase.text}"`);
    console.log('   Generating audio...');

    try {
      const audioBuffer = await tts.synthesize(testCase.text);
      console.log(`   ✅ Generated ${audioBuffer.length} bytes`);

      // Save to file
      const filename = `test-${i + 1}-${testCase.name.replace(/\s+/g, '-').toLowerCase()}.raw`;
      fs.writeFileSync(filename, audioBuffer);
      console.log(`   💾 Saved to ${filename}`);

      // Calculate duration
      const durationSec = audioBuffer.length / (24000 * 2); // 24kHz, 16-bit
      console.log(`   ⏱️  Duration: ${durationSec.toFixed(1)}s`);
      
      console.log('   ✅ Done!\n');
      
      // Wait between tests to avoid rate limiting
      await new Promise(r => setTimeout(r, 1500));
      
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
    }
  }

  console.log('\n🎉 All tests complete!');
  console.log('\n📊 Results saved as .raw files');
  console.log('\n🔊 To play them:');
  console.log('   ffplay -f s16le -ar 24000 -channels 1 test-1-no-brackets-\\(baseline\\).raw');
  console.log('   ffplay -f s16le -ar 24000 -channels 1 test-2-with-emotion-brackets.raw');
  console.log('   ffplay -f s16le -ar 24000 -channels 1 test-3-multiple-emotions.raw');
  console.log('   ffplay -f s16le -ar 24000 -channels 1 test-4-conspiracy-style.raw');
  console.log('\n📊 Analysis:');
  console.log('   Compare the audio files to see if emotion brackets affect the voice.');
  console.log('   ✅ If brackets work: Different tones, volume, whispers vs yells');
  console.log('   ❌ If brackets don\'t work: They\'re read as text or ignored');
  
  process.exit(0);
}

async function playAudio(audioBuffer) {
  return new Promise((resolve, reject) => {
    const ffplay = spawn('ffplay', [
      '-f', 's16le',
      '-ar', '24000',
      '-channels', '1',
      '-nodisp',
      '-autoexit',
      '-loglevel', 'quiet',
      '-'
    ]);

    ffplay.on('error', (err) => {
      resolve(); // Ignore playback errors
    });

    ffplay.stdin.on('error', (err) => {
      resolve(); // Ignore pipe errors
    });

    ffplay.on('close', () => resolve());

    try {
      ffplay.stdin.write(audioBuffer);
      ffplay.stdin.end();
    } catch (err) {
      resolve();
    }
  });
}

testEmotionBrackets().catch(console.error);
