'use strict';

const statusEl = document.querySelector('[data-role="status"]');
const siteEl = document.querySelector('[data-role="site"]');
const usageEl = document.querySelector('[data-role="usage"]');
const limitEl = document.querySelector('[data-role="limit"]');
const chartEl = document.querySelector('[data-role="chart"]');
const legendEl = document.querySelector('[data-role="legend"]');
const totalEl = document.querySelector('[data-role="total"]');
const footerEl = document.querySelector('[data-role="footer"]');

bootstrapPopup();

async function bootstrapPopup() {
    const response = await chrome.runtime.sendMessage({ type: 'webtime:get-popup-data' });

    if (response?.error) {
        statusEl.textContent = response.error;
        return;
    }

    renderCurrentSite(response.currentSite);
    renderChart(response.chart);
    renderFooter(response.settingsSummary);
}

function renderCurrentSite(site) {
    if (!site?.isTrackable) {
        siteEl.textContent = 'Unavailable';
        usageEl.textContent = '--';
        limitEl.textContent = '--';
        statusEl.textContent = 'This page is not trackable.';
        return;
    }

    siteEl.textContent = site.siteKey;
    usageEl.textContent = formatMinutes(site.todayMinutes);
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
            : 'Tracking the focused tab of the active window.';
        return;
    }

    statusEl.textContent = 'Tracking the focused tab of the active window. No explicit site limit.';
}

function renderChart(chart) {
    if (!chart?.entries?.length) {
        chartEl.style.background = 'linear-gradient(180deg, #f2e7d6 0%, #eadbc4 100%)';
        totalEl.textContent = 'No tracked usage yet today.';
        legendEl.innerHTML = '';
        return;
    }

    const totalSeconds = chart.entries.reduce((sum, entry) => sum + entry.seconds, 0);
    let offset = 0;
    const segments = chart.entries.map((entry) => {
        const start = (offset / totalSeconds) * 360;
        offset += entry.seconds;
        const end = (offset / totalSeconds) * 360;
        return `${entry.color} ${start}deg ${end}deg`;
    });

    chartEl.style.background = `conic-gradient(${segments.join(', ')})`;
    totalEl.textContent = `${formatMinutes(chart.totalMinutes)} tracked today`;
    legendEl.innerHTML = chart.entries
        .map((entry) => `
            <li class="legend__item">
                <span class="legend__swatch" style="background:${entry.color}"></span>
                <span class="legend__host">${entry.hostname}</span>
                <span class="legend__value">${formatMinutes(entry.minutes)}</span>
            </li>
        `)
        .join('');
}

function renderFooter(summary) {
    footerEl.textContent = `${summary.limitedSitesCount} limited sites, ${summary.blockedSitesCount} blocked sites`;
}
