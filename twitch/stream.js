// Twitch Hello World Stream
// Streams a static image with audio tone to Twitch via RTMP

const { spawn } = require('child_process');
const fs = require('fs');

// === CONFIGURATION ===
const TWITCH_STREAM_KEY = ''; // Get from https://dashboard.twitch.tv/settings/stream
const TWITCH_RTMP_URL = 'rtmp://live.twitch.tv/app/';

// Audio settings
const SAMPLE_RATE = 48000; // Twitch prefers 48kHz
const CHANNELS = 2; // Stereo
const FREQUENCY = 440; // A4 note (Hz)

// === GENERATE TEST AUDIO ===
// Creates a simple sine wave tone
function generateTone() {
  const bufferSize = SAMPLE_RATE * CHANNELS * 2; // 1 second of 16-bit PCM
  const buffer = Buffer.alloc(bufferSize);
  
  for (let i = 0; i < SAMPLE_RATE; i++) {
    const sample = Math.sin(2 * Math.PI * FREQUENCY * i / SAMPLE_RATE);
    const value = Math.round(sample * 32767); // 16-bit signed
    
    // Write stereo (same value for left and right)
    buffer.writeInt16LE(value, i * 4);
    buffer.writeInt16LE(value, i * 4 + 2);
  }
  
  return buffer;
}

// === START STREAMING ===
function startStream() {
  console.log('Starting Twitch stream...');
  
  // Check if image exists, create a simple one if not
  const imagePath = 'cover.png';
  if (!fs.existsSync(imagePath)) {
    console.log('No cover.png found - ffmpeg will create a test pattern');
  }
  
  // ffmpeg command for streaming
  const ffmpegArgs = [
    // Audio input: raw PCM from stdin
    '-f', 's16le',           // Format: signed 16-bit little-endian
    '-ar', SAMPLE_RATE.toString(),
    '-ac', CHANNELS.toString(),
    '-i', 'pipe:0',          // Read from stdin
    
    // Video input: static image or test pattern
    ...(fs.existsSync(imagePath) 
      ? ['-loop', '1', '-i', imagePath]  // Loop the image
      : ['-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:r=30']  // Blue background
    ),
    
    // Add text overlay
    '-vf', 'drawtext=text=\'Hello Twitch - AI Radio Test\':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2',
    
    // Video encoding
    '-c:v', 'libx264',       // H.264 codec
    '-preset', 'veryfast',   // Encoding speed (faster = less CPU)
    '-b:v', '2500k',         // Video bitrate
    '-maxrate', '2500k',
    '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',   // Pixel format
    '-g', '60',              // Keyframe interval
    '-r', '30',              // 30 fps
    
    // Audio encoding
    '-c:a', 'aac',           // AAC codec
    '-b:a', '128k',          // Audio bitrate
    '-ar', '48000',          // Resample to 48kHz
    
    // Output
    '-f', 'flv',             // Flash Video format for RTMP
    `${TWITCH_RTMP_URL}${TWITCH_STREAM_KEY}`
  ];
  
  const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  // Log ffmpeg output
  ffmpeg.stderr.on('data', (data) => {
    console.log(data.toString());
  });
  
  ffmpeg.on('error', (err) => {
    console.error('Failed to start ffmpeg:', err.message);
    console.error('Make sure ffmpeg is installed: brew install ffmpeg (Mac) or apt-get install ffmpeg (Linux)');
  });
  
  ffmpeg.on('close', (code) => {
    console.log(`Stream ended with code ${code}`);
  });
  
  // Generate and stream audio continuously
  let isStreaming = true;
  const toneBuffer = generateTone();
  
  function streamAudio() {
    if (!isStreaming) return;
    
    ffmpeg.stdin.write(toneBuffer, (err) => {
      if (err) {
        console.error('Error writing audio:', err.message);
        isStreaming = false;
        return;
      }
      // Schedule next write immediately for continuous audio
      setImmediate(streamAudio);
    });
  }
  
  streamAudio();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping stream...');
    isStreaming = false;
    ffmpeg.stdin.end();
    setTimeout(() => process.exit(0), 1000);
  });
  
  console.log(`
✅ Stream started!
📺 Check your stream at: https://twitch.tv/YOUR_USERNAME
⚠️  Stream may take 10-30 seconds to appear
🎵 You should hear a 440Hz tone (A4 note)
Press Ctrl+C to stop
  `);
}

// === MAIN ===
if (TWITCH_STREAM_KEY === 'your_stream_key_here') {
  console.error(`
❌ ERROR: Please set your Twitch stream key!

Steps to get your stream key:
1. Go to https://dashboard.twitch.tv/settings/stream
2. Copy your "Primary Stream Key"
3. Replace 'your_stream_key_here' in this file
4. Run again: node stream.js

⚠️  Keep your stream key SECRET - don't commit it to git!
  `);
  process.exit(1);
}

startStream();