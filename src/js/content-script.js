// ==UserScript==
// @name        Audio Player for ChatGPT
// @namespace   Violentmonkey Scripts
// @match       https://chatgpt.com/*
// @grant       none
// @version     0.0.0.5
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
 * 
 * On 2026-06-09: the user 'Mohammad J' contributed code to add functionality (backward/forward buttons, 
 * playback speed, time labels). I audited, tested and integrated his contribution.
 **/

(function () {
    'use strict';

    let audio = null;
    let controlsDiv = null;
    let contentDiv = null;
    let playPauseBtn = null;
    let backBtn = null;
    let forwardBtn = null;
    let seekBar = null;
    let currentTimeLabel = null;
    let durationLabel = null;
    let trackTitleLabel = null;
    let downloadBtn = null;
    let speedBtn = null;
    let speedMenu = null;
    let minimizeBtn = null;

    let playbackRate = Number(localStorage.getItem('ae_playbackRate') || 1);
    if (!Number.isFinite(playbackRate)) playbackRate = 1;

    let currentObjectUrl = null;
    let currentMimeType = 'audio/aac';
    let allChunks = [];
    let activeStreamId = 0;
    let playerState = 'idle';
    let hasPlaybackStarted = false;
    let isCollapsed = false;

    const speedOptions = [0.75, 1, 1.25, 1.5];
    const isTestMode = /(?:^|\/)test\.html(?:[?#]|$)/i.test(window.location.href);
    const nakedButtonStyle = [
        'appearance:none',
        'background:none',
        'border:none',
        'padding:0',
        'margin:0',
        'color:inherit',
        'font:inherit',
        'cursor:pointer'
    ].join(';');

    const formatRate = (rate) => `${String(rate).replace(/\.0$/, '')}x`;

    const formatTime = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };

    const getTrackTitle = () => {
        const title = `${document.title || 'Untitled'}`.trim();
        return title || 'Untitled';
    };

    const hasAudioSource = () => Boolean(audio && audio.src);

    const hasKnownDuration = () => Boolean(audio && Number.isFinite(audio.duration) && audio.duration > 0);

    const setObjectUrl = (url) => {
        ensureAudio();
        if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = url;
        audio.src = url;
    };

    const clearObjectUrl = () => {
        if (!currentObjectUrl) return;
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
    };

    const setButtonEnabled = (button, enabled) => {
        if (!button) return;
        button.disabled = !enabled;
        button.style.opacity = enabled ? '1' : '0.45';
        button.style.cursor = enabled ? 'pointer' : 'default';
    };

    const closeSpeedMenu = () => {
        if (!speedMenu) return;
        speedMenu.style.display = 'none';
    };

    const updateTrackTitle = () => {
        if (!trackTitleLabel) return;
        const title = getTrackTitle();
        trackTitleLabel.textContent = title;
        trackTitleLabel.title = title;
    };

    const updateSpeedUi = () => {
        if (speedBtn) speedBtn.textContent = formatRate(playbackRate);
        if (!speedMenu) return;

        speedMenu.querySelectorAll('button[data-rate]').forEach((optionBtn) => {
            const isActive = Number(optionBtn.dataset.rate) === playbackRate;
            optionBtn.style.fontWeight = isActive ? '700' : '400';
            optionBtn.style.color = isActive ? '#fff7d6' : '#f5f3ef';
        });
    };

    const updateTimeDisplay = () => {
        if (currentTimeLabel) {
            currentTimeLabel.textContent = formatTime(audio ? audio.currentTime : 0);
        }

        if (durationLabel) {
            durationLabel.textContent = formatTime(audio ? audio.duration : Number.NaN);
        }

        if (!seekBar) return;

        if (hasKnownDuration()) {
            seekBar.disabled = false;
            seekBar.style.opacity = '1';
            seekBar.style.cursor = 'pointer';
            seekBar.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
            return;
        }

        seekBar.disabled = true;
        seekBar.style.opacity = '0.45';
        seekBar.style.cursor = 'default';
        seekBar.value = '0';
    };

    const updatePlayPauseLabel = () => {
        if (!playPauseBtn) return;

        if (playerState === 'error') {
            playPauseBtn.textContent = 'Error';
            return;
        }

        if (playerState === 'loading' && !hasPlaybackStarted) {
            playPauseBtn.textContent = 'Loading';
            return;
        }

        playPauseBtn.textContent = hasAudioSource() && audio && !audio.paused ? 'Pause' : 'Play';
    };

    const updateControlState = () => {
        const canControlPlayback = hasAudioSource();
        const canDownload = allChunks.length > 0;

        setButtonEnabled(downloadBtn, canDownload);
        setButtonEnabled(playPauseBtn, canControlPlayback);
        setButtonEnabled(backBtn, canControlPlayback);
        setButtonEnabled(forwardBtn, canControlPlayback);

        updateSpeedUi();
        updatePlayPauseLabel();
        updateTimeDisplay();
    };

    const applyPlaybackRate = (nextRate) => {
        playbackRate = nextRate;
        localStorage.setItem('ae_playbackRate', String(playbackRate));
        if (audio) audio.playbackRate = playbackRate;
        updateSpeedUi();
        closeSpeedMenu();
    };

    const downloadAudio = () => {
        if (!allChunks.length) return;
        const blob = new Blob(allChunks, { type: currentMimeType });
        const url = URL.createObjectURL(blob);
        const extension = currentMimeType.includes('mpeg')
            ? 'mp3'
            : currentMimeType.includes('wav')
                ? 'wav'
                : currentMimeType.includes('aac')
                    ? 'aac'
                    : 'bin';
        const a = Object.assign(document.createElement('a'), {
            href: url,
            download: `ChatGPT_Audio_${Date.now()}.${extension}`,
            style: 'display:none'
        });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const closePlayer = () => {
        activeStreamId += 1;
        playerState = 'idle';
        hasPlaybackStarted = false;
        isCollapsed = false;
        closeSpeedMenu();

        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        }

        clearObjectUrl();

        if (controlsDiv) {
            controlsDiv.remove();
            controlsDiv = null;
        }

        contentDiv = null;
        playPauseBtn = null;
        backBtn = null;
        forwardBtn = null;
        seekBar = null;
        currentTimeLabel = null;
        durationLabel = null;
        trackTitleLabel = null;
        downloadBtn = null;
        speedBtn = null;
        speedMenu = null;
        minimizeBtn = null;

        currentMimeType = 'audio/aac';
        allChunks = [];
    };

    const toggleCollapsed = () => {
        isCollapsed = !isCollapsed;
        if (contentDiv) contentDiv.style.display = isCollapsed ? 'none' : 'grid';
        if (minimizeBtn) minimizeBtn.textContent = isCollapsed ? '+' : '-';
    };

    const beginDrag = (event) => {
        if (!controlsDiv || event.button !== 0) return;
        if (event.target.closest('button')) return;

        const rect = controlsDiv.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;

        controlsDiv.style.left = `${rect.left}px`;
        controlsDiv.style.top = `${rect.top}px`;
        controlsDiv.style.transform = 'none';

        const onMouseMove = (moveEvent) => {
            const width = controlsDiv.offsetWidth;
            const height = controlsDiv.offsetHeight;
            const nextLeft = Math.min(
                Math.max(12, moveEvent.clientX - offsetX),
                Math.max(12, window.innerWidth - width - 12)
            );
            const nextTop = Math.min(
                Math.max(12, moveEvent.clientY - offsetY),
                Math.max(12, window.innerHeight - height - 12)
            );

            controlsDiv.style.left = `${nextLeft}px`;
            controlsDiv.style.top = `${nextTop}px`;
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        event.preventDefault();
    };

    const createSpeedMenu = () => {
        speedMenu = document.createElement('div');
        speedMenu.style.cssText = [
            'position:absolute',
            'top:-50px',
            'right:0',
            'display:none',
            'min-width:78px',
            'padding:8px 10px',
            'border:1px solid rgba(255,255,255,0.18)',
            'border-radius:10px',
            'background:rgba(10,15,22,0.94)',
            'box-shadow:0 12px 30px rgba(0,0,0,0.28)',
            'z-index:1'
        ].join(';');

        speedOptions.forEach((rate) => {
            const optionBtn = document.createElement('button');
            optionBtn.type = 'button';
            optionBtn.dataset.rate = String(rate);
            optionBtn.textContent = formatRate(rate);
            optionBtn.style.cssText = `${nakedButtonStyle};display:block;width:100%;padding:4px 0;text-align:right;`;
            optionBtn.onclick = (event) => {
                event.stopPropagation();
                applyPlaybackRate(rate);
            };
            speedMenu.appendChild(optionBtn);
        });

        return speedMenu;
    };

    const buildControls = () => {
        if (controlsDiv) return;

        controlsDiv = document.createElement('div');
        controlsDiv.id = 'ae_enhanced_player';
        controlsDiv.style.cssText = [
            'position:fixed',
            'top:24px',
            'left:50%',
            'transform:translateX(-50%)',
            'z-index:2147483647',
            'width:min(360px, calc(100vw - 24px))',
            'border-radius:18px',
            'overflow:hidden',
            'border:1px solid rgba(255,255,255,0.14)',
            'box-shadow:0 18px 44px rgba(0,0,0,0.34)',
            'color:#f4efe5',
            'font-family:"Segoe UI", sans-serif',
            'font-size:14px'
        ].join(';');

        const titleBar = document.createElement('div');
        titleBar.style.cssText = [
            'display:flex',
            'align-items:center',
            'justify-content:space-between',
            'gap:12px',
            'padding:10px 14px',
            'background:#10161f',
            'cursor:move',
            'user-select:none'
        ].join(';');
        titleBar.onmousedown = beginDrag;

        const titleBarLabel = document.createElement('div');
        titleBarLabel.textContent = 'Audio Player';
        titleBarLabel.style.cssText = 'font-size:13px; font-weight:600; letter-spacing:0.04em; text-transform:uppercase;';

        const titleBarButtons = document.createElement('div');
        titleBarButtons.style.cssText = 'display:flex; align-items:center; gap:10px;';

        minimizeBtn = document.createElement('button');
        minimizeBtn.type = 'button';
        minimizeBtn.title = 'Minimize or expand player';
        minimizeBtn.textContent = '-';
        minimizeBtn.style.cssText = `${nakedButtonStyle};font-size:18px;line-height:1;`;
        minimizeBtn.onclick = toggleCollapsed;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.title = 'Close player';
        closeBtn.textContent = 'x';
        closeBtn.style.cssText = `${nakedButtonStyle};font-size:16px;line-height:1;`;
        closeBtn.onclick = closePlayer;

        titleBarButtons.append(minimizeBtn, closeBtn);
        titleBar.append(titleBarLabel, titleBarButtons);

        contentDiv = document.createElement('div');
        contentDiv.style.cssText = [
            'display:grid',
            'gap:10px',
            'padding:14px 16px 16px',
            'background:linear-gradient(180deg, #2d4b67 0%, #162434 100%)'
        ].join(';');

        trackTitleLabel = document.createElement('div');
        trackTitleLabel.style.cssText = [
            'text-align:center',
            'font-size:16px',
            'font-weight:600',
            'white-space:nowrap',
            'overflow:hidden',
            'text-overflow:ellipsis'
        ].join(';');

        downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.textContent = 'Download';
        downloadBtn.title = 'Download audio';
        downloadBtn.style.cssText = `${nakedButtonStyle};display:block;width:100%;text-align:center;font-size:13px;color:#e7edf6;`;
        downloadBtn.onclick = downloadAudio;

        const speedRow = document.createElement('div');
        speedRow.style.cssText = 'position:relative;display:flex;justify-content:flex-end;';

        speedBtn = document.createElement('button');
        speedBtn.type = 'button';
        speedBtn.title = 'Playback speed';
        speedBtn.style.cssText = `${nakedButtonStyle};font-size:13px;color:#fff7d6;`;
        speedBtn.onclick = (event) => {
            event.stopPropagation();
            if (!speedMenu) return;
            speedMenu.style.display = speedMenu.style.display === 'block' ? 'none' : 'block';
        };

        speedRow.append(speedBtn, createSpeedMenu());

        seekBar = document.createElement('input');
        seekBar.type = 'range';
        seekBar.min = '0';
        seekBar.max = '1000';
        seekBar.value = '0';
        seekBar.style.cssText = 'width:100%;margin:0;accent-color:#fff7d6;';
        seekBar.oninput = () => {
            if (!audio || !hasKnownDuration()) return;
            audio.currentTime = (Number(seekBar.value) / 1000) * audio.duration;
        };

        const timesRow = document.createElement('div');
        timesRow.style.cssText = 'display:flex;justify-content:space-between;font-size:13px;font-variant-numeric:tabular-nums;color:#edf1f7;';

        currentTimeLabel = document.createElement('span');
        currentTimeLabel.textContent = '0:00';

        durationLabel = document.createElement('span');
        durationLabel.textContent = '--:--';

        timesRow.append(currentTimeLabel, durationLabel);

        const controlsRow = document.createElement('div');
        controlsRow.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:20px;';

        backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.textContent = '5s Back';
        backBtn.style.cssText = `${nakedButtonStyle};font-size:14px;`;
        backBtn.onclick = () => {
            if (!audio) return;
            audio.currentTime = Math.max(0, audio.currentTime - 5);
        };

        playPauseBtn = document.createElement('button');
        playPauseBtn.type = 'button';
        playPauseBtn.textContent = 'Play';
        playPauseBtn.style.cssText = `${nakedButtonStyle};font-size:15px;font-weight:700;`;
        playPauseBtn.onclick = () => {
            if (!audio || !audio.src) return;
            if (audio.paused) {
                audio.play().catch(console.error);
                return;
            }
            audio.pause();
        };

        forwardBtn = document.createElement('button');
        forwardBtn.type = 'button';
        forwardBtn.textContent = '5s Forward';
        forwardBtn.style.cssText = `${nakedButtonStyle};font-size:14px;`;
        forwardBtn.onclick = () => {
            if (!audio) return;
            const maxDuration = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 5;
            audio.currentTime = Math.min(maxDuration, audio.currentTime + 5);
        };

        controlsRow.append(backBtn, playPauseBtn, forwardBtn);
        contentDiv.append(trackTitleLabel, downloadBtn, speedRow, seekBar, timesRow, controlsRow);
        controlsDiv.append(titleBar, contentDiv);
        document.body.appendChild(controlsDiv);

        updateTrackTitle();
        updateSpeedUi();
        updateControlState();
    };

    const ensureAudio = () => {
        if (audio) return audio;

        audio = new Audio();
        audio.addEventListener('timeupdate', updateTimeDisplay);
        audio.addEventListener('durationchange', updateTimeDisplay);
        audio.addEventListener('loadedmetadata', updateTimeDisplay);
        audio.addEventListener('play', () => {
            hasPlaybackStarted = true;
            playerState = 'ready';
            updateControlState();
        });
        audio.addEventListener('pause', updateControlState);
        audio.addEventListener('ended', updateControlState);
        audio.addEventListener('emptied', updateControlState);

        return audio;
    };

    const waitForBuffer = (sourceBuffer) => {
        if (!sourceBuffer.updating) return Promise.resolve();
        return new Promise((resolve) => sourceBuffer.addEventListener('updateend', resolve, { once: true }));
    };

    const appendWhenReady = async (sourceBuffer, chunk) => {
        await waitForBuffer(sourceBuffer);
        sourceBuffer.appendBuffer(chunk);
        await waitForBuffer(sourceBuffer);
    };

    const playBufferedAudio = async (response, mimeType) => {
        const chunks = [];

        if (response.body) {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                allChunks.push(value);
            }
        } else {
            const buffer = await response.arrayBuffer();
            const singleChunk = new Uint8Array(buffer);
            chunks.push(singleChunk);
            allChunks.push(singleChunk);
        }

        const blob = new Blob(chunks, { type: mimeType });
        setObjectUrl(URL.createObjectURL(blob));
        audio.playbackRate = playbackRate;
        await audio.play().catch(console.error);
    };

    const ensureBody = async () => {
        if (document.body) return;
        await new Promise((resolve) => window.addEventListener('DOMContentLoaded', resolve, { once: true }));
    };

    const attachAudioStream = async (response) => {
        await ensureBody();
        buildControls();
        ensureAudio();
        updateTrackTitle();
        allChunks = [];
        activeStreamId += 1;
        const streamId = activeStreamId;
        currentMimeType = 'audio/aac';
        playerState = 'loading';
        hasPlaybackStarted = false;
        audio.playbackRate = playbackRate;
        updateControlState();

        try {
            const mimeType = response.headers.get('content-type')?.split(';')[0] || 'audio/aac';
            currentMimeType = mimeType;
            const mseSupported = Boolean(response.body && window.MediaSource && MediaSource.isTypeSupported(mimeType));

            if (mseSupported) {
                const mediaSource = new MediaSource();
                setObjectUrl(URL.createObjectURL(mediaSource));

                await new Promise(resolve => mediaSource.addEventListener('sourceopen', resolve, { once: true }));
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
                        updateControlState();
                    }
                }

                if (streamId !== activeStreamId) return;
                await waitForBuffer(sourceBuffer);
                if (mediaSource.readyState === 'open') mediaSource.endOfStream();

            } else {
                await playBufferedAudio(response, mimeType);
            }

            playerState = 'ready';
            updateControlState();

        } catch (err) {
            playerState = 'error';
            updateControlState();
            console.error('[Audio Enhancer] Stream processing failed', err);
        }
    };

    const initializeTestMode = async () => {
        await ensureBody();
        buildControls();
        updateTrackTitle();
        playerState = 'idle';
        hasPlaybackStarted = false;
        updateControlState();
    };

    document.addEventListener('click', (event) => {
        if (!speedMenu || !speedBtn) return;
        if (speedMenu.contains(event.target) || speedBtn.contains(event.target)) return;
        closeSpeedMenu();
    });

    if (isTestMode) {
        initializeTestMode();
        return;
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const res = await originalFetch.apply(this, args);
        const url = args[0] instanceof Request ? args[0].url : args[0];

        if (/\/backend-api\/(?:synthesize|speech\/generation)/.test(url)) {
            const silencer = setInterval(() => {
                document.querySelectorAll('audio').forEach(a => {
                    if (a !== audio) { a.muted = true; a.pause(); }
                });
            }, 100);
            setTimeout(() => clearInterval(silencer), 3000);

            const streamResponse = typeof res.clone === 'function' ? res.clone() : res;
            attachAudioStream(streamResponse);
        }
        return res;
    };
})();