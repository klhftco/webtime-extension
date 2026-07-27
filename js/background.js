'use strict';

importScripts('shared.js');

// These Maps are the in-memory mirror of the active timing state. MV3 service
// workers are terminated after a short idle period, so this state is also
// persisted to chrome.storage.session (see ensureRestored/persistSessions) and
// rehydrated on every worker restart. Without that, every restart would reset
// each session's startedAt and silently discard the elapsed viewing time,
// causing limits to be enforced far too late or never.
const activeSessions = new Map();
const hostnameSessionMap = new Map();
const tabLastUrl = new Map();

const HEARTBEAT_MINUTES = 1;
// Discard a single flush interval longer than this as an implausible gap (the
// device was almost certainly asleep). Sized to tolerate one throttled
// heartbeat — Chrome can stretch alarms on battery — without counting real
// sleep time.
const MAX_PLAUSIBLE_INTERVAL_SECONDS = HEARTBEAT_MINUTES * 60 + 90;

let restorePromise = null;

async function ensureRestored() {
    if (!restorePromise) {
        restorePromise = (async () => {
            const stored = await chrome.storage.session.get([
                'activeSessions',
                'hostnameSessionMap',
                'tabLastUrl'
            ]).catch(() => ({}));

            for (const [windowId, session] of stored.activeSessions || []) {
                activeSessions.set(Number(windowId), session);
            }
            for (const [siteKey, windowId] of stored.hostnameSessionMap || []) {
                hostnameSessionMap.set(siteKey, Number(windowId));
            }
            for (const [tabId, url] of stored.tabLastUrl || []) {
                tabLastUrl.set(Number(tabId), url);
            }
        })();
    }

    return restorePromise;
}

async function persistSessions() {
    await chrome.storage.session.set({
        activeSessions: Array.from(activeSessions.entries()),
        hostnameSessionMap: Array.from(hostnameSessionMap.entries()),
        tabLastUrl: Array.from(tabLastUrl.entries())
    }).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(async () => {
    await ensureRestored();
    await ensureDefaults();
    await seedTabUrls();
    await syncActiveSessions();
    await syncBlockingRules();
});

chrome.runtime.onStartup.addListener(async () => {
    await ensureRestored();
    await ensureDefaults();
    await seedTabUrls();
    await syncActiveSessions();
    await syncBlockingRules();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await ensureRestored();
    await syncActiveSessions(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    await ensureRestored();
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        await flushAllSessions(false);
        return;
    }

    await syncActiveSessions();
});

chrome.idle.onStateChanged.addListener(async (newState) => {
    await ensureRestored();
    if (newState === 'locked') {
        await flushAllSessions(false);
    } else if (newState === 'active') {
        await syncActiveSessions();
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    await ensureRestored();
    if (changeInfo.url?.startsWith('http')) {
        await maybeRedirectBlockedTab(tabId, changeInfo.url);
    }

    if (changeInfo.status === 'complete' && tab.active && tab.windowId >= 0 && tab.url) {
        await syncActiveSessions(tabId);
    }

    if (changeInfo.url || changeInfo.status === 'complete') {
        await handleTabNavigation(tabId, tab);
    }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    await ensureRestored();
    await flushSessionByTabId(tabId);
    tabLastUrl.delete(tabId);
    await persistSessions();
});

chrome.alarms.create('heartbeat', { periodInMinutes: HEARTBEAT_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'grace-expiry') {
        // Re-block as soon as the extra minute runs out instead of waiting for
        // the next heartbeat.
        await ensureRestored();
        await syncBlockingRules();
        await scheduleGraceExpiryAlarm();
        return;
    }

    if (alarm.name !== 'heartbeat') {
        return;
    }

    await ensureRestored();
    await flushAllSessions(true);
    await syncActiveSessions();
    await syncBlockingRules();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'webtime:get-popup-data') {
        getPopupData(message.dayOffset)
            .then((data) => sendResponse(data))
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
        getWeeklyUsage(message.weekOffset ?? 0)
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

    if (message?.type === 'webtime:clear-day-usage') {
        clearDayUsage(message.dayKey, message.pinAttempt)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:get-grace-status') {
        getGraceStatus(message.siteKey)
            .then((status) => sendResponse({ status }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:grant-grace') {
        grantGrace(message.siteKey)
            .then((status) => sendResponse({ status }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message?.type === 'webtime:settings-opened') {
        recordSettingsOpened()
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
    await syncBlockingRules();

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

// Grace state lives in chrome.storage.local as
// graceBySiteKey[siteKey] = { dayKey, expiresAt }. Entries from any day other
// than today are pruned on read, which is what makes the allowance once-a-day.
async function getGraceState() {
    const store = await chrome.storage.local.get(['graceBySiteKey']);
    const todayKey = getTodayKey();
    const stored = store.graceBySiteKey || {};
    const graceBySiteKey = normalizeGraceMap(stored, todayKey);

    if (JSON.stringify(graceBySiteKey) !== JSON.stringify(stored)) {
        await chrome.storage.local.set({ graceBySiteKey });
    }

    const now = Date.now();
    const activeKeys = new Set(
        Object.entries(graceBySiteKey)
            .filter(([, entry]) => entry.expiresAt > now)
            .map(([siteKey]) => siteKey)
    );

    return { graceBySiteKey, activeKeys, todayKey };
}

function normalizeGraceMap(graceMap, todayKey) {
    return Object.entries(graceMap || {}).reduce((normalized, [siteKey, entry]) => {
        const cleanSiteKey = normalizeSiteKey(siteKey);
        const expiresAt = Number(entry?.expiresAt);

        if (!cleanSiteKey || entry?.dayKey !== todayKey || !Number.isFinite(expiresAt)) {
            return normalized;
        }

        normalized[cleanSiteKey] = { dayKey: todayKey, expiresAt };
        return normalized;
    }, {});
}

// Only a minute-limit overrun is extendable. Blocked-site and blocked-category
// entries are hard blocks, so the button is offered but refused for them.
function resolveGraceDenialReason(state) {
    if (!state.isTrackable) {
        return 'untracked';
    }

    if (state.isBlocked) {
        return 'blocked-site';
    }

    if (state.isCategoryBlocked) {
        return 'blocked-category';
    }

    if (!state.isOverLimit) {
        return 'not-over-limit';
    }

    return '';
}

async function evaluateSiteKey(siteKey) {
    const usageByHostname = await getTodayUsageByHostname();
    const settings = await getSettings();
    const categoryMap = await getCategoryMap();
    return buildCurrentSite(`https://${siteKey}`, usageByHostname, settings, categoryMap, new Set());
}

async function getGraceStatus(rawSiteKey) {
    const siteKey = normalizeSiteKey(rawSiteKey || '');
    if (!siteKey) {
        return buildGraceStatus({ siteKey: '', denialReason: 'untracked' });
    }

    const { graceBySiteKey } = await getGraceState();
    const entry = graceBySiteKey[siteKey] || null;
    const state = await evaluateSiteKey(siteKey);
    const denialReason = entry ? 'used-today' : resolveGraceDenialReason(state);

    return buildGraceStatus({ siteKey, entry, denialReason });
}

async function grantGrace(rawSiteKey) {
    const siteKey = normalizeSiteKey(rawSiteKey || '');
    if (!siteKey) {
        throw new Error(GRACE_DENIAL_REASONS.untracked);
    }

    const { graceBySiteKey, todayKey } = await getGraceState();
    if (graceBySiteKey[siteKey]) {
        throw new Error(GRACE_DENIAL_REASONS['used-today']);
    }

    // Re-evaluate here rather than trusting the blocked page: the caller only
    // supplies a site key, and a hard block must never be extendable.
    const state = await evaluateSiteKey(siteKey);
    const denialReason = resolveGraceDenialReason(state);
    if (denialReason) {
        throw new Error(GRACE_DENIAL_REASONS[denialReason]);
    }

    const entry = { dayKey: todayKey, expiresAt: Date.now() + GRACE_MS };
    graceBySiteKey[siteKey] = entry;
    await chrome.storage.local.set({ graceBySiteKey });
    await scheduleGraceExpiryAlarm();
    await syncBlockingRules();

    return buildGraceStatus({ siteKey, entry, denialReason: '' });
}

function buildGraceStatus({ siteKey, entry = null, denialReason }) {
    const now = Date.now();
    return {
        siteKey,
        graceMinutes: GRACE_MINUTES,
        usedToday: Boolean(entry),
        active: Boolean(entry && entry.expiresAt > now),
        expiresAt: entry ? entry.expiresAt : null,
        eligible: !denialReason,
        denialReason,
        denialMessage: denialReason ? GRACE_DENIAL_REASONS[denialReason] : ''
    };
}

async function scheduleGraceExpiryAlarm() {
    const { graceBySiteKey } = await getGraceState();
    const now = Date.now();
    const nextExpiry = Object.values(graceBySiteKey)
        .map((entry) => entry.expiresAt)
        .filter((expiresAt) => expiresAt > now)
        .sort((a, b) => a - b)[0];

    if (typeof nextExpiry === 'number') {
        chrome.alarms.create('grace-expiry', { when: nextExpiry + 1000 });
        return;
    }

    await chrome.alarms.clear('grace-expiry').catch(() => undefined);
}

async function maybeRedirectBlockedTab(tabId, urlString) {
    const usageByHostname = await getTodayUsageByHostname();
    const settings = await getSettings();
    const categoryMap = await getCategoryMap();
    const { activeKeys } = await getGraceState();
    const state = buildCurrentSite(urlString, usageByHostname, settings, categoryMap, activeKeys);

    if (!state.shouldOverlayBlock) {
        return;
    }

    const blockedPageBase = chrome.runtime.getURL('html/blocked.html');
    await chrome.tabs.update(tabId, {
        url: buildBlockedPageUrl(blockedPageBase, {
            siteKey: state.siteKey,
            limitMinutes: state.limitMinutes,
            isBlocked: state.isBlocked || state.isCategoryBlocked,
            targetUrl: urlString
        })
    }).catch(() => undefined);
}

// `target` is deliberately last and unencoded: DNR's regexSubstitution cannot
// percent-encode the matched URL, so both redirect paths must agree on a
// convention the blocked page can parse back out of the raw query string.
function buildBlockedPageUrl(blockedPageBase, { siteKey, limitMinutes, isBlocked, targetUrl }) {
    const query = [
        `site=${encodeURIComponent(siteKey || '')}`,
        `limitMinutes=${encodeURIComponent(limitMinutes ?? '')}`,
        `blocked=${Boolean(isBlocked)}`,
        `target=${targetUrl || ''}`
    ].join('&');

    return `${blockedPageBase}?${query}`;
}

async function syncBlockingRules() {
    const settings = await getSettings();
    const usageByHostname = await getTodayUsageByHostname();
    const categoryMap = await getCategoryMap();
    const { activeKeys: activeGraceKeys } = await getGraceState();
    const blockedPageBase = chrome.runtime.getURL('html/blocked.html');
    const rulesToCreate = [];

    // Blocked-site entries are hard blocks: grace never suppresses these.
    for (const siteKey of settings.blockedSites) {
        rulesToCreate.push({ siteKey, limitMinutes: 0, isBlocked: true });
    }

    for (const [siteKey, limitMinutes] of Object.entries(settings.siteLimitsByHostname)) {
        if (settings.blockedSites.includes(siteKey) || activeGraceKeys.has(siteKey)) {
            continue;
        }
        const usedMinutes = roundSecondsToMinutes(usageByHostname[siteKey] || 0);
        if (usedMinutes >= limitMinutes) {
            rulesToCreate.push({ siteKey, limitMinutes, isBlocked: false });
        }
    }

    const categoryUsage = buildCategoryUsage(usageByHostname, categoryMap.siteToCategory);
    const blockedCategorySet = new Set(settings.blockedCategories);

    for (const [categoryId, limitMinutes] of Object.entries(settings.categoryLimitsById)) {
        if (blockedCategorySet.has(categoryId)) {
            continue;
        }
        const usedMinutes = roundSecondsToMinutes(categoryUsage[categoryId] || 0);
        if (usedMinutes >= limitMinutes) {
            blockedCategorySet.add(categoryId);
        }
    }

    // A regex rule has no single site key to skip, so graced hostnames are
    // carved out of it instead. Only category *limits* are carved out; an
    // explicitly blocked category stays hard.
    const gracedDomains = Array.from(activeGraceKeys).map((siteKey) => siteKey.split('/')[0]);

    const existingSiteKeys = new Set(rulesToCreate.map((r) => r.siteKey));
    for (const categoryId of blockedCategorySet) {
        const isExplicitlyBlocked = settings.blockedCategories.includes(categoryId);
        const limitMinutes = isExplicitlyBlocked ? 0 : (settings.categoryLimitsById[categoryId] ?? 0);

        for (const [siteKey, cat] of Object.entries(categoryMap.siteToCategory)) {
            if (cat !== categoryId || existingSiteKeys.has(siteKey)) {
                continue;
            }
            if (!isExplicitlyBlocked && activeGraceKeys.has(siteKey)) {
                continue;
            }
            rulesToCreate.push({ siteKey, limitMinutes, isBlocked: isExplicitlyBlocked });
            existingSiteKeys.add(siteKey);
        }

        for (const rule of categoryMap.regexRules) {
            if (rule.categoryId === categoryId) {
                rulesToCreate.push({
                    siteKey: rule.regex.source,
                    limitMinutes,
                    isBlocked: isExplicitlyBlocked,
                    isRegex: true,
                    regexPattern: rule.regex.source,
                    excludedRequestDomains: isExplicitlyBlocked ? [] : gracedDomains
                });
            }
        }
    }

    await applyDynamicRules(rulesToCreate, blockedPageBase);

    const tabs = await chrome.tabs.query({});
    await Promise.all(
        tabs
            .filter((tab) => typeof tab.id === 'number' && tab.url?.startsWith('http'))
            .map(async (tab) => {
                const state = buildCurrentSite(tab.url, usageByHostname, settings, categoryMap, activeGraceKeys);
                if (!state.shouldOverlayBlock) {
                    return;
                }
                await chrome.tabs.update(tab.id, {
                    url: buildBlockedPageUrl(blockedPageBase, {
                        siteKey: state.siteKey,
                        limitMinutes: state.limitMinutes,
                        isBlocked: state.isBlocked || state.isCategoryBlocked,
                        targetUrl: tab.url
                    })
                }).catch(() => undefined);
            })
    );
}

async function applyDynamicRules(rulesToCreate, blockedPageBase) {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((r) => r.id);

    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds,
            addRules: rulesToCreate.map((item, index) => buildDnrRule(index + 1, item, blockedPageBase, true))
        });
    } catch (_error) {
        // regexSubstitution only exists to carry the original URL through to the
        // blocked page. If Chrome rejects it, fall back to static redirect URLs
        // so enforcement still happens — the page just loses "View original URL"
        // and sends "One more minute" to the site root instead.
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds,
            addRules: rulesToCreate.map((item, index) => buildDnrRule(index + 1, item, blockedPageBase, false))
        });
    }
}

function buildDnrRule(id, item, blockedPageBase, preserveTarget) {
    const { siteKey, limitMinutes, isBlocked, isRegex, regexPattern, excludedRequestDomains } = item;

    let regexFilter;
    if (isRegex) {
        // `.*$` extends the match to the end of the URL so \0 is the full URL.
        regexFilter = `(?i)^https?://[^/]*${regexPattern}[^/]*/.*$`;
    } else {
        const hostname = siteKey.includes('/') ? siteKey.split('/')[0] : siteKey;
        const pathPart = siteKey.includes('/') ? siteKey.slice(hostname.length) : '';
        const escapedHostname = hostname.replace(/\./g, '\\.');
        const escapedPath = pathPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regexFilter = pathPart
            ? `^https?://(?:[^/]*\\.)?${escapedHostname}${escapedPath}(?:[/?#].*)?$`
            : `^https?://(?:[^/]*\\.)?${escapedHostname}(?:[/?#].*)?$`;
    }

    // \0 is the whole matched URL, which every regexFilter above anchors to the
    // end of the request URL.
    const redirect = preserveTarget
        ? { regexSubstitution: buildBlockedPageUrl(blockedPageBase, { siteKey, limitMinutes, isBlocked, targetUrl: '\\0' }) }
        : { url: buildBlockedPageUrl(blockedPageBase, { siteKey, limitMinutes, isBlocked, targetUrl: '' }) };

    const condition = { regexFilter, resourceTypes: ['main_frame'] };
    if (excludedRequestDomains?.length) {
        condition.excludedRequestDomains = excludedRequestDomains;
    }

    return {
        id,
        priority: 1,
        action: { type: 'redirect', redirect },
        condition
    };
}

async function getPopupData(dayOffset) {
    await ensureRestored();
    await flushAllSessions(true);
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const settings = await getSettings();
    const currentDayUsage = await getUsageByDayOffset(0);
    const selectedDayOffset = normalizeDayOffset(dayOffset);
    const selectedDayUsage = await getUsageByDayOffset(selectedDayOffset);
    const categoryMap = await getCategoryMap();
    const { activeKeys } = await getGraceState();

    await syncActiveSessions();

    const currentSite = buildCurrentSite(tab?.url, currentDayUsage, settings, categoryMap, activeKeys);

    return {
        currentSite,
        chart: buildChartData(selectedDayUsage, 15),
        chartDayLabel: formatDayLabel(selectedDayOffset),
        chartDayOffset: selectedDayOffset,
        trackingMode: settings.trackingMode,
        siteLimitsByHostname: settings.siteLimitsByHostname,
        settingsSummary: {
            blockedSitesCount: settings.blockedSites.length,
            limitedSitesCount: Object.keys(settings.siteLimitsByHostname).length
        }
    };
}

function buildCurrentSite(urlString, usageByHostname, settings, categoryMap, activeGraceKeys) {
    const parsed = safeParseUrl(urlString);
    if (!parsed || !isTrackableUrl(parsed)) {
        return {
            siteKey: '',
            todayMinutes: 0,
            limitMinutes: null,
            isTrackable: false,
            isBlocked: false,
            isOverLimit: false,
            hasActiveGrace: false,
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
    // Grace suppresses enforcement for a minute, but only where the block came
    // from a time limit; a hard block ignores it.
    const isHardBlocked = isBlocked || isCategoryBlocked;
    const hasActiveGrace = !isHardBlocked && Boolean(
        activeGraceKeys && buildUrlCandidates(parsed).some((candidate) => activeGraceKeys.has(candidate))
    );

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
        hasActiveGrace,
        shouldOverlayBlock: isOverLimit && !hasActiveGrace
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

async function getWeeklyUsage(weekOffset = 0) {
    const store = await chrome.storage.local.get(STORAGE_KEYS.local);
    const usageByDay = store.usageByDay || {};
    const pickupsByDay = store.pickupsByDay || {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay() + weekOffset * 7);
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

    const saturdayDate = new Date(sunday);
    saturdayDate.setDate(sunday.getDate() + 6);
    const weekLabel = `${sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${saturdayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

    const prevSunday = new Date(sunday);
    prevSunday.setDate(sunday.getDate() - 7);
    const prevWeekBars = Array.from({ length: 7 }, (_value, index) => {
        const date = new Date(prevSunday);
        date.setDate(prevSunday.getDate() + index);
        const dayKey = getDateKeyFromDate(date);
        const usage = normalizeUsageMap(usageByDay[dayKey] || {});
        const totalSeconds = Object.values(usage).reduce((sum, s) => sum + s, 0);
        return { dayKey, totalSeconds };
    });

    const prevWeekPickupBars = Array.from({ length: 7 }, (_value, index) => {
        const date = new Date(prevSunday);
        date.setDate(prevSunday.getDate() + index);
        const dayKey = getDateKeyFromDate(date);
        const pickups = normalizePickupMap(pickupsByDay[dayKey] || {});
        const totalCount = Object.values(pickups).reduce((sum, c) => sum + c, 0);
        return { dayKey, totalCount };
    });

    return {
        bars,
        legend,
        weekTotalSeconds,
        defaultList,
        weekLabel,
        prevWeekBars,
        pickups: {
            daily: pickupDaily,
            total: pickupTotal,
            topSites: pickupTopSites,
            legend: pickupLegend,
            prevWeekDaily: prevWeekPickupBars
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
            return;
        }
    }

    activeSessions.set(windowId, {
        tabId: tab.id,
        siteKey,
        startedAt: Date.now()
    });

    hostnameSessionMap.set(siteKey, windowId);
    await persistSessions();
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

    const rawElapsed = Math.max(0, Math.round((Date.now() - session.startedAt) / 1000));
    const elapsedSeconds = rawElapsed <= MAX_PLAUSIBLE_INTERVAL_SECONDS ? rawElapsed : 0; // discard implausibly long intervals (system was likely asleep)
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

    await persistSessions();
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

async function seedTabUrls() {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
        if (typeof tab.id === 'number') {
            tabLastUrl.set(tab.id, tab.url || '');
        }
    });
    await persistSessions();
}

async function handleTabNavigation(tabId, tab) {
    if (!tab?.url) {
        return;
    }

    const settings = await getSettings();
    if (!(await isTrackedWindow(tab, settings))) {
        tabLastUrl.set(tabId, tab.url);
        await persistSessions();
        return;
    }

    if (!tab.active) {
        tabLastUrl.set(tabId, tab.url);
        await persistSessions();
        return;
    }

    const currentParsed = safeParseUrl(tab.url);
    const previousUrl = tabLastUrl.get(tabId) || '';
    tabLastUrl.set(tabId, tab.url);
    await persistSessions();

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

async function clearDayUsage(dayKey, pinAttempt) {
    if (!dayKey || typeof dayKey !== 'string') {
        throw new Error('Invalid day key.');
    }
    await requireSettingsAuthorization(typeof pinAttempt === 'string' ? pinAttempt.trim() : '');
    const store = await chrome.storage.local.get(['usageByDay', 'pickupsByDay']);
    const usageByDay = store.usageByDay || {};
    const pickupsByDay = store.pickupsByDay || {};
    delete usageByDay[dayKey];
    delete pickupsByDay[dayKey];
    await chrome.storage.local.set({ usageByDay, pickupsByDay });
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
