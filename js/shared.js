'use strict';

const STORAGE_KEYS = {
    sync: ['blockedSites', 'siteLimitsByHostname', 'blockedCategories', 'categoryLimitsById'],
    local: ['usageByDay']
};

const DEFAULT_SETTINGS = {
    blockedSites: [],
    siteLimitsByHostname: {},
    blockedCategories: [],
    categoryLimitsById: {}
};

const CHART_COLORS = [
    '#bf5b31',
    '#1d6b57',
    '#8d4f9f',
    '#2f6db0',
    '#d18c2b',
    '#b4436c'
];

const CATEGORY_IDS = [
    'adult',
    'social',
    'shopping',
    'gambling',
    'sports',
    'news',
    'gaming'
];

function safeParseUrl(value) {
    try {
        return new URL(value);
    } catch (_error) {
        return null;
    }
}

function isTrackableUrl(url) {
    return url.protocol === 'http:' || url.protocol === 'https:';
}

function normalizeHostname(hostname) {
    if (typeof hostname !== 'string') {
        return '';
    }

    return hostname
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./, '');
}

function normalizeHostnames(values) {
    return Array.from(
        new Set(
            values
                .map((value) => normalizeSiteKey(value))
                .filter(Boolean)
        )
    ).sort();
}

function normalizeSiteLimits(limitMap) {
    return Object.entries(limitMap || {}).reduce((normalized, [hostname, minutes]) => {
        const cleanHostname = normalizeSiteKey(hostname);
        const cleanMinutes = clampLimitMinutes(minutes);

        if (!cleanHostname || cleanMinutes === null) {
            return normalized;
        }

        normalized[cleanHostname] = cleanMinutes;
        return normalized;
    }, {});
}

function clampLimitMinutes(value) {
    if (value === '' || value === null || typeof value === 'undefined') {
        return null;
    }

    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
        return null;
    }

    return Math.min(1440, Math.max(1, Math.round(numericValue)));
}

function normalizeCategoryId(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return '';
    }

    return CATEGORY_IDS.includes(normalized) ? normalized : '';
}

function normalizeSiteKey(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    const parsed = safeParseUrl(trimmed) || safeParseUrl(`https://${trimmed}`);
    if (!parsed) {
        return normalizeHostname(trimmed);
    }

    const hostname = normalizeHostname(parsed.hostname);
    if (!hostname) {
        return '';
    }

    const pathname = parsed.pathname
        .replace(/\/{2,}/g, '/')
        .replace(/\/$/, '');

    if (!pathname || pathname === '/') {
        return hostname;
    }

    return `${hostname}${pathname}`;
}

function buildUrlCandidates(urlValue) {
    const parsed = typeof urlValue === 'string'
        ? (safeParseUrl(urlValue) || safeParseUrl(`https://${urlValue}`))
        : urlValue;

    if (!parsed || !parsed.hostname) {
        return [];
    }

    const hostname = normalizeHostname(parsed.hostname);
    if (!hostname) {
        return [];
    }

    const pathname = (parsed.pathname || '/')
        .replace(/\/{2,}/g, '/')
        .replace(/\/$/, '');

    if (!pathname || pathname === '/') {
        return [hostname];
    }

    const segments = pathname.split('/').filter(Boolean);
    const candidates = [];

    for (let index = segments.length; index >= 1; index -= 1) {
        candidates.push(`${hostname}/${segments.slice(0, index).join('/')}`);
    }

    candidates.push(hostname);
    return candidates;
}

function getDateKeyFromDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function getDateKeyFromOffset(dayOffset) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + dayOffset);

    return getDateKeyFromDate(date);
}

function getTodayKey() {
    return getDateKeyFromOffset(0);
}

function roundSecondsToMinutes(seconds) {
    return Math.floor(seconds / 60);
}

function formatMinutes(totalMinutes) {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
        return '0m';
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (hours > 0) {
        return `${hours}h`;
    }

    return `${minutes}m`;
}

function formatSeconds(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return '0s';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];

    if (hours > 0) {
        parts.push(`${hours}h`);
    }

    if (minutes > 0 || hours > 0) {
        parts.push(`${minutes}m`);
    }

    parts.push(`${seconds}s`);
    return parts.join(' ');
}
