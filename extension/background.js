const tabQuery = (options, params = {}) =>
    new Promise((res) => {
        if (!options.countPinnedTabs) params.pinned = false; // only non-pinned tabs
        chrome.tabs.query(params, (tabs) => res(tabs));
    });

// Domain extraction and tracking utilities
const extractDomainFromUrl = (url) => {
    try {
        // Handle special cases first
        if (!url || typeof url !== "string") {
            return "unknown";
        }

        // Handle chrome:// and extension URLs
        if (
            url.startsWith("chrome://") ||
            url.startsWith("chrome-extension://") ||
            url.startsWith("moz-extension://")
        ) {
            return "system";
        }

        // Handle data: and blob: URLs
        if (url.startsWith("data:") || url.startsWith("blob:")) {
            return "data";
        }

        // Handle file:// URLs
        if (url.startsWith("file://")) {
            return "file";
        }

        // Parse the URL
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;

        // Handle localhost and IP addresses
        if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
            return "localhost";
        }

        // Check if it's an IP address (IPv4)
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (ipv4Regex.test(hostname)) {
            return hostname; // Return IP as-is
        }

        // Check if it's an IPv6 address (enclosed in brackets)
        if (hostname.startsWith("[") && hostname.endsWith("]")) {
            return hostname; // Return IPv6 as-is
        }

        // Remove www. prefix if present
        if (hostname.startsWith("www.")) {
            hostname = hostname.substring(4);
        }

        // Return the cleaned hostname
        return hostname || "unknown";
    } catch (error) {
        console.warn("Error extracting domain from URL:", url, error);
        return "unknown";
    }
};

const getDomainCounts = async (options) => {
    try {
        const tabs = await tabQuery(options);
        const domainCounts = new Map();

        tabs.forEach((tab) => {
            const domain = extractDomainFromUrl(tab.url);
            const currentCount = domainCounts.get(domain) || 0;
            domainCounts.set(domain, currentCount + 1);
        });

        return domainCounts;
    } catch (error) {
        console.error("Error getting domain counts:", error);
        return new Map();
    }
};

const getDomainInfo = async (domain, options) => {
    try {
        const domainCounts = await getDomainCounts(options);
        const tabCount = domainCounts.get(domain) || 0;
        const limit = options.maxDomain || 10;
        const remaining = Math.max(0, limit - tabCount);
        const percentage = Math.min(100, (tabCount / limit) * 100);

        return {
            domain,
            tabCount,
            remaining,
            limit,
            percentage,
        };
    } catch (error) {
        console.error("Error getting domain info:", error);
        return {
            domain,
            tabCount: 0,
            remaining: options.maxDomain || 10,
            limit: options.maxDomain || 10,
            percentage: 0,
        };
    }
};

const getCurrentDomainInfo = async (options) => {
    try {
        const [activeTab] = await new Promise((resolve) =>
            chrome.tabs.query({ active: true, currentWindow: true }, resolve)
        );

        if (!activeTab) {
            return null;
        }

        const domain = extractDomainFromUrl(activeTab.url);
        return await getDomainInfo(domain, options);
    } catch (error) {
        console.error("Error getting current domain info:", error);
        return null;
    }
};

const getTopDomains = async (options, limit = 5) => {
    try {
        const domainCounts = await getDomainCounts(options);

        // Convert to array and sort by count (descending)
        const sortedDomains = Array.from(domainCounts.entries())
            .map(([domain, tabCount]) => ({
                domain,
                tabCount,
                remaining: Math.max(0, (options.maxDomain || 10) - tabCount),
                limit: options.maxDomain || 10,
                percentage: Math.min(100, (tabCount / (options.maxDomain || 10)) * 100),
            }))
            .sort((a, b) => b.tabCount - a.tabCount)
            .slice(0, limit);

        return sortedDomains;
    } catch (error) {
        console.error("Error getting top domains:", error);
        return [];
    }
};

const windowRemaining = (options) =>
    tabQuery(options, { currentWindow: true }).then((tabs) => options.maxWindow - tabs.length);

const totalRemaining = (options) =>
    tabQuery(options).then((tabs) => options.maxTotal - tabs.length);

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

// only resolves if there are too many tabs
const detectTooManyTabsInWindow = (options) =>
    new Promise((res) => {
        tabQuery(options, { currentWindow: true }).then((tabs) => {
            // Minimum of 1 allowed tab to prevent breaking browser
            if (options.maxWindow < 1) return;
            if (tabs.length > options.maxWindow) res("window");
        });
    });

// only resolves if there are too many tabs
const detectTooManyTabsInTotal = (options) =>
    new Promise((res) => {
        tabQuery(options).then((tabs) => {
            // Minimum of 1 allowed tab to prevent breaking browser
            if (options.maxTotal < 1) return;
            if (tabs.length > options.maxTotal) res("total");
        });
    });

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

// Domain limit storage helper functions
const getDomainLimit = async (domain = null) => {
    try {
        const options = await getOptions();
        // For now, return the global domain limit
        // Future enhancement: support per-domain limits from options.domainLimits[domain]
        return options.maxDomain || 10;
    } catch (error) {
        console.error("Error getting domain limit:", error);
        return 10; // Default fallback
    }
};

const setDomainLimit = async (limit) => {
    try {
        if (typeof limit !== "number" || limit < 1 || limit > 50) {
            throw new Error("Domain limit must be a number between 1 and 50");
        }

        await new Promise((resolve, reject) => {
            chrome.storage.sync.set({ maxDomain: limit }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });

        // Update badge after changing domain limit
        const options = await getOptions();
        updateBadge(options);
    } catch (error) {
        console.error("Error setting domain limit:", error);
        throw error;
    }
};

const isDomainLimitExceeded = async (domain) => {
    try {
        const options = await getOptions();
        const domainInfo = await getDomainInfo(domain, options);
        return domainInfo.tabCount >= domainInfo.limit;
    } catch (error) {
        console.error("Error checking domain limit:", error);
        return false; // Default to not exceeded on error
    }
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
                    return place === "window" ? "one window" : "total";

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
            iconUrl: "icons/icon48.png",
            title: "Tab Limiter",
            message: renderedMessage,
        });
    });

// For Manifest V3 service worker, we need to track state differently
// We'll use a simple approach without global state since service workers are ephemeral

// resolves amount of tabs created based on current tab count
const getTabCount = () => new Promise((res) => chrome.tabs.query({}, (tabs) => res(tabs.length)));

// Handle tab creation with Manifest V3 service worker
const handleExceedTabs = async (tab, options, place) => {
    console.log(place);

    // CRITICAL: Always check total tab limit first
    const totalTabs = await tabQuery(options);
    if (totalTabs.length >= options.maxTotal) {
        // Total limit would be exceeded, close the tab and show alert
        chrome.tabs.remove(tab.id);
        displayAlert(options, "total", false);
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
            if (currentTotalTabs.length >= options.maxTotal) {
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
    return getOptions().then((options) => {
        return Promise.race([detectTooManyTabsInWindow(options), detectTooManyTabsInTotal(options)])
            .then(() => {
                console.log("Tab creation detected, checking limits...");

                // For Manifest V3, we simplify the logic since service workers are ephemeral
                // We'll just handle the immediate tab creation without complex state tracking
                setTimeout(() => {
                    // Recheck tab limits after a short delay to handle race conditions
                    Promise.race([
                        detectTooManyTabsInWindow(options),
                        detectTooManyTabsInTotal(options),
                    ]).then((newPlace) => {
                        if (newPlace) {
                            handleExceedTabs(tab, options, newPlace);
                            updateBadge(options);
                        }
                    });
                }, 100);
            })
            .catch((err) => console.error("Error handling tab creation:", err));
    });
};

// Initialize extension
const init = () => {
    chrome.storage.sync.set({
        defaultOptions: {
            maxTotal: 50,
            maxWindow: 20,
            maxDomain: 10,
            exceedTabNewWindow: false,
            displayAlert: true,
            countPinnedTabs: false,
            displayBadge: false,
            alertMessage: "Limit is {maxPlace} tabs in {place}",
        },
    });

    // Request notification permission if needed
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

chrome.tabs.onUpdated.addListener(() => {
    getOptions().then(updateBadge);
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
