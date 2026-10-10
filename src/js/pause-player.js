// Runs in the page's MAIN world so it can control the tracked AudioContexts.
(function () {
    'use strict';

    const registryKey = '__chatgptAudioPlayerContexts';
    const mediaKey = '__chatgptAudioPlayerMedia';
    const hostId = 'chatgpt-audio-player-pause-control';
    let button;
    let playerHost;
    let updateInterval;
    let pausedMedia = new Set();
    let pausedContexts = new Set();
    let mediaResumeInProgress = false;
    let lastActiveMedia = null;

    const getContexts = () => Array.from(window[registryKey] || []);
    const getMediaElements = () => Array.from(window[mediaKey] || []);

    const pauseMediaWithoutStopSignal = (media) => {
        let pauseEventSuppressed = false;
        const suppressPauseEvent = (event) => {
            pauseEventSuppressed = true;
            event.stopImmediatePropagation();
            event.stopPropagation();
            console.info('[ChatGPT Audio Player] suppressed extension pause event from ChatGPT handlers', {
                source: media.currentSrc || media.src || '(no source)',
                currentTime: media.currentTime,
            });
        };

        media.addEventListener('pause', suppressPauseEvent, { capture: true, once: true });
        window.setTimeout(() => {
            if (!pauseEventSuppressed) {
                media.removeEventListener('pause', suppressPauseEvent, true);
                console.info('[ChatGPT Audio Player] extension pause event was not observed', {
                    source: media.currentSrc || media.src || '(no source)',
                    paused: media.paused,
                });
            }
        }, 2000);

        media.pause();
    };

    const getPlaybackState = () => {
        const contexts = getContexts();
        const mediaElements = getMediaElements();
        const activeMedia = mediaElements.filter((media) => !media.paused && !media.ended);
        if (activeMedia.length) lastActiveMedia = activeMedia[activeMedia.length - 1];
        return {
            contexts,
            mediaElements,
            activeMedia,
            isRunning: contexts.some((context) => context.state === 'running') || activeMedia.length > 0,
            states: contexts.map((context) => context.state),
        };
    };

    const updateButton = () => {
        if (!button) return;
        const { contexts, mediaElements, isRunning } = getPlaybackState();
        const hasPausedSession = pausedMedia.size > 0 || pausedContexts.size > 0;
        const shouldShow = isRunning || hasPausedSession;
        playerHost.style.display = shouldShow ? 'block' : 'none';
        const label = isRunning ? 'Pause read aloud' : 'Play read aloud';
        button.setAttribute('aria-label', label);
        button.title = contexts.length || mediaElements.length
            ? label
            : 'Waiting for ChatGPT audio';
        button.dataset.state = isRunning ? 'playing' : 'paused';
        button.innerHTML = isRunning
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM15 5h3v14h-3z"/></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    };

    const togglePlayback = async () => {
        const { contexts, activeMedia, isRunning } = getPlaybackState();
        console.info('[ChatGPT Audio Player] pause control clicked', {
            isRunning,
            activeMedia: activeMedia.map((media) => ({
                source: media.currentSrc || media.src || '(no source)',
                paused: media.paused,
                currentTime: media.currentTime,
                isConnected: media.isConnected,
            })),
            pausedMediaCount: pausedMedia.size,
            lastActiveMedia: lastActiveMedia ? {
                source: lastActiveMedia.currentSrc || lastActiveMedia.src || '(no source)',
                paused: lastActiveMedia.paused,
                ended: lastActiveMedia.ended,
                currentTime: lastActiveMedia.currentTime,
            } : null,
        });
        const controllableContexts = contexts.filter((context) => context.state === 'running'
            || context.state === 'suspended' || context.state === 'interrupted');

        if (controllableContexts.length) {
            const action = controllableContexts.some((context) => context.state === 'running')
                ? 'suspend'
                : 'resume';
            const targets = controllableContexts.filter((context) => action === 'suspend'
            ? context.state === 'running'
                : context.state === 'suspended' || context.state === 'interrupted');

            console.info(`[ChatGPT Audio Player] ${action} requested`, {
                contextStates: contexts.map((context) => context.state),
                activeMedia: activeMedia.length,
            });
            const results = await Promise.allSettled(targets.map((context) => context[action]()));
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    console.warn(`[ChatGPT Audio Player] AudioContext ${action} failed`, result.reason);
                } else if (action === 'suspend') {
                    pausedContexts.add(targets[index]);
                } else {
                    pausedContexts.delete(targets[index]);
                }
            });
        } else if (isRunning || (!pausedMedia.size && lastActiveMedia && !lastActiveMedia.ended
            && Boolean(lastActiveMedia.currentSrc || lastActiveMedia.src || lastActiveMedia.srcObject))) {
            const mediaToPause = activeMedia.length ? activeMedia : [lastActiveMedia];
            pausedMedia.clear();
            mediaToPause.forEach((media) => {
                pausedMedia.add(media);
                pauseMediaWithoutStopSignal(media);
            });
            console.info('[ChatGPT Audio Player] paused media elements', {
                count: mediaToPause.length,
                sources: mediaToPause.map((media) => media.currentSrc || media.src || '(no source)'),
                usedLastActiveFallback: activeMedia.length === 0,
                replacedStalePausedMedia: true,
            });
        } else if (pausedMedia.size) {
            if (mediaResumeInProgress) {
                console.info('[ChatGPT Audio Player] media resume already in progress');
                return;
            }

            const mediaToResume = Array.from(pausedMedia).filter((media) => !media.ended
                && Boolean(media.currentSrc || media.src || media.srcObject));
            Array.from(pausedMedia).filter((media) => media.ended
                || !(media.currentSrc || media.src || media.srcObject))
                .forEach((media) => pausedMedia.delete(media));

            if (mediaToResume.length) {
                mediaResumeInProgress = true;
                console.info('[ChatGPT Audio Player] resuming paused media elements', {
                    count: mediaToResume.length,
                    sources: mediaToResume.map((media) => media.currentSrc || media.src || '(no source)'),
                });
                try {
                    const results = await Promise.allSettled(mediaToResume.map((media) => media.play()));
                    results.forEach((result, index) => {
                        if (result.status === 'fulfilled') {
                            pausedMedia.delete(mediaToResume[index]);
                            console.info('[ChatGPT Audio Player] media resume succeeded', {
                                source: mediaToResume[index].currentSrc || mediaToResume[index].src || '(no source)',
                            });
                        } else {
                            console.warn('[ChatGPT Audio Player] media resume failed; keeping it available to retry', {
                                name: result.reason?.name,
                                message: result.reason?.message || String(result.reason),
                                source: mediaToResume[index].currentSrc || mediaToResume[index].src || '(no source)',
                                paused: mediaToResume[index].paused,
                                currentTime: mediaToResume[index].currentTime,
                            });
                        }
                    });
                } finally {
                    mediaResumeInProgress = false;
                }
            } else {
                console.info('[ChatGPT Audio Player] no paused media remains to resume');
            }
        } else {
            console.info('[ChatGPT Audio Player] no active playback found', {
                contextStates: contexts.map((context) => context.state),
                mediaElements: getMediaElements().map((media) => ({
                    tagName: media.tagName,
                    paused: media.paused,
                    ended: media.ended,
                    source: media.currentSrc || media.src || '(no source)',
                })),
            });
        }
        updateButton();
    };

    const mount = () => {
        if (document.getElementById(hostId)) return;

        playerHost = document.createElement('div');
        playerHost.id = hostId;
        playerHost.style.cssText = [
            'position:fixed',
            'top:56px',
            'right:16px',
            'z-index:2147483647',
            'width:56px',
            'height:56px',
            'display:none',
            'pointer-events:auto',
            'contain:strict',
        ].join(';');
        playerHost.addEventListener('pointerdown', (event) => {
            console.info('[ChatGPT Audio Player] overlay pointerdown', {
                target: event.target?.tagName || '(unknown)',
                pointerType: event.pointerType,
                button: event.button,
                isPrimary: event.isPrimary,
                x: event.clientX,
                y: event.clientY,
            });
        }, true);
        playerHost.addEventListener('pointerup', (event) => {
            console.info('[ChatGPT Audio Player] overlay pointerup', {
                target: event.target?.tagName || '(unknown)',
                pointerType: event.pointerType,
                button: event.button,
                x: event.clientX,
                y: event.clientY,
            });
        }, true);

        const shadow = playerHost.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = `
            button {
                display: grid;
                place-items: center;
                width: 56px;
                height: 56px;
                padding: 0;
                border: 1px solid rgba(255,255,255,.2);
                border-radius: 50%;
                background: #202123;
                color: #fff;
                box-shadow: 0 4px 16px rgba(0,0,0,.3);
                cursor: pointer;
                pointer-events: auto;
                touch-action: manipulation;
            }
            button:hover { background: #343541; }
            button:focus-visible { outline: 2px solid #10a37f; outline-offset: 3px; }
            svg { width: 24px; height: 24px; fill: currentColor; }
        `;

        button = document.createElement('button');
        button.type = 'button';
        button.addEventListener('pointerdown', (event) => {
            console.info('[ChatGPT Audio Player] pause button pointerdown', {
                pointerType: event.pointerType,
                button: event.button,
                isPrimary: event.isPrimary,
                isTrusted: event.isTrusted,
            });
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            togglePlayback();
        });
        button.addEventListener('click', (event) => {
            if (event.detail !== 0) return;
            console.info('[ChatGPT Audio Player] pause button keyboard activation', {
                key: event.type,
                isTrusted: event.isTrusted,
            });
            togglePlayback();
        });
        shadow.append(style, button);
        (document.body || document.documentElement).appendChild(playerHost);
        updateButton();

        updateInterval = window.setInterval(updateButton, 250);
        console.info('[ChatGPT Audio Player] Persistent pause control mounted');
    };

    if (document.body || document.documentElement) {
        mount();
    } else {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
    }

    new MutationObserver(() => {
        if (!document.getElementById(hostId)) mount();
    }).observe(document, { childList: true, subtree: true });

    window.addEventListener('pagehide', () => window.clearInterval(updateInterval), { once: true });
})();