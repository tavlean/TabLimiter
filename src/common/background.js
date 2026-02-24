const tabQuery = (options, params = {}) =>
    new Promise((res) => {
        if (!options.countPinnedTabs) params.pinned = false; // only non-pinned tabs
        chrome.tabs.query(params, (tabs) => res(tabs));
    });

const windowRemaining = (options) =>
    tabQuery(options, { currentWindow: true }).then((tabs) => options.maxWindow - tabs.length);

const totalRemaining = (options) =>
    tabQuery(options).then((tabs) => options.maxTotal - tabs.length);

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

    Promise.all([windowRemaining(options), totalRemaining(options)]).then((remaining) => {
        // console.log(remaining)
        // remaining = [remainingInWindow, remainingInTotal]
        chrome.action.setBadgeText({
            text: Math.min(...remaining).toString(),
        });
    });
};

// ----------------------------------------------------------------------------

const detectTooManyTabsInWindow = async (options) => {
    const maxWindow = normalizeNumber(options.maxWindow, 20);
    const tabs = await tabQuery(options, { currentWindow: true });
    return tabs.length > maxWindow ? "window" : null;
};

const detectTooManyTabsInTotal = async (options) => {
    const maxTotal = normalizeNumber(options.maxTotal, 50);
    const tabs = await tabQuery(options);
    return tabs.length > maxTotal ? "total" : null;
};

const detectTooManyTabsInDomain = async (options, tab) => {
    if (!options.enableDomainLimit) {
        return null;
    }

    const maxDomain = normalizeNumber(options.maxDomain, 10);
    const domain = getDomainFromUrl(tab && tab.url);
    if (!domain) {
        return null;
    }

    const tabs = await tabQuery(options);
    let domainCount = 0;

    for (const openTab of tabs) {
        if (getDomainFromUrl(openTab.url) === domain) {
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
        (await detectTooManyTabsInWindow(options))
    );
};

// get user options from storage
const getOptions = () =>
    new Promise((res) => {
        chrome.storage.sync.get("defaultOptions", (defaults) => {
            chrome.storage.sync.get(defaults.defaultOptions, (options) => {
                // console.log(options);
                res(options);
            });
        });
    });

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

// For Manifest V3 service worker, we need to track state differently
// We'll use a simple approach without global state since service workers are ephemeral

// Handle tab creation with Manifest V3 service worker
const handleExceedTabs = async (tab, options, place) => {
    // CRITICAL: Always check total tab limit first
    const totalTabs = await tabQuery(options);
    const maxTotal = normalizeNumber(options.maxTotal, 50);
    if (totalTabs.length > maxTotal) {
        // Total limit would be exceeded, close the tab and show alert
        chrome.tabs.remove(tab.id);
        displayAlert(options, "total", false);
        return;
    }

    if (place === "domain") {
        chrome.tabs.remove(tab.id);
        displayAlert(options, "domain", false);
        return;
    }

    if (options.exceedTabNewWindow && place === "window") {
        try {
            // Find all windows and their tab counts
            const windows = await new Promise((resolve) =>
                chrome.windows.getAll({ populate: true }, resolve)
            );

            let bestWindow = null;
            let maxRemainingCapacity = 0;

            // Find existing window with most available capacity
            for (const window of windows) {
                const windowTabs = window.tabs.filter((tab) =>
                    options.countPinnedTabs ? true : !tab.pinned
                );
                const remainingCapacity = options.maxWindow - windowTabs.length;

                if (remainingCapacity > maxRemainingCapacity) {
                    maxRemainingCapacity = remainingCapacity;
                    bestWindow = window;
                }
            }

            // Double-check total limit before proceeding
            const currentTotalTabs = await tabQuery(options);
            if (currentTotalTabs.length > normalizeNumber(options.maxTotal, 50)) {
                chrome.tabs.remove(tab.id);
                displayAlert(options, "total", false);
                return;
            }

            let movedToOtherWindow = false;

            if (bestWindow && maxRemainingCapacity > 0) {
                // Move tab to the best existing window
                await chrome.tabs.move(tab.id, { windowId: bestWindow.id, index: -1 });
                // Ensure the window is focused
                await chrome.windows.update(bestWindow.id, { focused: true });
                movedToOtherWindow = true;
            } else {
                // All windows are at capacity, create new one
                chrome.windows.create({ tabId: tab.id, focused: true });
                movedToOtherWindow = true;
            }

            // Show alert with "Opened in other window" message
            displayAlert(options, place, movedToOtherWindow);
        } catch (error) {
            console.error("Error in handleExceedTabs:", error);
            // Fallback to original behavior on error
            chrome.tabs.remove(tab.id);
            displayAlert(options, place, false);
        }
    } else {
        chrome.tabs.remove(tab.id);
        displayAlert(options, place, false);
    }
};

const handleTabCreated = async (tab) => {
    try {
        const options = await getOptions();
        const initialExceededPlace = await detectExceededLimit(options, tab);

        if (!initialExceededPlace) {
            return;
        }

        // Recheck shortly after creation to reduce races while the tab settles.
        setTimeout(async () => {
            try {
                const latestOptions = await getOptions();
                const exceededPlace = await detectExceededLimit(latestOptions, tab);

                if (exceededPlace) {
                    await handleExceedTabs(tab, latestOptions, exceededPlace);
                    updateBadge(latestOptions);
                }
            } catch (error) {
                console.error("Error rechecking tab limits after creation:", error);
            }
        }, 100);
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
            enableDomainLimit: false,
            topDomainsCount: 5,
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

chrome.tabs.onRemoved.addListener(() => {
    getOptions().then(updateBadge);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    getOptions()
        .then(async (options) => {
            updateBadge(options);

            const urlChanged =
                changeInfo && Object.prototype.hasOwnProperty.call(changeInfo, "url");
            const pinnedChanged =
                changeInfo && Object.prototype.hasOwnProperty.call(changeInfo, "pinned");

            if (!urlChanged && !pinnedChanged) {
                return;
            }

            const exceededPlace = await detectExceededLimit(options, tab);
            if (exceededPlace) {
                await handleExceedTabs(tab, options, exceededPlace);
                updateBadge(options);
            }
        })
        .catch((error) => console.error("Error handling tab update:", error));
});

chrome.windows.onFocusChanged.addListener(() => {
    getOptions().then(updateBadge);
});

// Handle messages from options page
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "updateBadge") {
        updateBadge(request.options);
    }
});

// Initialize on service worker startup
init();
// Initialize badge on startup by getting options first
getOptions().then(updateBadge);

function capitalizeFirstLetter(string) {
    return string[0].toUpperCase() + string.slice(1);
}
