'use strict';

const params = new URLSearchParams(window.location.search);
const siteEl = document.querySelector('[data-role="site"]');
const limitEl = document.querySelector('[data-role="limit"]');
const messageEl = document.querySelector('[data-role="message"]');
const viewTargetEl = document.querySelector('[data-role="view-target"]');
const openOptionsEl = document.querySelector('[data-role="open-options"]');

const siteKey = params.get('site') || 'Unknown site';
const limitMinutes = params.get('limitMinutes');
const isBlocked = params.get('blocked') === 'true';
const targetUrl = params.get('target') || '';

siteEl.textContent = siteKey;
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
