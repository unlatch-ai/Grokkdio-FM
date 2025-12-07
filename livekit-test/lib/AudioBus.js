/**
 * Audio Bus - Central audio routing
 * All audio flows through here, then gets distributed to all outputs
 * (Twitch, Twilio, Local Player, etc.)
 */

import { EventEmitter } from 'events';

class AudioBus extends EventEmitter {
  constructor() {
    super();
    this.outputs = new Set();
  }
  
  /**
   * Register an output (Twitch, Twilio, Local, etc.)
   */
  addOutput(output) {
    this.outputs.add(output);
    console.log(`🔊 Audio output registered: ${output.name}`);
  }
  
  /**
   * Remove an output
   */
  removeOutput(output) {
    this.outputs.delete(output);
    console.log(`🔇 Audio output removed: ${output.name}`);
  }
  
  /**
   * Write audio to all outputs
   */
  writeAudio(audioBuffer) {
    for (const output of this.outputs) {
      if (output.writeAudio) {
        output.writeAudio(audioBuffer);
      }
    }
  }
}

// Global singleton
export const audioBus = new AudioBus();
