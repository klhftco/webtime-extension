'use strict';

const STORAGE_KEYS = {
    sync: ['defaultDailyLimitMinutes'],
    local: ['usageByDay']
};

const DEFAULT_SETTINGS = {
    defaultDailyLimitMinutes: 60
};

const CHART_COLORS = [
    '#bf5b31',
    '#1d6b57',
    '#8d4f9f',
    '#2f6db0',
    '#d18c2b',
    '#b4436c'
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

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
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
