// ==UserScript==
// @name        Audio Player for ChatGPT
// @namespace   Violentmonkey Scripts
// @match       https://chatgpt.com/*
// @grant       none
// @version     0.0.0.2
// @author      Ian Speckart
// @description https://github.com/ian-speckart/chatgpt-audio-player.git
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
 * On 2026-05-06, ChatGPT changed its audio streaming endpoint, breaking the original extension. 
 * This is a rewrite to restore functionality. I used code from @drengskapur's chatgpt-audio-enhancer, which was MIT licensed.
 * His license: https://github.com/drengskapur/chatgpt-audio-enhancer/blob/main/LICENSE
 **/

(function () {
    'use strict';

    let audio = null, controlsDiv = null, playPauseBtn = null, seekBar = null, seekLabel = null;
    let playbackRate = localStorage.getItem('ae_playbackRate') || 1;
    let currentBlob = null;
    let allChunks = [];

    const downloadAudio = () => {
        if (!allChunks.length) return;
        const blob = new Blob(allChunks, { type: 'audio/aac' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), {
            href: url,
            download: `ChatGPT_Audio_${new Date().getTime()}.aac`,
            style: 'display:none'
        });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const closePlayer = () => {
        if (audio) {
            audio.pause();
            audio.src = '';
        }
        if (controlsDiv) {
            controlsDiv.remove();
            controlsDiv = null;
        }
        currentBlob = null;
        allChunks = [];
    };

    const buildControls = () => {
        if (controlsDiv) return;

        controlsDiv = document.createElement('div');
        controlsDiv.id = 'ae_enhanced_player';
        controlsDiv.style.cssText = `
            position:fixed; top:12px; left:50%; transform:translateX(-50%);
            z-index:10000; display:flex; gap:15px; align-items:center;
            padding:10px 20px; border-radius:30px;
            background: #171717; border: 1px solid #444;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4); color:#ececec;
            font-family: sans-serif; font-size: 14px;
        `;

        playPauseBtn = document.createElement('button');
        playPauseBtn.textContent = 'Loading...';
        playPauseBtn.style.cssText = 'background:none; border:none; color:#6bb9f5; cursor:pointer; font-weight:bold; min-width:70px;';

        // Seek bar — hidden until stream finishes
        seekBar = Object.assign(document.createElement('input'), {
            type: 'range', min: 0, max: 100, value: 0,
            style: 'width:300px; cursor:pointer; display:none;'
        });

        // Placeholder shown while streaming
        seekLabel = document.createElement('span');
        seekLabel.textContent = 'Loading seek bar…';
        seekLabel.style.cssText = 'color:#888; font-size:13px; width:300px; text-align:center;';

        const dlBtn = document.createElement('button');
        dlBtn.innerHTML = '⬇️';
        dlBtn.title = 'Download Audio';
        dlBtn.style.cssText = 'background:none; border:none; cursor:pointer; font-size:16px;';
        dlBtn.onclick = downloadAudio;

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.title = 'Close Player';
        closeBtn.style.cssText = 'background:none; border:none; color:#888; cursor:pointer; font-size:16px; margin-left:5px;';
        closeBtn.onclick = closePlayer;

        controlsDiv.append(playPauseBtn, seekLabel, seekBar, dlBtn, closeBtn);
        document.body.appendChild(controlsDiv);
    };

    const enableSeekBar = () => {
        if (!seekBar || !seekLabel) return;
        seekLabel.style.display = 'none';
        seekBar.style.display = 'block';
    };

    const attachAudioStream = async (response) => {
        buildControls();
        allChunks = [];

        try {
            const mimeType = response.headers.get('content-type')?.split(';')[0] || 'audio/aac';
            const mseSupported = window.MediaSource && MediaSource.isTypeSupported(mimeType);

            if (!audio) {
                audio = new Audio();
                audio.addEventListener('timeupdate', () => {
                    if (audio.duration && isFinite(audio.duration)) {
                        seekBar.value = (audio.currentTime / audio.duration) * 100;
                    }
                });
                audio.addEventListener('ended', () => { playPauseBtn.textContent = 'Play'; });
            }

            audio.playbackRate = playbackRate;

            const wireControls = () => {
                playPauseBtn.textContent = 'Pause';
                playPauseBtn.onclick = () => {
                    if (audio.paused) { audio.play(); playPauseBtn.textContent = 'Pause'; }
                    else { audio.pause(); playPauseBtn.textContent = 'Play'; }
                };
                seekBar.oninput = () => {
                    if (audio.duration && isFinite(audio.duration)) {
                        audio.currentTime = (seekBar.value / 100) * audio.duration;
                    }
                };
            };

            if (mseSupported) {
                // --- Streaming path via MediaSource ---
                const mediaSource = new MediaSource();
                audio.src = URL.createObjectURL(mediaSource);

                await new Promise(resolve => mediaSource.addEventListener('sourceopen', resolve, { once: true }));
                const sourceBuffer = mediaSource.addSourceBuffer(mimeType);

                const reader = response.body.getReader();
                let firstChunk = true;

                const pump = async () => {
                    const { done, value } = await reader.read();

                    if (done) {
                        const waitIdle = () => new Promise(r => {
                            if (!sourceBuffer.updating) return r();
                            sourceBuffer.addEventListener('updateend', r, { once: true });
                        });
                        await waitIdle();
                        if (mediaSource.readyState === 'open') mediaSource.endOfStream();

                        // Stream finished — swap label for seek bar
                        enableSeekBar();
                        wireControls();
                        playPauseBtn.textContent = audio.paused ? 'Play' : 'Pause';
                        return;
                    }

                    allChunks.push(value);

                    if (sourceBuffer.updating) {
                        await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));
                    }

                    sourceBuffer.appendBuffer(value);

                    if (firstChunk) {
                        firstChunk = false;
                        await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));
                        audio.play().then(() => {
                            playPauseBtn.textContent = 'Pause';
                            playPauseBtn.onclick = () => {
                                if (audio.paused) { audio.play(); playPauseBtn.textContent = 'Pause'; }
                                else { audio.pause(); playPauseBtn.textContent = 'Play'; }
                            };
                            // seekBar intentionally NOT wired yet — still streaming
                        }).catch(console.error);
                    }

                    pump();
                };

                pump();

            } else {
                // --- Fallback: collect full stream then play ---
                console.warn('Extension not supported for', mimeType, '— falling back to full download');
                const chunks = [];
                const reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    allChunks.push(value);
                }
                const blob = new Blob(chunks, { type: mimeType });
                audio.src = URL.createObjectURL(blob);
                enableSeekBar();
                audio.play().then(wireControls).catch(console.error);
            }

        } catch (err) {
            if (playPauseBtn) playPauseBtn.textContent = 'Error';
            console.error('[Audio Enhancer] Stream processing failed', err);
        }
    };

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const res = await originalFetch.apply(this, args);
        const url = args[0] instanceof Request ? args[0].url : args[0];

        if (/\/backend-api\/(?:synthesize|speech\/generation)/.test(url)) {
            buildControls();

            const silencer = setInterval(() => {
                document.querySelectorAll('audio').forEach(a => {
                    if (a !== audio) { a.muted = true; a.pause(); }
                });
            }, 100);
            setTimeout(() => clearInterval(silencer), 3000);

            attachAudioStream(res);
        }
        return res;
    };
})();