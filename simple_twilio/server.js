require('dotenv-flow/config');
const express = require('express');
const expressWs = require('express-ws');

const appBase = express();
const { app } = expressWs(appBase);

app.use(express.urlencoded({ extended: true })).use(express.json());

// Simple Twilio media stream demo: logs when user is speaking / paused.

// TwiML webhook – configure this on your Twilio number as Voice webhook (POST)
app.post('/twiml', (req, res) => {
  const from = req.body.From;
  const to = req.body.To;

  const callId = `call_${Date.now()}`;

  const hostname = process.env.HOSTNAME.replace(/^https?:\/\//, '');
  const streamUrl = `wss://${hostname}/media-stream/${callId}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;

  console.log(`[${callId}] Incoming call from ${from} to ${to}`);
  console.log(`[${callId}] Using stream URL: ${streamUrl}`);

  res.type('text/xml').status(200).send(twiml);
});

// Very simple Twilio media stream handler
// This does NOT transcribe, it just logs when audio is flowing and when
// there is a pause (based on gaps between media messages).
app.ws('/media-stream/:callId', (ws, req) => {
  const callId = req.params.callId;
  console.log(`[${callId}] Media stream connected`);

  let lastMediaTs = Date.now();
  let speaking = false;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.event === 'start') {
      console.log(`[${callId}] Twilio start event:`, msg.start?.mediaFormat);
      return;
    }

    if (msg.event === 'media') {
      const now = Date.now();
      const delta = now - lastMediaTs;
      lastMediaTs = now;

      // Very rough VAD: if we see continuous packets, assume speaking;
      // if we have a gap > 500ms, treat as pause.
      if (!speaking) {
        speaking = true;
        console.log(`[${callId}] 🎤 user started speaking`);
      }

      if (delta > 500) {
        console.log(`[${callId}] ⏸ pause detected (${delta} ms gap)`);
      }

      return;
    }

    if (msg.event === 'stop') {
      console.log(`[${callId}] Twilio stop event`);
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log(`[${callId}] Media stream closed`);
  });

  ws.on('error', (err) => {
    console.error(`[${callId}] Media stream error`, err);
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`simple_twilio server listening on http://localhost:${port}`);
});
