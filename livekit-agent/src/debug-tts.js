/**
 * Debug TTS Connection
 * Tests the WebSocket connection and logs all messages
 */

import 'dotenv/config';
import WebSocket from 'ws';

async function debugTTS() {
  console.log('🔍 Debugging XAI TTS Connection\n');

  const apiKey = process.env.XAI_API_KEY;
  const baseUrl = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
  
  console.log('API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'MISSING');
  console.log('Base URL:', baseUrl);
  
  const wsBase = baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
  const wsUri = `${wsBase}/realtime/audio/speech`;
  
  console.log('WebSocket URI:', wsUri);
  console.log('\n🔌 Connecting...\n');

  const ws = new WebSocket(wsUri, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  ws.on('open', () => {
    console.log('✅ WebSocket connected!');
    
    // Send config
    const configMessage = {
      type: 'config',
      data: {
        voice_id: 'ara',
      },
    };
    console.log('📤 Sending config:', JSON.stringify(configMessage));
    ws.send(JSON.stringify(configMessage));
    
    // Send text
    const textMessage = {
      type: 'text_chunk',
      data: {
        text: 'Hello, this is a test.',
        is_last: true,
      },
    };
    console.log('📤 Sending text:', JSON.stringify(textMessage));
    ws.send(JSON.stringify(textMessage));
  });

  ws.on('message', (data) => {
    console.log('\n📨 Received message:');
    try {
      const message = JSON.parse(data.toString());
      console.log('Message type:', message.type || 'unknown');
      console.log('Full message:', JSON.stringify(message, null, 2));
      
      // Check for audio
      const audioB64 = message?.data?.data?.audio;
      if (audioB64) {
        console.log('✅ Audio data found! Length:', audioB64.length);
      } else {
        console.log('❌ No audio data in message');
      }
      
      const isLast = message?.data?.data?.is_last;
      if (isLast) {
        console.log('✅ This is the last chunk');
        ws.close();
      }
    } catch (err) {
      console.error('❌ Error parsing message:', err);
      console.log('Raw data:', data.toString().substring(0, 500));
    }
  });

  ws.on('error', (err) => {
    console.error('\n❌ WebSocket error:', err.message);
    console.error('Full error:', err);
  });

  ws.on('close', (code, reason) => {
    console.log('\n🔌 WebSocket closed');
    console.log('Code:', code);
    console.log('Reason:', reason.toString() || 'none');
  });
}

debugTTS();
