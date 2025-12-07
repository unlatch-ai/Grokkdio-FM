/**
 * Twitch Egress Helper
 * Handles starting RTMP egress to Twitch via LiveKit
 */

import { EgressClient, StreamOutput, StreamProtocol } from "livekit-server-sdk";

/**
 * Start Twitch RTMP egress for a LiveKit room
 * @param {string} roomName - Name of the LiveKit room
 * @param {Object} config - Configuration options
 * @returns {Promise<Object|null>} - Egress info or null if failed
 */
export async function startTwitchEgress(roomName, config = {}) {
  const livekitUrl = config.livekitUrl || process.env.LIVEKIT_URL;
  const apiKey = config.apiKey || process.env.LIVEKIT_API_KEY;
  const apiSecret = config.apiSecret || process.env.LIVEKIT_API_SECRET;
  const twitchStreamKey =
    config.twitchStreamKey || process.env.TWITCH_STREAM_KEY;

  if (!twitchStreamKey) {
    console.log("⚠️  No TWITCH_STREAM_KEY - skipping egress");
    return null;
  }

  if (!livekitUrl || !apiKey || !apiSecret) {
    console.error("❌ Missing LiveKit credentials for egress");
    return null;
  }

  console.log("📺 Starting Twitch egress...");

  // Convert wss:// to https:// for the API endpoint
  const apiUrl = livekitUrl
    .replace("wss://", "https://")
    .replace("ws://", "http://");

  const egressClient = new EgressClient(apiUrl, apiKey, apiSecret);

  try {
    const output = new StreamOutput({
      protocol: StreamProtocol.RTMP,
      urls: [`rtmp://live.twitch.tv/app/${twitchStreamKey}`],
    });

    const info = await egressClient.startRoomCompositeEgress(
      roomName,
      { stream: output },
      {
        layout: config.layout || "single-speaker",
        audioOnly: config.audioOnly !== undefined ? config.audioOnly : false,
      }
    );

    console.log("✅ Twitch egress started:", info.egressId);
    console.log("📺 Stream should appear on Twitch in ~25 seconds");

    return info;
  } catch (err) {
    console.error("❌ Failed to start egress:", err.message);
    console.log(
      "💡 Tip: Make sure Egress is enabled in your LiveKit Cloud project"
    );
    console.log(
      "   Go to https://cloud.livekit.io/ → Your Project → Settings → Egress"
    );
    return null;
  }
}

/**
 * Stop an active egress
 * @param {string} egressId - ID of the egress to stop
 * @param {Object} config - Configuration options
 */
export async function stopEgress(egressId, config = {}) {
  const livekitUrl = config.livekitUrl || process.env.LIVEKIT_URL;
  const apiKey = config.apiKey || process.env.LIVEKIT_API_KEY;
  const apiSecret = config.apiSecret || process.env.LIVEKIT_API_SECRET;

  const apiUrl = livekitUrl
    .replace("wss://", "https://")
    .replace("ws://", "http://");

  const egressClient = new EgressClient(apiUrl, apiKey, apiSecret);

  try {
    await egressClient.stopEgress(egressId);
    console.log("✅ Egress stopped:", egressId);
  } catch (err) {
    console.error("❌ Failed to stop egress:", err.message);
  }
}

export default { startTwitchEgress, stopEgress };
