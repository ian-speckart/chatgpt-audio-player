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
 * This file adds audio player controls when an audio element is being played with
 * the 'Read Aloud' feature of ChatGPT web.
 *
 * HOW IT WORKS:
 * -It checks if the tab is active.
 * -If so, it checks if there's an audio element being played.
 * -If so, it enables its native audio controls.
 * -It positions the player next to the Share button.
 */

// hides the player
const closeBtn = document.createElement('button');

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
 * @player: the audio element that is added to the DOM when the 'Read Aloud' feature is used.
 * It's a single element that is reused for all playbacks, and is already a child of
 * document.body.
 * It just need its controls enabled, and some styling.
 */
function showPlayer(player) {
  // we set this here in case the user closed the player
  player.style.display = 'block';
  closeBtn.style.display = 'block';

  // if we have already configured the player
  if (player.controls === true) {
    return;
  }

  player.controls = true;

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

  closeBtn.style.position = 'fixed';
  closeBtn.style.width = '20px';
  closeBtn.style.height = '20px';
  closeBtn.style.top = '19px';
  closeBtn.style.right = '687px';
  closeBtn.appendChild(getExitIcon());
  closeBtn.addEventListener('click', () => hidePlayer(player));
  document.body.appendChild(closeBtn);
}

/**
 * The player and closeBtn will remain hiden until an audio starts playing
 * again.
 */
function hidePlayer(player) {
  player.style.display = 'none';
  closeBtn.style.display = 'none';

  player.pause();
}

function getExitIcon() {
  // Create a container for the SVG content
  const container = document.createElement('div');
  container.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 1.61143L14.3886 0L8 6.38857L1.61143 0L0 1.61143L6.38857 8L0 14.3886L1.61143 16L8 9.61143L14.3886 16L16 14.3886L9.61143 8L16 1.61143Z" fill="#8F8F8F"/>
        </svg>
    `;

  // Return the SVG element
  return container.querySelector('svg');
}
