const invokeChromeMethod = (apiObject, methodName, ...args) =>
    new Promise((resolve, reject) => {
        if (!apiObject || typeof apiObject[methodName] !== "function") {
            resolve(undefined);
            return;
        }

        apiObject[methodName](...args, (result) => {
            const runtimeError = chrome.runtime && chrome.runtime.lastError;
            if (runtimeError) {
                reject(new Error(runtimeError.message));
                return;
            }

            resolve(result);
        });
    });

const filterCountableTabs = (tabs, options) =>
    (tabs || []).filter((tab) => options.countPinnedTabs || !tab.pinned);

const mergeTabsById = (...tabLists) => {
    const tabsById = new Map();

    for (const tabList of tabLists) {
        for (const tab of tabList || []) {
            if (!tab || typeof tab.id !== "number") {
                continue;
            }

            const existing = tabsById.get(tab.id) || {};
            tabsById.set(tab.id, {
                ...existing,
                ...tab,
                url: tab.url || existing.url,
                pendingUrl: tab.pendingUrl || existing.pendingUrl,
                favIconUrl: tab.favIconUrl || existing.favIconUrl,
            });
        }
    }

    return Array.from(tabsById.values());
};

const queryTabs = async (queryInfo = {}) => {
    return invokeChromeMethod(chrome.tabs, "query", queryInfo);
};

const isMissingTabError = (error) =>
    Boolean(error && typeof error.message === "string" && error.message.includes("No tab with id"));

const getTabById = async (tabId) => {
    if (typeof tabId !== "number") {
        return null;
    }

    try {
        return await invokeChromeMethod(chrome.tabs, "get", tabId);
    } catch (error) {
        if (isMissingTabError(error)) {
            return null;
        }

        throw error;
    }
};

const removeTabSafely = async (tabId) => {
    if (typeof tabId !== "number") {
        return false;
    }

    try {
        await invokeChromeMethod(chrome.tabs, "remove", tabId);
        return true;
    } catch (error) {
        if (isMissingTabError(error)) {
            return false;
        }

        throw error;
    }
};

const moveTabSafely = async (tabId, moveProperties) => {
    if (typeof tabId !== "number") {
        return null;
    }

    try {
        return await invokeChromeMethod(chrome.tabs, "move", tabId, moveProperties);
    } catch (error) {
        if (isMissingTabError(error)) {
            return null;
        }

        throw error;
    }
};

const createWindowForTabSafely = async (createData) => {
    try {
        return await invokeChromeMethod(chrome.windows, "create", createData);
    } catch (error) {
        if (isMissingTabError(error)) {
            return null;
        }

        throw error;
    }
};

const getNormalWindows = async (populate) => {
    const windows = await invokeChromeMethod(chrome.windows, "getAll", {
        populate,
    });

    return (windows || []).filter((window) => !window.type || window.type === "normal");
};

const getAllCountableTabs = async (options) => {
    const [queriedTabs, windows] = await Promise.all([
        queryTabs({}),
        getNormalWindows(true),
    ]);
    const windowTabs = windows.flatMap((window) => window.tabs || []);
    return filterCountableTabs(mergeTabsById(queriedTabs, windowTabs), options);
};

const getFocusedWindowCountableTabs = async (options) => {
    const windows = await getNormalWindows(true);
    const focusedWindow = windows.find((window) => window.focused) || windows[0] || null;

    if (!focusedWindow || typeof focusedWindow.id !== "number") {
        return [];
    }

    const queriedTabs = await queryTabs({ windowId: focusedWindow.id });

    return filterCountableTabs(
        mergeTabsById(queriedTabs, focusedWindow ? focusedWindow.tabs : []),
        options,
    );
};

const getWindowCountableTabs = async (options, windowId) => {
    if (typeof windowId !== "number") {
        return getFocusedWindowCountableTabs(options);
    }

    const [queriedTabs, matchingWindow] = await Promise.all([
        queryTabs({ windowId }),
        invokeChromeMethod(chrome.windows, "get", windowId, { populate: true }).catch(() => null),
    ]);

    return filterCountableTabs(
        mergeTabsById(queriedTabs, matchingWindow ? matchingWindow.tabs : []),
        options,
    );
};

const windowRemaining = (options) =>
    getFocusedWindowCountableTabs(options).then((tabs) => options.maxWindow - tabs.length);

const totalRemaining = (options) =>
    getAllCountableTabs(options).then((tabs) => options.maxTotal - tabs.length);

const normalizeNumber = (value, fallback, min = 1, max = 9999) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const getDomainFromUrl = (url) => {
    if (!url) return null;

    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            return null;
        }

        return parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
    } catch (error) {
        return null;
    }
};

const getTabUrl = (tab) => (tab && (tab.pendingUrl || tab.url)) || null;

const buildTopDomains = (tabs, maxItems = 8) => {
    const domainCounts = new Map();

    for (const tab of tabs) {
        const domain = getDomainFromUrl(getTabUrl(tab));
        if (!domain) {
            continue;
        }

        const existing = domainCounts.get(domain);
        if (existing) {
            existing.count += 1;
            if (!existing.faviconUrl && tab.favIconUrl) {
                existing.faviconUrl = tab.favIconUrl;
            }
            continue;
        }

        domainCounts.set(domain, {
            count: 1,
            faviconUrl: tab.favIconUrl || "",
        });
    }

    return Array.from(domainCounts.entries())
        .sort((a, b) =>
            b[1].count !== a[1].count ? b[1].count - a[1].count : a[0].localeCompare(b[0]),
        )
        .slice(0, maxItems)
        .map(([domain, data]) => ({ domain, count: data.count, faviconUrl: data.faviconUrl }));
};

const getTabSnapshot = async (options) => {
    const maxTotal = normalizeNumber(options.maxTotal, 50);
    const maxWindow = normalizeNumber(options.maxWindow, 20);
    const [globalTabs, windowTabs, windows] = await Promise.all([
        getAllCountableTabs(options),
        getFocusedWindowCountableTabs(options),
        getNormalWindows(false),
    ]);

    return {
        globalOpen: globalTabs.length,
        globalLeft: Math.max(0, maxTotal - globalTabs.length),
        windowOpen: windowTabs.length,
        windowLeft: Math.max(0, maxWindow - windowTabs.length),
        windowCount: windows.length,
        topDomains: buildTopDomains(globalTabs),
    };
};

const updateBadge = (options) => {
    // Handle case when no options are provided
    if (!options) {
        getOptions().then(updateBadge);
        return;
    }

    if (!options.displayBadge) {
        chrome.action.setBadgeText({ text: "" });
        return;
    }

    Promise.all([windowRemaining(options), totalRemaining(options)])
        .then((remaining) => {
            chrome.action.setBadgeText({
                text: Math.min(...remaining).toString(),
            });
        })
        .catch((error) => {
            console.error("Error updating badge:", error);
        });
};

// ----------------------------------------------------------------------------

const detectTooManyTabsInWindow = async (options, tab) => {
    const maxWindow = normalizeNumber(options.maxWindow, 20);
    const tabs = await getWindowCountableTabs(options, tab && tab.windowId);
    return tabs.length > maxWindow ? "window" : null;
};

const detectTooManyTabsInTotal = async (options) => {
    const maxTotal = normalizeNumber(options.maxTotal, 50);
    const tabs = await getAllCountableTabs(options);
    return tabs.length > maxTotal ? "total" : null;
};

const detectTooManyTabsInDomain = async (options, tab) => {
    if (!options.enableDomainLimit) {
        return null;
    }

    const maxDomain = normalizeNumber(options.maxDomain, 10);
    const domain = getDomainFromUrl(getTabUrl(tab));
    if (!domain) {
        return null;
    }

    const tabs = await getAllCountableTabs(options);
    let domainCount = 0;

    for (const openTab of tabs) {
        if (getDomainFromUrl(getTabUrl(openTab)) === domain) {
            domainCount += 1;
            if (domainCount > maxDomain) {
                return "domain";
            }
        }
    }

    return null;
};

const detectExceededLimit = async (options, tab) => {
    return (
        (await detectTooManyTabsInTotal(options)) ||
        (await detectTooManyTabsInDomain(options, tab)) ||
        (await detectTooManyTabsInWindow(options, tab))
    );
};

// get user options from storage
const getOptions = async () => {
    const defaults = await invokeChromeMethod(chrome.storage.sync, "get", "defaultOptions");
    return invokeChromeMethod(chrome.storage.sync, "get", defaults.defaultOptions);
};

const displayAlert = (options, place, movedToOtherWindow = false) =>
    new Promise((res) => {
        if (!options.displayAlert) {
            return res(false);
        }

        const replacer = (_, p1) => {
            switch (p1) {
                case "place":
                case "which": // backwards compatibility
                    if (place === "window") return "one window";
                    if (place === "domain") return "one domain";
                    return "total";

                case "maxPlace":
                case "maxWhich": // backwards compatibility
                    return options["max" + capitalizeFirstLetter(place)];

                default:
                    return options[p1] || "?";
            }
        };

        let renderedMessage = options.alertMessage.replace(/{\s*(\S+)\s*}/g, replacer);

        // Prepend "Opened in another window" when tab is moved due to exceedTabNewWindow
        if (movedToOtherWindow && options.exceedTabNewWindow && place === "window") {
            renderedMessage = "Opened in another window. " + renderedMessage;
        }

        // Use notifications instead of alert() for Manifest V3
        chrome.notifications.create({
            type: "basic",
            iconUrl: "assets/icon48.png",
            title: "Tab Limiter",
            message: renderedMessage,
        });
    });

const pendingLimitCheckTabIds = new Set();

const scheduleTabLimitRecheck = (tabId, delay = 100) => {
    if (typeof tabId !== "number") {
        return;
    }

    pendingLimitCheckTabIds.add(tabId);

    setTimeout(async () => {
        if (!pendingLimitCheckTabIds.has(tabId)) {
            return;
        }

        try {
            const [tab, options] = await Promise.all([getTabById(tabId), getOptions()]);

            if (!tab) {
                return;
            }

            const exceededPlace = await detectExceededLimit(options, tab);
            if (exceededPlace) {
                await handleExceedTabs(tab, options, exceededPlace);
                updateBadge(options);
            }
        } catch (error) {
            console.error("Error rechecking tab limits after creation:", error);
        } finally {
            pendingLimitCheckTabIds.delete(tabId);
        }
    }, delay);
};

// For Manifest V3 service worker, we need to track state differently
// We'll use a simple approach without global state since service workers are ephemeral

// Handle tab creation with Manifest V3 service worker
const handleExceedTabs = async (tab, options, place) => {
    const tabId = tab && tab.id;

    // CRITICAL: Always check total tab limit first
    const totalTabs = await getAllCountableTabs(options);
    const maxTotal = normalizeNumber(options.maxTotal, 50);
    if (totalTabs.length > maxTotal) {
        // Total limit would be exceeded, close the tab and show alert
        if (await removeTabSafely(tabId)) {
            displayAlert(options, "total", false);
        }
        return;
    }

    if (place === "domain") {
        if (await removeTabSafely(tabId)) {
            displayAlert(options, "domain", false);
        }
        return;
    }

    if (options.exceedTabNewWindow && place === "window") {
        try {
            // Find all windows and their tab counts
            const windows = await getNormalWindows(true);

            let bestWindow = null;
            let maxRemainingCapacity = 0;

            // Find existing window with most available capacity
            for (const window of windows) {
                const windowTabs = filterCountableTabs(window.tabs, options);
                const remainingCapacity = options.maxWindow - windowTabs.length;

                if (remainingCapacity > maxRemainingCapacity) {
                    maxRemainingCapacity = remainingCapacity;
                    bestWindow = window;
                }
            }

            // Double-check total limit before proceeding
            const currentTotalTabs = await getAllCountableTabs(options);
            if (currentTotalTabs.length > normalizeNumber(options.maxTotal, 50)) {
                if (await removeTabSafely(tabId)) {
                    displayAlert(options, "total", false);
                }
                return;
            }

            let movedToOtherWindow = false;

            if (bestWindow && maxRemainingCapacity > 0) {
                // Move tab to the best existing window
                const movedTab = await moveTabSafely(tabId, { windowId: bestWindow.id, index: -1 });
                if (!movedTab) {
                    return;
                }
                // Ensure the window is focused
                await invokeChromeMethod(chrome.windows, "update", bestWindow.id, { focused: true });
                movedToOtherWindow = true;
            } else {
                // All windows are at capacity, create new one
                const createdWindow = await createWindowForTabSafely({ tabId, focused: true });
                if (!createdWindow) {
                    return;
                }
                movedToOtherWindow = true;
            }

            // Show alert with "Opened in other window" message
            displayAlert(options, place, movedToOtherWindow);
        } catch (error) {
            console.error("Error in handleExceedTabs:", error);
            // Fallback to original behavior on error
            if (await removeTabSafely(tabId)) {
                displayAlert(options, place, false);
            }
        }
    } else {
        if (await removeTabSafely(tabId)) {
            displayAlert(options, place, false);
        }
    }
};

const handleTabCreated = async (tab) => {
    try {
        const options = await getOptions();
        const initialExceededPlace = await detectExceededLimit(options, tab);

        if (!initialExceededPlace && getDomainFromUrl(getTabUrl(tab))) {
            return;
        }

        // Recheck shortly after creation so URLs and pending URLs can settle.
        scheduleTabLimitRecheck(tab.id, 150);
    } catch (err) {
        console.error("Error handling tab creation:", err);
    }
};

// Initialize extension
const init = () => {
    chrome.storage.sync.set({
        defaultOptions: {
            maxTotal: 50,
            maxWindow: 20,
            maxDomain: 10,
            exceedTabNewWindow: false,
            enableDomainLimit: true,
            coloredFavicons: false,
            displayAlert: true,
            countPinnedTabs: false,
            displayBadge: false,
            alertMessage: "Limit is {maxPlace} tabs in {place}",
        },
    });

    // Request notification permission if the API exists in this browser.
    if (
        chrome.permissions &&
        typeof chrome.permissions.contains === "function" &&
        typeof chrome.permissions.request === "function"
    ) {
        chrome.permissions.contains(
            {
                permissions: ["notifications"],
            },
            (result) => {
                if (!result) {
                    chrome.permissions.request({
                        permissions: ["notifications"],
                    });
                }
            }
        );
    }

    console.log("Tab Limiter initialized");
};

// Event listeners for Manifest V3 service worker
chrome.tabs.onCreated.addListener((tab) => {
    handleTabCreated(tab);
});

// Remove duplicate listener for onCreated - handleTabCreated already calls updateBadge

chrome.tabs.onRemoved.addListener((tabId) => {
    pendingLimitCheckTabIds.delete(tabId);
    getOptions().then(updateBadge);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    getOptions()
        .then(async (options) => {
            updateBadge(options);

            if (!pendingLimitCheckTabIds.has(tabId)) {
                return;
            }

            const limitRelevantUpdate =
                changeInfo &&
                (Object.prototype.hasOwnProperty.call(changeInfo, "url") ||
                    Object.prototype.hasOwnProperty.call(changeInfo, "status"));

            if (!limitRelevantUpdate || (!getTabUrl(tab) && changeInfo.status !== "complete")) {
                return;
            }

            pendingLimitCheckTabIds.delete(tabId);

            const exceededPlace = await detectExceededLimit(options, tab);
            if (!exceededPlace) {
                return;
            }

            await handleExceedTabs(tab, options, exceededPlace);
            updateBadge(options);
        })
        .catch((error) => console.error("Error handling tab update:", error));
});

chrome.windows.onFocusChanged.addListener(() => {
    getOptions().then(updateBadge);
});

// Handle messages from options page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateBadge") {
        updateBadge(request.options);
    }

    if (request.action === "getTabSnapshot") {
        getTabSnapshot(request.options)
            .then((snapshot) => {
                sendResponse(snapshot);
            })
            .catch((error) => {
                console.error("Error building tab snapshot:", error);
                sendResponse({ error: error.message });
            });
        return true;
    }
});

// Initialize on service worker startup
init();
// Initialize badge on startup by getting options first
getOptions().then(updateBadge);

function capitalizeFirstLetter(string) {
    return string[0].toUpperCase() + string.slice(1);
}
