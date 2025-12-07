'use strict';

const fs = require('fs');
const path = require('path');

const XAI_API_BASE_URL = process.env.BASE_URL || 'https://api.x.ai/v1';
const XAI_TTS_URL = `${XAI_API_BASE_URL}/audio/speech`;
const HELLO_AUDIO_FILENAME = 'hello-xai.mp3';

async function ensureHelloAudioFile() {
  const audioPath = path.join(__dirname, HELLO_AUDIO_FILENAME);

  if (fs.existsSync(audioPath)) {
    return audioPath;
  }

  const apiKey = "";
  if (!apiKey) {
    throw new Error('XAI_API_KEY environment variable is required to generate hello world audio');
  }

  const text = 'Hello Twitch! This is your XAI powered hello world stream.';

  console.log('Generating XAI hello world audio...');

  const response = await fetch(XAI_TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      voice: 'Ara',
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate TTS audio: ${response.status} - ${errorText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(audioPath, buffer);

  console.log(`XAI hello world audio saved to ${audioPath} (${buffer.length} bytes)`);

  return audioPath;
}

module.exports = { ensureHelloAudioFile, HELLO_AUDIO_FILENAME };
