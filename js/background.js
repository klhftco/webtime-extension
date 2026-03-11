'use strict';

importScripts('shared.js');

const activeSessions = new Map();
const hostnameSessionMap = new Map();
const tabLastUrl = new Map();

chrome.runtime.onInstalled.addListener(async () => {
    await ensureDefaults();
    await seedTabUrls();
    await syncActiveSessions();
    await refreshAllTabs();
});

chrome.runtime.onStartup.addListener(async () => {
    await ensureDefaults();
    await seedTabUrls();
    await syncActiveSessions();
    await refreshAllTabs();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await syncActiveSessions(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        await flushAllSessions(false);
        return;
    }

    await syncActiveSessions();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active && tab.windowId >= 0 && tab.url) {
        await syncActiveSessions(tabId);
        await pushStateToTab(tabId, tab.url);
    }

    if (changeInfo.url || changeInfo.status === 'complete') {
        await handleTabNavigation(tabId, tab);
    }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    await flushSessionByTabId(tabId);
    tabLastUrl.delete(tabId);
});

chrome.alarms.create('heartbeat', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'heartbeat') {
        return;
    }

    await flushAllSessions(true);
    await syncActiveSessions();
    await refreshAllTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'webtime:get-popup-data') {
        getPopupData(message.dayOffset)
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

    if (message?.type === 'webtime:get-weekly-usage') {
        getWeeklyUsage()
            .then((weeklyUsage) => sendResponse({ weeklyUsage }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:dump-usage') {
        dumpUsage(message.pinAttempt)
            .then((payload) => sendResponse(payload))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:clear-usage') {
        clearUsage(message.pinAttempt)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:settings-opened') {
        recordSettingsOpened()
            .then(() => sendResponse({ ok: true }))
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

    if (!Array.isArray(current.blockedCategories)) {
        next.blockedCategories = DEFAULT_SETTINGS.blockedCategories;
    }

    if (!current.categoryLimitsById || typeof current.categoryLimitsById !== 'object' || Array.isArray(current.categoryLimitsById)) {
        next.categoryLimitsById = DEFAULT_SETTINGS.categoryLimitsById;
    }

    if (typeof current.settingsPinHash !== 'string') {
        next.settingsPinHash = DEFAULT_SETTINGS.settingsPinHash;
    }

    if (typeof current.settingsPinSalt !== 'string') {
        next.settingsPinSalt = DEFAULT_SETTINGS.settingsPinSalt;
    }

    if (typeof current.slowModeEnabled !== 'boolean') {
        next.slowModeEnabled = DEFAULT_SETTINGS.slowModeEnabled;
    }

    if (!Number.isFinite(current.slowModeSeconds)) {
        next.slowModeSeconds = DEFAULT_SETTINGS.slowModeSeconds;
    }

    if (typeof current.trackingMode !== 'string') {
        next.trackingMode = DEFAULT_SETTINGS.trackingMode;
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
        siteLimitsByHostname: normalizeSiteLimits(current.siteLimitsByHostname || {}),
        blockedCategories: normalizeCategoryList(current.blockedCategories || []),
        categoryLimitsById: normalizeCategoryLimits(current.categoryLimitsById || {}),
        slowModeEnabled: Boolean(current.slowModeEnabled),
        slowModeSeconds: normalizeSlowModeSeconds(current.slowModeSeconds),
        trackingMode: normalizeTrackingMode(current.trackingMode),
        hasPin: Boolean(current.settingsPinHash)
    };

    if (JSON.stringify(settings.blockedSites) !== JSON.stringify(current.blockedSites || []) ||
        JSON.stringify(settings.siteLimitsByHostname) !== JSON.stringify(current.siteLimitsByHostname || {}) ||
        JSON.stringify(settings.blockedCategories) !== JSON.stringify(current.blockedCategories || []) ||
        JSON.stringify(settings.categoryLimitsById) !== JSON.stringify(current.categoryLimitsById || {}) ||
        settings.slowModeEnabled !== Boolean(current.slowModeEnabled) ||
        settings.slowModeSeconds !== normalizeSlowModeSeconds(current.slowModeSeconds) ||
        settings.trackingMode !== normalizeTrackingMode(current.trackingMode)) {
        await chrome.storage.sync.set({
            blockedSites: settings.blockedSites,
            siteLimitsByHostname: settings.siteLimitsByHostname,
            blockedCategories: settings.blockedCategories,
            categoryLimitsById: settings.categoryLimitsById,
            slowModeEnabled: settings.slowModeEnabled,
            slowModeSeconds: settings.slowModeSeconds,
            trackingMode: settings.trackingMode
        });
    }

    return settings;
}

async function saveSettings(payload) {
    const pinAttempt = typeof payload?.pinAttempt === 'string' ? payload.pinAttempt.trim() : '';
    const current = await requireSettingsAuthorization(pinAttempt);
    const newPin = typeof payload?.newPin === 'string' ? payload.newPin.trim() : '';
    const newPinConfirm = typeof payload?.newPinConfirm === 'string' ? payload.newPinConfirm.trim() : '';

    if (payload?.clearPin) {
        if (newPin || newPinConfirm) {
            throw new Error('Clear PIN cannot be combined with a new PIN.');
        }
    } else if (newPin || newPinConfirm) {
        if (!isValidPin(newPin) || !isValidPin(newPinConfirm)) {
            throw new Error('New PIN must be 4 digits.');
        }

        if (newPin !== newPinConfirm) {
            throw new Error('New PIN confirmation did not match.');
        }
    }

    const blockedSites = normalizeHostnames((payload?.blockedSites || '').split('\n'));
    const siteLimitsByHostname = parseSiteLimitsText(payload?.siteLimitsText || '');
    const blockedCategories = normalizeCategoryList((payload?.blockedCategories || '').split('\n'));
    const categoryLimitsById = parseCategoryLimitsText(payload?.categoryLimitsText || '');
    const nextSlowModeEnabled = Boolean(payload?.slowModeEnabled);
    const nextSlowModeSeconds = normalizeSlowModeSeconds(payload?.slowModeSeconds);

    let settingsPinHash = current.settingsPinHash || '';
    let settingsPinSalt = current.settingsPinSalt || '';

    if (payload?.clearPin) {
        settingsPinSalt = '';
        settingsPinHash = '';
    } else if (newPin) {
        settingsPinSalt = generateSalt();
        settingsPinHash = await hashPin(newPin, settingsPinSalt);
    }

    const settings = {
        blockedSites,
        siteLimitsByHostname,
        blockedCategories,
        categoryLimitsById,
        settingsPinHash,
        settingsPinSalt,
        slowModeEnabled: nextSlowModeEnabled,
        slowModeSeconds: nextSlowModeSeconds,
        trackingMode: normalizeTrackingMode(payload?.trackingMode ?? current.trackingMode)
    };
    await chrome.storage.sync.set(settings);
    await refreshAllTabs();

    return {
        blockedSites,
        siteLimitsByHostname,
        blockedCategories,
        categoryLimitsById,
        slowModeEnabled: nextSlowModeEnabled,
        slowModeSeconds: nextSlowModeSeconds,
        trackingMode: settings.trackingMode,
        hasPin: Boolean(settingsPinHash)
    };
}

async function getPopupData(dayOffset) {
    await flushAllSessions(true);
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const settings = await getSettings();
    const currentDayUsage = await getUsageByDayOffset(0);
    const selectedDayOffset = normalizeDayOffset(dayOffset);
    const selectedDayUsage = await getUsageByDayOffset(selectedDayOffset);
    const categoryMap = await getCategoryMap();

    await syncActiveSessions();

    const currentSite = buildCurrentSite(tab?.url, currentDayUsage, settings, categoryMap);

    return {
        currentSite,
        chart: buildChartData(selectedDayUsage, 15),
        chartDayLabel: formatDayLabel(selectedDayOffset),
        chartDayOffset: selectedDayOffset,
        trackingMode: settings.trackingMode,
        settingsSummary: {
            blockedSitesCount: settings.blockedSites.length,
            limitedSitesCount: Object.keys(settings.siteLimitsByHostname).length
        }
    };
}

async function getSiteState(urlString) {
    const usageByHostname = await getTodayUsageByHostname();
    const settings = await getSettings();
    const categoryMap = await getCategoryMap();
    return buildCurrentSite(urlString, usageByHostname, settings, categoryMap);
}

function buildCurrentSite(urlString, usageByHostname, settings, categoryMap) {
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
    const categoryId = resolveCategoryId(parsed, categoryMap);
    const categoryUsageSeconds = categoryId ? (buildCategoryUsage(usageByHostname, categoryMap.siteToCategory)[categoryId] || 0) : 0;
    const categoryUsageMinutes = roundSecondsToMinutes(categoryUsageSeconds);
    const categoryLimitMinutes = categoryId ? (settings.categoryLimitsById[categoryId] ?? null) : null;
    const isCategoryBlocked = categoryId ? settings.blockedCategories.includes(categoryId) : false;
    const isBlocked = Boolean(matchingBlockedKey);
    const configuredLimitMinutes = matchingLimitKey ? settings.siteLimitsByHostname[matchingLimitKey] : null;
    const effectiveSiteLimitMinutes = resolveEffectiveLimitMinutes(parsed, settings);
    const effectiveCategoryLimitMinutes = resolveEffectiveCategoryLimitMinutes(categoryId, settings);
    const isSiteOverLimit = effectiveSiteLimitMinutes !== null && todayMinutes >= effectiveSiteLimitMinutes;
    const isCategoryOverLimit = effectiveCategoryLimitMinutes !== null && categoryUsageMinutes >= effectiveCategoryLimitMinutes;
    const isOverLimit = isSiteOverLimit || isCategoryOverLimit;

    return {
        siteKey,
        todaySeconds: totalSeconds,
        todayMinutes,
        limitMinutes: effectiveSiteLimitMinutes ?? effectiveCategoryLimitMinutes,
        configuredLimitMinutes,
        siteLimitMinutes: effectiveSiteLimitMinutes,
        categoryId,
        categoryLimitMinutes: effectiveCategoryLimitMinutes,
        categoryUsageMinutes,
        isCategoryBlocked,
        isTrackable: true,
        isBlocked,
        isOverLimit,
        shouldOverlayBlock: isOverLimit
    };
}

function buildChartData(usageByHostname, maxEntries) {
    const entries = buildGroupedEntries(usageByHostname, maxEntries)
        .map(([siteKey, seconds], index) => ({
            hostname: siteKey,
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

async function getWeeklyUsage() {
    const store = await chrome.storage.local.get(STORAGE_KEYS.local);
    const usageByDay = store.usageByDay || {};
    const pickupsByDay = store.pickupsByDay || {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    const weeklyDayKeys = Array.from({ length: 7 }, (_value, index) => {
        const date = new Date(sunday);
        date.setDate(sunday.getDate() + index);
        return getDateKeyFromDate(date);
    });
    const normalizedDays = weeklyDayKeys.map((dayKey) => ({
        dayKey,
        usage: normalizeUsageMap(usageByDay[dayKey] || {}),
        pickups: normalizePickupMap(pickupsByDay[dayKey] || {})
    }));

    const weeklyTotals = normalizedDays.reduce((totals, day) => {
        Object.entries(day.usage).forEach(([siteKey, seconds]) => {
            totals[siteKey] = (totals[siteKey] || 0) + seconds;
        });
        return totals;
    }, {});

    const weeklyPickupTotals = normalizedDays.reduce((totals, day) => {
        Object.entries(day.pickups).forEach(([siteKey, count]) => {
            totals[siteKey] = (totals[siteKey] || 0) + count;
        });
        return totals;
    }, {});

    const rankedEntries = buildGroupedEntries(weeklyTotals, 10);
    const legend = rankedEntries.map(([siteKey, _seconds], index) => ({
        siteKey,
        color: siteKey === 'Other' ? '#e8dccb' : CHART_COLORS[index % CHART_COLORS.length]
    }));

    const bars = normalizedDays.map((day) => {
        const totalSeconds = Object.values(day.usage).reduce((sum, seconds) => sum + seconds, 0);
        const groupedUsage = buildGroupedUsageForKeys(day.usage, rankedEntries.map(([siteKey]) => siteKey));
        const segments = legend.map((entry) => ({
            siteKey: entry.siteKey,
            color: entry.color,
            seconds: groupedUsage[entry.siteKey] || 0
        })).filter((segment) => segment.seconds > 0);
        const detailEntries = Object.entries(day.usage)
            .filter(([, seconds]) => seconds > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([siteKey, seconds]) => ({
                siteKey,
                seconds
            }));

        return {
            dayKey: day.dayKey,
            label: formatWeeklyLabel(day.dayKey),
            totalMinutes: roundSecondsToMinutes(totalSeconds),
            totalSeconds,
            segments,
            detailEntries
        };
    });

    const pickupDaily = normalizedDays.map((day) => {
        const detailEntries = Object.entries(day.pickups)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([siteKey, count]) => ({ siteKey, count }));
        return {
            dayKey: day.dayKey,
            label: formatWeeklyLabel(day.dayKey),
            count: Object.values(day.pickups).reduce((sum, count) => sum + count, 0),
            detailEntries
        };
    });

    const pickupTotal = pickupDaily.reduce((sum, day) => sum + day.count, 0);
    const pickupTopSites = Object.entries(weeklyPickupTotals)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([siteKey, count]) => ({ siteKey, count }));
    const pickupLegend = pickupTopSites.slice(0, 10).map((entry, index) => ({
        siteKey: entry.siteKey,
        color: CHART_COLORS[index % CHART_COLORS.length]
    }));
    const pickupLegendKeys = pickupLegend.map((entry) => entry.siteKey);
    if (pickupTopSites.length > pickupLegendKeys.length) {
        pickupLegend.push({ siteKey: 'Other', color: '#e8dccb' });
    }

    normalizedDays.forEach((day, index) => {
        const groupedPickups = buildGroupedPickupsForKeys(day.pickups, pickupLegendKeys);
        pickupDaily[index].segments = pickupLegend
            .map((entry) => ({
                siteKey: entry.siteKey,
                color: entry.color,
                count: groupedPickups[entry.siteKey] || 0
            }))
            .filter((segment) => segment.count > 0);
    });

    const weekTotalSeconds = bars.reduce((sum, bar) => sum + bar.totalSeconds, 0);
    const defaultList = Object.entries(weeklyTotals)
        .filter(([, seconds]) => seconds > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([siteKey, seconds]) => ({
            siteKey,
            totalSeconds: seconds
        }));

    return {
        bars,
        legend,
        weekTotalSeconds,
        defaultList,
        pickups: {
            daily: pickupDaily,
            total: pickupTotal,
            topSites: pickupTopSites,
            legend: pickupLegend
        }
    };
}

function buildGroupedEntries(usageByHostname, maxEntries) {
    const sortedEntries = Object.entries(usageByHostname)
        .filter(([, seconds]) => seconds > 0)
        .sort((a, b) => b[1] - a[1]);

    if (sortedEntries.length <= maxEntries) {
        return sortedEntries;
    }

    const head = sortedEntries.slice(0, maxEntries);
    const otherSeconds = sortedEntries.slice(maxEntries).reduce((sum, [, seconds]) => sum + seconds, 0);

    if (otherSeconds > 0) {
        head.push(['Other', otherSeconds]);
    }

    return head;
}

async function syncActiveSessions() {
    const settings = await getSettings();
    if (settings.trackingMode === 'visible-windows') {
        await syncVisibleWindowSessions(settings);
        return;
    }

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const targetWindowId = tab?.windowId;
    await flushSessionsExcept(targetWindowId);
    await syncWindowSession(targetWindowId, tab, settings);
}

async function syncVisibleWindowSessions(settings) {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const visibleWindows = windows.filter((window) => window.state !== 'minimized');
    const visibleWindowIds = new Set(visibleWindows.map((window) => window.id));

    await flushSessionsExcept(visibleWindowIds);

    for (const window of visibleWindows) {
        const activeTab = (window.tabs || []).find((tab) => tab.active);
        await syncWindowSession(window.id, activeTab, settings);
    }
}

async function syncWindowSession(windowId, tab, settings) {
    if (!Number.isInteger(windowId)) {
        return;
    }

    const existing = activeSessions.get(windowId);
    const parsed = safeParseUrl(tab?.url);
    if (!tab?.id || !parsed || !isTrackableUrl(parsed)) {
        await flushSession(windowId, false);
        return;
    }

    const siteKey = getTrackingSiteKey(parsed, settings);
    if (existing && existing.tabId === tab.id && existing.siteKey === siteKey) {
        return;
    }

    await flushSession(windowId, false);

    if (settings.trackingMode === 'visible-windows') {
        const owner = hostnameSessionMap.get(siteKey);
        if (owner && owner !== windowId) {
            await pushStateToTab(tab.id, tab.url);
            return;
        }
    }

    activeSessions.set(windowId, {
        tabId: tab.id,
        siteKey,
        startedAt: Date.now()
    });

    hostnameSessionMap.set(siteKey, windowId);

    await pushStateToTab(tab.id, tab.url);
}

async function flushAllSessions(keepActive) {
    const windowIds = Array.from(activeSessions.keys());
    for (const windowId of windowIds) {
        await flushSession(windowId, keepActive);
    }
}

async function flushSessionsExcept(allowedWindowIdOrSet) {
    const allowedSet = allowedWindowIdOrSet instanceof Set
        ? allowedWindowIdOrSet
        : new Set(Number.isInteger(allowedWindowIdOrSet) ? [allowedWindowIdOrSet] : []);

    const windowIds = Array.from(activeSessions.keys());
    for (const windowId of windowIds) {
        if (!allowedSet.has(windowId)) {
            await flushSession(windowId, false);
        }
    }
}

async function flushSession(windowId, keepActive) {
    const session = activeSessions.get(windowId);
    if (!session) {
        return;
    }

    const elapsedSeconds = Math.max(0, Math.round((Date.now() - session.startedAt) / 1000));
    if (elapsedSeconds > 0) {
        await addUsage(session.siteKey, elapsedSeconds);
    }

    if (keepActive) {
        session.startedAt = Date.now();
        activeSessions.set(windowId, session);
    } else {
        activeSessions.delete(windowId);
        if (hostnameSessionMap.get(session.siteKey) === windowId) {
            hostnameSessionMap.delete(session.siteKey);
        }
    }
}

async function flushSessionByTabId(tabId) {
    for (const [windowId, session] of activeSessions.entries()) {
        if (session.tabId === tabId) {
            await flushSession(windowId, false);
            break;
        }
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

async function addPickup(hostname) {
    const store = await chrome.storage.local.get(STORAGE_KEYS.local);
    const pickupsByDay = store.pickupsByDay || {};
    const todayKey = getTodayKey();
    const todayPickups = normalizePickupMap(pickupsByDay[todayKey] || {});

    todayPickups[hostname] = (todayPickups[hostname] || 0) + 1;
    pickupsByDay[todayKey] = todayPickups;

    await chrome.storage.local.set({ pickupsByDay });
}

async function getTodayUsageByHostname() {
    return getUsageByDayOffset(0);
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

function normalizePickupMap(pickupMap) {
    return Object.entries(pickupMap).reduce((normalized, [hostname, count]) => {
        const cleanHostname = normalizeHostname(hostname);
        if (!cleanHostname) {
            return normalized;
        }

        const numericCount = Number(count);
        if (!Number.isFinite(numericCount) || numericCount <= 0) {
            return normalized;
        }

        normalized[cleanHostname] = (normalized[cleanHostname] || 0) + Math.round(numericCount);
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

function parseCategoryLimitsText(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .reduce((limits, line) => {
            const [rawCategory, rawMinutes] = line.split(/[,:=\s]+/, 2);
            const categoryId = normalizeCategoryId(rawCategory || '');
            const minutes = clampLimitMinutes(rawMinutes);

            if (categoryId && minutes !== null) {
                limits[categoryId] = minutes;
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

function resolveEffectiveCategoryLimitMinutes(categoryId, settings) {
    if (!categoryId) {
        return null;
    }

    if (settings.blockedCategories.includes(categoryId)) {
        return 0;
    }

    if (Object.prototype.hasOwnProperty.call(settings.categoryLimitsById, categoryId)) {
        return settings.categoryLimitsById[categoryId];
    }

    return null;
}

function buildCategoryUsage(usageByHostname, categoryMap) {
    return Object.entries(usageByHostname).reduce((totals, [siteKey, seconds]) => {
        const categoryId = categoryMap[siteKey];
        if (!categoryId) {
            return totals;
        }

        totals[categoryId] = (totals[categoryId] || 0) + seconds;
        return totals;
    }, {});
}

function normalizeCategoryList(values) {
    return Array.from(
        new Set(
            values
                .map((value) => normalizeCategoryId(value))
                .filter(Boolean)
        )
    ).sort();
}

function normalizeCategoryLimits(limitMap) {
    return Object.entries(limitMap || {}).reduce((normalized, [categoryId, minutes]) => {
        const cleanCategory = normalizeCategoryId(categoryId);
        const cleanMinutes = clampLimitMinutes(minutes);

        if (!cleanCategory || cleanMinutes === null) {
            return normalized;
        }

        normalized[cleanCategory] = cleanMinutes;
        return normalized;
    }, {});
}

let categoryMapPromise = null;

async function getCategoryMap() {
    if (!categoryMapPromise) {
        categoryMapPromise = fetch(chrome.runtime.getURL('data/categories.json'))
            .then((response) => response.json())
            .then((categoryList) => buildCategoryMap(categoryList))
            .catch(() => ({ siteToCategory: {}, regexRules: [] }));
    }

    return categoryMapPromise;
}

function buildCategoryMap(categoryList) {
    const siteToCategory = {};
    const regexRules = [];

    Object.entries(categoryList || {}).forEach(([categoryId, sites]) => {
        if (categoryId.endsWith('_regex')) {
            const baseCategory = normalizeCategoryId(categoryId.replace(/_regex$/, ''));
            if (!baseCategory || !Array.isArray(sites)) {
                return;
            }

            sites.forEach((pattern) => {
                if (typeof pattern !== 'string' || !pattern.trim()) {
                    return;
                }
                regexRules.push({ categoryId: baseCategory, regex: new RegExp(pattern, 'i') });
            });

            return;
        }

        const cleanCategory = normalizeCategoryId(categoryId);
        if (!cleanCategory || !Array.isArray(sites)) {
            return;
        }

        sites.forEach((siteKey) => {
            const cleanSiteKey = normalizeSiteKey(siteKey);
            if (cleanSiteKey) {
                siteToCategory[cleanSiteKey] = cleanCategory;
            }
        });
    });

    return { siteToCategory, regexRules };
}

function resolveCategoryId(urlOrParsed, categoryMap) {
    const candidates = buildUrlCandidates(urlOrParsed);
    for (const candidate of candidates) {
        if (categoryMap.siteToCategory[candidate]) {
            return categoryMap.siteToCategory[candidate];
        }
    }

    const hostname = normalizeHostname((typeof urlOrParsed === 'string' ? safeParseUrl(urlOrParsed) : urlOrParsed)?.hostname || '');
    if (!hostname) {
        return null;
    }

    for (const rule of categoryMap.regexRules) {
        if (rule.regex.test(hostname)) {
            return rule.categoryId;
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

async function seedTabUrls() {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
        if (typeof tab.id === 'number') {
            tabLastUrl.set(tab.id, tab.url || '');
        }
    });
}

async function pushStateToTab(tabId, urlString) {
    const state = await getSiteState(urlString);
    await chrome.tabs.sendMessage(tabId, {
        type: 'webtime:apply-site-state',
        payload: state
    }).catch(() => undefined);
}

async function handleTabNavigation(tabId, tab) {
    if (!tab?.url) {
        return;
    }

    const settings = await getSettings();
    if (!(await isTrackedWindow(tab, settings))) {
        tabLastUrl.set(tabId, tab.url);
        return;
    }

    if (!tab.active) {
        tabLastUrl.set(tabId, tab.url);
        return;
    }

    const currentParsed = safeParseUrl(tab.url);
    const previousUrl = tabLastUrl.get(tabId) || '';
    tabLastUrl.set(tabId, tab.url);

    if (!currentParsed || !isTrackableUrl(currentParsed)) {
        return;
    }

    const previousParsed = safeParseUrl(previousUrl);
    const previousHost = previousParsed && isTrackableUrl(previousParsed)
        ? normalizeHostname(previousParsed.hostname || '')
        : '';
    const currentHost = normalizeHostname(currentParsed.hostname || '');

    if (!currentHost) {
        return;
    }

    if (previousHost === currentHost) {
        return;
    }

    if (settings.trackingMode === 'visible-windows') {
        const owner = hostnameSessionMap.get(currentHost);
        if (owner && owner !== tab.windowId) {
            return;
        }
    }

    await addPickup(currentHost);
}

async function isTrackedWindow(tab, settings) {
    if (settings.trackingMode === 'visible-windows') {
        const window = await chrome.windows.get(tab.windowId).catch(() => null);
        return Boolean(window && window.state !== 'minimized');
    }

    const focused = await chrome.windows.getLastFocused().catch(() => null);
    return Boolean(focused && focused.id === tab.windowId);
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

async function dumpUsage(pinAttempt) {
    await requireSettingsAuthorization(typeof pinAttempt === 'string' ? pinAttempt.trim() : '');
    const store = await chrome.storage.local.get(STORAGE_KEYS.local);
    const usageByDay = store.usageByDay || {};
    const pickupsByDay = store.pickupsByDay || {};
    return {
        usageByDay,
        pickupsByDay,
        exportedAt: new Date().toISOString()
    };
}

async function clearUsage(pinAttempt) {
    await requireSettingsAuthorization(typeof pinAttempt === 'string' ? pinAttempt.trim() : '');
    await chrome.storage.local.set({ usageByDay: {}, pickupsByDay: {} });
}

async function requireSettingsAuthorization(pinAttempt) {
    await ensureDefaults();
    const current = await chrome.storage.sync.get(STORAGE_KEYS.sync);
    const hasPin = Boolean(current.settingsPinHash);
    const slowModeEnabled = Boolean(current.slowModeEnabled);
    const slowModeSeconds = normalizeSlowModeSeconds(current.slowModeSeconds);

    if (hasPin) {
        if (!isValidPin(pinAttempt)) {
            throw new Error('Enter the 4-digit PIN to change settings.');
        }

        const expected = await hashPin(pinAttempt, current.settingsPinSalt || '');
        if (expected !== current.settingsPinHash) {
            throw new Error('PIN did not match.');
        }
    } else if (slowModeEnabled) {
        await assertSlowModeCooldown(slowModeSeconds);
    }

    return current;
}

async function recordSettingsOpened() {
    await chrome.storage.local.set({ settingsOpenedAt: Date.now() });
}

async function assertSlowModeCooldown(slowModeSeconds) {
    const store = await chrome.storage.local.get(STORAGE_KEYS.local);
    const openedAt = Number(store.settingsOpenedAt);
    if (!Number.isFinite(openedAt)) {
        throw new Error('Settings cooldown active. Reopen settings and wait out the timer.');
    }

    const elapsedMs = Date.now() - openedAt;
    const requiredMs = Math.max(1, slowModeSeconds) * 1000;
    if (elapsedMs < requiredMs) {
        const remainingSeconds = Math.ceil((requiredMs - elapsedMs) / 1000);
        throw new Error(`Settings cooldown active. Wait ${remainingSeconds}s.`);
    }
}

function isValidPin(value) {
    return typeof value === 'string' && /^\d{4}$/.test(value);
}

function normalizeSlowModeSeconds(value) {
    if (value === '' || value === null || typeof value === 'undefined') {
        return DEFAULT_SETTINGS.slowModeSeconds;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return DEFAULT_SETTINGS.slowModeSeconds;
    }

    return Math.min(3600, Math.max(0, Math.round(numericValue)));
}

function normalizeTrackingMode(value) {
    return value === 'visible-windows' ? 'visible-windows' : 'focused';
}

function generateSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${salt}:${pin}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getUsageByDayOffset(dayOffset) {
    const store = await chrome.storage.local.get(STORAGE_KEYS.local);
    const usageByDay = store.usageByDay || {};
    const dayKey = getDateKeyFromOffset(dayOffset);
    const normalizedUsage = normalizeUsageMap(usageByDay[dayKey] || {});

    if (JSON.stringify(normalizedUsage) !== JSON.stringify(usageByDay[dayKey] || {})) {
        usageByDay[dayKey] = normalizedUsage;
        await chrome.storage.local.set({ usageByDay });
    }

    return normalizedUsage;
}

function normalizeDayOffset(dayOffset) {
    const numericOffset = Number(dayOffset);
    if (Number.isNaN(numericOffset)) {
        return 0;
    }

    return Math.max(-28, Math.min(0, Math.trunc(numericOffset)));
}

function formatDayLabel(dayOffset) {
    if (dayOffset === 0) {
        return 'Today';
    }

    if (dayOffset === -1) {
        return 'Yesterday';
    }

    return formatWeeklyLabel(getDateKeyFromOffset(dayOffset));
}

function formatWeeklyLabel(dayKey) {
    const [year, month, day] = dayKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function buildGroupedUsageForKeys(usageMap, rankedKeys) {
    const totals = {};
    const allowedKeys = new Set(rankedKeys);

    Object.entries(usageMap).forEach(([siteKey, seconds]) => {
        const bucket = allowedKeys.has(siteKey) ? siteKey : 'Other';
        totals[bucket] = (totals[bucket] || 0) + seconds;
    });

    return totals;
}

function buildGroupedPickupsForKeys(pickupMap, rankedKeys) {
    const totals = {};
    const allowedKeys = new Set(rankedKeys);

    Object.entries(pickupMap).forEach(([siteKey, count]) => {
        const bucket = allowedKeys.has(siteKey) ? siteKey : 'Other';
        totals[bucket] = (totals[bucket] || 0) + count;
    });

    return totals;
}
