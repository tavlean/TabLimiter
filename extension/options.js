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
let currentView = 'main'; // 'main' or 'settings'

// Update progress bar color based on percentage
const updateProgressBarColor = (progressEl, percentage) => {
    // Remove all existing color classes
    progressEl.classList.remove('purple', 'blue', 'green', 'yellow', 'orange', 'red');
    
    // Add appropriate color class based on percentage ranges
    if (percentage <= 20) {
        progressEl.classList.add('purple');
    } else if (percentage <= 40) {
        progressEl.classList.add('blue');
    } else if (percentage <= 60) {
        progressEl.classList.add('green');
    } else if (percentage <= 75) {
        progressEl.classList.add('yellow');
    } else if (percentage <= 90) {
        progressEl.classList.add('orange');
    } else {
        progressEl.classList.add('red');
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
            globalOpenEl.textContent = `${globalOpen} open`;
        }
        
        if (globalLeftEl) {
            globalLeftEl.textContent = `${globalLeft} left`;
        }
        
        if (globalProgressEl) {
            const globalProgress = Math.min(100, (globalOpen / options.maxTotal) * 100);
            globalProgressEl.style.width = `${globalProgress}%`;
            updateProgressBarColor(globalProgressEl, globalProgress);
        }
        
        if (windowOpenEl) {
            windowOpenEl.textContent = `${windowOpen} open`;
        }
        
        if (windowLeftEl) {
            windowLeftEl.textContent = `${windowLeft} left`;
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
    const mainView = document.getElementById('mainView');
    const settingsView = document.getElementById('settingsView');
    const settingsToggle = document.getElementById('settingsToggle');
    const settingsIcon = settingsToggle.querySelector('.settings-icon');
    const subtitle = document.getElementById('subtitle');
    
    if (currentView === 'main') {
        // Switch to settings view
        mainView.classList.add('hidden');
        settingsView.classList.remove('hidden');
        settingsToggle.setAttribute('aria-expanded', 'true');
        settingsToggle.setAttribute('aria-label', 'Close settings');
        
        // Show subtitle
        if (subtitle) {
            subtitle.classList.remove('hidden');
        }
        
        // Change icon to X/close
        settingsIcon.innerHTML = `
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
        `;
        settingsIcon.setAttribute('viewBox', '0 0 24 24');
        
        currentView = 'settings';
    } else {
        // Switch to main view
        settingsView.classList.add('hidden');
        mainView.classList.remove('hidden');
        settingsToggle.setAttribute('aria-expanded', 'false');
        settingsToggle.setAttribute('aria-label', 'Toggle settings');
        
        // Hide subtitle
        if (subtitle) {
            subtitle.classList.add('hidden');
        }
        
        // Change icon back to settings gear
        settingsIcon.innerHTML = `
            <path d="M16.1603 7.0411L14.8823 6.4021C14.7813 6.0951 14.6553 5.8001 14.5113 5.5151L14.9643 4.1561C15.2166 3.40119 14.4814 2.89121 14.0163 2.4261C13.3785 1.78597 12.3283 2.40559 11.6333 2.6371C11.3483 2.4931 11.0533 2.3681 10.7463 2.2661L10.1073 0.988096C9.75015 0.276005 8.87127 0.435096 8.21225 0.435096C7.30922 0.435096 7.00602 1.61055 6.67825 2.2661C6.37125 2.3671 6.07625 2.4931 5.79125 2.6371L4.43125 2.1841C3.6765 1.93181 3.16624 2.6681 2.70125 3.1331C2.06267 3.77168 2.68152 4.81989 2.91325 5.5151C2.76925 5.8001 2.64425 6.0951 2.54225 6.4021L1.26425 7.0411C0.55169 7.39633 0.711251 8.27823 0.711251 8.9361C0.711251 9.83913 1.88671 10.1423 2.54225 10.4701C2.64325 10.7771 2.76925 11.0721 2.91325 11.3571L2.46025 12.7161C2.20792 13.471 2.94314 13.981 3.40825 14.4461C4.05543 15.0967 5.10796 14.4627 5.79125 14.2351C6.07625 14.3791 6.37125 14.5041 6.67825 14.6061L7.31725 15.8841C7.67435 16.5962 8.55323 16.4371 9.21225 16.4371C10.1153 16.4371 10.4185 15.2616 10.7463 14.6061C11.0533 14.5051 11.3483 14.3791 11.6333 14.2351L12.9933 14.6881C13.7428 14.9403 14.2603 14.2021 14.7233 13.7391C15.3618 13.1005 14.743 12.0523 14.5113 11.3571C14.6553 11.0721 14.7803 10.7771 14.8823 10.4701L16.1603 9.8311C16.9899 9.4175 16.9872 7.45581 16.1603 7.0411ZM8.71325 11.4361C7.05625 11.4361 5.71325 10.0931 5.71325 8.4361C5.71325 6.7791 7.05625 5.4361 8.71325 5.4361C10.3703 5.4361 11.7133 6.7791 11.7133 8.4361C11.7133 10.0931 10.3703 11.4361 8.71325 11.4361Z"/>
        `;
        settingsIcon.setAttribute('viewBox', '0 0 24 24');
        
        currentView = 'main';
    }
    
    // Save current view to storage
    browserRef.storage.sync.set({ optionsView: currentView });
};

// Load saved view preference
const loadViewPreference = () => {
    browserRef.storage.sync.get(['optionsView'], (result) => {
        if (result.optionsView === 'settings') {
            toggleView();
        } else {
            // Ensure subtitle is hidden in main view
            const subtitle = document.getElementById('subtitle');
            if (subtitle) {
                subtitle.classList.add('hidden');
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
    loadViewPreference(); // Load saved view preference

    // Settings toggle functionality
    const settingsToggle = document.getElementById('settingsToggle');
    if (settingsToggle) {
        settingsToggle.addEventListener('click', toggleView);
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
