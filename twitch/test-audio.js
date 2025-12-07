const { ensureHelloAudioFile } = require('./xaiHelloAudio');

(async () => {
  try {
    const p = await ensureHelloAudioFile();
    console.log('Audio ready at:', p);
  } catch (err) {
    console.error('Error:', err);
  }
})();
