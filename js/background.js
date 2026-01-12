'use strict';

// Import helper scripts for service worker
importScripts('config.js', 'fn.js');

/**
 * Global variables, visible only inside background.js
 */
var counter = 0;

/**
 * Run this code every second
 */
setInterval(function () {
    getAllTabs(function (tabs) {
        dcl(tabs);
    });
    dcl(`${counter++} s since installation/reload`);
}, 1000);

/**
 * Block nasty requests using declarativeNetRequest
 * Note: In Manifest V3, blocking is done via declarativeNetRequest rules
 * This handler now just monitors and sets badge text
 */
chrome.webNavigation.onBeforeNavigate.addListener(function (details) {
    let domain, domainBlocked;
    let tabId = details.tabId;

    try {
        // Use URL API instead of DOM (service workers don't have DOM access)
        const url = new URL(details.url);
        domain = url.hostname;
        dcl('navigation - ' + domain);

        domainBlocked = DOMAINS_FORBIDDEN.indexOf(domain) >= 0;

        if (domainBlocked) {
            chrome.action.setBadgeText({
                tabId: tabId,
                text: 'XXX'
            });
            // To actually block, you'd need to set up declarativeNetRequest rules
            // For now, this just marks blocked domains with a badge
        }
    } catch (e) {
        dcl('Error parsing URL: ' + e.message);
    }
});

/**
 * Context menu
 */
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
        id: 'contextMenu',
        title: 'Chrome Extension Starter Kit',
        type: 'normal',
        contexts: ['image']
    });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'contextMenu') {
        chrome.tabs.create({
            url: 'https://www.google.com/search?&tbm=isch&q=' + encodeURI(info.srcUrl)
        });
    }
});
