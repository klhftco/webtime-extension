'use strict';

const OVERLAY_ID = 'webtime-overlay';

initContentScript();

async function initContentScript() {
    const response = await chrome.runtime.sendMessage({
        type: 'webtime:get-site-state',
        url: window.location.href
    }).catch(() => null);

    if (response) {
        applySiteState(response);
    }
}

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'webtime:apply-site-state') {
        applySiteState(message.payload);
    }
});

function applySiteState(state) {
    if (!state?.isTrackable) {
        removeOverlay();
        return;
    }

    if (state.isBlocked) {
        renderOverlay(
            'Blocked for now',
            `${state.hostname} is on your blocked list. Remove it from the popup or options to continue.`
        );
        return;
    }

    if (state.isLimitReached) {
        renderOverlay(
            'Daily limit reached',
            `You have used ${state.todayMinutes} of ${state.dailyLimitMinutes} minutes on ${state.hostname} today.`
        );
        return;
    }

    removeOverlay();
}

function renderOverlay(title, description) {
    let overlay = document.getElementById(OVERLAY_ID);

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = `
            <div class="webtime-overlay__panel">
                <p class="webtime-overlay__eyebrow">WebTime</p>
                <h1 class="webtime-overlay__title"></h1>
                <p class="webtime-overlay__description"></p>
            </div>
        `;
        document.documentElement.appendChild(overlay);
    }

    overlay.querySelector('.webtime-overlay__title').textContent = title;
    overlay.querySelector('.webtime-overlay__description').textContent = description;
}

function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
}
