/**
 * Text Overlay Manager
 * Manages dynamic text overlays that appear and disappear
 */

import { EventEmitter } from 'events';

export class TextOverlayManager extends EventEmitter {
  constructor(localPlayer = null) {
    super();
    this.currentText = '';
    this.timeout = null;
    this.typingInterval = null;
    this.fullText = '';
    this.currentIndex = 0;
    this.localPlayer = localPlayer;
  }

  /**
   * Show text overlay with typewriter effect
   * @param {string} speakerName - Name of the speaker
   * @param {string} text - Text to display
   * @param {number} audioDurationMs - Duration of audio in milliseconds
   */
  showTypingText(speakerName, text, audioDurationMs) {
    // Clear any existing animation
    this.stopTyping();

    this.fullText = `${speakerName}: ${text}`;
    this.currentIndex = 0;
    this.currentText = '';

    // Calculate typing speed to match audio duration
    const charsPerMs = this.fullText.length / audioDurationMs;
    const msPerChar = Math.max(10, 1 / charsPerMs); // At least 10ms per char

    // Start typing animation (no console output)
    this.typingInterval = setInterval(() => {
      if (this.currentIndex < this.fullText.length) {
        this.currentIndex++;
        this.currentText = this.fullText.substring(0, this.currentIndex);
        this.emit('textChanged', this.currentText);
        
        // Update video overlay if available
        if (this.localPlayer) {
          this.localPlayer.updateSubtitle(this.currentText);
        }
      } else {
        // Finished typing
        clearInterval(this.typingInterval);
        this.typingInterval = null;
        
        // Auto-hide after 1 second
        this.timeout = setTimeout(() => {
          this.hideText();
        }, 1000);
      }
    }, msPerChar);
  }

  /**
   * Show text overlay for a duration (instant, no typing)
   * @param {string} text - Text to display
   * @param {number} duration - Duration in milliseconds (default 5000)
   */
  showText(text, duration = 5000) {
    // Clear any existing timeout
    this.stopTyping();

    this.currentText = text;
    this.emit('textChanged', text);
    
    console.log(`\n📝 Overlay: "${text}"\n`);

    // Auto-hide after duration
    this.timeout = setTimeout(() => {
      this.hideText();
    }, duration);
  }

  /**
   * Stop typing animation
   */
  stopTyping() {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  /**
   * Hide the current text overlay
   */
  hideText() {
    this.stopTyping();
    this.currentText = '';
    this.fullText = '';
    this.currentIndex = 0;
    this.emit('textChanged', '');
    
    // Clear video overlay
    if (this.localPlayer) {
      this.localPlayer.updateSubtitle('');
    }
  }

  /**
   * Get current text
   * @returns {string}
   */
  getText() {
    return this.currentText;
  }

  /**
   * Check if text is currently showing
   * @returns {boolean}
   */
  isShowing() {
    return this.currentText !== '';
  }
}
