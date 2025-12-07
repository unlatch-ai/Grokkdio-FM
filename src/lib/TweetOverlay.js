/**
 * Tweet Overlay Helper
 * Combines tweet capture with image overlay display
 */

import { captureTweet } from './gettweet.js';

/**
 * Display a tweet on the video overlay
 * @param {object} player - LocalAudioPlayer or TwitchStreamer instance
 * @param {string} tweetUrl - Twitter/X URL
 * @param {object} options - Options
 * @param {number} options.duration - Display duration in ms (default: 15000)
 * @param {boolean} options.darkMode - Use dark theme (default: true)
 * @returns {Promise<void>}
 */
export async function showTweetOverlay(player, tweetUrl, options = {}) {
  const {
    duration = 15000,
    darkMode = true,
  } = options;

  try {
    // Capture the tweet
    const imagePath = await captureTweet(tweetUrl, { darkMode });
    
    // Show on overlay - deleteAfter: true is default, so image is auto-deleted when hidden
    await player.showImage(imagePath, { duration, deleteAfter: true });
    
  } catch (err) {
    console.error('Failed to show tweet overlay:', err.message);
    throw err;
  }
}

export default { showTweetOverlay };
