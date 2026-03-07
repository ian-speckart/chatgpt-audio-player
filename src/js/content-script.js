// ==UserScript==
// @name        Audio Player for ChatGPT
// @namespace   Violentmonkey Scripts
// @match       https://www.chatgpt.com/*
// @grant       none
// @version     0.0.0.1
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
 * This file adds a custom media player UX when an audio element is being played
 * with the 'Read Aloud' feature of ChatGPT web.
 *
 * HOW IT WORKS:
 * -It checks if the tab is active.
 * -If so, it checks if there's a media element being played.
 * -If so, it enables native controls and injects extension controls.
 * -It positions the player next to the Share button.
 * -It injects a speed button + popup with fixed options.
 * -It persists selected playback rate in localStorage and restores it.
 * -It disables native playback-rate controls so only extension rates are shown.
 */

// UI elements injected beside the media player
const closeBtn = document.createElement('button');
const speedBtn = document.createElement('button');
const speedPanel = document.createElement('div');

// playback rate config + persistence
const PLAYBACK_RATE_STORAGE_KEY = 'chatgptAudioPlayer.playbackRate';
const PLAYBACK_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const DEFAULT_PLAYBACK_RATE = 1;

// runtime state
let speedOptionButtons = [];
let currentPlayer = null;
let isUiInitialized = false;

let checkInterval;

/**
 * Monitor if the tab is active / has focus.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Tab lost focus
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  } else {
    // Tab gained focus
    startCheckingForAudioFile();
  }
});

/**
 * When the script loads for the first time, the 'visibilitychange' event is
 * not triggered. So we manually check for focus.
 */
if (document.hasFocus()) {
  startCheckingForAudioFile();
}

function startCheckingForAudioFile() {
  if (!checkInterval) {
    checkInterval = setInterval(checkForAudioFile, 1000);
  }
}

function checkForAudioFile() {
  // check if the 'Read Aloud' feature generated an audio element
  const audio = document.querySelector('audio');

  if (audio && !audio.paused) {
    showPlayer(audio);
  }
}

/**
 * @player: media element added to the DOM by the 'Read Aloud' feature.
 * It's reused between playbacks and already attached to document.body.
 * Here we:
 * -show player + extension controls
 * -restore + apply saved playback rate
 * -enable native controls and hide native speed controls
 * -set fixed positioning for the player and injected UI
 */
function showPlayer(player) {
  currentPlayer = player;

  if (!isUiInitialized) {
    initializeUi();
    isUiInitialized = true;
  }

  // we set this here in case the user closed the player
  player.style.display = 'block';
  closeBtn.style.display = 'block';
  speedBtn.style.display = 'block';

  const restoredRate = getSavedPlaybackRate();
  applyPlaybackRate(player, restoredRate);
  setActiveSpeedOption(restoredRate);

  player.controls = true;
  disableNativePlaybackRateControls(player);

  /**
   * Adding styles in JS (instead of CSS) so that users can copy this single file
   * into violentmonkey/tampermonkey if they dont wanna use my browser extension.
   */
  player.style.position = 'fixed';
  player.style.top = '9px';
  player.style.left = 'unset';
  player.style.right = '180px';
  player.style.bottom = 'unset';
  player.style.width = '500px';
  player.style.height = '38px';

  if (closeBtn.parentElement !== document.body) {
    document.body.appendChild(closeBtn);
  }
  if (speedBtn.parentElement !== document.body) {
    document.body.appendChild(speedBtn);
  }
  if (speedPanel.parentElement !== document.body) {
    document.body.appendChild(speedPanel);
  }
}

/**
 * The player and extension controls will remain hidden until an audio starts playing
 * again.
 */
function hidePlayer(player) {
  if (!player) {
    return;
  }

  player.style.display = 'none';
  closeBtn.style.display = 'none';
  speedBtn.style.display = 'none';
  speedPanel.style.display = 'none';

  player.pause();
}

function getExitIcon() {
  // Create a container for the SVG content
  const container = document.createElement('div');
  container.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 1.61143L14.3886 0L8 6.38857L1.61143 0L0 1.61143L6.38857 8L0 14.3886L1.61143 16L8 9.61143L14.3886 16L16 14.3886L9.61143 8L16 1.61143Z" fill="#1f1f1f"/>
        </svg>
    `;

  // Return the SVG element
  return container.querySelector('svg');
}

// speed icon used by the playback rate button
function getSpeedIcon() {
  const container = document.createElement('div');
  container.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 305 305" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:auto" preserveAspectRatio="xMidYMid meet">
      <g>
        <path style="fill:#222220;" d="M305,173.726c0-41.662-16.799-79.469-43.972-107.02c-0.212-0.282-0.438-0.558-0.695-0.815
        c-0.257-0.257-0.532-0.483-0.814-0.694C231.968,38.024,194.161,21.226,152.5,21.226c-41.661,0-79.468,16.799-107.02,43.971
        c-0.282,0.212-0.557,0.438-0.814,0.694c-0.257,0.257-0.483,0.532-0.695,0.815C16.799,94.257,0,132.064,0,173.726
        c0,40.729,15.859,79.018,44.655,107.821c0.004,0.004,0.008,0.009,0.012,0.013c0.003,0.002,0.005,0.005,0.008,0.007
        c0.004,0.004,0.008,0.008,0.012,0.012c1.464,1.464,3.383,2.195,5.302,2.195c1.92,0,3.84-0.732,5.304-2.197
        c0.125-0.125,0.238-0.258,0.352-0.39l23.112-23.113c2.929-2.93,2.929-7.678,0-10.607c-2.929-2.928-7.678-2.928-10.606,0
        l-18.036,18.036c-21.031-23.403-33.232-52.857-34.91-84.277h25.507c4.142,0,7.5-3.357,7.5-7.5s-3.358-7.5-7.5-7.5H15.207
        c1.744-32.272,14.668-61.618,34.957-84.229l17.987,17.987c1.464,1.464,3.384,2.196,5.303,2.196c1.919,0,3.839-0.732,5.303-2.196
        c2.929-2.93,2.929-7.678,0-10.607L60.771,71.389C83.383,51.1,112.728,38.176,145,36.433v25.506c0,4.143,3.358,7.5,7.5,7.5
        s7.5-3.357,7.5-7.5V36.433c32.272,1.743,61.617,14.668,84.229,34.957l-17.987,17.987c-2.929,2.93-2.929,7.678,0,10.607
        c1.464,1.464,3.384,2.196,5.303,2.196s3.839-0.732,5.303-2.196l17.987-17.987c20.289,22.612,33.214,51.957,34.957,84.229h-25.506
        c-4.142,0-7.5,3.357-7.5,7.5s3.358,7.5,7.5,7.5h25.507c-1.678,31.42-13.878,60.875-34.909,84.278l-18.036-18.037
        c-2.928-2.928-7.677-2.928-10.606,0c-2.929,2.93-2.929,7.678,0,10.607l23.485,23.485c1.464,1.464,3.384,2.196,5.303,2.196
        c0.959,0,1.919-0.183,2.822-0.549c0.903-0.366,1.749-0.915,2.482-1.647C289.137,252.755,305,214.459,305,173.726z"/>
        <path style="fill:#222220;" d="M186.956,87.718c-3.847-1.541-8.211,0.327-9.751,4.173l-21.673,54.1
        c-1.01-0.108-2.02-0.182-3.031-0.182c-10.556,0-20.091,5.847-24.886,15.259c-5.012,9.839-3.728,21.595,3.432,31.445
        c0.732,1.007,1.652,1.928,2.666,2.665c5.817,4.229,12.314,6.464,18.788,6.464c10.556,0,20.092-5.847,24.886-15.259
        c5.012-9.839,3.728-21.594-3.427-31.437c-0.732-1.01-1.654-1.934-2.671-2.674c-0.547-0.398-1.106-0.761-1.665-1.123l21.505-53.681
        C192.669,93.624,190.801,89.258,186.956,87.718z M164.02,179.574c-2.221,4.359-6.635,7.067-11.52,7.067
        c-3.204,0-6.429-1.119-9.589-3.327c-3.6-5.169-4.307-10.773-1.93-15.438c2.22-4.359,6.634-7.067,11.52-7.067
        c1.558,0,3.12,0.27,4.678,0.795c0.051,0.021,0.098,0.048,0.15,0.069c0.164,0.065,0.329,0.118,0.494,0.171
        c1.43,0.549,2.854,1.305,4.266,2.291C165.688,169.304,166.396,174.909,164.02,179.574z"/>
      </g>
    </svg>
  `;
  return container.querySelector('svg');
}

function getSavedPlaybackRate() {
  // restore saved rate if valid, else fallback to default
  try {
    const rawValue = localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY);
    const parsedRate = Number(rawValue);
    if (PLAYBACK_RATE_OPTIONS.includes(parsedRate)) {
      return parsedRate;
    }
  } catch {
    // Ignore storage issues and use default.
  }

  return DEFAULT_PLAYBACK_RATE;
}

function savePlaybackRate(rate) {
  // persist selected rate for next player show
  try {
    localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(rate));
  } catch {
    // Ignore storage issues; playback still works for this session.
  }
}

function applyPlaybackRate(player, rate) {
  // apply selected rate immediately
  player.playbackRate = rate;
}

function setActiveSpeedOption(activeRate) {
  // keep selected state in popup options
  speedOptionButtons.forEach((button) => {
    const optionRate = Number(button.dataset.rate);
    const isActive = optionRate === activeRate;
    button.style.background = isActive ? '#ececec' : 'transparent';
    button.style.color = '#111111';
    button.style.fontWeight = isActive ? '700' : '500';
  });
}

function formatPlaybackRate(rate) {
  // format labels like 1x, 1.5x, 1.75x
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(2).replace(/0$/, '');
}

// initialize injected close button + speed selector panel once
function initializeUi() {
  closeBtn.style.position = 'fixed';
  closeBtn.style.width = '20px';
  closeBtn.style.height = '20px';
  closeBtn.style.top = '19px';
  closeBtn.style.right = '687px';
  closeBtn.style.background = 'transparent';
  closeBtn.style.border = 'none';
  closeBtn.style.padding = '0';
  closeBtn.style.cursor = 'pointer';
  closeBtn.appendChild(getExitIcon());
  closeBtn.addEventListener('click', () => hidePlayer(currentPlayer));

  speedBtn.style.position = 'fixed';
  speedBtn.style.width = '30px';
  speedBtn.style.height = '30px';
  speedBtn.style.top = '13px';
  speedBtn.style.right = '145px';
  speedBtn.style.border = '1px solid #d9d9d9';
  speedBtn.style.borderRadius = '8px';
  speedBtn.style.background = '#ffffff';
  speedBtn.style.padding = '0';
  speedBtn.style.cursor = 'pointer';
  speedBtn.style.display = 'flex';
  speedBtn.style.alignItems = 'center';
  speedBtn.style.justifyContent = 'center';
  speedBtn.appendChild(getSpeedIcon());

  speedPanel.style.position = 'fixed';
  speedPanel.style.top = '48px';
  speedPanel.style.right = '145px';
  speedPanel.style.display = 'none';
  speedPanel.style.background = '#ffffff';
  speedPanel.style.border = '1px solid #e5e5e5';
  speedPanel.style.borderRadius = '10px';
  speedPanel.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.12)';
  speedPanel.style.padding = '6px';
  speedPanel.style.minWidth = '88px';
  speedPanel.style.zIndex = '9999';

  speedPanel.innerHTML = '';
  speedOptionButtons = PLAYBACK_RATE_OPTIONS.map((rate) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.dataset.rate = String(rate);
    option.textContent = `${formatPlaybackRate(rate)}x`;
    option.style.width = '100%';
    option.style.border = 'none';
    option.style.background = 'transparent';
    option.style.color = '#1f1f1f';
    option.style.fontSize = '13px';
    option.style.fontWeight = '500';
    option.style.textAlign = 'left';
    option.style.padding = '7px 10px';
    option.style.borderRadius = '6px';
    option.style.cursor = 'pointer';

    option.addEventListener('click', () => {
      if (!currentPlayer) {
        return;
      }
      applyPlaybackRate(currentPlayer, rate);
      savePlaybackRate(rate);
      setActiveSpeedOption(rate);
      speedPanel.style.display = 'none';
    });

    option.addEventListener('mouseenter', () => {
      if (currentPlayer && Number(option.dataset.rate) !== currentPlayer.playbackRate) {
        option.style.background = '#f3f4f6';
      }
    });

    option.addEventListener('mouseleave', () => {
      if (currentPlayer && Number(option.dataset.rate) !== currentPlayer.playbackRate) {
        option.style.background = 'transparent';
      }
    });

    speedPanel.appendChild(option);
    return option;
  });

  speedBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    speedPanel.style.display = speedPanel.style.display === 'none' ? 'block' : 'none';
  });

  speedPanel.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  document.addEventListener('click', () => {
    speedPanel.style.display = 'none';
  });
}

function disableNativePlaybackRateControls(player) {
  // Chromium supports noplaybackrate in controlsList for media controls.
  try {
    if (player.controlsList && typeof player.controlsList.add === 'function') {
      player.controlsList.add('noplaybackrate');
    } else {
      const controlsList = player.getAttribute('controlsList') || '';
      if (!controlsList.includes('noplaybackrate')) {
        player.setAttribute('controlsList', `${controlsList} noplaybackrate`.trim());
      }
    }
  } catch {
    // Ignore unsupported environments.
  }

  // Prevent native context menu speed options from appearing.
  if (!player.dataset.chatgptAudioPlayerNoContextMenu) {
    player.dataset.chatgptAudioPlayerNoContextMenu = 'true';
    player.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });
  }
}
