'use strict';

const params = new URLSearchParams(window.location.search);
const siteEl = document.querySelector('[data-role="site"]');
const limitEl = document.querySelector('[data-role="limit"]');
const messageEl = document.querySelector('[data-role="message"]');
const viewTargetEl = document.querySelector('[data-role="view-target"]');
const openOptionsEl = document.querySelector('[data-role="open-options"]');
const graceButtonEl = document.querySelector('[data-role="grace"]');
const graceStatusEl = document.querySelector('[data-role="grace-status"]');

const siteKey = params.get('site') || '';
const limitMinutes = params.get('limitMinutes');
const isBlocked = params.get('blocked') === 'true';
const targetUrl = readTargetUrl();

siteEl.textContent = siteKey || 'Unknown site';
limitEl.textContent = limitMinutes ? `${limitMinutes}m` : 'None';
messageEl.textContent = isBlocked
    ? 'This site matches a blocked rule, which acts like a zero-minute limit.'
    : `This site reached its ${limitMinutes || 'assigned'}-minute daily limit.`;

if (targetUrl) {
    viewTargetEl.href = targetUrl;
} else {
    viewTargetEl.removeAttribute('href');
    viewTargetEl.textContent = 'Original URL unavailable';
}

openOptionsEl.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

graceButtonEl.addEventListener('click', async () => {
    graceButtonEl.disabled = true;
    graceStatusEl.textContent = 'Granting...';

    const response = await chrome.runtime.sendMessage({
        type: 'webtime:grant-grace',
        siteKey
    });

    if (response?.error) {
        graceStatusEl.textContent = response.error;
        return;
    }

    window.location.replace(targetUrl || `https://${siteKey}`);
});

initGrace();

// The `target` value is appended last and unencoded so the full original URL
// (query string included) survives DNR's regexSubstitution, which cannot
// percent-encode. URLSearchParams would truncate it at the first `&`.
function readTargetUrl() {
    const marker = '&target=';
    const rawSearch = window.location.search;
    const markerIndex = rawSearch.indexOf(marker);
    if (markerIndex < 0) {
        return '';
    }

    return toSafeHttpUrl(rawSearch.slice(markerIndex + marker.length));
}

function toSafeHttpUrl(value) {
    if (!value) {
        return '';
    }

    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch (_error) {
        return '';
    }
}

async function initGrace() {
    if (!siteKey) {
        return;
    }

    const response = await chrome.runtime.sendMessage({
        type: 'webtime:get-grace-status',
        siteKey
    });

    const status = response?.status;
    if (!status) {
        return;
    }

    // Hard blocks (blocked-site list, blocked category) never show the button.
    if (status.denialReason === 'blocked-site' || status.denialReason === 'blocked-category') {
        graceStatusEl.textContent = `${status.denialMessage} Change the rule in settings to browse this site.`;
        return;
    }

    graceButtonEl.hidden = false;

    if (status.eligible) {
        graceStatusEl.textContent = `One extra minute per site, once a day. Using it here spends today's minute for ${siteKey}.`;
        return;
    }

    graceButtonEl.disabled = true;
    graceStatusEl.textContent = status.usedToday
        ? `Today's extra minute for ${siteKey} is already spent. It resets tomorrow.`
        : status.denialMessage;
}
