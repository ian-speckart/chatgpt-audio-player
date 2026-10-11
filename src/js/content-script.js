// Runs in the page's MAIN world and controls playback discovered by audio-context-hook.js.
(function () {
    'use strict';

    const loggingEnabled = false;

    const MEDIA_KEY = '__chatgptAudioPlayerMedia';
    const CONTEXT_KEY = '__chatgptAudioPlayerContexts';
    const PLAYER_ID = 'ae_enhanced_player';
    const SPEEDS = [0.75, 1, 1.25, 1.5];

    let player;
    let titleLabel;
    let content;
    let playButton;
    let speedButton;
    let speedMenu;
    let forwardButton;
    let downloadButton;
    let chunks = [];
    let mimeType = 'audio/aac';
    let pausedMedia = new Set();
    let pausedContexts = new Set();
    let lastActiveMedia = null;
    let dismissedSource = '';
    let minimized = false;
    let dragState = null;
    let mediaResumeInProgress = false;
    let playbackToggleInProgress = false;
    let playbackRate = Number(localStorage.getItem('ae_playbackRate') || 1);
    if (!Number.isFinite(playbackRate)) playbackRate = 1;

    const getMedia = () => Array.from(window[MEDIA_KEY] || []);
    const getContexts = () => Array.from(window[CONTEXT_KEY] || []);
    const sourceOf = (media) => media?.currentSrc || media?.src || '';
    const hasSource = (media) => Boolean(media && (sourceOf(media) || media.srcObject));
    const activeMedia = () => getMedia().filter((media) => !media.paused && !media.ended);

    function getRouteKey() {
        const match = location.pathname.match(/\/c\/([^/?#]+)/);
        return match ? `conversation:${match[1]}` : `route:${location.pathname}`;
    }

    function log(event, details = {}) {
        if (!loggingEnabled) return;
        console.info('[ChatGPT Audio Player]', event, details);
    }

    function setIcon(button, name, label) {
        const paths = {
            minimize: '<path d="M5 12h14"/>',
            maximize: '<path d="M12 4v16M4 12h16"/>',
            close: '<path d="m6 6 12 12M18 6 6 18"/>',
            back: '<path d="M11 19 2 12l9-7v14ZM22 19l-9-7 9-7v14Z"/>',
            play: '<path d="M8 5v14l11-7z"/>',
            pause: '<path d="M7 5h4v14H7zM15 5h4v14h-4z"/>',
            forward: '<path d="M13 5 22 12l-9 7V5ZM2 5l9 7-9 7V5Z"/>',
            download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M4 17v4h16v-4"/>',
        };
        const filled = ['play', 'pause', 'back', 'forward'].includes(name);
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"${filled ? ' fill="#fff"' : ' fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'}>${paths[name]}</svg>`;
        button.dataset.icon = name;
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    function getCurrentMedia() {
        const playing = activeMedia();
        if (playing.length) {
            lastActiveMedia = playing[playing.length - 1];
            return lastActiveMedia;
        }
        return Array.from(pausedMedia).find((media) => !media.ended && hasSource(media))
            || (lastActiveMedia && !lastActiveMedia.ended && hasSource(lastActiveMedia) ? lastActiveMedia : null);
    }

    function getPlaybackState() {
        const runningContexts = getContexts().filter((context) => context.state === 'running');
        const playingMedia = activeMedia();
        if (playingMedia.length) lastActiveMedia = playingMedia[playingMedia.length - 1];
        return { runningContexts, playingMedia, isPlaying: runningContexts.length > 0 || playingMedia.length > 0 };
    }

    function getCurrentSourceKey() {
        const media = activeMedia().at(-1) || Array.from(pausedMedia).at(-1) || lastActiveMedia;
        return sourceOf(media);
    }

    function updateUi() {
        if (!player) return;
        const { isPlaying } = getPlaybackState();
        const hasPausedSession = pausedMedia.size > 0 || pausedContexts.size > 0;
        const sourceKey = getCurrentSourceKey();
        if (dismissedSource && sourceKey && sourceKey !== dismissedSource) dismissedSource = '';
        player.style.display = (isPlaying || hasPausedSession) && sourceKey !== dismissedSource ? 'block' : 'none';
        setIcon(playButton, isPlaying ? 'pause' : 'play', isPlaying ? 'Pause' : 'Play');
        titleLabel.textContent = document.title || 'ChatGPT Audio';
        titleLabel.title = titleLabel.textContent;
        speedButton.textContent = `${String(playbackRate).replace(/\.0$/, '')}x`;
        downloadButton.disabled = chunks.length === 0;
        speedMenu.querySelectorAll('button[data-rate]').forEach((item) => {
            item.style.fontWeight = Number(item.dataset.rate) === playbackRate ? '700' : '400';
        });
    }

    function pauseMedia(media) {
        let suppressed = false;
        const suppressPause = (event) => {
            suppressed = true;
            event.stopImmediatePropagation();
            event.stopPropagation();
            log('extension pause event suppressed', { source: sourceOf(media), currentTime: media.currentTime });
        };
        media.addEventListener('pause', suppressPause, { capture: true, once: true });
        window.setTimeout(() => {
            if (!suppressed) media.removeEventListener('pause', suppressPause, true);
        }, 2000);
        media.pause();
    }

    async function togglePlayback() {
        if (playbackToggleInProgress) {
            log('playback toggle ignored because the previous toggle is still running');
            return;
        }

        playbackToggleInProgress = true;
        const { runningContexts, playingMedia, isPlaying } = getPlaybackState();
        log('playback toggle started', {
            isPlaying,
            runningContexts: runningContexts.length,
            playingMedia: playingMedia.map((media) => ({
                source: sourceOf(media),
                paused: media.paused,
                ended: media.ended,
                currentTime: media.currentTime,
            })),
            pausedMedia: pausedMedia.size,
            pausedContexts: pausedContexts.size,
        });
        try {
        if (runningContexts.length) {
            const results = await Promise.allSettled(runningContexts.map((context) => context.suspend()));
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') pausedContexts.add(runningContexts[index]);
                else log('AudioContext suspend failed', { message: result.reason?.message || String(result.reason) });
            });
        }

        if (playingMedia.length) {
            pausedMedia.clear();
            playingMedia.forEach((media) => {
                pausedMedia.add(media);
                pauseMedia(media);
            });
        } else if (!isPlaying) {
            if (mediaResumeInProgress) return;
            mediaResumeInProgress = true;
            try {
                const contexts = Array.from(pausedContexts).filter((context) =>
                    context.state === 'suspended' || context.state === 'interrupted');
                const media = Array.from(pausedMedia).filter((element) => !element.ended && hasSource(element));
                const contextResults = await Promise.allSettled(contexts.map((context) => context.resume()));
                contextResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') pausedContexts.delete(contexts[index]);
                    else log('AudioContext resume failed', { message: result.reason?.message || String(result.reason) });
                });
                const mediaResults = await Promise.allSettled(media.map((element) => element.play()));
                mediaResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') pausedMedia.delete(media[index]);
                    else log('media resume failed', { message: result.reason?.message || String(result.reason) });
                });
            } finally {
                mediaResumeInProgress = false;
            }
        }
        updateUi();
        log('playback toggle completed', {
            isPlaying: getPlaybackState().isPlaying,
            pausedMedia: pausedMedia.size,
            pausedContexts: pausedContexts.size,
        });
        } catch (error) {
            log('playback toggle threw', { name: error?.name, message: error?.message || String(error) });
        } finally {
            playbackToggleInProgress = false;
            updateUi();
        }
    }

    function seekBy(offset) {
        const media = getCurrentMedia();
        if (!media || !hasSource(media)) {
            log('seek unavailable', { offset, hasMedia: Boolean(media), duration: media?.duration });
            return;
        }
        const maxTime = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : Infinity;
        const nextTime = Math.max(0, Math.min(maxTime, media.currentTime + offset));
        try {
            media.currentTime = nextTime;
            log('seek applied', {
                offset,
                currentTime: media.currentTime,
                duration: media.duration,
                source: sourceOf(media),
            });
        } catch (error) {
            log('seek failed', { offset, message: error?.message || String(error) });
        }
    }

    function applyPlaybackRate(rate) {
        playbackRate = rate;
        localStorage.setItem('ae_playbackRate', String(rate));
        getMedia().forEach((media) => { media.playbackRate = rate; });
        speedMenu.style.display = 'none';
        updateUi();
    }

    function downloadAudio() {
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ChatGPT_Audio_${Date.now()}.${mimeType.includes('mpeg') ? 'mp3' : 'aac'}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function beginDrag(event) {
        if (event.button !== 0 || event.target.closest('button')) return;
        const rect = player.getBoundingClientRect();
        dragState = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        player.style.left = `${rect.left}px`;
        player.style.top = `${rect.top}px`;
        player.style.right = 'auto';
        player.style.transform = 'none';
        event.preventDefault();
    }

    function mountPlayer() {
        if (document.getElementById(PLAYER_ID)) return;
        player = document.createElement('section');
        player.id = PLAYER_ID;
        player.style.cssText = [
            'position:fixed', 'top:24px', 'left:50%', 'transform:translateX(-50%)',
            'z-index:2147483647', 'width:min(360px,calc(100vw - 24px))',
            'border:1px solid rgba(255,255,255,.14)', 'border-radius:12px',
            'box-shadow:0 18px 44px rgba(0,0,0,.34)', 'color:#f4efe5',
            'font:14px "Segoe UI",sans-serif', 'background:#212121', 'display:none', 'overflow:visible',
        ].join(';');

        const header = document.createElement('header');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;cursor:move;user-select:none;background:#292929;border-radius:12px 12px 0 0;';
        header.addEventListener('pointerdown', beginDrag);
        titleLabel = document.createElement('div');
        titleLabel.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;';
        const headerActions = document.createElement('div');
        headerActions.style.cssText = 'display:flex;gap:6px;';

        const createButton = (name, label, handler, size = 34, pointerActivate = false) => {
            const control = document.createElement('button');
            control.type = 'button';
            control.style.cssText = `display:inline-grid;place-items:center;width:${size}px;height:${size}px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;`;
            setIcon(control, name, label);
            control.querySelector('svg').style.cssText = `width:${size > 40 ? 22 : 18}px;height:${size > 40 ? 22 : 18}px;${['play', 'pause', 'back', 'forward'].includes(name) ? 'fill:currentColor;' : 'fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;'}`;
            if (pointerActivate) {
                control.addEventListener('pointerdown', (event) => {
                    log(`${label} pointerdown`, {
                        pointerType: event.pointerType,
                        isPrimary: event.isPrimary,
                        button: event.button,
                        isTrusted: event.isTrusted,
                    });
                    if (!event.isPrimary || event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    handler();
                });
                control.addEventListener('click', (event) => {
                    if (event.detail !== 0) return;
                    log(`${label} keyboard activation`, { isTrusted: event.isTrusted });
                    handler();
                });
            } else {
                control.addEventListener('click', handler);
            }
            return control;
        };

        let minimizeButton;
        minimizeButton = createButton('minimize', 'Minimize player', () => {
            minimized = !minimized;
            content.style.display = minimized ? 'none' : 'grid';
            setIcon(minimizeButton, minimized ? 'maximize' : 'minimize', minimized ? 'Expand player' : 'Minimize player');
        }, 30);
        const closeButton = createButton('close', 'Close player', () => {
            dismissedSource = getCurrentSourceKey();
            player.style.display = 'none';
            pausedMedia.clear();
            pausedContexts.clear();
        }, 30);
        headerActions.append(minimizeButton, closeButton);
        header.append(titleLabel, headerActions);

        content = document.createElement('div');
        content.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;padding:12px 16px 14px;';
        const left = document.createElement('div');
        left.style.cssText = 'display:flex;align-items:center;gap:8px;';
        const speedWrap = document.createElement('div');
        speedWrap.style.cssText = 'position:relative;';
        speedButton = document.createElement('button');
        speedButton.type = 'button';
        speedButton.style.cssText = 'min-width:32px;border:0;background:transparent;color:#fff7d6;cursor:pointer;font:13px inherit;';
        speedButton.addEventListener('click', () => {
            speedMenu.style.display = speedMenu.style.display === 'block' ? 'none' : 'block';
        });
        speedMenu = document.createElement('div');
        speedMenu.style.cssText = 'position:absolute;bottom:30px;left:0;display:none;min-width:68px;padding:6px 8px;background:#111;border:1px solid #555;border-radius:8px;';
        SPEEDS.forEach((rate) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.dataset.rate = String(rate);
            item.textContent = `${String(rate).replace(/\.0$/, '')}x`;
            item.style.cssText = 'display:block;width:100%;padding:5px;border:0;background:transparent;color:#fff;text-align:right;cursor:pointer;';
            item.addEventListener('click', () => applyPlaybackRate(rate));
            speedMenu.appendChild(item);
        });
        speedWrap.append(speedButton, speedMenu);
        left.append(speedWrap);

        playButton = createButton('play', 'Play', togglePlayback, 44, true);
        playButton.style.justifySelf = 'center';
        const right = document.createElement('div');
        right.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:8px;';
        downloadButton = createButton('download', 'Download audio', downloadAudio, 30);
        downloadButton.disabled = true;
        right.append(downloadButton);
        content.append(left, playButton, right);
        player.append(header, content);
        (document.body || document.documentElement).appendChild(player);
        document.addEventListener('pointermove', (event) => {
            if (!dragState) return;
            const leftPos = Math.max(8, Math.min(window.innerWidth - player.offsetWidth - 8, event.clientX - dragState.x));
            const topPos = Math.max(8, Math.min(window.innerHeight - player.offsetHeight - 8, event.clientY - dragState.y));
            player.style.left = `${leftPos}px`;
            player.style.top = `${topPos}px`;
        });
        document.addEventListener('pointerup', () => { dragState = null; });
        updateUi();
    }

    async function captureDownload(response) {
        try {
            mimeType = response.headers.get('content-type')?.split(';')[0] || 'audio/aac';
            chunks = [new Uint8Array(await response.arrayBuffer())];
            updateUi();
            log('audio download buffer captured', { bytes: chunks[0].byteLength, mimeType });
        } catch (error) {
            log('audio download capture failed', { message: error?.message || String(error) });
        }
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        const requestUrl = args[0] instanceof Request ? args[0].url
            : args[0] instanceof URL ? args[0].href : String(args[0]);
        if (/\/backend-api\/(?:synthesize|speech\/generation)(?:[/?#]|$)/.test(requestUrl)
            && response.ok && response.clone) {
            chunks = [];
            updateUi();
            captureDownload(response.clone());
        }
        return response;
    };

    let currentRoute = getRouteKey();
    const handleRouteChange = () => {
        const nextRoute = getRouteKey();
        if (nextRoute === currentRoute) return;
        currentRoute = nextRoute;
        pausedMedia.clear();
        pausedContexts.clear();
        lastActiveMedia = null;
        dismissedSource = '';
        minimized = false;
        content.style.display = 'grid';
        updateUi();
        log('conversation changed; cleared previous paused playback', { route: currentRoute });
    };
    ['pushState', 'replaceState'].forEach((name) => {
        const original = history[name];
        history[name] = function (...args) {
            const result = original.apply(this, args);
            handleRouteChange();
            return result;
        };
    });
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);

    const start = () => {
        mountPlayer();
        window.setInterval(updateUi, 250);
        document.addEventListener('click', (event) => {
            if (speedMenu && !speedMenu.contains(event.target) && !speedButton.contains(event.target)) {
                speedMenu.style.display = 'none';
            }
        });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
})();