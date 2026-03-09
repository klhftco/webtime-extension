'use strict';

const statusEl = document.querySelector('[data-role="status"]');
const siteEl = document.querySelector('[data-role="site"]');
const usageEl = document.querySelector('[data-role="usage"]');
const remainingEl = document.querySelector('[data-role="remaining"]');
const blockButtonEl = document.querySelector('[data-role="toggle-block"]');
const openOptionsEl = document.querySelector('[data-role="open-options"]');

let currentSite = null;

bootstrapPopup();

async function bootstrapPopup() {
    const response = await chrome.runtime.sendMessage({ type: 'webtime:get-popup-data' });
    if (response?.error) {
        statusEl.textContent = response.error;
        return;
    }

    currentSite = response.site;
    renderSite(response.site);
}

blockButtonEl.addEventListener('click', async () => {
    if (!currentSite?.hostname) {
        return;
    }

    const response = await chrome.runtime.sendMessage({
        type: 'webtime:toggle-site-block',
        hostname: currentSite.hostname
    });

    if (response?.error) {
        statusEl.textContent = response.error;
        return;
    }

    await bootstrapPopup();
});

openOptionsEl.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

function renderSite(site) {
    if (!site?.isTrackable) {
        statusEl.textContent = 'This page is not tracked.';
        siteEl.textContent = 'Unavailable';
        usageEl.textContent = '--';
        remainingEl.textContent = '--';
        blockButtonEl.disabled = true;
        blockButtonEl.textContent = 'Block site';
        return;
    }

    siteEl.textContent = site.hostname;
    usageEl.textContent = `${site.todayMinutes} / ${site.dailyLimitMinutes} min`;
    remainingEl.textContent = `${site.remainingMinutes} min left`;
    blockButtonEl.disabled = false;
    blockButtonEl.textContent = site.isBlocked ? 'Unblock site' : 'Block site';

    if (site.isBlocked) {
        statusEl.textContent = 'Blocked by your site list.';
        return;
    }

    if (site.isLimitReached) {
        statusEl.textContent = 'Daily limit reached.';
        return;
    }

    statusEl.textContent = 'Tracking is active.';
}
