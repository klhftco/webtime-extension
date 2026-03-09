'use strict';

importScripts('shared.js');

let activeSession = null;

chrome.runtime.onInstalled.addListener(async () => {
    await ensureDefaults();
    await syncActiveTabSession();
});

chrome.runtime.onStartup.addListener(async () => {
    await ensureDefaults();
    await syncActiveTabSession();
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
    if (tab?.id) {
        await recordTransition(tab.id);
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active && tab.windowId >= 0 && tab.url) {
        const focusedWindow = await chrome.windows.getLastFocused().catch(() => null);
        if (focusedWindow && focusedWindow.id === tab.windowId) {
            await recordTransition(tabId);
        }
    }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (activeSession?.tabId === tabId) {
        await flushActiveSession();
    }
});

chrome.alarms.create('heartbeat', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'heartbeat') {
        return;
    }

    await flushActiveSession();
    await syncActiveTabSession();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'webtime:get-popup-data') {
        getPopupData()
            .then((data) => sendResponse(data))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    return false;
});

async function ensureDefaults() {
    const current = await chrome.storage.sync.get(STORAGE_KEYS.sync);
    if (typeof current.defaultDailyLimitMinutes !== 'number') {
        await chrome.storage.sync.set({
            defaultDailyLimitMinutes: DEFAULT_SETTINGS.defaultDailyLimitMinutes
        });
    }
}

async function getPopupData() {
    await flushActiveSession();
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const settings = await chrome.storage.sync.get(STORAGE_KEYS.sync);
    const usageByHostname = await getTodayUsageByHostname();

    if (tab?.id) {
        await recordTransition(tab.id);
    }

    const currentSite = buildCurrentSite(tab?.url, usageByHostname, settings.defaultDailyLimitMinutes);

    return {
        currentSite,
        chart: buildChartData(usageByHostname),
        defaultDailyLimitMinutes: settings.defaultDailyLimitMinutes
    };
}

function buildCurrentSite(urlString, usageByHostname, dailyLimitMinutes) {
    const parsed = safeParseUrl(urlString);
    if (!parsed || !isTrackableUrl(parsed)) {
        return {
            hostname: '',
            todayMinutes: 0,
            dailyLimitMinutes,
            isTrackable: false
        };
    }

    const hostname = normalizeHostname(parsed.hostname);
    const totalSeconds = usageByHostname[hostname] || 0;

    return {
        hostname,
        todayMinutes: roundSecondsToMinutes(totalSeconds),
        dailyLimitMinutes,
        isTrackable: true
    };
}

function buildChartData(usageByHostname) {
    const entries = Object.entries(usageByHostname)
        .filter(([, seconds]) => seconds > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([hostname, seconds], index) => ({
            hostname,
            seconds,
            minutes: roundSecondsToMinutes(seconds),
            color: CHART_COLORS[index % CHART_COLORS.length]
        }));

    const totalSeconds = entries.reduce((sum, entry) => sum + entry.seconds, 0);

    return {
        totalMinutes: roundSecondsToMinutes(totalSeconds),
        entries
    };
}

async function syncActiveTabSession() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) {
        await recordTransition(tab.id);
    }
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
        hostname: normalizeHostname(parsed.hostname),
        startedAt: Date.now()
    };
}

async function flushActiveSession() {
    if (!activeSession) {
        return;
    }

    const elapsedSeconds = Math.max(0, Math.round((Date.now() - activeSession.startedAt) / 1000));
    if (elapsedSeconds > 0) {
        await addUsage(activeSession.hostname, elapsedSeconds);
    }

    activeSession = null;
}

async function addUsage(hostname, secondsToAdd) {
    const store = await chrome.storage.local.get(STORAGE_KEYS.local);
    const usageByDay = store.usageByDay || {};
    const todayKey = getTodayKey();
    const todayUsage = normalizeUsageMap(usageByDay[todayKey] || {});

    todayUsage[hostname] = (todayUsage[hostname] || 0) + secondsToAdd;
    usageByDay[todayKey] = todayUsage;

    await chrome.storage.local.set({ usageByDay });
}

async function getTodayUsageByHostname() {
    const store = await chrome.storage.local.get(STORAGE_KEYS.local);
    const usageByDay = store.usageByDay || {};
    const todayKey = getTodayKey();
    const normalizedTodayUsage = normalizeUsageMap(usageByDay[todayKey] || {});

    if (JSON.stringify(normalizedTodayUsage) !== JSON.stringify(usageByDay[todayKey] || {})) {
        usageByDay[todayKey] = normalizedTodayUsage;
        await chrome.storage.local.set({ usageByDay });
    }

    return normalizedTodayUsage;
}

function normalizeUsageMap(usageMap) {
    return Object.entries(usageMap).reduce((normalized, [hostname, seconds]) => {
        const cleanHostname = normalizeHostname(hostname);
        if (!cleanHostname) {
            return normalized;
        }

        normalized[cleanHostname] = (normalized[cleanHostname] || 0) + seconds;
        return normalized;
    }, {});
}
