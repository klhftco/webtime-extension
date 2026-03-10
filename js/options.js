'use strict';

const blockedSitesEl = document.querySelector('[name="blockedSites"]');
const siteLimitsEl = document.querySelector('[name="siteLimits"]');
const blockedCategoriesEl = document.querySelector('[name="blockedCategories"]');
const categoryLimitsEl = document.querySelector('[name="categoryLimits"]');
const saveStatusEl = document.querySelector('[data-role="save-status"]');
const formEl = document.querySelector('[data-role="settings-form"]');
const weeklyChartEl = document.querySelector('[data-role="weekly-chart"]');
const weeklyTotalEl = document.querySelector('[data-role="weekly-total"]');
const weeklyDetailTitleEl = document.querySelector('[data-role="weekly-detail-title"]');
const weeklyDetailListEl = document.querySelector('[data-role="weekly-detail-list"]');
const clearWeeklySelectionEl = document.querySelector('[data-role="clear-weekly-selection"]');
const tabEls = Array.from(document.querySelectorAll('[data-role="tab"]'));
const panelEls = Array.from(document.querySelectorAll('[data-role="panel"]'));

let weeklyUsageState = null;
let selectedDayKey = null;

bootstrapOptions();

formEl.addEventListener('submit', async (event) => {
    event.preventDefault();

    const response = await chrome.runtime.sendMessage({
        type: 'webtime:save-settings',
        payload: {
            blockedSites: blockedSitesEl.value,
            siteLimitsText: siteLimitsEl.value,
            blockedCategories: blockedCategoriesEl.value,
            categoryLimitsText: categoryLimitsEl.value
        }
    });

    if (response?.error) {
        saveStatusEl.textContent = response.error;
        return;
    }

    renderSettings(response.settings);
    saveStatusEl.textContent = 'Saved.';
});

tabEls.forEach((tabEl) => {
    tabEl.addEventListener('click', () => {
        const targetTab = tabEl.dataset.tab;

        tabEls.forEach((button) => button.classList.toggle('is-active', button === tabEl));
        panelEls.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === targetTab));
    });
});

clearWeeklySelectionEl.addEventListener('click', () => {
    selectedDayKey = null;
    renderWeeklyUsage(weeklyUsageState);
});

async function bootstrapOptions() {
    const [settingsResponse, weeklyResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'webtime:get-settings' }),
        chrome.runtime.sendMessage({ type: 'webtime:get-weekly-usage' })
    ]);

    if (settingsResponse?.error) {
        saveStatusEl.textContent = settingsResponse.error;
        return;
    }

    renderSettings(settingsResponse.settings);

    if (!weeklyResponse?.error) {
        weeklyUsageState = weeklyResponse.weeklyUsage;
        renderWeeklyUsage(weeklyUsageState);
    }
}

function renderSettings(settings) {
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
}

function renderWeeklyUsage(weeklyUsage) {
    if (!weeklyUsage?.bars?.length) {
        weeklyChartEl.innerHTML = '';
        weeklyDetailListEl.innerHTML = '';
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
                    return `<span class="weekly-bar__segment" style="height:${height}%;background:${segment.color}" title="${segment.siteKey}: ${formatSeconds(segment.seconds)}"></span>`;
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
}

function renderWeeklyDetail(weeklyUsage) {
    const colorMap = new Map(weeklyUsage.legend.map((entry) => [entry.siteKey, entry.color]));

    if (!selectedDayKey) {
        weeklyDetailTitleEl.textContent = 'Top 30 by weekly total';
        clearWeeklySelectionEl.hidden = true;
        weeklyDetailListEl.innerHTML = weeklyUsage.defaultList
            .map((entry) => `
                <li class="weekly-detail__item">
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
    weeklyDetailListEl.innerHTML = selectedBar.detailEntries
        .map((entry) => `
            <li class="weekly-detail__item">
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
