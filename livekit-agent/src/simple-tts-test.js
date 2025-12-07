/**
 * Simple TTS Test - Based on working radio-stream.js
 */

import 'dotenv/config';
import WebSocket from 'ws';

const XAI_API_KEY = process.env.XAI_API_KEY;
const BASE_URL = process.env.BASE_URL || process.env.XAI_BASE_URL || 'https://api.x.ai/v1';

console.log('Testing XAI TTS...');
console.log('API Key:', XAI_API_KEY ? `${XAI_API_KEY.substring(0, 10)}...` : 'MISSING');
console.log('Base URL:', BASE_URL);

if (!XAI_API_KEY) {
  console.error('❌ Missing XAI_API_KEY');
  process.exit(1);
}

const wsBase = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');
const wsUri = `${wsBase}/realtime/audio/speech`;

console.log('WebSocket URI:', wsUri);
console.log('\nConnecting...\n');

const ws = new WebSocket(wsUri, {
  headers: {
    Authorization: `Bearer ${XAI_API_KEY}`,
  },
});

let audioChunks = [];

ws.on('open', () => {
  console.log('✅ Connected to XAI streaming TTS');

  // Send config
  const configMessage = {
    type: 'config',
    data: {
      voice_id: 'ara',
    },
  };
  ws.send(JSON.stringify(configMessage));
  console.log('📤 Sent config');

  // Send text
  const text = 'Hello, this is a test of the text to speech system.';
  console.log('📝 Text:', text);

  const textMessage = {
    type: 'text_chunk',
    data: {
      text,
      is_last: true,
    },
  };
  ws.send(JSON.stringify(textMessage));
  console.log('📤 Sent text chunk');
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('\n📨 Received message:', JSON.stringify(message).substring(0, 200));
    
    const audioB64 = message?.data?.data?.audio;
    const isLast = message?.data?.data?.is_last;
    
    if (!audioB64) {
      console.log('⚠️  No audio in message');
      return;
    }

    const audioBuffer = Buffer.from(audioB64, 'base64');
    audioChunks.push(audioBuffer);
    console.log(`✅ Audio chunk ${audioChunks.length}: ${audioBuffer.length} bytes`);

    if (isLast) {
      console.log('🧩 Finished audio chunk set');
      ws.close();
    }
  } catch (err) {
    console.error('❌ Error parsing TTS message:', err);
  }
});

ws.on('close', () => {
  console.log('\n🔌 TTS session closed');
  console.log(`📊 Total chunks: ${audioChunks.length}`);
  
  if (audioChunks.length > 0) {
    const totalBytes = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    console.log(`📊 Total audio: ${totalBytes} bytes`);
    console.log('✅ SUCCESS!');
  } else {
    console.log('❌ FAILED - No audio received');
  }
  
  process.exit(audioChunks.length > 0 ? 0 : 1);
});

ws.on('error', (err) => {
  console.error('❌ XAI TTS WebSocket error:', err.message || err);
  ws.close();
});
