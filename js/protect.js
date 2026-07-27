'use strict';

const PLATFORM_STORAGE_KEY = 'protectPlatform';
const platformTabEls = Array.from(document.querySelectorAll('[data-role="platform-tab"]'));
const platformPanelEls = Array.from(document.querySelectorAll('[data-role="platform-panel"]'));
const extensionIdEls = Array.from(document.querySelectorAll('[data-role="extension-id"]'));
const copyButtonEls = Array.from(document.querySelectorAll('[data-role="copy"]'));
const copyInlineEls = Array.from(document.querySelectorAll('[data-role="copy-inline"]'));

renderExtensionId();
selectPlatform(detectPlatform());

platformTabEls.forEach((tabEl) => {
    tabEl.addEventListener('click', () => {
        selectPlatform(tabEl.dataset.platform);
        chrome.storage.local.set({ [PLATFORM_STORAGE_KEY]: tabEl.dataset.platform }).catch(() => undefined);
    });
});

copyButtonEls.forEach((buttonEl) => {
    buttonEl.addEventListener('click', () => {
        const codeEl = buttonEl.parentElement.querySelector('[data-role="code"]');
        copyText(codeEl?.textContent || '', buttonEl);
    });
});

copyInlineEls.forEach((codeEl) => {
    codeEl.title = 'Click to copy';
    codeEl.addEventListener('click', () => copyText(codeEl.textContent || '', codeEl));
});

restorePlatformChoice();

function renderExtensionId() {
    const extensionId = chrome.runtime.id;
    extensionIdEls.forEach((el) => {
        el.textContent = extensionId;
    });

    document.querySelectorAll('[data-template="extension-settings"]').forEach((el) => {
        el.textContent = el.textContent.replace('__EXTENSION_ID__', extensionId);
    });
}

// Best-effort guess only; the user can always switch tabs.
function detectPlatform() {
    const platform = `${navigator.userAgentData?.platform || navigator.platform || ''}`.toLowerCase();
    if (platform.includes('mac')) {
        return 'macos';
    }

    if (platform.includes('linux')) {
        return 'linux';
    }

    return 'windows';
}

async function restorePlatformChoice() {
    const stored = await chrome.storage.local.get([PLATFORM_STORAGE_KEY]).catch(() => ({}));
    const platform = stored?.[PLATFORM_STORAGE_KEY];
    if (platformPanelEls.some((panelEl) => panelEl.dataset.platform === platform)) {
        selectPlatform(platform);
    }
}

function selectPlatform(platform) {
    platformTabEls.forEach((tabEl) => {
        const isActive = tabEl.dataset.platform === platform;
        tabEl.classList.toggle('is-active', isActive);
        tabEl.setAttribute('aria-selected', String(isActive));
    });

    platformPanelEls.forEach((panelEl) => {
        panelEl.classList.toggle('is-active', panelEl.dataset.platform === platform);
    });
}

async function copyText(text, feedbackEl) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (_error) {
        return;
    }

    const original = feedbackEl.dataset.originalLabel || feedbackEl.textContent;
    feedbackEl.dataset.originalLabel = original;
    feedbackEl.classList.add('is-copied');

    if (feedbackEl.dataset.role === 'copy') {
        feedbackEl.textContent = 'Copied';
    }

    window.setTimeout(() => {
        feedbackEl.textContent = original;
        feedbackEl.classList.remove('is-copied');
    }, 1400);
}
