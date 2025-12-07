/**
 * Image Overlay Manager
 * Manages a single image overlay with fade in/out effects
 * Works by writing to a file that FFmpeg reads with movie filter
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export class ImageOverlayManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.overlayFile = config.overlayFile || path.join(process.cwd(), 'overlay.png');
    this.transparentFile = path.join(process.cwd(), 'transparent.png');
    this.currentImage = null;
    this.fadeTimeout = null;
    
    // Create a 1x1 transparent PNG for "no overlay" state
    this._createTransparentPng();
  }

  /**
   * Create a transparent PNG to use when no overlay is active
   * Creates a 1280x720 transparent PNG for proper overlay sizing
   */
  _createTransparentPng() {
    // 1280x720 transparent PNG - minimal valid PNG with IHDR for this size
    // Using ffmpeg to create it is more reliable
    try {
      const { execSync } = require('child_process');
      execSync(`ffmpeg -y -f lavfi -i color=c=black@0:s=1280x720:d=1 -frames:v 1 -c:v png "${this.transparentFile}" 2>/dev/null`, {
        stdio: 'pipe'
      });
      // Start with transparent overlay
      fs.copyFileSync(this.transparentFile, this.overlayFile);
      console.log('🖼️  Created transparent overlay base');
    } catch (err) {
      // Fallback: create a 1x1 transparent PNG (will be scaled by FFmpeg)
      const transparentPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const buffer = Buffer.from(transparentPngBase64, 'base64');
      fs.writeFileSync(this.transparentFile, buffer);
      fs.copyFileSync(this.transparentFile, this.overlayFile);
      console.log('🖼️  Created fallback transparent overlay');
    }
  }

  /**
   * Show an image with fade in, display for duration, then fade out
   * @param {string} imagePath - Path to the PNG image
   * @param {object} options - Options
   * @param {number} options.duration - How long to show (ms), default 15000
   * @param {boolean} options.deleteAfter - Delete source image after hiding (default: true)
   */
  async showImage(imagePath, options = {}) {
    const {
      duration = 15000,
      deleteAfter = true,
    } = options;

    // Clear any pending fade out
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }

    // Verify image exists
    if (!fs.existsSync(imagePath)) {
      console.error(`Image not found: ${imagePath}`);
      return;
    }

    console.log(`🖼️  Showing image: ${path.basename(imagePath)} for ${duration/1000}s`);

    // Copy the image to overlay file (FFmpeg will pick it up)
    try {
      fs.copyFileSync(imagePath, this.overlayFile);
      this.currentImage = imagePath;
      this.currentImageDeleteAfter = deleteAfter;
      this.emit('imageShown', imagePath);
    } catch (err) {
      console.error('Error copying image:', err.message);
      return;
    }

    // Schedule fade out
    this.fadeTimeout = setTimeout(() => {
      this.hideImage();
    }, duration);
  }

  /**
   * Hide the current image (instant) and optionally delete source
   */
  hideImage() {
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }

    const imageToDelete = this.currentImage;
    const shouldDelete = this.currentImageDeleteAfter;

    if (imageToDelete) {
      console.log(`🖼️  Hiding image`);
    }

    try {
      // Replace with transparent PNG
      fs.copyFileSync(this.transparentFile, this.overlayFile);
      this.currentImage = null;
      this.currentImageDeleteAfter = false;
      this.emit('imageHidden');
      
      // Delete source image if requested
      if (shouldDelete && imageToDelete && fs.existsSync(imageToDelete)) {
        fs.unlinkSync(imageToDelete);
        console.log(`🗑️  Deleted: ${path.basename(imageToDelete)}`);
      }
    } catch (err) {
      console.error('Error hiding image:', err.message);
    }
  }

  /**
   * Get the overlay file path for FFmpeg filter
   * @returns {string}
   */
  getOverlayPath() {
    return this.overlayFile;
  }

  /**
   * Get FFmpeg filter string for overlay with fade effect
   * Call this to get the -vf filter addition
   * @param {object} options - Position options
   * @param {string} options.x - X position (default: centered)
   * @param {string} options.y - Y position (default: centered)
   * @param {number} options.fadeFrames - Frames for fade (default: 15 = 0.5s at 30fps)
   * @returns {string} FFmpeg filter string
   */
  static getFilterString(overlayPath, options = {}) {
    const {
      x = '(W-w)/2',  // Centered horizontally
      y = '(H-h)/2',  // Centered vertically
    } = options;

    // movie filter reads the PNG, format ensures alpha channel works
    // overlay composites it on top of the video
    return `movie=${overlayPath}:loop=0,format=rgba,setpts=N/FRAME_RATE/TB[ovl];[base][ovl]overlay=${x}:${y}:format=auto:shortest=0`;
  }

  /**
   * Cleanup
   */
  cleanup() {
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
    }
    
    try {
      if (fs.existsSync(this.overlayFile)) {
        fs.unlinkSync(this.overlayFile);
      }
      if (fs.existsSync(this.transparentFile)) {
        fs.unlinkSync(this.transparentFile);
      }
    } catch (err) {
      // Ignore
    }
  }
}

export default ImageOverlayManager;
