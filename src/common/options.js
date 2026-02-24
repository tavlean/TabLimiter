/* global chrome, browser */

// Cross-browser API alias (does not throw if `browser` is undefined)
const browserApi =
    typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
const browserRef = browserApi; // Keep old variable name compatibility

// ---------------------------------------------------------------------------
// Helpers used also by background script (kept here unchanged in spirit)

const tabQuery = (options, params = {}) =>
    new Promise((res) => {
        if (!options.countPinnedTabs) params.pinned = false; // only non-pinned tabs
        browserRef.tabs.query(params, (tabs) => res(tabs));
    });

const windowRemaining = (options) =>
    tabQuery(options, { currentWindow: true }).then((tabs) => options.maxWindow - tabs.length);

const totalRemaining = (options) =>
    tabQuery(options).then((tabs) => options.maxTotal - tabs.length);

// Badge updates are handled by the background script
const updateBadge = (options) => {
    // Send message to background script to update badge
    browserRef.runtime.sendMessage({ action: "updateBadge", options });
};

// ---------------------------------------------------------------------------

let $inputs;
let currentView = "main"; // 'main' or 'settings'
let tabCountsUpdateTimer = null;
let tabCountsUpdateInFlight = false;
let tabCountsUpdatePending = false;
const TOP_DOMAINS_LIMIT = 8;
const COUNT_RELEVANT_OPTION_IDS = new Set([
    "maxWindow",
    "maxTotal",
    "countPinnedTabs",
    "enableDomainLimit",
    "maxDomain",
]);

const getCachedInputs = () => {
    if (!$inputs) {
        $inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');
    }
    return $inputs;
};

const applyOptionsToInputs = (options) => {
    const inputs = getCachedInputs();

    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];

        if (!(input.id in options)) {
            continue;
        }

        if (input.type === "checkbox") {
            input.checked = Boolean(options[input.id]);
            continue;
        }

        // Preserve the user's in-progress edit in the active popup.
        if (document.activeElement === input) {
            continue;
        }

        input.value = options[input.id];
    }

    syncDomainFeatureVisibility(options);
    syncColoredFaviconsVisibility(options);
};

const getCurrentOptions = () =>
    new Promise((resolve) => {
        browserRef.storage.sync.get("defaultOptions", (defaults) => {
            browserRef.storage.sync.get(defaults.defaultOptions, (opts) => {
                resolve(opts);
            });
        });
    });

const getDomainFromUrl = (url) => {
    if (!url) {
        return null;
    }

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

const buildTopDomains = (tabs, maxItems) => {
    const domainCounts = new Map();

    for (const tab of tabs) {
        const domain = getDomainFromUrl(tab.url);
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

    const sortedDomains = Array.from(domainCounts.entries())
        .sort((a, b) => (b[1].count !== a[1].count ? b[1].count - a[1].count : a[0].localeCompare(b[0])))
        .map(([domain, data]) => ({ domain, count: data.count, faviconUrl: data.faviconUrl }));

    return sortedDomains.slice(0, maxItems);
};

const renderDomainList = (tabs) => {
    const domainListEl = document.getElementById("domainList");
    const domainEmptyEl = document.getElementById("domainEmptyState");

    if (!domainListEl || !domainEmptyEl) {
        return;
    }

    const topDomains = buildTopDomains(tabs, TOP_DOMAINS_LIMIT);

    domainListEl.textContent = "";

    if (topDomains.length === 0) {
        domainEmptyEl.classList.remove("hidden");
        return;
    }

    domainEmptyEl.classList.add("hidden");

    const fragment = document.createDocumentFragment();
    for (const { domain, count, faviconUrl } of topDomains) {
        const item = document.createElement("li");
        item.className = "domain-item";

        const domainLabel = document.createElement("span");
        domainLabel.className = "domain-label";

        const favicon = document.createElement("img");
        favicon.className = "domain-favicon";
        favicon.alt = "";
        favicon.width = 16;
        favicon.height = 16;
        favicon.src = faviconUrl || "assets/domain.svg";

        favicon.addEventListener("error", () => {
            if (favicon.dataset.fallbackApplied === "true") {
                return;
            }
            favicon.dataset.fallbackApplied = "true";
            favicon.src = "assets/domain.svg";
        });

        const domainName = document.createElement("span");
        domainName.className = "domain-name";
        domainName.textContent = domain;
        domainName.title = domain;

        const countBadge = document.createElement("span");
        countBadge.className = "count-badge domain-list-badge";
        countBadge.textContent = count;

        domainLabel.append(favicon, domainName);
        item.append(domainLabel, countBadge);
        fragment.append(item);
    }

    domainListEl.append(fragment);
};

const syncDomainFeatureVisibility = (partialOptions = {}) => {
    const enabledInput = document.getElementById("enableDomainLimit");
    const domainInput = document.getElementById("maxDomain");
    const domainStepperGroup = document.getElementById("domainStepperGroup");
    const domainStepperContainer = document.getElementById("domainStepperContainer");

    if (!domainInput) {
        return;
    }

    const isEnabled =
        "enableDomainLimit" in partialOptions
            ? Boolean(partialOptions.enableDomainLimit)
            : Boolean(enabledInput && enabledInput.checked);

    domainInput.disabled = !isEnabled;

    const domainStepperButtons = document.querySelectorAll('.stepper-btn[data-input="maxDomain"]');
    for (let i = 0; i < domainStepperButtons.length; i++) {
        domainStepperButtons[i].disabled = !isEnabled;
    }

    if (domainStepperGroup) {
        domainStepperGroup.classList.toggle("is-disabled", !isEnabled);
    }

    if (domainStepperContainer) {
        domainStepperContainer.classList.toggle("is-disabled", !isEnabled);
    }
};

const syncColoredFaviconsVisibility = (partialOptions = {}) => {
    const coloredFaviconsInput = document.getElementById("coloredFavicons");
    const isEnabled =
        "coloredFavicons" in partialOptions
            ? Boolean(partialOptions.coloredFavicons)
            : coloredFaviconsInput
              ? coloredFaviconsInput.checked
              : false;

    document.body.classList.toggle("colored-favicons-enabled", isEnabled);
};

const runTabCountsUpdate = async () => {
    if (tabCountsUpdateInFlight) {
        tabCountsUpdatePending = true;
        return;
    }

    tabCountsUpdateInFlight = true;
    tabCountsUpdatePending = false;

    try {
        await updateTabCounts();
    } finally {
        tabCountsUpdateInFlight = false;

        if (tabCountsUpdatePending) {
            tabCountsUpdatePending = false;
            scheduleTabCountsUpdate(75);
        }
    }
};

const scheduleTabCountsUpdate = (delay = 100) => {
    if (tabCountsUpdateTimer) {
        clearTimeout(tabCountsUpdateTimer);
    }

    tabCountsUpdateTimer = setTimeout(() => {
        tabCountsUpdateTimer = null;
        runTabCountsUpdate();
    }, delay);
};

// Update progress bar color based on percentage
const updateProgressBarColor = (progressEl, percentage) => {
    // Remove all existing color classes
    progressEl.classList.remove("purple", "blue", "green", "yellow", "orange", "red");

    // Add appropriate color class based on percentage ranges
    if (percentage <= 25) {
        progressEl.classList.add("purple");
    } else if (percentage <= 45) {
        progressEl.classList.add("blue");
    } else if (percentage <= 70) {
        progressEl.classList.add("green");
    } else if (percentage <= 85) {
        progressEl.classList.add("yellow");
    } else if (percentage < 100) {
        progressEl.classList.add("orange");
    } else {
        progressEl.classList.add("red");
    }
};

// Update tab count displays
const updateTabCounts = async () => {
    try {
        const options = await getCurrentOptions();
        syncDomainFeatureVisibility(options);

        // Get global tab count
        const globalTabs = await tabQuery(options);
        const globalOpen = globalTabs.length;
        const globalLeft = Math.max(0, options.maxTotal - globalOpen);

        // Get current window tab count
        const windowTabs = await tabQuery(options, { currentWindow: true });
        const windowOpen = windowTabs.length;
        const windowLeft = Math.max(0, options.maxWindow - windowOpen);

        // Get window count
        const windows = await new Promise((resolve) => {
            browserRef.windows.getAll({ populate: false }, (wins) => resolve(wins));
        });
        const windowCount = windows.length;

        // Update progress bars and labels
        const globalOpenEl = document.getElementById("globalOpenCount");
        const globalLeftEl = document.getElementById("globalLeftCount");
        const globalProgressEl = document.getElementById("globalProgressFill");
        const windowOpenEl = document.getElementById("windowOpenCount");
        const windowLeftEl = document.getElementById("windowLeftCount");
        const windowProgressEl = document.getElementById("windowProgressFill");
        const windowBadgeEl = document.getElementById("windowCountBadge");

        if (globalOpenEl) {
            globalOpenEl.textContent = globalOpen;
        }

        if (globalLeftEl) {
            globalLeftEl.textContent = globalLeft;
        }

        if (globalProgressEl) {
            const globalProgress = Math.min(100, (globalOpen / options.maxTotal) * 100);
            globalProgressEl.style.width = `${globalProgress}%`;
            updateProgressBarColor(globalProgressEl, globalProgress);
        }

        if (windowOpenEl) {
            windowOpenEl.textContent = windowOpen;
        }

        if (windowLeftEl) {
            windowLeftEl.textContent = windowLeft;
        }

        if (windowProgressEl) {
            const windowProgress = Math.min(100, (windowOpen / options.maxWindow) * 100);
            windowProgressEl.style.width = `${windowProgress}%`;
            updateProgressBarColor(windowProgressEl, windowProgress);
        }

        if (windowBadgeEl) {
            windowBadgeEl.textContent = windowCount;
        }

        renderDomainList(globalTabs);
    } catch (error) {
        console.error("Error updating tab counts:", error);
    }
};

// Toggle between main view and settings view
const toggleView = () => {
    const mainView = document.getElementById("mainView");
    const settingsView = document.getElementById("settingsView");
    const settingsToggle = document.getElementById("settingsToggle");
    const settingsIcon = settingsToggle.querySelector(".settings-icon");
    const subtitle = document.getElementById("subtitle");

    if (currentView === "main") {
        // Switch to settings view
        mainView.classList.add("hidden");
        settingsView.classList.remove("hidden");
        settingsToggle.setAttribute("aria-expanded", "true");
        settingsToggle.setAttribute("aria-label", "Close settings");

        // Show subtitle
        if (subtitle) {
            subtitle.classList.remove("hidden");
        }

        // Change icon to X/close
        settingsIcon.src = "assets/close.svg";
        settingsIcon.alt = "Close settings";

        currentView = "settings";
    } else {
        // Switch to main view
        settingsView.classList.add("hidden");
        mainView.classList.remove("hidden");
        settingsToggle.setAttribute("aria-expanded", "false");
        settingsToggle.setAttribute("aria-label", "Toggle settings");

        // Hide subtitle
        if (subtitle) {
            subtitle.classList.add("hidden");
        }

        // Change icon back to settings gear
        settingsIcon.src = "assets/settings.svg";
        settingsIcon.alt = "Toggle settings";

        currentView = "main";
    }

};

// Collect and save options to storage
const saveOptions = () => {
    // Collect all checkbox and number inputs
    const inputs =
        $inputs || document.querySelectorAll('input[type="checkbox"], input[type="number"]');

    const values = {};

    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const value = input.type === "checkbox" ? input.checked : input.value;
        values[input.id] = value;
    }

    const options = values;
    syncDomainFeatureVisibility(options);
    syncColoredFaviconsVisibility(options);

    browserRef.storage.sync.set(options, () => {
        updateBadge(options);
        scheduleTabCountsUpdate(0); // Coalesce UI refreshes across multiple triggers
    });
};

// Restore options from storage
const restoreOptions = () => {
    browserRef.storage.sync.get("defaultOptions", (defaults) => {
        browserRef.storage.sync.get(defaults.defaultOptions, (options) => {
            applyOptionsToInputs(options);
        });
    });
};

document.addEventListener("DOMContentLoaded", () => {
    // Cache inputs first, then restore their values
    $inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');
    syncColoredFaviconsVisibility();
    restoreOptions();
    runTabCountsUpdate(); // Update tab counts on page load

    // Settings toggle functionality
    const settingsToggle = document.getElementById("settingsToggle");
    if (settingsToggle) {
        settingsToggle.addEventListener("click", toggleView);
    }

    const enableDomainLimitInput = document.getElementById("enableDomainLimit");
    if (enableDomainLimitInput) {
        enableDomainLimitInput.addEventListener("change", () => {
            syncDomainFeatureVisibility({ enableDomainLimit: enableDomainLimitInput.checked });
            scheduleTabCountsUpdate(0);
        });
    }

    // Wire up change/keyup events for auto-save
    const onChangeInputs = document.querySelectorAll(
        'input[type="checkbox"], input[type="number"]'
    );
    const onKeyupInputs = document.querySelectorAll('input[type="number"]');

    for (let i = 0; i < onChangeInputs.length; i++) {
        onChangeInputs[i].addEventListener("change", saveOptions);
    }
    for (let i = 0; i < onKeyupInputs.length; i++) {
        onKeyupInputs[i].addEventListener("keyup", saveOptions);
    }

    // Stepper button functionality
    const stepperButtons = document.querySelectorAll(".stepper-btn");
    stepperButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const inputId = button.dataset.input;
            const action = button.dataset.action;
            const input = document.getElementById(inputId);
            const currentValue = parseInt(input.value, 10) || 1;
            const min = parseInt(input.min, 10) || 1;
            const max = parseInt(input.max, 10) || 1337;

            let newValue;
            if (action === "increment") {
                newValue = Math.min(currentValue + 1, max);
            } else {
                newValue = Math.max(currentValue - 1, min);
            }

            input.value = newValue;
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    });

    // Optional special message guard (kept from original, made safe)
    try {
        const showUntil = new Date("09-20-2020");
        const msgEl = document.querySelector(".message");
        if (msgEl && !localStorage.getItem("readMessage") && new Date() < showUntil) {
            msgEl.classList.remove("hidden");
            setTimeout(() => {
                localStorage.setItem("readMessage", "true");
            }, 2000);
        }
    } catch (e) {
        // no-op
    }

    // Keep tab/window counts current without polling.
    const addListenerIfAvailable = (eventObj, listener) => {
        if (eventObj && typeof eventObj.addListener === "function") {
            eventObj.addListener(listener);
        }
    };

    const onTabCountRelevantChange = () => {
        scheduleTabCountsUpdate();
    };

    addListenerIfAvailable(browserRef.tabs && browserRef.tabs.onCreated, onTabCountRelevantChange);
    addListenerIfAvailable(browserRef.tabs && browserRef.tabs.onRemoved, onTabCountRelevantChange);
    addListenerIfAvailable(browserRef.tabs && browserRef.tabs.onAttached, onTabCountRelevantChange);
    addListenerIfAvailable(browserRef.tabs && browserRef.tabs.onDetached, onTabCountRelevantChange);

    addListenerIfAvailable(browserRef.tabs && browserRef.tabs.onUpdated, (_, changeInfo) => {
        // Counts only change here when pinning state changes and pinned tabs are excluded.
        if (changeInfo && Object.prototype.hasOwnProperty.call(changeInfo, "pinned")) {
            scheduleTabCountsUpdate();
        }
    });

    addListenerIfAvailable(browserRef.windows && browserRef.windows.onCreated, onTabCountRelevantChange);
    addListenerIfAvailable(browserRef.windows && browserRef.windows.onRemoved, onTabCountRelevantChange);

    // Keep multiple open popups/options pages in sync.
    browserRef.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "sync") {
            return;
        }

        const inputUpdates = {};
        let shouldRefreshCounts = false;

        for (const [key, change] of Object.entries(changes)) {
            if (!change) {
                continue;
            }

            if (document.getElementById(key)) {
                inputUpdates[key] = change.newValue;
            }

            if (COUNT_RELEVANT_OPTION_IDS.has(key)) {
                shouldRefreshCounts = true;
            }
        }

        if (Object.keys(inputUpdates).length > 0) {
            applyOptionsToInputs(inputUpdates);
        }

        if (shouldRefreshCounts) {
            scheduleTabCountsUpdate(0);
        }
    });
});
