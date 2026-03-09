'use strict';

const STORAGE_KEYS = {
    sync: ['blockedSites', 'defaultDailyLimitMinutes'],
    local: ['usageByDay']
};

const DEFAULT_SETTINGS = {
    blockedSites: ['youtube.com'],
    defaultDailyLimitMinutes: 60
};

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
                .map((value) => normalizeHostname(value))
                .filter(Boolean)
        )
    ).sort();
}

function clampMinutes(value) {
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
        return DEFAULT_SETTINGS.defaultDailyLimitMinutes;
    }

    return Math.min(720, Math.max(5, Math.round(numericValue)));
}

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

function roundSecondsToMinutes(seconds) {
    return Math.floor(seconds / 60);
}
