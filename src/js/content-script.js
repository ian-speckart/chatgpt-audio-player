// ==UserScript==
// @name        Audio Player for ChatGPT
// @namespace   Violentmonkey Scripts
// @match       https://www.chatgpt.com/*
// @grant       none
// @version     0.0.0.3
// @author      Ian Speckart
// @description Adds audio player controls for ChatGPT's Read Aloud feature.
// ==/UserScript==

/**
 * RUNTIMES:
 * The code in this file can run as a Chrome/Firefox extension, by installing
 * 'Audio Player for ChatGPT', or by copy/pasting this file in a script manager like
 * violentmonkey (ready to go).
 *
 * DESCRIPTION:
 * This file adds audio player controls when an audio element is being played with
 * the 'Read Aloud' feature of ChatGPT web.
 *
 * ATTRIBUTION:
 * This extension is not affiliated with OpenAI. It was developed independently by Ian Speckart.
 * This extension was updated using code from:
 * https://github.com/drengskapur/chatgpt-audio-enhancer/issues/1
 * -On 2026-05-06, ChatGPT changed its audio streaming endpoint, breaking the original extension.
 * This is a rewrite to restore functionality. I used code from @drengskapur's chatgpt-audio-enhancer, which was MIT licensed.
 * License: https://github.com/drengskapur/chatgpt-audio-enhancer/blob/main/LICENSE
 *
 * -On 2026-06-09, Mohammad J. made code contributions, which I audited, tested and integrated.
 * ...He added: time markers, back and forward buttons, playback speed control, performance improvements.
 **/

(function () {
  'use strict';

  let audio = null;
  let controlsDiv = null;
  let playPauseBtn = null;
  let backBtn = null;
  let forwardBtn = null;
  let seekBar = null;
  let seekLabel = null;
  let timeLabel = null;
  let speedSelect = null;
  let currentObjectUrl = null;
  let allChunks = [];
  let activeStreamId = 0;
  let playbackRate = Number(localStorage.getItem('ae_playbackRate') || 1);

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const updateTimeDisplay = () => {
    if (!audio || !timeLabel) return;
    timeLabel.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  };

  const setObjectUrl = (url) => {
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = url;
    audio.src = url;
  };

  const buttonStyle = `
        background:#2b2b2b; border:1px solid #555; border-radius:14px;
        color:#ececec; cursor:pointer; padding:4px 8px; font-size:13px;
    `;

  const downloadAudio = () => {
    if (!allChunks.length) return;
    const blob = new Blob(allChunks, { type: 'audio/aac' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: `ChatGPT_Audio_${Date.now()}.aac`,
      style: 'display:none',
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const closePlayer = () => {
    activeStreamId += 1;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    if (controlsDiv) {
      controlsDiv.remove();
      controlsDiv = null;
    }
    allChunks = [];
  };

  const buildControls = () => {
    if (controlsDiv) return;

    controlsDiv = document.createElement('div');
    controlsDiv.id = 'ae_enhanced_player';
    controlsDiv.style.cssText = `
            position:fixed; top:12px; left:50%; transform:translateX(-50%);
            z-index:10000; display:flex; gap:10px; align-items:center;
            padding:10px 16px; border-radius:30px; background:#171717;
            border:1px solid #444; box-shadow:0 8px 32px rgba(0,0,0,0.4);
            color:#ececec; font-family:Arial, sans-serif; font-size:14px;
        `;

    playPauseBtn = document.createElement('button');
    playPauseBtn.textContent = 'Loading...';
    playPauseBtn.style.cssText = `
            background:none; border:none; color:#ffffff; cursor:pointer;
            font-weight:bold; min-width:70px;
        `;

    backBtn = document.createElement('button');
    backBtn.textContent = '-5s';
    backBtn.title = 'Back 5 seconds';
    backBtn.style.cssText = buttonStyle;

    forwardBtn = document.createElement('button');
    forwardBtn.textContent = '+5s';
    forwardBtn.title = 'Forward 5 seconds';
    forwardBtn.style.cssText = buttonStyle;

    seekBar = Object.assign(document.createElement('input'), {
      type: 'range',
      min: 0,
      max: 1000,
      value: 0,
    });
    seekBar.style.cssText = 'width:300px; cursor:pointer; display:none;';

    seekLabel = document.createElement('span');
    seekLabel.textContent = 'Loading seek bar...';
    seekLabel.style.cssText =
      'color:#888; font-size:13px; width:300px; text-align:center;';

    timeLabel = document.createElement('span');
    timeLabel.textContent = '0:00 / --:--';
    timeLabel.style.cssText = `
            color:#cfcfcf; font-size:13px; min-width:95px; text-align:center;
            font-variant-numeric:tabular-nums;
        `;

    speedSelect = document.createElement('select');
    speedSelect.title = 'Playback speed';
    speedSelect.style.cssText = buttonStyle;
    [0.75, 1, 1.25, 1.5, 1.75, 2].forEach((rate) => {
      const option = document.createElement('option');
      option.value = String(rate);
      option.textContent = `${rate}x`;
      option.selected = rate === playbackRate;
      speedSelect.appendChild(option);
    });

    const dlBtn = document.createElement('button');
    dlBtn.textContent = 'Download';
    dlBtn.title = 'Download Audio';
    dlBtn.style.cssText = buttonStyle;
    dlBtn.onclick = downloadAudio;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'x';
    closeBtn.title = 'Close Player';
    closeBtn.style.cssText = `
            background:none; border:none; color:#aaa; cursor:pointer;
            font-size:16px; margin-left:2px;
        `;
    closeBtn.onclick = closePlayer;

    controlsDiv.append(
      playPauseBtn,
      backBtn,
      forwardBtn,
      seekLabel,
      seekBar,
      timeLabel,
      speedSelect,
      dlBtn,
      closeBtn,
    );
    document.body.appendChild(controlsDiv);
  };

  const enableSeekBar = () => {
    if (!seekBar || !seekLabel) return;
    seekLabel.style.display = 'none';
    seekBar.style.display = 'block';
  };

  const wireControls = () => {
    if (!audio) return;

    playPauseBtn.onclick = () => {
      if (audio.paused) {
        audio.play().catch(console.error);
        playPauseBtn.textContent = 'Pause';
      } else {
        audio.pause();
        playPauseBtn.textContent = 'Play';
      }
    };

    backBtn.onclick = () => {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    };

    forwardBtn.onclick = () => {
      const duration = Number.isFinite(audio.duration)
        ? audio.duration
        : audio.currentTime + 5;
      audio.currentTime = Math.min(duration, audio.currentTime + 5);
    };

    seekBar.oninput = () => {
      if (Number.isFinite(audio.duration)) {
        audio.currentTime = (Number(seekBar.value) / 1000) * audio.duration;
      }
    };

    speedSelect.onchange = () => {
      playbackRate = Number(speedSelect.value);
      localStorage.setItem('ae_playbackRate', String(playbackRate));
      audio.playbackRate = playbackRate;
    };

    updateTimeDisplay();
  };

  const ensureAudio = () => {
    if (audio) return audio;

    audio = new Audio();
    audio.addEventListener('timeupdate', () => {
      if (Number.isFinite(audio.duration) && seekBar) {
        seekBar.value = String((audio.currentTime / audio.duration) * 1000);
      }
      updateTimeDisplay();
    });
    audio.addEventListener('durationchange', updateTimeDisplay);
    audio.addEventListener('loadedmetadata', updateTimeDisplay);
    audio.addEventListener('play', () => {
      if (playPauseBtn) playPauseBtn.textContent = 'Pause';
    });
    audio.addEventListener('pause', () => {
      if (playPauseBtn) playPauseBtn.textContent = 'Play';
    });
    audio.addEventListener('ended', () => {
      if (playPauseBtn) playPauseBtn.textContent = 'Play';
    });

    return audio;
  };

  const waitForBuffer = (sourceBuffer) => {
    if (!sourceBuffer.updating) return Promise.resolve();
    return new Promise((resolve) =>
      sourceBuffer.addEventListener('updateend', resolve, { once: true }),
    );
  };

  const appendWhenReady = async (sourceBuffer, chunk) => {
    await waitForBuffer(sourceBuffer);
    sourceBuffer.appendBuffer(chunk);
    await waitForBuffer(sourceBuffer);
  };

  const playBufferedAudio = async (response, mimeType) => {
    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      allChunks.push(value);
    }

    const blob = new Blob(chunks, { type: mimeType });
    setObjectUrl(URL.createObjectURL(blob));
    enableSeekBar();
    wireControls();
    await audio.play();
  };

  const attachAudioStream = async (response) => {
    buildControls();
    ensureAudio();
    allChunks = [];
    activeStreamId += 1;
    const streamId = activeStreamId;

    playPauseBtn.textContent = 'Loading...';
    seekLabel.style.display = 'block';
    seekBar.style.display = 'none';
    seekBar.value = '0';
    audio.playbackRate = playbackRate;
    wireControls();

    try {
      const mimeType =
        response.headers.get('content-type')?.split(';')[0] || 'audio/aac';
      const mseSupported =
        window.MediaSource && MediaSource.isTypeSupported(mimeType);

      if (!mseSupported || !response.body) {
        await playBufferedAudio(response, mimeType);
        return;
      }

      const mediaSource = new MediaSource();
      setObjectUrl(URL.createObjectURL(mediaSource));
      await new Promise((resolve) =>
        mediaSource.addEventListener('sourceopen', resolve, { once: true }),
      );

      const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      const reader = response.body.getReader();
      let started = false;

      while (streamId === activeStreamId) {
        const { done, value } = await reader.read();
        if (done) break;

        allChunks.push(value);
        await appendWhenReady(sourceBuffer, value);

        if (!started) {
          started = true;
          audio.play().catch(console.error);
        }
      }

      if (streamId !== activeStreamId) return;
      await waitForBuffer(sourceBuffer);
      if (mediaSource.readyState === 'open') mediaSource.endOfStream();

      enableSeekBar();
      playPauseBtn.textContent = audio.paused ? 'Play' : 'Pause';
      updateTimeDisplay();
    } catch (error) {
      if (playPauseBtn) playPauseBtn.textContent = 'Error';
      console.error(
        '[Audio Player for ChatGPT] Stream processing failed',
        error,
      );
    }
  };

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await originalFetch.apply(this, args);
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);

    if (/\/backend-api\/(?:synthesize|speech\/generation)/.test(url)) {
      buildControls();

      const silencer = setInterval(() => {
        document.querySelectorAll('audio').forEach((pageAudio) => {
          if (pageAudio !== audio) {
            pageAudio.muted = true;
            pageAudio.pause();
          }
        });
      }, 100);
      setTimeout(() => clearInterval(silencer), 3000);

      attachAudioStream(res.clone());
    }

    return res;
  };
})();
