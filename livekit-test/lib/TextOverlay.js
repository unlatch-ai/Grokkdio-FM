/**
 * Text Overlay Manager
 * Manages dynamic text overlays that appear and disappear
 */

import { EventEmitter } from 'events';

export class TextOverlayManager extends EventEmitter {
  constructor() {
    super();
    this.currentText = '';
    this.timeout = null;
  }

  /**
   * Show text overlay for a duration
   * @param {string} text - Text to display
   * @param {number} duration - Duration in milliseconds (default 5000)
   */
  showText(text, duration = 5000) {
    // Clear any existing timeout
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.currentText = text;
    this.emit('textChanged', text);
    
    console.log(`\n📝 Overlay: "${text}"\n`);

    // Auto-hide after duration
    this.timeout = setTimeout(() => {
      this.hideText();
    }, duration);
  }

  /**
   * Hide the current text overlay
   */
  hideText() {
    this.currentText = '';
    this.emit('textChanged', '');
    
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
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
