'use strict';

const statusEl = document.querySelector('[data-role="status"]');
const siteEl = document.querySelector('[data-role="site"]');
const usageEl = document.querySelector('[data-role="usage"]');
const limitEl = document.querySelector('[data-role="limit"]');
const chartEl = document.querySelector('[data-role="chart"]');
const legendEl = document.querySelector('[data-role="legend"]');
const totalEl = document.querySelector('[data-role="total"]');
const footerEl = document.querySelector('[data-role="footer"]');
const chartDayEl = document.querySelector('[data-role="chart-day"]');
const olderDayEl = document.querySelector('[data-role="older-day"]');
const newerDayEl = document.querySelector('[data-role="newer-day"]');

let currentDayOffset = 0;
let refreshTimer = null;
let currentChartData = null;

bootstrapPopup();
startLiveRefresh();

olderDayEl.addEventListener('click', () => {
    currentDayOffset = Math.max(-28, currentDayOffset - 1);
    bootstrapPopup();
});

newerDayEl.addEventListener('click', () => {
    currentDayOffset = Math.min(0, currentDayOffset + 1);
    bootstrapPopup();
});

async function bootstrapPopup() {
    const response = await chrome.runtime.sendMessage({
        type: 'webtime:get-popup-data',
        dayOffset: currentDayOffset
    });

    if (response?.error) {
        statusEl.textContent = response.error;
        return;
    }

    currentDayOffset = response.chartDayOffset;
    renderCurrentSite(response.currentSite, response.trackingMode);
    renderChart(response.chart, response.chartDayLabel);
    renderFooter(response.settingsSummary);
    olderDayEl.disabled = currentDayOffset <= -28;
    newerDayEl.disabled = currentDayOffset >= 0;
}

function renderCurrentSite(site, trackingMode) {
    if (!site?.isTrackable) {
        siteEl.textContent = 'Unavailable';
        usageEl.textContent = '--';
        limitEl.textContent = '--';
        statusEl.textContent = 'This page is not trackable.';
        return;
    }

    siteEl.textContent = site.siteKey;
    usageEl.textContent = formatSeconds(site.todaySeconds);
    limitEl.textContent = site.limitMinutes === null ? 'None' : `${site.limitMinutes}m`;

    if (site.shouldOverlayBlock) {
        statusEl.textContent = site.isBlocked
            ? 'Blocked: site is on the blocked list, which acts as a 0-minute limit.'
            : 'Blocked: site has reached its assigned daily limit.';
        return;
    }

    if (site.limitMinutes !== null) {
        statusEl.textContent = site.isBlocked
            ? 'Blocked list entry detected. This site will block immediately.'
            : buildTrackingStatus(trackingMode);
        return;
    }

    statusEl.textContent = `${buildTrackingStatus(trackingMode)} No explicit site limit.`;
}

function fadeColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const nr = 218, ng = 210, nb = 204;
    return `rgb(${Math.round(r * 0.25 + nr * 0.75)},${Math.round(g * 0.25 + ng * 0.75)},${Math.round(b * 0.25 + nb * 0.75)})`;
}

function buildPieGradient(entries, totalSeconds, highlightHostname) {
    let offset = 0;
    return `conic-gradient(${entries.map((entry) => {
        const start = (offset / totalSeconds) * 360;
        offset += entry.seconds;
        const end = (offset / totalSeconds) * 360;
        const color = highlightHostname === null || entry.hostname === highlightHostname
            ? entry.color
            : fadeColor(entry.color);
        return `${color} ${start}deg ${end}deg`;
    }).join(', ')})`;
}

function highlightPieSite(hostname) {
    if (!currentChartData) return;
    const { entries, totalSeconds } = currentChartData;
    chartEl.style.background = buildPieGradient(entries, totalSeconds, hostname);
    legendEl.querySelectorAll('.legend__item').forEach((itemEl) => {
        const match = itemEl.dataset.hostname === hostname;
        itemEl.classList.toggle('is-dimmed', !match);
        itemEl.classList.toggle('is-highlighted', match);
    });
}

function clearPieHighlight() {
    if (!currentChartData) return;
    chartEl.style.background = currentChartData.gradient;
    legendEl.querySelectorAll('.legend__item').forEach((el) => el.classList.remove('is-dimmed', 'is-highlighted'));
}

function renderChart(chart, chartDayLabel) {
    chartDayEl.textContent = chartDayLabel;
    currentChartData = null;

    if (!chart?.entries?.length) {
        chartEl.style.background = 'linear-gradient(180deg, #f2e7d6 0%, #eadbc4 100%)';
        totalEl.textContent = 'No tracked usage for this day.';
        legendEl.innerHTML = '';
        return;
    }

    const totalSeconds = chart.entries.reduce((sum, entry) => sum + entry.seconds, 0);
    const gradient = buildPieGradient(chart.entries, totalSeconds, null);
    chartEl.style.background = gradient;
    currentChartData = { entries: chart.entries, totalSeconds, gradient };

    totalEl.textContent = `${formatMinutes(chart.totalMinutes)} tracked`;
    legendEl.innerHTML = chart.entries
        .map((entry) => `
            <li class="legend__item" data-hostname="${entry.hostname}">
                <span class="legend__swatch" style="background:${entry.color}"></span>
                <span class="legend__host">${entry.hostname}</span>
                <span class="legend__value">${formatMinutes(entry.minutes)}</span>
            </li>
        `)
        .join('');

    legendEl.querySelectorAll('.legend__item').forEach((itemEl) => {
        itemEl.addEventListener('mouseenter', () => highlightPieSite(itemEl.dataset.hostname));
        itemEl.addEventListener('mouseleave', clearPieHighlight);
    });
}

chartEl.addEventListener('mousemove', (e) => {
    if (!currentChartData) return;
    const rect = chartEl.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    let accum = 0;
    const { entries, totalSeconds } = currentChartData;
    const hovered = entries.find((entry) => {
        accum += (entry.seconds / totalSeconds) * 360;
        return angle < accum;
    });
    if (hovered) highlightPieSite(hovered.hostname);
});

chartEl.addEventListener('mouseleave', clearPieHighlight);

function renderFooter(summary) {
    footerEl.textContent = `${summary.limitedSitesCount} limited sites, ${summary.blockedSitesCount} blocked sites`;
}

function startLiveRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(async () => {
        const response = await chrome.runtime.sendMessage({
            type: 'webtime:get-popup-data',
            dayOffset: currentDayOffset
        });

        if (response?.error) {
            statusEl.textContent = response.error;
            return;
        }

        currentDayOffset = response.chartDayOffset;
        renderCurrentSite(response.currentSite, response.trackingMode);
        olderDayEl.disabled = currentDayOffset <= -28;
        newerDayEl.disabled = currentDayOffset >= 0;
    }, 1000);

    window.addEventListener('unload', () => {
        clearInterval(refreshTimer);
        refreshTimer = null;
    });
}

function buildTrackingStatus(trackingMode) {
    return trackingMode === 'visible-windows'
        ? 'Tracking the active tab in each visible window.'
        : 'Tracking the focused tab of the active window.';
}
