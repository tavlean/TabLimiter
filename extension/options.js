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

        // Update displays
        const globalCountEl = document.getElementById("globalTabCount");
        const windowCountEl = document.getElementById("windowTabCount");
        
        if (globalCountEl) {
            globalCountEl.textContent = `${globalOpen} open, ${globalLeft} left`;
        }
        
        if (windowCountEl) {
            windowCountEl.textContent = `${windowOpen} open, ${windowLeft} left`;
        }
    } catch (error) {
        console.error("Error updating tab counts:", error);
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

    browserRef.storage.sync.set(options, () => {
        // Update status to let user know options were saved.
        const status = document.getElementById("status");
        if (status) {
            status.className = "notice";
            status.textContent = "Options saved.";
            setTimeout(() => {
                status.className += " invisible";
            }, 100);
        }

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
