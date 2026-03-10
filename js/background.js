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
        categoryLimitsById: normalizeCategoryLimits(current.categoryLimitsById || {})
    };

    if (JSON.stringify(settings.blockedSites) !== JSON.stringify(current.blockedSites || []) ||
        JSON.stringify(settings.siteLimitsByHostname) !== JSON.stringify(current.siteLimitsByHostname || {}) ||
        JSON.stringify(settings.blockedCategories) !== JSON.stringify(current.blockedCategories || []) ||
        JSON.stringify(settings.categoryLimitsById) !== JSON.stringify(current.categoryLimitsById || {})) {
        await chrome.storage.sync.set(settings);
    }

    return settings;
}

async function saveSettings(payload) {
    const blockedSites = normalizeHostnames((payload?.blockedSites || '').split('\n'));
    const siteLimitsByHostname = parseSiteLimitsText(payload?.siteLimitsText || '');
    const blockedCategories = normalizeCategoryList((payload?.blockedCategories || '').split('\n'));
    const categoryLimitsById = parseCategoryLimitsText(payload?.categoryLimitsText || '');

    const settings = { blockedSites, siteLimitsByHostname, blockedCategories, categoryLimitsById };
    await chrome.storage.sync.set(settings);
    await refreshAllTabs();

    return settings;
}

async function getPopupData(dayOffset) {
    await flushActiveSession();
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const settings = await getSettings();
    const currentDayUsage = await getUsageByDayOffset(0);
    const selectedDayOffset = normalizeDayOffset(dayOffset);
    const selectedDayUsage = await getUsageByDayOffset(selectedDayOffset);
    const categoryMap = await getCategoryMap();

    if (tab?.id) {
        await recordTransition(tab.id);
    }

    const currentSite = buildCurrentSite(tab?.url, currentDayUsage, settings, categoryMap);

    return {
        currentSite,
        chart: buildChartData(selectedDayUsage, 15),
        chartDayLabel: formatDayLabel(selectedDayOffset),
        chartDayOffset: selectedDayOffset,
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
        usage: normalizeUsageMap(usageByDay[dayKey] || {})
    }));

    const weeklyTotals = normalizedDays.reduce((totals, day) => {
        Object.entries(day.usage).forEach(([siteKey, seconds]) => {
            totals[siteKey] = (totals[siteKey] || 0) + seconds;
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

    const weekTotalSeconds = bars.reduce((sum, bar) => sum + bar.totalSeconds, 0);
    const defaultList = Object.entries(weeklyTotals)
        .filter(([, seconds]) => seconds > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([siteKey, seconds]) => ({
            siteKey,
            totalSeconds: seconds
        }));

    return { bars, legend, weekTotalSeconds, defaultList };
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
