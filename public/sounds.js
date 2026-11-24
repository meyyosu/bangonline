'use strict';

const gameAudio = (() => {
  const control = document.getElementById('soundControl');
  const toggle = document.getElementById('soundToggle');
  const panel = document.getElementById('soundPanel');
  const slider = document.getElementById('soundVolume');
  const value = document.getElementById('soundValue');
  const storageKey = 'bang.soundVolume';
  let saved = null;
  try { saved = localStorage.getItem(storageKey); } catch {}
  if (saved !== null && /^\d{1,3}$/.test(saved)) slider.value = String(Math.min(Number(saved), 100));
  let context, gain, generation = 0;
  const buffers = new Map();
  const playing = new Set();

  function updateVolume() {
    const volume = Number(slider.value);
    value.textContent = `${volume}%`;
    toggle.textContent = volume === 0 ? '🔇' : '🔊';
    if (gain) gain.gain.value = volume / 100;
  }

  function unlock() {
    if (slider.value === '0') return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!context) {
      context = new Audio();
      gain = context.createGain();
      gain.connect(context.destination);
      updateVolume();
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
  }

  function stop() {
    generation++;
    for (const source of playing) source.stop();
    playing.clear();
  }

  function load(file) {
    if (!buffers.has(file)) {
      const filename = file.includes('.') ? file : `${file}.mp3`;
      buffers.set(file, fetch(`/sounds/${filename}`).then((response) => response.ok ? response.arrayBuffer() : null)
        .then((data) => data && context.decodeAudioData(data)).catch(() => null));
    }
    return buffers.get(file);
  }

  function play(...files) {
    if (!context || slider.value === '0') return;
    const session = generation;
    const barrelAt = context.currentTime + 1;
    Promise.all(files.map(load)).then((clips) => {
      if (session !== generation || context.state !== 'running') return;
      const start = context.currentTime;
      for (const [index, clip] of clips.entries()) {
        if (!clip) continue;
        const source = context.createBufferSource();
        source.buffer = clip;
        source.connect(gain);
        playing.add(source);
        source.onended = () => playing.delete(source);
        source.start(files[index] === 'missedsound_barrel' ? Math.max(start, barrelAt) : start);
      }
    });
  }

  function showPanel(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  updateVolume();
  toggle.onclick = () => showPanel(panel.hidden);
  slider.oninput = () => {
    try { localStorage.setItem(storageKey, slider.value); } catch {}
    if (slider.value === '0') stop();
    else unlock();
    updateVolume();
  };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('click', (event) => {
    if (!control.contains(event.target)) showPanel(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { showPanel(false); toggle.focus(); }
    else unlock();
  });

  return { play, stop };
})();
