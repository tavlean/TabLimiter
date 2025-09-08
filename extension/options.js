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

// Update progress bar color based on percentage
const updateProgressBarColor = (progressEl, percentage) => {
    // Remove all existing color classes
    progressEl.classList.remove("purple", "blue", "green", "yellow", "orange", "red");

    // Add appropriate color class based on percentage ranges
    if (percentage <= 20) {
        progressEl.classList.add("purple");
    } else if (percentage <= 40) {
        progressEl.classList.add("blue");
    } else if (percentage <= 60) {
        progressEl.classList.add("green");
    } else if (percentage <= 75) {
        progressEl.classList.add("yellow");
    } else if (percentage <= 90) {
        progressEl.classList.add("orange");
    } else {
        progressEl.classList.add("red");
    }
};

// Update tab count displays
const updateTabCounts = async () => {
    try {
        // Get current options
        const options = await new Promise((resolve) => {
            browserRef.storage.sync.get("defaultOptions", (defaults) => {
                browserRef.storage.sync.get(defaults.defaultOptions, (opts) => {
                    resolve(opts);
                });
            });
        });

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
        settingsIcon.src = "icons/close.svg";
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
        settingsIcon.src = "icons/settings.svg";
        settingsIcon.alt = "Toggle settings";

        currentView = "main";
    }

    // Save current view to storage
    browserRef.storage.sync.set({ optionsView: currentView });
};

// Load saved view preference
const loadViewPreference = () => {
    browserRef.storage.sync.get(["optionsView"], (result) => {
        if (result.optionsView === "settings") {
            toggleView();
        } else {
            // Ensure subtitle is hidden in main view
            const subtitle = document.getElementById("subtitle");
            if (subtitle) {
                subtitle.classList.add("hidden");
            }
        }
    });
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

    browserRef.storage.sync.set(options, () => {
        updateBadge(options);
        updateTabCounts(); // Update tab counts when options are saved
    });
};

// Restore options from storage
const restoreOptions = () => {
    // Ensure inputs are present
    if (!$inputs) {
        $inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');
    }

    browserRef.storage.sync.get("defaultOptions", (defaults) => {
        browserRef.storage.sync.get(defaults.defaultOptions, (options) => {
            for (let i = 0; i < $inputs.length; i++) {
                const input = $inputs[i];
                const valueType = input.type === "checkbox" ? "checked" : "value";
                input[valueType] = options[input.id];
            }
        });
    });
};

document.addEventListener("DOMContentLoaded", () => {
    // Cache inputs first, then restore their values
    $inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');
    restoreOptions();
    updateTabCounts(); // Update tab counts on page load
    loadViewPreference(); // Load saved view preference

    // Settings toggle functionality
    const settingsToggle = document.getElementById("settingsToggle");
    if (settingsToggle) {
        settingsToggle.addEventListener("click", toggleView);
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
            updateTabCounts(); // Update tab counts when stepper buttons are clicked
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

    // Update tab counts periodically to keep them current
    setInterval(updateTabCounts, 1000);
});
