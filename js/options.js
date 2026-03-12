'use strict';

const blockedSitesEl = document.querySelector('[name="blockedSites"]');
const siteLimitsEl = document.querySelector('[name="siteLimits"]');
const blockedCategoriesEl = document.querySelector('[name="blockedCategories"]');
const categoryLimitsEl = document.querySelector('[name="categoryLimits"]');
const slowModeEnabledEl = document.querySelector('[name="slowModeEnabled"]');
const slowModeSecondsEl = document.querySelector('[name="slowModeSeconds"]');
const pinAttemptEl = document.querySelector('[name="pinAttempt"]');
const currentPinEl = document.querySelector('[name="currentPin"]');
const newPinEl = document.querySelector('[name="newPin"]');
const confirmPinEl = document.querySelector('[name="confirmPin"]');
const clearPinEl = document.querySelector('[name="clearPin"]');
const pinStatusEl = document.querySelector('[data-role="pin-status"]');
const settingsPinFieldEl = document.querySelector('[data-role="settings-pin-field"]');
const currentPinFieldEl = document.querySelector('[data-role="current-pin-field"]');
const saveStatusEl = document.querySelector('[data-role="save-status"]');
const formEl = document.querySelector('[data-role="settings-form"]');
const protectionFormEl = document.querySelector('[data-role="protection-form"]');
const protectionStatusEl = document.querySelector('[data-role="protection-status"]');
const usageDumpButtonEl = document.querySelector('[data-role="usage-dump"]');
const usageClearButtonEl = document.querySelector('[data-role="usage-clear"]');
const usageStatusEl = document.querySelector('[data-role="usage-status"]');
const usagePinEl = document.querySelector('[name="usagePin"]');
const clearUsageConfirmEl = document.querySelector('[name="clearUsageConfirm"]');
const usagePinFieldEl = document.querySelector('[data-role="usage-pin-field"]');
const usagePinStatusEl = document.querySelector('[data-role="usage-pin-status"]');
const limitsExportButtonEl = document.querySelector('[data-role="limits-export"]');
const limitsImportButtonEl = document.querySelector('[data-role="limits-import"]');
const limitsImportFileEl = document.querySelector('[name="limitsImportFile"]');
const limitsImportPinEl = document.querySelector('[name="limitsImportPin"]');
const limitsImportPinFieldEl = document.querySelector('[data-role="limits-import-pin-field"]');
const limitsImportPinStatusEl = document.querySelector('[data-role="limits-import-pin-status"]');
const limitsStatusEl = document.querySelector('[data-role="limits-status"]');
const experimentalFormEl = document.querySelector('[data-role="experimental-form"]');
const trackingModeEl = document.querySelector('[name="trackingMode"]');
const experimentalPinEl = document.querySelector('[name="experimentalPin"]');
const experimentalStatusEl = document.querySelector('[data-role="experimental-status"]');
const experimentalPinFieldEl = document.querySelector('[data-role="experimental-pin-field"]');
const experimentalPinStatusEl = document.querySelector('[data-role="experimental-pin-status"]');
const weeklyChartEl = document.querySelector('[data-role="weekly-chart"]');
const weeklyTotalEl = document.querySelector('[data-role="weekly-total"]');
const weeklyDetailTitleEl = document.querySelector('[data-role="weekly-detail-title"]');
const weeklyDetailListEl = document.querySelector('[data-role="weekly-detail-list"]');
const clearWeeklySelectionEl = document.querySelector('[data-role="clear-weekly-selection"]');
const clearWeeklyPinFieldEl = document.querySelector('[data-role="clear-weekly-pin-field"]');
const clearWeeklyPinEl = document.querySelector('[name="clearWeeklyPin"]');
const clearWeeklyStatusEl = document.querySelector('[data-role="clear-weekly-status"]');
const weeklyPickupsChartEl = document.querySelector('[data-role="weekly-pickups-chart"]');
const weeklyPickupsListEl = document.querySelector('[data-role="weekly-pickups-list"]');
const clearPickupsSelectionEl = document.querySelector('[data-role="clear-pickups-selection"]');
const clearPickupsPinFieldEl = document.querySelector('[data-role="clear-pickups-pin-field"]');
const clearPickupsPinEl = document.querySelector('[name="clearPickupsPin"]');
const clearPickupsStatusEl = document.querySelector('[data-role="clear-pickups-status"]');
const tabEls = Array.from(document.querySelectorAll('[data-role="tab"]'));
const panelEls = Array.from(document.querySelectorAll('[data-role="panel"]'));

let weeklyUsageState = null;
let selectedDayKey = null;
let currentSettings = null;

bootstrapOptions();

formEl.addEventListener('submit', async (event) => {
    event.preventDefault();

    const response = await chrome.runtime.sendMessage({
        type: 'webtime:save-settings',
        payload: buildSettingsPayload({
            blockedSites: blockedSitesEl.value,
            siteLimitsText: siteLimitsEl.value,
            blockedCategories: blockedCategoriesEl.value,
            categoryLimitsText: categoryLimitsEl.value
        })
    });

    if (response?.error) {
        saveStatusEl.textContent = response.error;
        return;
    }

    renderSettings(response.settings);
    saveStatusEl.textContent = 'Saved.';
    pinAttemptEl.value = '';
});

protectionFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();

    const response = await chrome.runtime.sendMessage({
        type: 'webtime:save-settings',
        payload: buildSettingsPayload({
            blockedSites: currentSettings ? currentSettings.blockedSites.join('\n') : blockedSitesEl.value,
            siteLimitsText: currentSettings ? serializeLimitMap(currentSettings.siteLimitsByHostname) : siteLimitsEl.value,
            blockedCategories: currentSettings ? currentSettings.blockedCategories.join('\n') : blockedCategoriesEl.value,
            categoryLimitsText: currentSettings ? serializeLimitMap(currentSettings.categoryLimitsById) : categoryLimitsEl.value,
            slowModeEnabled: slowModeEnabledEl.checked,
            slowModeSeconds: slowModeSecondsEl.value,
            pinAttempt: currentPinEl.value,
            clearPin: clearPinEl.checked,
            newPin: newPinEl.value,
            newPinConfirm: confirmPinEl.value
        })
    });

    if (response?.error) {
        protectionStatusEl.textContent = response.error;
        return;
    }

    renderSettings(response.settings);
    protectionStatusEl.textContent = 'Saved.';
    pinAttemptEl.value = '';
    currentPinEl.value = '';
    clearPinEl.checked = false;
    newPinEl.value = '';
    confirmPinEl.value = '';
});

usageDumpButtonEl.addEventListener('click', async () => {
    usageStatusEl.textContent = 'Preparing export...';
    const response = await chrome.runtime.sendMessage({
        type: 'webtime:dump-usage',
        pinAttempt: usagePinEl.value
    });

    if (response?.error) {
        usageStatusEl.textContent = response.error;
        return;
    }

    const filename = `webtime-usage-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    usageStatusEl.textContent = 'Usage export downloaded.';
});

usageClearButtonEl.addEventListener('click', async () => {
    if (!isClearConfirmReady()) {
        usageStatusEl.textContent = 'Type the confirmation phrase to enable clearing.';
        return;
    }

    usageStatusEl.textContent = 'Clearing usage...';
    const response = await chrome.runtime.sendMessage({
        type: 'webtime:clear-usage',
        pinAttempt: usagePinEl.value
    });

    if (response?.error) {
        usageStatusEl.textContent = response.error;
        return;
    }

    usageStatusEl.textContent = 'All usage data cleared.';
    usagePinEl.value = '';
    clearUsageConfirmEl.value = '';
    usageClearButtonEl.disabled = true;
    await refreshWeeklyUsage();
});

limitsExportButtonEl.addEventListener('click', () => {
    if (!currentSettings) return;
    const payload = {
        blockedSites: currentSettings.blockedSites,
        siteLimitsByHostname: currentSettings.siteLimitsByHostname,
        blockedCategories: currentSettings.blockedCategories,
        categoryLimitsById: currentSettings.categoryLimitsById,
        exportedAt: new Date().toISOString()
    };
    const filename = `webtime-limits-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    limitsStatusEl.textContent = 'Limits exported.';
});

limitsImportFileEl.addEventListener('change', () => {
    limitsImportButtonEl.disabled = !limitsImportFileEl.files.length;
    limitsStatusEl.textContent = '';
});

limitsImportButtonEl.addEventListener('click', async () => {
    const file = limitsImportFileEl.files[0];
    if (!file) return;

    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        limitsStatusEl.textContent = 'Invalid JSON file.';
        return;
    }

    if (!Array.isArray(parsed.blockedSites)) {
        limitsStatusEl.textContent = 'Invalid limits file.';
        return;
    }

    limitsStatusEl.textContent = 'Importing...';
    const response = await chrome.runtime.sendMessage({
        type: 'webtime:save-settings',
        payload: buildSettingsPayload({
            blockedSites: parsed.blockedSites.join('\n'),
            siteLimitsText: serializeLimitMap(parsed.siteLimitsByHostname || {}),
            blockedCategories: (parsed.blockedCategories || []).join('\n'),
            categoryLimitsText: serializeLimitMap(parsed.categoryLimitsById || {}),
            pinAttempt: limitsImportPinEl.value
        })
    });

    if (response?.error) {
        limitsStatusEl.textContent = response.error;
        return;
    }

    renderSettings(response.settings);
    limitsStatusEl.textContent = 'Limits imported.';
    limitsImportPinEl.value = '';
    limitsImportFileEl.value = '';
    limitsImportButtonEl.disabled = true;
});

experimentalFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();

    const response = await chrome.runtime.sendMessage({
        type: 'webtime:save-settings',
        payload: buildSettingsPayload({
            blockedSites: currentSettings ? currentSettings.blockedSites.join('\n') : blockedSitesEl.value,
            siteLimitsText: currentSettings ? serializeLimitMap(currentSettings.siteLimitsByHostname) : siteLimitsEl.value,
            blockedCategories: currentSettings ? currentSettings.blockedCategories.join('\n') : blockedCategoriesEl.value,
            categoryLimitsText: currentSettings ? serializeLimitMap(currentSettings.categoryLimitsById) : categoryLimitsEl.value,
            trackingMode: trackingModeEl.value,
            pinAttempt: experimentalPinEl.value
        })
    });

    if (response?.error) {
        experimentalStatusEl.textContent = response.error;
        return;
    }

    renderSettings(response.settings);
    experimentalStatusEl.textContent = 'Saved.';
    experimentalPinEl.value = '';
});

clearUsageConfirmEl.addEventListener('input', () => {
    usageClearButtonEl.disabled = !isClearConfirmReady();
});

async function refreshWeeklyUsage() {
    const weeklyResponse = await chrome.runtime.sendMessage({ type: 'webtime:get-weekly-usage' });
    if (!weeklyResponse?.error) {
        weeklyUsageState = weeklyResponse.weeklyUsage;
        selectedDayKey = null;
        renderWeeklyUsage(weeklyUsageState);
    }
}

tabEls.forEach((tabEl) => {
    tabEl.addEventListener('click', () => {
        const targetTab = tabEl.dataset.tab;

        tabEls.forEach((button) => button.classList.toggle('is-active', button === tabEl));
        panelEls.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === targetTab));
    });
});

clearWeeklySelectionEl.addEventListener('click', async () => {
    clearWeeklyStatusEl.textContent = 'Clearing...';
    const response = await chrome.runtime.sendMessage({
        type: 'webtime:clear-day-usage',
        dayKey: selectedDayKey,
        pinAttempt: clearWeeklyPinEl.value
    });

    if (response?.error) {
        clearWeeklyStatusEl.textContent = response.error;
        return;
    }

    clearWeeklyPinEl.value = '';
    selectedDayKey = null;
    await refreshWeeklyUsage();
});

if (clearPickupsSelectionEl) {
    clearPickupsSelectionEl.addEventListener('click', async () => {
        clearPickupsStatusEl.textContent = 'Clearing...';
        const response = await chrome.runtime.sendMessage({
            type: 'webtime:clear-day-usage',
            dayKey: selectedDayKey,
            pinAttempt: clearPickupsPinEl.value
        });

        if (response?.error) {
            clearPickupsStatusEl.textContent = response.error;
            return;
        }

        clearPickupsPinEl.value = '';
        selectedDayKey = null;
        await refreshWeeklyUsage();
    });
}

async function bootstrapOptions() {
    const [settingsResponse, weeklyResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'webtime:get-settings' }),
        chrome.runtime.sendMessage({ type: 'webtime:get-weekly-usage' }),
        chrome.runtime.sendMessage({ type: 'webtime:settings-opened' })
    ]);

    if (settingsResponse?.error) {
        saveStatusEl.textContent = settingsResponse.error;
        return;
    }

    renderSettings(settingsResponse.settings);

    if (!weeklyResponse?.error) {
        weeklyUsageState = weeklyResponse.weeklyUsage;
        renderWeeklyUsage(weeklyUsageState);
    } else if (weeklyTotalEl) {
        weeklyTotalEl.textContent = weeklyResponse?.error || 'Unable to load weekly usage.';
    }
}

function renderSettings(settings) {
    currentSettings = settings;
    blockedSitesEl.value = settings.blockedSites.join('\n');
    siteLimitsEl.value = Object.entries(settings.siteLimitsByHostname)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([hostname, minutes]) => `${hostname} ${minutes}`)
        .join('\n');
    blockedCategoriesEl.value = settings.blockedCategories.join('\n');
    categoryLimitsEl.value = Object.entries(settings.categoryLimitsById)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([categoryId, minutes]) => `${categoryId} ${minutes}`)
        .join('\n');
    slowModeEnabledEl.checked = Boolean(settings.slowModeEnabled);
    slowModeSecondsEl.value = Number.isFinite(settings.slowModeSeconds) ? settings.slowModeSeconds : 60;
    pinStatusEl.textContent = settings.hasPin ? 'PIN set' : 'No PIN set';
    togglePinField(settingsPinFieldEl, settings.hasPin);
    togglePinField(currentPinFieldEl, settings.hasPin);
    togglePinField(usagePinFieldEl, settings.hasPin);
    usagePinStatusEl.hidden = settings.hasPin;
    togglePinField(limitsImportPinFieldEl, settings.hasPin);
    limitsImportPinStatusEl.hidden = settings.hasPin;
    togglePinField(experimentalPinFieldEl, settings.hasPin);
    experimentalPinStatusEl.hidden = settings.hasPin;
    if (!settings.hasPin) {
        usagePinEl.value = '';
        experimentalPinEl.value = '';
        pinAttemptEl.value = '';
        currentPinEl.value = '';
        limitsImportPinEl.value = '';
    }
    trackingModeEl.value = settings.trackingMode || 'focused';
}

function buildSettingsPayload(overrides) {
    return {
        blockedSites: overrides.blockedSites ?? blockedSitesEl.value,
        siteLimitsText: overrides.siteLimitsText ?? siteLimitsEl.value,
        blockedCategories: overrides.blockedCategories ?? blockedCategoriesEl.value,
        categoryLimitsText: overrides.categoryLimitsText ?? categoryLimitsEl.value,
        slowModeEnabled: overrides.slowModeEnabled ?? slowModeEnabledEl.checked,
        slowModeSeconds: overrides.slowModeSeconds ?? slowModeSecondsEl.value,
        trackingMode: overrides.trackingMode ?? trackingModeEl.value,
        pinAttempt: overrides.pinAttempt ?? pinAttemptEl.value,
        clearPin: overrides.clearPin ?? clearPinEl.checked,
        newPin: overrides.newPin ?? '',
        newPinConfirm: overrides.newPinConfirm ?? ''
    };
}

function serializeLimitMap(limitMap) {
    return Object.entries(limitMap || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, minutes]) => `${key} ${minutes}`)
        .join('\n');
}

function isClearConfirmReady() {
    return clearUsageConfirmEl.value.trim().toLowerCase() === 'permanently clear';
}

function togglePinField(element, show) {
    if (!element) {
        return;
    }

    element.hidden = !show;
    element.style.display = show ? '' : 'none';
}

function renderWeeklyUsage(weeklyUsage) {
    if (!weeklyUsage?.bars?.length) {
        weeklyChartEl.innerHTML = '';
        weeklyDetailListEl.innerHTML = '';
        if (weeklyPickupsChartEl) {
            weeklyPickupsChartEl.innerHTML = '';
        }
        if (weeklyPickupsListEl) {
            weeklyPickupsListEl.innerHTML = '';
        }
        return;
    }

    const maxSeconds = Math.max(...weeklyUsage.bars.map((bar) => bar.totalSeconds), 1);
    weeklyTotalEl.textContent = `${formatSeconds(weeklyUsage.weekTotalSeconds)} total in browser this week`;

    weeklyChartEl.innerHTML = weeklyUsage.bars
        .map((bar) => {
            const totalSeconds = bar.segments.reduce((sum, segment) => sum + segment.seconds, 0);
            const stackHeight = totalSeconds === 0 ? 0 : Math.max(2, (totalSeconds / maxSeconds) * 90);
            const segmentsHtml = bar.segments
                .map((segment) => {
                    const height = totalSeconds === 0 ? 0 : (segment.seconds / totalSeconds) * 100;
                    return `<span class="weekly-bar__segment" data-site-key="${segment.siteKey}" style="height:${height}%;background:${segment.color}" title="${segment.siteKey}: ${formatSeconds(segment.seconds)}"></span>`;
                })
                .join('');

            return `
                <article class="weekly-bar ${selectedDayKey === bar.dayKey ? 'is-selected' : ''}" data-day-key="${bar.dayKey}">
                    <div class="weekly-bar__frame">
                        <div class="weekly-bar__stack" style="height:${stackHeight}%">${segmentsHtml}</div>
                    </div>
                    <p class="weekly-bar__total">${formatMinutes(bar.totalMinutes)}</p>
                    <p class="weekly-bar__label">${bar.label}</p>
                </article>
            `;
        })
        .join('');

    Array.from(weeklyChartEl.querySelectorAll('.weekly-bar')).forEach((barEl) => {
        barEl.addEventListener('click', () => {
            const dayKey = barEl.dataset.dayKey;
            selectedDayKey = selectedDayKey === dayKey ? null : dayKey;
            renderWeeklyUsage(weeklyUsage);
        });
    });

    renderWeeklyDetail(weeklyUsage);
    renderWeeklyPickups(weeklyUsage.pickups);
    attachChartListHover(weeklyChartEl, weeklyDetailListEl);
}

function renderWeeklyDetail(weeklyUsage) {
    const colorMap = new Map(weeklyUsage.legend.map((entry) => [entry.siteKey, entry.color]));

    if (!selectedDayKey) {
        weeklyDetailTitleEl.textContent = 'Top 30 by weekly total';
        clearWeeklySelectionEl.hidden = true;
        togglePinField(clearWeeklyPinFieldEl, false);
        clearWeeklyStatusEl.textContent = '';
        clearWeeklyPinEl.value = '';
        weeklyDetailListEl.innerHTML = weeklyUsage.defaultList
            .map((entry) => `
                <li class="weekly-detail__item" data-site-key="${entry.siteKey}">
                    <span class="weekly-detail__site">
                        ${renderDetailSwatch(colorMap.get(entry.siteKey))}
                        <span>${entry.siteKey}</span>
                    </span>
                    <span class="weekly-detail__value">${formatSeconds(entry.totalSeconds)}</span>
                </li>
            `)
            .join('');
        return;
    }

    const selectedBar = weeklyUsage.bars.find((bar) => bar.dayKey === selectedDayKey);
    if (!selectedBar) {
        selectedDayKey = null;
        renderWeeklyDetail(weeklyUsage);
        return;
    }

    weeklyDetailTitleEl.textContent = `${selectedBar.label} usage`;
    clearWeeklySelectionEl.hidden = false;
    togglePinField(clearWeeklyPinFieldEl, Boolean(currentSettings?.hasPin));
    weeklyDetailListEl.innerHTML = selectedBar.detailEntries
        .map((entry) => `
            <li class="weekly-detail__item" data-site-key="${entry.siteKey}">
                <span class="weekly-detail__site">
                    ${renderDetailSwatch(colorMap.get(entry.siteKey))}
                    <span>${entry.siteKey}</span>
                </span>
                <span class="weekly-detail__value">${formatSeconds(entry.seconds)}</span>
            </li>
        `)
        .join('') || '<li class="weekly-detail__empty">No tracked usage for this day.</li>';
}

function renderDetailSwatch(color) {
    if (!color) {
        return '<span class="weekly-detail__swatch weekly-detail__swatch--empty" aria-hidden="true"></span>';
    }

    return `<span class="weekly-detail__swatch" style="background:${color}" aria-hidden="true"></span>`;
}

function renderWeeklyPickups(pickups) {
    if (!pickups || !weeklyPickupsChartEl || !weeklyPickupsListEl) {
        if (weeklyPickupsChartEl) {
            weeklyPickupsChartEl.innerHTML = '';
        }
        if (weeklyPickupsListEl) {
            weeklyPickupsListEl.innerHTML = '';
        }
        return;
    }

    const pickupsLegendMap = new Map((pickups.legend || []).map((entry) => [entry.siteKey, entry.color]));
    const maxCount = Math.max(...pickups.daily.map((entry) => entry.count), 1);
    weeklyPickupsChartEl.innerHTML = pickups.daily
        .map((entry) => {
            const height = entry.count === 0 ? 0 : Math.max(2, (entry.count / maxCount) * 90);
            const segments = entry.segments || [];
            const total = segments.reduce((sum, segment) => sum + segment.count, 0);
            const segmentsHtml = segments
                .map((segment) => {
                    const segmentHeight = total === 0 ? 0 : (segment.count / total) * 100;
                    return `<span class="weekly-bar__segment" data-site-key="${segment.siteKey}" style="height:${segmentHeight}%;background:${segment.color}" title="${segment.siteKey}: ${segment.count}"></span>`;
                })
                .join('');
            return `
                <article class="weekly-bar ${selectedDayKey === entry.dayKey ? 'is-selected' : ''}" data-day-key="${entry.dayKey}">
                    <div class="weekly-bar__frame">
                        <div class="weekly-bar__stack" style="height:${height}%">${segmentsHtml}</div>
                    </div>
                    <p class="weekly-bar__total">${entry.count}</p>
                    <p class="weekly-bar__label">${entry.label}</p>
                </article>
            `;
        })
        .join('');

    Array.from(weeklyPickupsChartEl.querySelectorAll('.weekly-bar')).forEach((barEl) => {
        barEl.addEventListener('click', () => {
            const dayKey = barEl.dataset.dayKey;
            selectedDayKey = selectedDayKey === dayKey ? null : dayKey;
            renderWeeklyUsage(weeklyUsageState);
        });
    });

    renderPickupList(pickups, pickupsLegendMap);
    attachChartListHover(weeklyPickupsChartEl, weeklyPickupsListEl);
}

function renderPickupList(pickups, pickupsLegendMap) {
    if (!selectedDayKey) {
        clearPickupsSelectionEl.hidden = true;
        togglePinField(clearPickupsPinFieldEl, false);
        clearPickupsStatusEl.textContent = '';
        clearPickupsPinEl.value = '';
        weeklyPickupsListEl.innerHTML = pickups.topSites.length
            ? pickups.topSites
            .map((entry) => `
                <li class="weekly-detail__item" data-site-key="${entry.siteKey}">
                    <span class="weekly-detail__site">
                        ${renderDetailSwatch(pickupsLegendMap.get(entry.siteKey))}
                        <span>${entry.siteKey}</span>
                    </span>
                    <span class="weekly-detail__value">${entry.count}</span>
                </li>
            `)
            .join('')
        : '<li class="weekly-detail__empty">No pickups yet.</li>';
        return;
    }

    const selected = pickups.daily.find((entry) => entry.dayKey === selectedDayKey);
    if (!selected) {
        selectedDayKey = null;
        renderPickupList(pickups, pickupsLegendMap);
        return;
    }

    clearPickupsSelectionEl.hidden = false;
    togglePinField(clearPickupsPinFieldEl, Boolean(currentSettings?.hasPin));
    weeklyPickupsListEl.innerHTML = selected.detailEntries.length
        ? selected.detailEntries
            .map((entry) => `
                <li class="weekly-detail__item" data-site-key="${entry.siteKey}">
                    <span class="weekly-detail__site">
                        ${renderDetailSwatch(pickupsLegendMap.get(entry.siteKey))}
                        <span>${entry.siteKey}</span>
                    </span>
                    <span class="weekly-detail__value">${entry.count}</span>
                </li>
            `)
            .join('')
        : '<li class="weekly-detail__empty">No pickups for this day.</li>';
}

function attachChartListHover(chartContainerEl, listEl) {
    chartContainerEl.querySelectorAll('.weekly-bar__segment').forEach((segEl) => {
        segEl.addEventListener('mouseenter', () => highlightSiteKey(chartContainerEl, listEl, segEl.dataset.siteKey));
        segEl.addEventListener('mouseleave', () => clearChartHighlight(chartContainerEl, listEl));
    });
    listEl.querySelectorAll('.weekly-detail__item[data-site-key]').forEach((itemEl) => {
        itemEl.addEventListener('mouseenter', () => highlightSiteKey(chartContainerEl, listEl, itemEl.dataset.siteKey));
        itemEl.addEventListener('mouseleave', () => clearChartHighlight(chartContainerEl, listEl));
    });
}

function highlightSiteKey(chartContainerEl, listEl, siteKey) {
    chartContainerEl.querySelectorAll('.weekly-bar__segment').forEach((el) => {
        el.classList.toggle('is-dimmed', el.dataset.siteKey !== siteKey);
    });
    listEl.querySelectorAll('.weekly-detail__item[data-site-key]').forEach((el) => {
        const match = el.dataset.siteKey === siteKey;
        el.classList.toggle('is-dimmed', !match);
        el.classList.toggle('is-highlighted', match);
    });
}

function clearChartHighlight(chartContainerEl, listEl) {
    chartContainerEl.querySelectorAll('.weekly-bar__segment').forEach((el) => el.classList.remove('is-dimmed'));
    listEl.querySelectorAll('.weekly-detail__item').forEach((el) => el.classList.remove('is-dimmed', 'is-highlighted'));
}
