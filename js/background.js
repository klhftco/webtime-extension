'use strict';

importScripts('shared.js');

let activeSession = null;

chrome.runtime.onInstalled.addListener(async () => {
    await ensureDefaults();
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
        id: 'open-options',
        title: 'Open WebTime settings',
        contexts: ['action']
    });
    await refreshAllTabs();
    await syncActiveTabSession();
});

chrome.runtime.onStartup.addListener(async () => {
    await ensureDefaults();
    await refreshAllTabs();
    await syncActiveTabSession();
});

chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === 'open-options') {
        chrome.runtime.openOptionsPage();
    }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await recordTransition(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        await flushActiveSession();
        return;
    }

    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) {
        await recordTransition(tab.id);
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        await pushStateToTab(tabId, tab.url);
    }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (activeSession && activeSession.tabId === tabId) {
        await flushActiveSession();
    }
});

chrome.alarms.create('heartbeat', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'heartbeat') {
        return;
    }

    await flushActiveSession();
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) {
        await recordTransition(tab.id);
    }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'webtime:get-site-state') {
        getSiteState(message.url)
            .then((state) => sendResponse(state))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:get-popup-data') {
        getPopupData()
            .then((data) => sendResponse(data))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:toggle-site-block') {
        toggleSiteBlock(message.hostname)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:save-settings') {
        saveSettings(message.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:get-settings') {
        getSettings()
            .then((settings) => sendResponse({ settings }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    return false;
});

async function ensureDefaults() {
    const current = await chrome.storage.sync.get(STORAGE_KEYS.sync);
    const next = {};

    if (!Array.isArray(current.blockedSites)) {
        next.blockedSites = DEFAULT_SETTINGS.blockedSites;
    }

    if (typeof current.defaultDailyLimitMinutes !== 'number') {
        next.defaultDailyLimitMinutes = DEFAULT_SETTINGS.defaultDailyLimitMinutes;
    }

    if (Object.keys(next).length > 0) {
        await chrome.storage.sync.set(next);
    }
}

async function getSettings() {
    await ensureDefaults();
    const settings = await chrome.storage.sync.get(STORAGE_KEYS.sync);
    return {
        blockedSites: normalizeHostnames(settings.blockedSites || []),
        defaultDailyLimitMinutes: clampMinutes(settings.defaultDailyLimitMinutes)
    };
}

async function saveSettings(payload) {
    const blockedSites = normalizeHostnames((payload?.blockedSites || '').split('\n'));
    const defaultDailyLimitMinutes = clampMinutes(payload?.defaultDailyLimitMinutes);

    await chrome.storage.sync.set({
        blockedSites,
        defaultDailyLimitMinutes
    });

    await refreshAllTabs();

    return {
        ok: true,
        settings: { blockedSites, defaultDailyLimitMinutes }
    };
}

async function toggleSiteBlock(hostname) {
    const cleanHostname = normalizeHostname(hostname);
    if (!cleanHostname) {
        throw new Error('A valid hostname is required.');
    }

    const settings = await getSettings();
    const nextBlocked = new Set(settings.blockedSites);

    if (nextBlocked.has(cleanHostname)) {
        nextBlocked.delete(cleanHostname);
    } else {
        nextBlocked.add(cleanHostname);
    }

    const blockedSites = Array.from(nextBlocked).sort();

    await chrome.storage.sync.set({ blockedSites });
    await refreshAllTabs();

    return {
        ok: true,
        blocked: blockedSites.includes(cleanHostname),
        hostname: cleanHostname
    };
}

async function getPopupData() {
    await flushActiveSession();
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const settings = await getSettings();

    if (tab?.id) {
        await recordTransition(tab.id);
    }

    if (!tab?.url) {
        return {
            site: null,
            settings
        };
    }

    const site = await getSiteState(tab.url);
    return { site, settings };
}

async function getSiteState(urlString) {
    const parsed = safeParseUrl(urlString);
    if (!parsed || !isTrackableUrl(parsed)) {
        return {
            hostname: '',
            todayMinutes: 0,
            dailyLimitMinutes: 0,
            remainingMinutes: 0,
            isBlocked: false,
            isLimitReached: false,
            isTrackable: false
        };
    }

    const settings = await getSettings();
    const usage = await chrome.storage.local.get(STORAGE_KEYS.local);
    const todayKey = getTodayKey();
    const todayUsage = usage.usageByDay?.[todayKey] || {};
    const spentSeconds = todayUsage[parsed.hostname] || 0;
    const dailyLimitMinutes = settings.defaultDailyLimitMinutes;
    const todayMinutes = roundSecondsToMinutes(spentSeconds);
    const remainingMinutes = Math.max(0, dailyLimitMinutes - todayMinutes);
    const isBlocked = settings.blockedSites.includes(parsed.hostname);
    const isLimitReached = todayMinutes >= dailyLimitMinutes;

    return {
        hostname: parsed.hostname,
        todayMinutes,
        dailyLimitMinutes,
        remainingMinutes,
        isBlocked,
        isLimitReached,
        isTrackable: true
    };
}

async function recordTransition(tabId) {
    await flushActiveSession();

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const parsed = safeParseUrl(tab?.url);

    if (!parsed || !isTrackableUrl(parsed)) {
        activeSession = null;
        return;
    }

    activeSession = {
        tabId,
        hostname: parsed.hostname,
        startedAt: Date.now()
    };

    await pushStateToTab(tabId, tab.url);
}

async function flushActiveSession() {
    if (!activeSession) {
        return;
    }

    const elapsedSeconds = Math.max(0, Math.round((Date.now() - activeSession.startedAt) / 1000));
    if (elapsedSeconds > 0) {
        await addUsage(activeSession.hostname, elapsedSeconds);
    }

    const currentTabId = activeSession.tabId;
    activeSession = null;

    const tab = await chrome.tabs.get(currentTabId).catch(() => null);
    if (tab?.url) {
        await pushStateToTab(currentTabId, tab.url);
    }
}

async function addUsage(hostname, secondsToAdd) {
    const store = await chrome.storage.local.get(STORAGE_KEYS.local);
    const usageByDay = store.usageByDay || {};
    const todayKey = getTodayKey();
    const todayUsage = usageByDay[todayKey] || {};

    todayUsage[hostname] = (todayUsage[hostname] || 0) + secondsToAdd;
    usageByDay[todayKey] = todayUsage;

    await chrome.storage.local.set({ usageByDay });
}

async function refreshAllTabs() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
        tabs
            .filter((tab) => typeof tab.id === 'number' && tab.url)
            .map((tab) => pushStateToTab(tab.id, tab.url))
    );
}

async function syncActiveTabSession() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) {
        await recordTransition(tab.id);
    }
}

async function pushStateToTab(tabId, urlString) {
    const state = await getSiteState(urlString);
    await chrome.tabs.sendMessage(tabId, {
        type: 'webtime:apply-site-state',
        payload: state
    }).catch(() => undefined);
}
