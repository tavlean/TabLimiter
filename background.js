const tabQuery = (options, params = {}) =>
    new Promise((res) => {
        if (!options.countPinnedTabs) params.pinned = false; // only non-pinned tabs
        chrome.tabs.query(params, (tabs) => res(tabs));
    });

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

const displayAlert = (options, place) =>
    new Promise((res) => {
        if (!options.displayAlert) {
            return res(false);
        }

        const replacer = (match, p1) => {
            switch (p1) {
                case "place":
                case "which": // backwards compatibility
                    return place === "window" ? "one window" : "total";
                    break;

                case "maxPlace":
                case "maxWhich": // backwards compatibility
                    return options["max" + capitalizeFirstLetter(place)];
                    break;

                default:
                    return options[p1] || "?";
            }
        };

        const renderedMessage = options.alertMessage.replace(/{\s*(\S+)\s*}/g, replacer);

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
const handleExceedTabs = (tab, options, place) => {
    console.log(place);
    if (options.exceedTabNewWindow && place === "window") {
        chrome.windows.create({ tabId: tab.id, focused: true });
    } else {
        chrome.tabs.remove(tab.id);
    }
};

const handleTabCreated = async (tab) => {
    return getOptions().then((options) => {
        return Promise.race([detectTooManyTabsInWindow(options), detectTooManyTabsInTotal(options)])
            .then((place) => {
                console.log("Tab creation detected, checking limits...");
                displayAlert(options, place); // alert about opening too many tabs

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
            exceedTabNewWindow: false,
            displayAlert: true,
            countPinnedTabs: false,
            displayBadge: false,
            alertMessage: "The limit is {maxPlace} tabs in {place}",
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
