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
 * NOTICE:
 * This extension is not affiliated with OpenAI. It was developed independently by Ian Speckart.
 * 
 * ATTRIBUTIONS:
 * See CREDITS.md
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

    const iconButtonStyle = [
        nakedButtonStyle,
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'border-radius:999px',
        'transition:background-color 120ms ease, transform 120ms ease',
        'color:inherit'
    ].join(';');

    const iconMarkup = {
        minimize: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" /></svg>',
        maximize: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>',
        close: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>',
        backward: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M21 16.811c0 .864-.933 1.406-1.683.977l-7.108-4.061a1.125 1.125 0 0 1 0-1.954l7.108-4.061A1.125 1.125 0 0 1 21 8.689v8.122ZM11.25 16.811c0 .864-.933 1.406-1.683.977l-7.108-4.061a1.125 1.125 0 0 1 0-1.954l7.108-4.061a1.125 1.125 0 0 1 1.683.977v8.122Z" /></svg>',
        play: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z" /></svg>',
        pause: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M14.25 9v6m-4.5 0V9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>',
        forward: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 0 1 0 1.954l-7.108 4.061A1.125 1.125 0 0 1 3 16.811V8.69ZM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 0 1 0 1.954l-7.108 4.061a1.125 1.125 0 0 1-1.683-.977V8.69Z" /></svg>',
        download: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>'
    };

    const setButtonHoverState = (button, hoverColor = 'rgba(255,255,255,0.12)') => {
        if (!button) return;
        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = hoverColor;
            button.style.transform = 'translateY(-1px)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = 'transparent';
            button.style.transform = 'none';
        });
    };

    const setIconButton = (button, iconName, label, size = 24) => {
        button.type = 'button';
        button.innerHTML = iconMarkup[iconName] || '';
        button.setAttribute('aria-label', label);
        button.title = label;
        button.style.cssText = `${iconButtonStyle};width:${size}px;height:${size}px;`;
        const svg = button.querySelector('svg');
        if (svg) {
            svg.style.width = '18px';
            svg.style.height = '18px';
            svg.style.display = 'block';
        }
        setButtonHoverState(button);
    };

    const refreshIconButton = (button, iconName, label) => {
        if (!button) return;
        button.innerHTML = iconMarkup[iconName] || '';
        button.setAttribute('aria-label', label);
        button.title = label;
        const svg = button.querySelector('svg');
        if (svg) {
            svg.style.width = '18px';
            svg.style.height = '18px';
            svg.style.display = 'block';
        }
    };

    const createIconButton = (iconName, label, size = 24) => {
        const button = document.createElement('button');
        setIconButton(button, iconName, label, size);
        return button;
    };

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

        refreshIconButton(
            playPauseBtn,
            hasAudioSource() && audio && !audio.paused ? 'pause' : 'play',
            hasAudioSource() && audio && !audio.paused ? 'Pause' : 'Play'
        );
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
        if (minimizeBtn) {
            refreshIconButton(minimizeBtn, isCollapsed ? 'maximize' : 'minimize', isCollapsed ? 'Expand player' : 'Minimize player');
        }
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

        minimizeBtn = createIconButton('minimize', 'Minimize player');
        minimizeBtn.onclick = toggleCollapsed;

        const closeBtn = createIconButton('close', 'Close player');
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
        controlsRow.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;';

        const playbackGroup = document.createElement('div');
        playbackGroup.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:18px;';

        const rightGroup = document.createElement('div');
        rightGroup.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;';

        backBtn = createIconButton('backward', 'Back 5 seconds', 32);
        backBtn.onclick = () => {
            if (!audio) return;
            audio.currentTime = Math.max(0, audio.currentTime - 5);
        };

        playPauseBtn = createIconButton('play', 'Play', 44);
        playPauseBtn.onclick = () => {
            if (!audio || !audio.src) return;
            if (audio.paused) {
                audio.play().catch(console.error);
                return;
            }
            audio.pause();
        };

        forwardBtn = createIconButton('forward', 'Forward 5 seconds', 32);
        forwardBtn.onclick = () => {
            if (!audio) return;
            const maxDuration = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 5;
            audio.currentTime = Math.min(maxDuration, audio.currentTime + 5);
        };

        downloadBtn = createIconButton('download', 'Download audio', 32);
        downloadBtn.onclick = downloadAudio;

        playbackGroup.append(backBtn, playPauseBtn, forwardBtn);
        rightGroup.append(downloadBtn);
        controlsRow.append(document.createElement('div'), playbackGroup, rightGroup);
        contentDiv.append(trackTitleLabel, speedRow, seekBar, timesRow, controlsRow);
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