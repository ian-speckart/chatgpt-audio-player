// Runs in the page's MAIN world before ChatGPT's scripts.
(function () {
    'use strict';

    const registryKey = '__chatgptAudioPlayerContexts';
    const contexts = window[registryKey] || new Set();
    const mediaKey = '__chatgptAudioPlayerMedia';
    const mediaElements = window[mediaKey] || new Set();
    const wrappedRealms = new WeakSet();

    if (!window[registryKey]) {
        Object.defineProperty(window, registryKey, {
            value: contexts,
            configurable: false,
            enumerable: false,
            writable: false,
        });
    }

    if (!window[mediaKey]) {
        Object.defineProperty(window, mediaKey, {
            value: mediaElements,
            configurable: false,
            enumerable: false,
            writable: false,
        });
    }

    const rememberContext = (context, discoveredBy) => {
        if (!context || contexts.has(context)) return;
        contexts.add(context);
        console.info('[ChatGPT Audio Player] AudioContext discovered', {
            discoveredBy,
            state: context.state,
            sampleRate: context.sampleRate,
        });
    };

    const rememberMedia = (media) => {
        if (!mediaElements.has(media)) {
            mediaElements.add(media);
            ['play', 'playing', 'pause', 'ended', 'emptied', 'error'].forEach((eventName) => {
                media.addEventListener(eventName, () => {
                    console.info(`[ChatGPT Audio Player] media event: ${eventName}`, {
                        tagName: media.tagName,
                        source: media.currentSrc || media.src || '(no source)',
                        paused: media.paused,
                        ended: media.ended,
                        currentTime: media.currentTime,
                        duration: media.duration,
                        readyState: media.readyState,
                        networkState: media.networkState,
                        error: media.error ? { code: media.error.code, message: media.error.message } : null,
                    });
                }, true);
            });
            console.info('[ChatGPT Audio Player] media playback observed', {
                tagName: media.tagName,
                source: media.currentSrc || media.src || '(no source)',
                paused: media.paused,
                isConnected: media.isConnected,
            });
        }
    };

    const wrapRealm = (realm, realmName) => {
        try {
            if (!realm || wrappedRealms.has(realm)) return;
            wrappedRealms.add(realm);
            let wrappedApis = 0;

            ['AudioContext', 'webkitAudioContext'].forEach((constructorName) => {
                const OriginalContext = realm[constructorName];
                if (!OriginalContext || OriginalContext.__chatgptAudioPlayerWrapped) return;

                const TrackedContext = new Proxy(OriginalContext, {
                    construct(target, args, newTarget) {
                        const context = Reflect.construct(
                            target,
                            args,
                            newTarget === TrackedContext ? target : newTarget,
                        );
                        rememberContext(context, `${realmName}.${constructorName}`);
                        return context;
                    },
                });

                Object.defineProperty(TrackedContext, '__chatgptAudioPlayerWrapped', { value: true });
                realm[constructorName] = TrackedContext;
                wrappedApis += 1;
            });

            const sourcePrototype = realm.AudioBufferSourceNode?.prototype;
            const originalStart = sourcePrototype?.start;
            if (typeof originalStart === 'function' && !originalStart.__chatgptAudioPlayerWrapped) {
                const trackedStart = function (...args) {
                    rememberContext(this.context, `${realmName}.AudioBufferSourceNode.start`);
                    return originalStart.apply(this, args);
                };
                Object.defineProperty(trackedStart, '__chatgptAudioPlayerWrapped', { value: true });
                sourcePrototype.start = trackedStart;
                wrappedApis += 1;
            }

            const mediaPrototype = realm.HTMLMediaElement?.prototype;
            const originalPlay = mediaPrototype?.play;
            if (typeof originalPlay === 'function' && !originalPlay.__chatgptAudioPlayerWrapped) {
                const trackedPlay = function (...args) {
                    rememberMedia(this);
                    return originalPlay.apply(this, args);
                };
                Object.defineProperty(trackedPlay, '__chatgptAudioPlayerWrapped', { value: true });
                mediaPrototype.play = trackedPlay;
                wrappedApis += 1;
            }

            const originalPause = mediaPrototype?.pause;
            if (typeof originalPause === 'function' && !originalPause.__chatgptAudioPlayerWrapped) {
                const trackedPause = function (...args) {
                    if (mediaElements.has(this)) {
                        console.info('[ChatGPT Audio Player] media pause() called', {
                            source: this.currentSrc || this.src || '(no source)',
                            currentTime: this.currentTime,
                            paused: this.paused,
                            callStack: new Error().stack?.split('\n').slice(1, 7).join('\n'),
                        });
                    }
                    return originalPause.apply(this, args);
                };
                Object.defineProperty(trackedPause, '__chatgptAudioPlayerWrapped', { value: true });
                mediaPrototype.pause = trackedPause;
                wrappedApis += 1;
            }

            realm.document?.querySelectorAll('audio, video').forEach(rememberMedia);
            console.info('[ChatGPT Audio Player] audio realm inspected', {
                realm: realmName,
                wrappedApis,
                hasAudioContext: Boolean(realm.AudioContext || realm.webkitAudioContext),
                mediaElements: realm.document?.querySelectorAll('audio, video').length || 0,
            });
        } catch (error) {
            console.info('[ChatGPT Audio Player] audio realm unavailable', {
                realm: realmName,
                message: error?.message || String(error),
            });
        }
    };

    const inspectFrames = (node) => {
        if (node instanceof HTMLIFrameElement) {
            node.addEventListener('load', () => wrapRealm(node.contentWindow, 'iframe'));
            try {
                if (node.contentDocument?.readyState === 'complete') {
                    wrapRealm(node.contentWindow, 'iframe');
                }
            } catch (error) {
                console.info('[ChatGPT Audio Player] iframe inspection blocked', error);
            }
        }
        node.querySelectorAll?.('iframe').forEach((frame) => inspectFrames(frame));
    };

    wrapRealm(window, 'main');
    inspectFrames(document);
    new MutationObserver((records) => {
        records.forEach((record) => record.addedNodes.forEach(inspectFrames));
    }).observe(document, { childList: true, subtree: true });
    console.info('[ChatGPT Audio Player] audio diagnostics installed', {
        url: location.href,
        audioContextAvailable: Boolean(window.AudioContext || window.webkitAudioContext),
        audioElements: document.querySelectorAll('audio, video').length,
        iframeCount: document.querySelectorAll('iframe').length,
    });
})();