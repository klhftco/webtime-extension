'use strict';

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
    if (!state?.isTrackable || !state.shouldOverlayBlock) {
        return;
    }

    chrome.runtime.sendMessage({
        type: 'webtime:redirect-to-blocked-page',
        payload: {
            siteKey: state.siteKey,
            limitMinutes: state.limitMinutes,
            isBlocked: state.isBlocked,
            targetUrl: window.location.href
        }
    }).catch(() => null);
}
