'use strict';

importScripts('shared.js');

let activeSession = null;

chrome.runtime.onInstalled.addListener(async () => {
    await ensureDefaults();
    await syncActiveTabSession();
    await refreshAllTabs();
});

chrome.runtime.onStartup.addListener(async () => {
    await ensureDefaults();
    await syncActiveTabSession();
    await refreshAllTabs();
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

        await pushStateToTab(tabId, tab.url);
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
    await refreshAllTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'webtime:get-popup-data') {
        getPopupData()
            .then((data) => sendResponse(data))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:get-site-state') {
        getSiteState(message.url)
            .then((state) => sendResponse(state))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:get-settings') {
        getSettings()
            .then((settings) => sendResponse({ settings }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:save-settings') {
        saveSettings(message.payload)
            .then((settings) => sendResponse({ settings }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:redirect-to-blocked-page') {
        redirectTabToBlockedPage(sender?.tab?.id, message.payload)
            .then(() => sendResponse({ ok: true }))
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

    if (!current.siteLimitsByHostname || typeof current.siteLimitsByHostname !== 'object' || Array.isArray(current.siteLimitsByHostname)) {
        next.siteLimitsByHostname = DEFAULT_SETTINGS.siteLimitsByHostname;
    }

    if (Object.keys(next).length > 0) {
        await chrome.storage.sync.set(next);
    }
}

async function getSettings() {
    await ensureDefaults();
    const current = await chrome.storage.sync.get(STORAGE_KEYS.sync);
    const settings = {
        blockedSites: normalizeHostnames(current.blockedSites || []),
        siteLimitsByHostname: normalizeSiteLimits(current.siteLimitsByHostname || {})
    };

    if (JSON.stringify(settings.blockedSites) !== JSON.stringify(current.blockedSites || []) ||
        JSON.stringify(settings.siteLimitsByHostname) !== JSON.stringify(current.siteLimitsByHostname || {})) {
        await chrome.storage.sync.set(settings);
    }

    return settings;
}

async function saveSettings(payload) {
    const blockedSites = normalizeHostnames((payload?.blockedSites || '').split('\n'));
    const siteLimitsByHostname = parseSiteLimitsText(payload?.siteLimitsText || '');

    const settings = { blockedSites, siteLimitsByHostname };
    await chrome.storage.sync.set(settings);
    await refreshAllTabs();

    return settings;
}

async function getPopupData() {
    await flushActiveSession();
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const settings = await getSettings();
    const usageByHostname = await getTodayUsageByHostname();

    if (tab?.id) {
        await recordTransition(tab.id);
    }

    const currentSite = buildCurrentSite(tab?.url, usageByHostname, settings);

    return {
        currentSite,
        chart: buildChartData(usageByHostname),
        settingsSummary: {
            blockedSitesCount: settings.blockedSites.length,
            limitedSitesCount: Object.keys(settings.siteLimitsByHostname).length
        }
    };
}

async function getSiteState(urlString) {
    const usageByHostname = await getTodayUsageByHostname();
    const settings = await getSettings();
    return buildCurrentSite(urlString, usageByHostname, settings);
}

function buildCurrentSite(urlString, usageByHostname, settings) {
    const parsed = safeParseUrl(urlString);
    if (!parsed || !isTrackableUrl(parsed)) {
        return {
            siteKey: '',
            todayMinutes: 0,
            limitMinutes: null,
            isTrackable: false,
            isBlocked: false,
            isOverLimit: false,
            shouldOverlayBlock: false
        };
    }

    const siteKey = getTrackingSiteKey(parsed, settings);
    const totalSeconds = usageByHostname[siteKey] || 0;
    const todayMinutes = roundSecondsToMinutes(totalSeconds);
    const matchingBlockedKey = getMostSpecificMatch(parsed, settings.blockedSites);
    const matchingLimitKey = getMostSpecificMatch(parsed, Object.keys(settings.siteLimitsByHostname));
    const isBlocked = Boolean(matchingBlockedKey);
    const configuredLimitMinutes = matchingLimitKey ? settings.siteLimitsByHostname[matchingLimitKey] : null;
    const effectiveLimitMinutes = resolveEffectiveLimitMinutes(parsed, settings);
    const isOverLimit = effectiveLimitMinutes !== null && todayMinutes >= effectiveLimitMinutes;

    return {
        siteKey,
        todayMinutes,
        limitMinutes: effectiveLimitMinutes,
        configuredLimitMinutes,
        isTrackable: true,
        isBlocked,
        isOverLimit,
        shouldOverlayBlock: isOverLimit
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

    const settings = await getSettings();
    activeSession = {
        tabId,
        siteKey: getTrackingSiteKey(parsed, settings),
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
        await addUsage(activeSession.siteKey, elapsedSeconds);
    }

    const previousTabId = activeSession.tabId;
    activeSession = null;

    const tab = await chrome.tabs.get(previousTabId).catch(() => null);
    if (tab?.url) {
        await pushStateToTab(previousTabId, tab.url);
    }
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
        const cleanHostname = normalizeSiteKey(hostname);
        if (!cleanHostname) {
            return normalized;
        }

        normalized[cleanHostname] = (normalized[cleanHostname] || 0) + seconds;
        return normalized;
    }, {});
}

function parseSiteLimitsText(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .reduce((limits, line) => {
            const [rawHostname, rawMinutes] = line.split(/[,:=\s]+/, 2);
            const hostname = normalizeSiteKey(rawHostname || '');
            const minutes = clampLimitMinutes(rawMinutes);

            if (hostname && minutes !== null) {
                limits[hostname] = minutes;
            }

            return limits;
        }, {});
}

function getTrackingSiteKey(urlOrParsed, settings) {
    const candidates = buildUrlCandidates(urlOrParsed);
    const configuredRuleKeys = new Set([
        ...settings.blockedSites,
        ...Object.keys(settings.siteLimitsByHostname)
    ]);

    const match = candidates.find((candidate) => configuredRuleKeys.has(candidate));
    return match || normalizeHostname((typeof urlOrParsed === 'string' ? safeParseUrl(urlOrParsed) : urlOrParsed)?.hostname || '');
}

function getMostSpecificMatch(urlOrParsed, ruleKeys) {
    const candidates = buildUrlCandidates(urlOrParsed);
    const ruleSet = new Set(ruleKeys);
    return candidates.find((candidate) => ruleSet.has(candidate)) || null;
}

function resolveEffectiveLimitMinutes(urlOrParsed, settings) {
    const candidates = buildUrlCandidates(urlOrParsed);

    for (const candidate of candidates) {
        if (Object.prototype.hasOwnProperty.call(settings.siteLimitsByHostname, candidate)) {
            return settings.siteLimitsByHostname[candidate];
        }

        if (settings.blockedSites.includes(candidate)) {
            return 0;
        }
    }

    return null;
}

async function refreshAllTabs() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
        tabs
            .filter((tab) => typeof tab.id === 'number' && tab.url)
            .map((tab) => pushStateToTab(tab.id, tab.url))
    );
}

async function pushStateToTab(tabId, urlString) {
    const state = await getSiteState(urlString);
    await chrome.tabs.sendMessage(tabId, {
        type: 'webtime:apply-site-state',
        payload: state
    }).catch(() => undefined);
}

async function redirectTabToBlockedPage(tabId, payload) {
    if (!Number.isInteger(tabId)) {
        throw new Error('A valid tab id is required for blocked-page redirects.');
    }

    const blockedPageUrl = new URL(chrome.runtime.getURL('html/blocked.html'));
    blockedPageUrl.searchParams.set('site', payload?.siteKey || '');
    blockedPageUrl.searchParams.set('limitMinutes', String(payload?.limitMinutes ?? ''));
    blockedPageUrl.searchParams.set('blocked', String(Boolean(payload?.isBlocked)));
    blockedPageUrl.searchParams.set('target', payload?.targetUrl || '');

    await chrome.tabs.update(tabId, { url: blockedPageUrl.toString() });
}
