'use strict';

const blockedSitesEl = document.querySelector('[name="blockedSites"]');
const siteLimitsEl = document.querySelector('[name="siteLimits"]');
const saveStatusEl = document.querySelector('[data-role="save-status"]');
const formEl = document.querySelector('[data-role="settings-form"]');

bootstrapOptions();

formEl.addEventListener('submit', async (event) => {
    event.preventDefault();

    const response = await chrome.runtime.sendMessage({
        type: 'webtime:save-settings',
        payload: {
            blockedSites: blockedSitesEl.value,
            siteLimitsText: siteLimitsEl.value
        }
    });

    if (response?.error) {
        saveStatusEl.textContent = response.error;
        return;
    }

    renderSettings(response.settings);
    saveStatusEl.textContent = 'Saved.';
});

async function bootstrapOptions() {
    const response = await chrome.runtime.sendMessage({ type: 'webtime:get-settings' });

    if (response?.error) {
        saveStatusEl.textContent = response.error;
        return;
    }

    renderSettings(response.settings);
}

function renderSettings(settings) {
    blockedSitesEl.value = settings.blockedSites.join('\n');
    siteLimitsEl.value = Object.entries(settings.siteLimitsByHostname)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([hostname, minutes]) => `${hostname} ${minutes}`)
        .join('\n');
}
