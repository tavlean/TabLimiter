/* global chrome, browser */

const browserApi =
    typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;

if (!browserApi) {
    throw new Error("Browser API is unavailable.");
}

const DEFAULT_OPTIONS = {
    maxTotal: 50,
    maxWindow: 20,
    maxDomain: 10,
    exceedTabNewWindow: false,
    enableDomainLimit: true,
    coloredFavicons: false,
    displayAlert: true,
    countPinnedTabs: false,
    displayBadge: false,
    badgeDisplayMode: "remaining",
    closeStrategy: "newest",
    notificationMode: "system",
    softLimitsEnabled: false,
    softLimitWindowWarn: 16,
    softLimitWindowClose: 20,
    softLimitTotalWarn: 40,
    softLimitTotalClose: 50,
    softLimitDomainWarn: 8,
    softLimitDomainClose: 10,
    alertMessage:
        "Limit reached in {place}: {currentCount}/{maxPlace}. Strategy: {strategy}.",
    warningMessage: "Approaching {place} limit: {currentCount}/{maxPlace}.",
    domainRules: [],
    groupRules: [],
    schedulesEnabled: false,
    schedules: [],
};

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const TOP_DOMAINS_LIMIT = 12;

const state = {
    view: "main",
    options: null,
    statusSnapshot: null,
    saveTimer: null,
    isApplyingOptions: false,
    tabCountsTimer: null,
    tabCountsInFlight: false,
    tabCountsPending: false,
    openDomainCustomEditors: new Set(),
    sessionsLoaded: false,
};

const byId = (id) => document.getElementById(id);

const storageSyncGet = (keys) =>
    new Promise((resolve) => {
        browserApi.storage.sync.get(keys, (data) => resolve(data || {}));
    });

const tabQuery = (params = {}) =>
    new Promise((resolve) => {
        browserApi.tabs.query(params, (tabs) => resolve(tabs || []));
    });

const getAllWindows = () =>
    new Promise((resolve) => {
        browserApi.windows.getAll({ populate: false }, (windows) => resolve(windows || []));
    });

const runtimeSendMessage = (message) =>
    new Promise((resolve) => {
        try {
            browserApi.runtime.sendMessage(message, (response) => {
                if (browserApi.runtime.lastError) {
                    resolve({ ok: false, error: browserApi.runtime.lastError.message });
                    return;
                }
                resolve(response || { ok: false });
            });
        } catch (error) {
            resolve({ ok: false, error: error && error.message ? error.message : "Send failed" });
        }
    });

const normalizeNumber = (value, fallback, min = 1, max = 9999) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
};

const normalizeDomain = (value) => {
    if (!value || typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
        return null;
    }

    const candidate = trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");

    try {
        const parsed =
            candidate.includes("/") || candidate.includes(":")
                ? new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
                : new URL(`https://${candidate}`);

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }

        return parsed.hostname.toLowerCase().replace(/^www\./, "");
    } catch (error) {
        const stripped = candidate.replace(/^www\./, "");
        if (!/^[a-z0-9.-]+$/.test(stripped) || !stripped.includes(".")) {
            return null;
        }
        return stripped;
    }
};

const getDomainFromUrl = (url) => {
    if (!url) {
        return null;
    }

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return parsed.hostname.toLowerCase().replace(/^www\./, "");
    } catch (error) {
        return null;
    }
};

const normalizeDomainRules = (rules) => {
    if (!Array.isArray(rules)) {
        return [];
    }

    const map = new Map();

    for (const rawRule of rules) {
        if (!rawRule || typeof rawRule !== "object") {
            continue;
        }

        const domain = normalizeDomain(rawRule.domain);
        if (!domain) {
            continue;
        }

        const behavior = ["allow", "block", "custom"].includes(rawRule.behavior)
            ? rawRule.behavior
            : "custom";

        const normalized = {
            id:
                typeof rawRule.id === "string" && rawRule.id
                    ? rawRule.id
                    : `${domain}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            domain,
            behavior,
        };

        if (behavior === "custom") {
            normalized.limit = normalizeNumber(rawRule.limit, DEFAULT_OPTIONS.maxDomain, 1, 9999);
        }

        // One rule per domain, newest wins.
        map.set(domain, normalized);
    }

    return Array.from(map.values()).sort((a, b) => a.domain.localeCompare(b.domain));
};

const normalizeGroupRules = (rules) => {
    if (!Array.isArray(rules)) {
        return [];
    }

    const output = [];
    for (const rawRule of rules) {
        if (!rawRule || typeof rawRule !== "object") {
            continue;
        }

        const groupId = Number(rawRule.groupId);
        if (!Number.isInteger(groupId) || groupId < 0) {
            continue;
        }

        output.push({
            groupId,
            includeInGlobal:
                typeof rawRule.includeInGlobal === "boolean" ? rawRule.includeInGlobal : true,
            limit:
                rawRule.limit === null || rawRule.limit === ""
                    ? null
                    : normalizeNumber(rawRule.limit, DEFAULT_OPTIONS.maxWindow, 1, 9999),
            name: typeof rawRule.name === "string" ? rawRule.name : "",
            color: typeof rawRule.color === "string" ? rawRule.color : "grey",
        });
    }

    output.sort((a, b) => a.groupId - b.groupId);
    return output;
};

const parseTimeString = (value, fallbackMinutes) => {
    if (typeof value !== "string") {
        return fallbackMinutes;
    }

    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        return fallbackMinutes;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return fallbackMinutes;
    }
    return hours * 60 + minutes;
};

const toTimeString = (minutes) => {
    const clamped = Math.min(1439, Math.max(0, minutes));
    const hour = String(Math.floor(clamped / 60)).padStart(2, "0");
    const minute = String(clamped % 60).padStart(2, "0");
    return `${hour}:${minute}`;
};

const normalizeSchedule = (raw, index = 0) => {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const days = Array.isArray(raw.days)
        ? raw.days
              .map((day) => Number(day))
              .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        : [];

    if (days.length === 0) {
        return null;
    }

    return {
        id:
            typeof raw.id === "string" && raw.id
                ? raw.id
                : `schedule-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 6)}`,
        name:
            typeof raw.name === "string" && raw.name.trim()
                ? raw.name.trim()
                : `Schedule ${index + 1}`,
        days: Array.from(new Set(days)).sort((a, b) => a - b),
        start: toTimeString(parseTimeString(raw.start, 9 * 60)),
        end: toTimeString(parseTimeString(raw.end, 17 * 60)),
        maxWindow:
            raw.maxWindow === null || raw.maxWindow === ""
                ? null
                : normalizeNumber(raw.maxWindow, DEFAULT_OPTIONS.maxWindow, 1, 9999),
        maxTotal:
            raw.maxTotal === null || raw.maxTotal === ""
                ? null
                : normalizeNumber(raw.maxTotal, DEFAULT_OPTIONS.maxTotal, 1, 9999),
        maxDomain:
            raw.maxDomain === null || raw.maxDomain === ""
                ? null
                : normalizeNumber(raw.maxDomain, DEFAULT_OPTIONS.maxDomain, 1, 9999),
    };
};

const normalizeSchedules = (schedules) => {
    if (!Array.isArray(schedules)) {
        return [];
    }

    const output = [];
    for (let i = 0; i < schedules.length; i += 1) {
        const normalized = normalizeSchedule(schedules[i], i);
        if (normalized) {
            output.push(normalized);
        }
    }
    return output;
};

const sanitizeOptions = (raw) => {
    const source = raw && typeof raw === "object" ? raw : {};

    const options = {
        ...DEFAULT_OPTIONS,
        ...source,
    };

    options.maxTotal = normalizeNumber(source.maxTotal, DEFAULT_OPTIONS.maxTotal, 1, 9999);
    options.maxWindow = normalizeNumber(source.maxWindow, DEFAULT_OPTIONS.maxWindow, 1, 9999);
    options.maxDomain = normalizeNumber(source.maxDomain, DEFAULT_OPTIONS.maxDomain, 1, 9999);

    options.exceedTabNewWindow = Boolean(source.exceedTabNewWindow);
    options.enableDomainLimit =
        source.enableDomainLimit === undefined ? true : Boolean(source.enableDomainLimit);
    options.coloredFavicons = Boolean(source.coloredFavicons);
    options.displayAlert = source.displayAlert === undefined ? true : Boolean(source.displayAlert);
    options.countPinnedTabs = Boolean(source.countPinnedTabs);
    options.displayBadge = Boolean(source.displayBadge);

    options.badgeDisplayMode = ["remaining", "open", "fraction"].includes(source.badgeDisplayMode)
        ? source.badgeDisplayMode
        : DEFAULT_OPTIONS.badgeDisplayMode;

    options.closeStrategy = ["newest", "oldest", "lru"].includes(source.closeStrategy)
        ? source.closeStrategy
        : DEFAULT_OPTIONS.closeStrategy;

    options.notificationMode = ["system", "toast"].includes(source.notificationMode)
        ? source.notificationMode
        : DEFAULT_OPTIONS.notificationMode;

    options.softLimitsEnabled = Boolean(source.softLimitsEnabled);
    options.softLimitWindowClose = normalizeNumber(source.softLimitWindowClose, options.maxWindow, 1, 9999);
    options.softLimitTotalClose = normalizeNumber(source.softLimitTotalClose, options.maxTotal, 1, 9999);
    options.softLimitDomainClose = normalizeNumber(source.softLimitDomainClose, options.maxDomain, 1, 9999);

    options.softLimitWindowWarn = normalizeNumber(
        source.softLimitWindowWarn,
        Math.max(1, options.softLimitWindowClose - 1),
        1,
        options.softLimitWindowClose
    );
    options.softLimitTotalWarn = normalizeNumber(
        source.softLimitTotalWarn,
        Math.max(1, options.softLimitTotalClose - 1),
        1,
        options.softLimitTotalClose
    );
    options.softLimitDomainWarn = normalizeNumber(
        source.softLimitDomainWarn,
        Math.max(1, options.softLimitDomainClose - 1),
        1,
        options.softLimitDomainClose
    );

    options.alertMessage =
        typeof source.alertMessage === "string" && source.alertMessage.trim()
            ? source.alertMessage
            : DEFAULT_OPTIONS.alertMessage;

    options.warningMessage =
        typeof source.warningMessage === "string" && source.warningMessage.trim()
            ? source.warningMessage
            : DEFAULT_OPTIONS.warningMessage;

    options.domainRules = normalizeDomainRules(source.domainRules);
    options.groupRules = normalizeGroupRules(source.groupRules);

    options.schedulesEnabled = Boolean(source.schedulesEnabled);
    options.schedules = normalizeSchedules(source.schedules);

    return options;
};

const getStoredOptions = async () => {
    const syncData = await storageSyncGet(null);
    return sanitizeOptions(syncData);
};

const isTabCountedInWindow = (tab, options) =>
    options.countPinnedTabs ? true : !tab.pinned;

const getGroupRule = (options, groupId) =>
    options.groupRules.find((rule) => rule.groupId === groupId) || null;

const isTabIncludedInGlobal = (tab, options) => {
    if (!isTabCountedInWindow(tab, options)) {
        return false;
    }

    const groupRule = getGroupRule(options, tab.groupId);
    if (groupRule && groupRule.includeInGlobal === false) {
        return false;
    }

    return true;
};

const domainMatchesRule = (domain, ruleDomain) =>
    domain === ruleDomain || domain.endsWith(`.${ruleDomain}`);

const findDomainRule = (options, domain) => {
    if (!domain) {
        return null;
    }

    return (
        options.domainRules
            .filter((rule) => domainMatchesRule(domain, rule.domain))
            .sort((a, b) => b.domain.length - a.domain.length)[0] || null
    );
};

const getDomainLimit = (options, domain, defaultDomainLimit) => {
    const rule = findDomainRule(options, domain);
    if (rule && rule.behavior === "custom") {
        return normalizeNumber(rule.limit, defaultDomainLimit, 1, 9999);
    }

    return defaultDomainLimit;
};

const getStatusSnapshot = async () => {
    const response = await runtimeSendMessage({ action: "getStatus" });
    if (response && response.ok && response.snapshot) {
        return response.snapshot;
    }

    // Fallback for browsers where background messaging is unavailable.
    const options = state.options || (await getStoredOptions());
    const [allTabs, currentWindowTabs, windows] = await Promise.all([
        tabQuery({}),
        tabQuery({ currentWindow: true }),
        getAllWindows(),
    ]);

    const totalOpen = allTabs.filter((tab) => isTabIncludedInGlobal(tab, options)).length;
    const windowOpen = currentWindowTabs.filter((tab) => isTabCountedInWindow(tab, options)).length;

    return {
        limits: {
            maxTotal: options.maxTotal,
            maxWindow: options.maxWindow,
            maxDomain: options.maxDomain,
        },
        counts: {
            totalOpen,
            totalLeft: Math.max(0, options.maxTotal - totalOpen),
            windowOpen,
            windowLeft: Math.max(0, options.maxWindow - windowOpen),
            windowCount: windows.length,
        },
        activeSchedule: null,
    };
};

const setView = (view) => {
    state.view = view;

    const mainView = byId("mainView");
    const settingsView = byId("settingsView");
    const sessionsView = byId("sessionsView");
    const subtitle = byId("subtitle");
    const settingsToggle = byId("settingsToggle");

    if (mainView) {
        mainView.classList.toggle("hidden", view !== "main");
    }

    if (settingsView) {
        settingsView.classList.toggle("hidden", view !== "settings");
    }

    if (sessionsView) {
        sessionsView.classList.toggle("hidden", view !== "sessions");
    }

    if (subtitle) {
        subtitle.textContent = view === "settings" ? "Settings" : view === "sessions" ? "Sessions" : "Status";
    }

    if (settingsToggle) {
        settingsToggle.setAttribute("aria-expanded", view === "settings" ? "true" : "false");
        const icon = settingsToggle.querySelector(".settings-icon");
        if (icon) {
            icon.src = view === "settings" ? "assets/close.svg" : "assets/settings.svg";
            icon.alt = view === "settings" ? "Close settings" : "Settings";
        }
    }
};

const showToast = (message, level = "info", duration = 3000) => {
    const container = byId("toastContainer");
    if (!container) {
        return;
    }

    const toast = document.createElement("div");
    toast.className = `toast ${level === "warning" ? "warning" : ""}`.trim();
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
        toast.remove();
    }, duration);
};

const updateProgressBarColor = (progressEl, percentage) => {
    progressEl.classList.remove("purple", "blue", "green", "yellow", "orange", "red");

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

const setWarnMarker = (markerEl, warnThreshold, closeThreshold) => {
    if (!markerEl || !warnThreshold || !closeThreshold || warnThreshold >= closeThreshold) {
        if (markerEl) {
            markerEl.classList.remove("visible");
        }
        return;
    }

    const percentage = Math.min(100, Math.max(0, (warnThreshold / closeThreshold) * 100));
    markerEl.style.left = `${percentage}%`;
    markerEl.classList.add("visible");
};

const applyOptionsToInputs = (options) => {
    state.isApplyingOptions = true;

    const checkboxIds = [
        "enableDomainLimit",
        "displayBadge",
        "displayAlert",
        "exceedTabNewWindow",
        "countPinnedTabs",
        "coloredFavicons",
        "softLimitsEnabled",
        "schedulesEnabled",
    ];

    const numberIds = [
        "maxWindow",
        "maxTotal",
        "maxDomain",
        "softLimitWindowWarn",
        "softLimitWindowClose",
        "softLimitTotalWarn",
        "softLimitTotalClose",
        "softLimitDomainWarn",
        "softLimitDomainClose",
    ];

    const textIds = ["alertMessage", "warningMessage"];
    const selectIds = ["closeStrategy", "badgeDisplayMode", "notificationMode"];

    for (const id of checkboxIds) {
        const input = byId(id);
        if (input) {
            input.checked = Boolean(options[id]);
        }
    }

    for (const id of numberIds) {
        const input = byId(id);
        if (input) {
            input.value = options[id];
        }
    }

    for (const id of textIds) {
        const input = byId(id);
        if (input) {
            input.value = options[id] || "";
        }
    }

    for (const id of selectIds) {
        const select = byId(id);
        if (select) {
            select.value = options[id] || DEFAULT_OPTIONS[id];
        }
    }

    document.body.classList.toggle("colored-favicons-enabled", Boolean(options.coloredFavicons));

    syncDomainFeatureVisibility(options);
    syncSoftLimitsVisibility(options);
    renderDomainRuleEditor();
    renderSchedulesEditor();

    state.isApplyingOptions = false;
};

const syncDomainFeatureVisibility = (options) => {
    const domainInput = byId("maxDomain");
    const domainStepperGroup = byId("domainStepperGroup");
    const domainStepperContainer = byId("domainStepperContainer");

    const enabled = Boolean(options.enableDomainLimit);

    if (domainInput) {
        domainInput.disabled = !enabled;
    }

    document.querySelectorAll('.stepper-btn[data-input="maxDomain"]').forEach((button) => {
        button.disabled = !enabled;
    });

    if (domainStepperGroup) {
        domainStepperGroup.classList.toggle("is-disabled", !enabled);
    }

    if (domainStepperContainer) {
        domainStepperContainer.classList.toggle("is-disabled", !enabled);
    }
};

const syncSoftLimitsVisibility = (options) => {
    const enabled = Boolean(options.softLimitsEnabled);
    const ids = [
        "softLimitWindowWarn",
        "softLimitWindowClose",
        "softLimitTotalWarn",
        "softLimitTotalClose",
        "softLimitDomainWarn",
        "softLimitDomainClose",
    ];

    for (const id of ids) {
        const input = byId(id);
        if (input) {
            input.disabled = !enabled;
        }
    }
};

const collectOptionsFromInputs = () => {
    const base = state.options || DEFAULT_OPTIONS;

    const options = {
        ...base,
        maxWindow: normalizeNumber(byId("maxWindow") && byId("maxWindow").value, base.maxWindow, 1, 9999),
        maxTotal: normalizeNumber(byId("maxTotal") && byId("maxTotal").value, base.maxTotal, 1, 9999),
        maxDomain: normalizeNumber(byId("maxDomain") && byId("maxDomain").value, base.maxDomain, 1, 9999),
        enableDomainLimit: Boolean(byId("enableDomainLimit") && byId("enableDomainLimit").checked),
        displayBadge: Boolean(byId("displayBadge") && byId("displayBadge").checked),
        displayAlert: Boolean(byId("displayAlert") && byId("displayAlert").checked),
        exceedTabNewWindow: Boolean(byId("exceedTabNewWindow") && byId("exceedTabNewWindow").checked),
        countPinnedTabs: Boolean(byId("countPinnedTabs") && byId("countPinnedTabs").checked),
        coloredFavicons: Boolean(byId("coloredFavicons") && byId("coloredFavicons").checked),
        closeStrategy: byId("closeStrategy") ? byId("closeStrategy").value : base.closeStrategy,
        badgeDisplayMode: byId("badgeDisplayMode")
            ? byId("badgeDisplayMode").value
            : base.badgeDisplayMode,
        notificationMode: byId("notificationMode")
            ? byId("notificationMode").value
            : base.notificationMode,
        softLimitsEnabled: Boolean(byId("softLimitsEnabled") && byId("softLimitsEnabled").checked),
        softLimitWindowWarn: normalizeNumber(
            byId("softLimitWindowWarn") && byId("softLimitWindowWarn").value,
            base.softLimitWindowWarn,
            1,
            9999
        ),
        softLimitWindowClose: normalizeNumber(
            byId("softLimitWindowClose") && byId("softLimitWindowClose").value,
            base.softLimitWindowClose,
            1,
            9999
        ),
        softLimitTotalWarn: normalizeNumber(
            byId("softLimitTotalWarn") && byId("softLimitTotalWarn").value,
            base.softLimitTotalWarn,
            1,
            9999
        ),
        softLimitTotalClose: normalizeNumber(
            byId("softLimitTotalClose") && byId("softLimitTotalClose").value,
            base.softLimitTotalClose,
            1,
            9999
        ),
        softLimitDomainWarn: normalizeNumber(
            byId("softLimitDomainWarn") && byId("softLimitDomainWarn").value,
            base.softLimitDomainWarn,
            1,
            9999
        ),
        softLimitDomainClose: normalizeNumber(
            byId("softLimitDomainClose") && byId("softLimitDomainClose").value,
            base.softLimitDomainClose,
            1,
            9999
        ),
        schedulesEnabled: Boolean(byId("schedulesEnabled") && byId("schedulesEnabled").checked),
        alertMessage: byId("alertMessage") ? byId("alertMessage").value : base.alertMessage,
        warningMessage: byId("warningMessage") ? byId("warningMessage").value : base.warningMessage,
        domainRules: normalizeDomainRules(base.domainRules),
        groupRules: normalizeGroupRules(base.groupRules),
        schedules: normalizeSchedules(base.schedules),
    };

    return sanitizeOptions(options);
};

const saveOptionsNow = async (showSavedToast = false) => {
    state.options = collectOptionsFromInputs();

    const response = await runtimeSendMessage({
        action: "saveOptions",
        options: state.options,
    });

    if (!response || !response.ok) {
        showToast(response && response.error ? response.error : "Failed to save options.", "warning");
        return;
    }

    state.options = sanitizeOptions(response.options || state.options);
    applyOptionsToInputs(state.options);

    if (showSavedToast) {
        showToast("Settings saved");
    }

    scheduleTabCountsUpdate(0);
};

const queueSaveOptions = () => {
    if (state.isApplyingOptions) {
        return;
    }

    if (state.saveTimer) {
        clearTimeout(state.saveTimer);
    }

    state.options = collectOptionsFromInputs();

    state.saveTimer = window.setTimeout(() => {
        state.saveTimer = null;
        saveOptionsNow(false);
    }, 120);
};

const updateDuplicateBadge = async () => {
    const badge = byId("duplicatesCountBadge");
    if (!badge) {
        return;
    }

    const response = await runtimeSendMessage({ action: "scanDuplicates" });
    if (!response || !response.ok) {
        badge.textContent = "0";
        return;
    }

    badge.textContent = String(response.duplicateTabs || 0);
};

const formatFraction = (openCount, maxCount) => `${openCount}/${maxCount}`;

const updateProgressUI = ({
    progressFill,
    progressBar,
    openEl,
    leftEl,
    fractionEl,
    warnMarker,
    openCount,
    leftCount,
    maxCount,
    warnThreshold,
    ariaLabel,
}) => {
    if (!progressFill || !progressBar) {
        return;
    }

    const percentage = maxCount > 0 ? Math.min(100, (openCount / maxCount) * 100) : 0;
    progressFill.style.width = `${percentage}%`;
    updateProgressBarColor(progressFill, percentage);

    if (openEl) {
        openEl.textContent = String(openCount);
    }
    if (leftEl) {
        leftEl.textContent = String(leftCount);
    }
    if (fractionEl) {
        fractionEl.textContent = formatFraction(openCount, maxCount);
    }

    progressBar.setAttribute("aria-valuenow", String(openCount));
    progressBar.setAttribute("aria-valuemax", String(maxCount));
    progressBar.setAttribute("aria-label", ariaLabel);

    setWarnMarker(warnMarker, warnThreshold, maxCount);
};

const getGroupColorValue = (color) => {
    const map = {
        grey: "#94a3b8",
        blue: "#3b82f6",
        red: "#ef4444",
        yellow: "#f59e0b",
        green: "#10b981",
        pink: "#ec4899",
        purple: "#8b5cf6",
        cyan: "#06b6d4",
        orange: "#f97316",
    };

    return map[color] || "#94a3b8";
};

const upsertExactDomainRule = (domain, behavior, limit = null) => {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) {
        return false;
    }

    const rules = [...(state.options ? state.options.domainRules : [])];
    const existingIndex = rules.findIndex((rule) => rule.domain === normalizedDomain);

    const nextRule = {
        id:
            existingIndex >= 0 && rules[existingIndex].id
                ? rules[existingIndex].id
                : `rule-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        domain: normalizedDomain,
        behavior,
    };

    if (behavior === "custom") {
        nextRule.limit = normalizeNumber(limit, state.options.maxDomain, 1, 9999);
    }

    if (existingIndex >= 0) {
        rules[existingIndex] = nextRule;
    } else {
        rules.push(nextRule);
    }

    state.options.domainRules = normalizeDomainRules(rules);
    return true;
};

const removeExactDomainRule = (domain) => {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) {
        return;
    }

    state.options.domainRules = state.options.domainRules.filter((rule) => rule.domain !== normalizedDomain);
};

const renderDomainRuleEditor = () => {
    const container = byId("domainRulesList");
    if (!container || !state.options) {
        return;
    }

    container.textContent = "";

    if (state.options.domainRules.length === 0) {
        const empty = document.createElement("p");
        empty.className = "domain-empty";
        empty.textContent = "No exceptions yet.";
        container.appendChild(empty);
        return;
    }

    state.options.domainRules.forEach((rule, index) => {
        const row = document.createElement("div");
        row.className = "editor-row";

        const grid = document.createElement("div");
        grid.className = "editor-grid";

        const domainInput = document.createElement("input");
        domainInput.type = "text";
        domainInput.value = rule.domain;
        domainInput.placeholder = "example.com";

        const behaviorSelect = document.createElement("select");
        behaviorSelect.innerHTML = `
            <option value="allow">Allow</option>
            <option value="block">Block</option>
            <option value="custom">Custom limit</option>
        `;
        behaviorSelect.value = rule.behavior;

        const limitInput = document.createElement("input");
        limitInput.type = "number";
        limitInput.min = "1";
        limitInput.max = "9999";
        limitInput.value = rule.behavior === "custom" ? String(rule.limit || state.options.maxDomain) : "";
        limitInput.disabled = rule.behavior !== "custom";

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "icon-btn danger";
        removeButton.textContent = "Remove";

        domainInput.addEventListener("change", () => {
            const normalized = normalizeDomain(domainInput.value);
            if (!normalized) {
                domainInput.value = rule.domain;
                showToast("Invalid domain", "warning");
                return;
            }

            const current = state.options.domainRules[index];
            current.domain = normalized;
            state.options.domainRules = normalizeDomainRules(state.options.domainRules);
            saveOptionsNow();
        });

        behaviorSelect.addEventListener("change", () => {
            const current = state.options.domainRules[index];
            current.behavior = behaviorSelect.value;
            if (behaviorSelect.value === "custom") {
                current.limit = normalizeNumber(limitInput.value, state.options.maxDomain, 1, 9999);
            } else {
                delete current.limit;
            }
            state.options.domainRules = normalizeDomainRules(state.options.domainRules);
            saveOptionsNow();
        });

        limitInput.addEventListener("change", () => {
            const current = state.options.domainRules[index];
            current.limit = normalizeNumber(limitInput.value, state.options.maxDomain, 1, 9999);
            state.options.domainRules = normalizeDomainRules(state.options.domainRules);
            saveOptionsNow();
        });

        removeButton.addEventListener("click", () => {
            state.options.domainRules.splice(index, 1);
            state.options.domainRules = normalizeDomainRules(state.options.domainRules);
            saveOptionsNow();
        });

        grid.append(domainInput, behaviorSelect, limitInput, removeButton);
        row.appendChild(grid);
        container.appendChild(row);
    });
};

const renderSchedulesEditor = () => {
    const container = byId("schedulesList");
    if (!container || !state.options) {
        return;
    }

    container.textContent = "";

    if (state.options.schedules.length === 0) {
        const empty = document.createElement("p");
        empty.className = "domain-empty";
        empty.textContent = "No schedules configured.";
        container.appendChild(empty);
        return;
    }

    state.options.schedules.forEach((schedule, index) => {
        const row = document.createElement("div");
        row.className = "editor-row";

        const nameGrid = document.createElement("div");
        nameGrid.className = "editor-grid";

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = schedule.name;
        nameInput.placeholder = "Work hours";

        const startInput = document.createElement("input");
        startInput.type = "time";
        startInput.value = schedule.start;

        const endInput = document.createElement("input");
        endInput.type = "time";
        endInput.value = schedule.end;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "icon-btn danger";
        removeButton.textContent = "Remove";

        nameGrid.append(nameInput, startInput, endInput, removeButton);

        const daysRow = document.createElement("div");
        daysRow.className = "editor-days";

        DAY_LABELS.forEach((label, dayIndex) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "day-chip";
            chip.textContent = label;
            chip.classList.toggle("active", schedule.days.includes(dayIndex));

            chip.addEventListener("click", () => {
                const days = new Set(state.options.schedules[index].days);
                if (days.has(dayIndex)) {
                    days.delete(dayIndex);
                } else {
                    days.add(dayIndex);
                }

                if (days.size === 0) {
                    showToast("At least one day is required", "warning");
                    return;
                }

                state.options.schedules[index].days = Array.from(days).sort((a, b) => a - b);
                saveOptionsNow();
            });

            daysRow.appendChild(chip);
        });

        const limitGrid = document.createElement("div");
        limitGrid.className = "editor-grid";

        const maxWindowInput = document.createElement("input");
        maxWindowInput.type = "number";
        maxWindowInput.min = "1";
        maxWindowInput.max = "9999";
        maxWindowInput.value = schedule.maxWindow || "";
        maxWindowInput.placeholder = "Window";

        const maxTotalInput = document.createElement("input");
        maxTotalInput.type = "number";
        maxTotalInput.min = "1";
        maxTotalInput.max = "9999";
        maxTotalInput.value = schedule.maxTotal || "";
        maxTotalInput.placeholder = "Total";

        const maxDomainInput = document.createElement("input");
        maxDomainInput.type = "number";
        maxDomainInput.min = "1";
        maxDomainInput.max = "9999";
        maxDomainInput.value = schedule.maxDomain || "";
        maxDomainInput.placeholder = "Domain";

        const spacer = document.createElement("span");
        spacer.textContent = "";

        limitGrid.append(maxWindowInput, maxTotalInput, maxDomainInput, spacer);

        nameInput.addEventListener("change", () => {
            state.options.schedules[index].name = nameInput.value.trim() || `Schedule ${index + 1}`;
            saveOptionsNow();
        });

        startInput.addEventListener("change", () => {
            state.options.schedules[index].start = startInput.value || "09:00";
            saveOptionsNow();
        });

        endInput.addEventListener("change", () => {
            state.options.schedules[index].end = endInput.value || "17:00";
            saveOptionsNow();
        });

        const bindLimitInput = (input, key) => {
            input.addEventListener("change", () => {
                const value = input.value.trim();
                state.options.schedules[index][key] = value
                    ? normalizeNumber(value, state.options[key === "maxTotal" ? "maxTotal" : key === "maxWindow" ? "maxWindow" : "maxDomain"], 1, 9999)
                    : null;
                saveOptionsNow();
            });
        };

        bindLimitInput(maxWindowInput, "maxWindow");
        bindLimitInput(maxTotalInput, "maxTotal");
        bindLimitInput(maxDomainInput, "maxDomain");

        removeButton.addEventListener("click", () => {
            state.options.schedules.splice(index, 1);
            state.options.schedules = normalizeSchedules(state.options.schedules);
            saveOptionsNow();
        });

        row.append(nameGrid, daysRow, limitGrid);
        container.appendChild(row);
    });
};

const renderDomainList = (tabs, limits) => {
    const domainListEl = byId("domainList");
    const emptyStateEl = byId("domainEmptyState");
    if (!domainListEl || !emptyStateEl || !state.options) {
        return;
    }

    const domainMap = new Map();

    for (const tab of tabs) {
        const domain = getDomainFromUrl(tab.url);
        if (!domain) {
            continue;
        }

        if (!domainMap.has(domain)) {
            domainMap.set(domain, {
                count: 0,
                faviconUrl: tab.favIconUrl || "",
            });
        }

        const current = domainMap.get(domain);
        current.count += isTabCountedInWindow(tab, state.options) ? 1 : 0;
        if (!current.faviconUrl && tab.favIconUrl) {
            current.faviconUrl = tab.favIconUrl;
        }
    }

    const topDomains = Array.from(domainMap.entries())
        .map(([domain, info]) => ({ domain, ...info }))
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
        .slice(0, TOP_DOMAINS_LIMIT);

    domainListEl.textContent = "";

    if (topDomains.length === 0) {
        emptyStateEl.classList.remove("hidden");
        return;
    }

    emptyStateEl.classList.add("hidden");

    topDomains.forEach((item) => {
        const domain = item.domain;
        const domainRule = findDomainRule(state.options, domain);
        const domainLimit = getDomainLimit(state.options, domain, limits.maxDomain);
        const progress = Math.min(100, (item.count / domainLimit) * 100);

        const itemEl = document.createElement("li");
        itemEl.className = "domain-item";

        const row = document.createElement("div");
        row.className = "domain-row";

        const label = document.createElement("div");
        label.className = "domain-label";

        const favicon = document.createElement("img");
        favicon.className = "domain-favicon";
        favicon.alt = "";
        favicon.width = 16;
        favicon.height = 16;
        favicon.src = item.faviconUrl || "assets/domain.svg";
        favicon.addEventListener("error", () => {
            favicon.src = "assets/domain.svg";
        });

        const name = document.createElement("span");
        name.className = "domain-name";
        name.textContent = domain;
        name.title = "Close all tabs for this domain";

        name.addEventListener("click", async () => {
            const accepted = window.confirm(`Close all tabs for ${domain}?`);
            if (!accepted) {
                return;
            }

            const response = await runtimeSendMessage({ action: "closeDomainTabs", domain });
            if (!response || !response.ok) {
                showToast(response && response.error ? response.error : "Failed to close tabs", "warning");
                return;
            }

            showToast(`Closed ${response.removedCount || 0} tabs for ${domain}`);
            scheduleTabCountsUpdate(0);
        });

        label.append(favicon, name);

        const actions = document.createElement("div");
        actions.className = "domain-actions";

        const customizeButton = document.createElement("button");
        customizeButton.type = "button";
        customizeButton.className = "icon-btn";
        customizeButton.textContent = "Limit";
        customizeButton.title = "Set custom domain limit";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "icon-btn danger";
        closeButton.textContent = "x";
        closeButton.title = "Close all tabs for this domain";

        closeButton.addEventListener("click", async () => {
            const accepted = window.confirm(`Close all tabs for ${domain}?`);
            if (!accepted) {
                return;
            }

            const response = await runtimeSendMessage({ action: "closeDomainTabs", domain });
            if (!response || !response.ok) {
                showToast(response && response.error ? response.error : "Failed to close tabs", "warning");
                return;
            }

            showToast(`Closed ${response.removedCount || 0} tabs for ${domain}`);
            scheduleTabCountsUpdate(0);
        });

        customizeButton.addEventListener("click", () => {
            if (state.openDomainCustomEditors.has(domain)) {
                state.openDomainCustomEditors.delete(domain);
            } else {
                state.openDomainCustomEditors.add(domain);
            }
            scheduleTabCountsUpdate(0);
        });

        actions.append(customizeButton, closeButton);

        row.append(label, actions);

        const meta = document.createElement("div");
        meta.className = "domain-meta";

        const mini = document.createElement("div");
        mini.className = "domain-mini-progress";
        const miniFill = document.createElement("div");
        miniFill.className = "domain-mini-fill progress-fill";
        miniFill.style.width = `${progress}%`;
        updateProgressBarColor(miniFill, progress);
        mini.appendChild(miniFill);

        const metaText = document.createElement("span");
        metaText.textContent = `${item.count}/${domainLimit}`;

        const ruleTag = document.createElement("span");
        if (domainRule) {
            if (domainRule.behavior === "allow") {
                ruleTag.textContent = "Allow";
            } else if (domainRule.behavior === "block") {
                ruleTag.textContent = "Block";
            } else {
                ruleTag.textContent = "Custom";
            }
        } else {
            ruleTag.textContent = "Default";
        }

        meta.append(mini, metaText, ruleTag);

        itemEl.append(row, meta);

        if (state.openDomainCustomEditors.has(domain)) {
            const editor = document.createElement("div");
            editor.className = "domain-custom-editor";

            const limitInput = document.createElement("input");
            limitInput.type = "number";
            limitInput.min = "1";
            limitInput.max = "9999";
            limitInput.className = "inline-input";
            limitInput.value = String(domainLimit);

            const saveButton = document.createElement("button");
            saveButton.type = "button";
            saveButton.className = "icon-btn";
            saveButton.textContent = "Save";

            const resetButton = document.createElement("button");
            resetButton.type = "button";
            resetButton.className = "icon-btn";
            resetButton.textContent = "Reset";

            saveButton.addEventListener("click", () => {
                const limit = normalizeNumber(limitInput.value, state.options.maxDomain, 1, 9999);
                upsertExactDomainRule(domain, "custom", limit);
                saveOptionsNow();
            });

            resetButton.addEventListener("click", () => {
                const existing = findDomainRule(state.options, domain);
                if (existing && existing.domain === domain && existing.behavior === "custom") {
                    removeExactDomainRule(domain);
                }
                state.openDomainCustomEditors.delete(domain);
                saveOptionsNow();
            });

            editor.append(limitInput, saveButton, resetButton);
            itemEl.appendChild(editor);
        }

        domainListEl.appendChild(itemEl);
    });
};

const upsertGroupRule = (groupId, updates) => {
    const rules = [...(state.options ? state.options.groupRules : [])];
    const index = rules.findIndex((rule) => rule.groupId === groupId);

    if (index >= 0) {
        rules[index] = {
            ...rules[index],
            ...updates,
        };
    } else {
        rules.push({
            groupId,
            includeInGlobal: true,
            limit: null,
            name: `Group ${groupId}`,
            color: "grey",
            ...updates,
        });
    }

    state.options.groupRules = normalizeGroupRules(rules);
};

const renderGroupList = async (tabs, limits) => {
    const listEl = byId("groupList");
    const emptyEl = byId("groupEmptyState");
    const unavailableEl = byId("groupFeatureUnavailable");

    if (!listEl || !emptyEl || !unavailableEl || !state.options) {
        return;
    }

    listEl.textContent = "";

    if (!browserApi.tabGroups || typeof browserApi.tabGroups.get !== "function") {
        unavailableEl.classList.remove("hidden");
        emptyEl.classList.add("hidden");
        return;
    }

    unavailableEl.classList.add("hidden");

    const groupMap = new Map();

    for (const tab of tabs) {
        if (!Number.isInteger(tab.groupId) || tab.groupId < 0) {
            continue;
        }

        if (!groupMap.has(tab.groupId)) {
            groupMap.set(tab.groupId, {
                groupId: tab.groupId,
                count: 0,
            });
        }

        const groupInfo = groupMap.get(tab.groupId);
        groupInfo.count += isTabCountedInWindow(tab, state.options) ? 1 : 0;
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => b.count - a.count || a.groupId - b.groupId);

    if (groups.length === 0) {
        emptyEl.classList.remove("hidden");
        return;
    }

    emptyEl.classList.add("hidden");

    for (const group of groups) {
        const groupData = await new Promise((resolve) => {
            browserApi.tabGroups.get(group.groupId, (value) => {
                if (browserApi.runtime.lastError) {
                    resolve(null);
                    return;
                }
                resolve(value || null);
            });
        });

        const existingRule = getGroupRule(state.options, group.groupId);

        upsertGroupRule(group.groupId, {
            name: groupData && groupData.title ? groupData.title : existingRule ? existingRule.name : `Group ${group.groupId}`,
            color: groupData && groupData.color ? groupData.color : existingRule ? existingRule.color : "grey",
            includeInGlobal: existingRule ? existingRule.includeInGlobal : true,
            limit: existingRule ? existingRule.limit : null,
        });

        const finalRule = getGroupRule(state.options, group.groupId);
        const effectiveLimit =
            finalRule && finalRule.limit !== null ? finalRule.limit : limits.maxWindow;

        const itemEl = document.createElement("li");
        itemEl.className = "group-item";

        const row = document.createElement("div");
        row.className = "group-row";

        const label = document.createElement("div");
        label.className = "group-label";

        const dot = document.createElement("span");
        dot.className = "group-dot";
        dot.style.background = getGroupColorValue(finalRule.color);

        const name = document.createElement("span");
        name.className = "group-name";
        name.textContent = finalRule.name || `Group ${group.groupId}`;
        name.title = `Group ${group.groupId}`;

        label.append(dot, name);

        const countBadge = document.createElement("span");
        countBadge.className = "count-badge";
        countBadge.textContent = `${group.count}/${effectiveLimit}`;

        row.append(label, countBadge);

        const meta = document.createElement("div");
        meta.className = "group-meta";

        const includeToggleLabel = document.createElement("label");
        includeToggleLabel.className = "toggle-inline";
        const includeToggle = document.createElement("input");
        includeToggle.type = "checkbox";
        includeToggle.checked = finalRule.includeInGlobal;
        includeToggleLabel.append(includeToggle, "Count in global");

        const editor = document.createElement("div");
        editor.className = "group-editor";

        const decrement = document.createElement("button");
        decrement.type = "button";
        decrement.className = "icon-btn";
        decrement.textContent = "-";

        const limitInput = document.createElement("input");
        limitInput.type = "number";
        limitInput.min = "1";
        limitInput.max = "9999";
        limitInput.className = "inline-input";
        limitInput.value = String(effectiveLimit);

        const increment = document.createElement("button");
        increment.type = "button";
        increment.className = "icon-btn";
        increment.textContent = "+";

        const inheritButton = document.createElement("button");
        inheritButton.type = "button";
        inheritButton.className = "icon-btn";
        inheritButton.textContent = "Inherit";

        const applyGroupLimit = (rawValue) => {
            const value = normalizeNumber(rawValue, effectiveLimit, 1, 9999);
            upsertGroupRule(group.groupId, { limit: value });
            saveOptionsNow();
        };

        decrement.addEventListener("click", () => {
            const next = Math.max(1, normalizeNumber(limitInput.value, effectiveLimit, 1, 9999) - 1);
            limitInput.value = String(next);
            applyGroupLimit(next);
        });

        increment.addEventListener("click", () => {
            const next = normalizeNumber(limitInput.value, effectiveLimit, 1, 9999) + 1;
            limitInput.value = String(next);
            applyGroupLimit(next);
        });

        limitInput.addEventListener("change", () => {
            applyGroupLimit(limitInput.value);
        });

        inheritButton.addEventListener("click", () => {
            upsertGroupRule(group.groupId, { limit: null });
            saveOptionsNow();
        });

        includeToggle.addEventListener("change", () => {
            upsertGroupRule(group.groupId, { includeInGlobal: includeToggle.checked });
            saveOptionsNow();
        });

        editor.append(decrement, limitInput, increment, inheritButton);
        meta.append(includeToggleLabel, editor);

        itemEl.append(row, meta);
        listEl.appendChild(itemEl);
    }
};

const renderActiveScheduleChip = (snapshot) => {
    const chip = byId("activeScheduleChip");
    if (!chip) {
        return;
    }

    if (!snapshot || !snapshot.activeSchedule) {
        chip.classList.add("hidden");
        return;
    }

    chip.textContent = `Active: ${snapshot.activeSchedule.name}`;
    chip.classList.remove("hidden");
};

const updateTabCounts = async () => {
    if (!state.options) {
        return;
    }

    try {
        const [snapshot, tabs] = await Promise.all([getStatusSnapshot(), tabQuery({})]);
        state.statusSnapshot = snapshot;

        const limits = snapshot.limits;
        const counts = snapshot.counts;

        updateProgressUI({
            progressFill: byId("windowProgressFill"),
            progressBar: byId("windowProgressBar"),
            openEl: byId("windowOpenCount"),
            leftEl: byId("windowLeftCount"),
            fractionEl: byId("windowFractionLabel"),
            warnMarker: byId("windowWarnMarker"),
            openCount: counts.windowOpen,
            leftCount: counts.windowLeft,
            maxCount: limits.maxWindow,
            warnThreshold: state.options.softLimitsEnabled ? state.options.softLimitWindowWarn : null,
            ariaLabel: `Window tab usage ${counts.windowOpen} of ${limits.maxWindow}`,
        });

        updateProgressUI({
            progressFill: byId("globalProgressFill"),
            progressBar: byId("globalProgressBar"),
            openEl: byId("globalOpenCount"),
            leftEl: byId("globalLeftCount"),
            fractionEl: byId("globalFractionLabel"),
            warnMarker: byId("globalWarnMarker"),
            openCount: counts.totalOpen,
            leftCount: counts.totalLeft,
            maxCount: limits.maxTotal,
            warnThreshold: state.options.softLimitsEnabled ? state.options.softLimitTotalWarn : null,
            ariaLabel: `Total tab usage ${counts.totalOpen} of ${limits.maxTotal}`,
        });

        const windowBadge = byId("windowCountBadge");
        if (windowBadge) {
            windowBadge.textContent = String(counts.windowCount);
        }

        renderActiveScheduleChip(snapshot);
        renderDomainList(tabs, limits);
        await renderGroupList(tabs, limits);
        await updateDuplicateBadge();
    } catch (error) {
        console.error("Failed to update tab counts:", error);
    }
};

const runTabCountsUpdate = async () => {
    if (state.tabCountsInFlight) {
        state.tabCountsPending = true;
        return;
    }

    state.tabCountsInFlight = true;
    state.tabCountsPending = false;

    try {
        await updateTabCounts();
    } finally {
        state.tabCountsInFlight = false;

        if (state.tabCountsPending) {
            state.tabCountsPending = false;
            scheduleTabCountsUpdate(75);
        }
    }
};

const scheduleTabCountsUpdate = (delay = 100) => {
    if (state.tabCountsTimer) {
        clearTimeout(state.tabCountsTimer);
    }

    state.tabCountsTimer = window.setTimeout(() => {
        state.tabCountsTimer = null;
        runTabCountsUpdate();
    }, delay);
};

const renderSessions = async () => {
    const listEl = byId("sessionList");
    const emptyEl = byId("sessionEmptyState");
    if (!listEl || !emptyEl) {
        return;
    }

    const response = await runtimeSendMessage({ action: "listSessions" });
    listEl.textContent = "";

    if (!response || !response.ok || !Array.isArray(response.sessions)) {
        emptyEl.classList.remove("hidden");
        return;
    }

    if (response.sessions.length === 0) {
        emptyEl.classList.remove("hidden");
        return;
    }

    emptyEl.classList.add("hidden");

    response.sessions.forEach((session) => {
        const item = document.createElement("li");
        item.className = "session-item";

        const row = document.createElement("div");
        row.className = "session-row";

        const name = document.createElement("span");
        name.className = "session-name";
        name.textContent = session.name;
        row.appendChild(name);

        const actions = document.createElement("div");
        actions.className = "session-actions-row";

        const restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.className = "icon-btn";
        restoreBtn.textContent = "Restore";

        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "icon-btn";
        renameBtn.textContent = "Rename";

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "icon-btn danger";
        deleteBtn.textContent = "Delete";

        restoreBtn.addEventListener("click", async () => {
            const accepted = window.confirm(
                `Restore ${session.tabCount} tabs from "${session.name}"?`
            );
            if (!accepted) {
                return;
            }

            const result = await runtimeSendMessage({ action: "restoreSession", sessionId: session.id });
            if (!result || !result.ok) {
                showToast(result && result.error ? result.error : "Failed to restore session", "warning");
                return;
            }

            showToast(`Restored ${result.restored || 0} tabs from ${session.name}`);
            scheduleTabCountsUpdate(0);
        });

        renameBtn.addEventListener("click", async () => {
            const nextName = window.prompt("Session name", session.name);
            if (!nextName) {
                return;
            }

            const result = await runtimeSendMessage({
                action: "renameSession",
                sessionId: session.id,
                name: nextName,
            });

            if (!result || !result.ok) {
                showToast(result && result.error ? result.error : "Failed to rename session", "warning");
                return;
            }

            showToast("Session renamed");
            renderSessions();
        });

        deleteBtn.addEventListener("click", async () => {
            const accepted = window.confirm(`Delete session "${session.name}"?`);
            if (!accepted) {
                return;
            }

            const result = await runtimeSendMessage({ action: "deleteSession", sessionId: session.id });
            if (!result || !result.ok) {
                showToast(result && result.error ? result.error : "Failed to delete session", "warning");
                return;
            }

            showToast("Session deleted");
            renderSessions();
        });

        actions.append(restoreBtn, renameBtn, deleteBtn);
        row.appendChild(actions);

        const meta = document.createElement("div");
        meta.className = "session-meta";
        const dateText = new Date(session.createdAt).toLocaleString();
        meta.textContent = `${session.tabCount} tabs • ${dateText}`;

        item.append(row, meta);
        listEl.appendChild(item);
    });
};

const handleDuplicatesClick = async () => {
    const response = await runtimeSendMessage({ action: "scanDuplicates" });
    if (!response || !response.ok) {
        showToast(response && response.error ? response.error : "Failed to scan duplicates", "warning");
        return;
    }

    if (!response.duplicateTabs) {
        showToast("No duplicate tabs found");
        return;
    }

    const preview = (response.groups || [])
        .slice(0, 4)
        .map((group) => `• ${group.count}x ${group.url}`)
        .join("\n");

    const accepted = window.confirm(
        `Found ${response.duplicateTabs} duplicate tabs. Close duplicates and keep one copy each?\n\n${preview}`
    );

    if (!accepted) {
        return;
    }

    const closeResponse = await runtimeSendMessage({ action: "closeDuplicates" });
    if (!closeResponse || !closeResponse.ok) {
        showToast(closeResponse && closeResponse.error ? closeResponse.error : "Failed to close duplicates", "warning");
        return;
    }

    showToast(`Closed ${closeResponse.removedCount || 0} duplicate tabs`);
    scheduleTabCountsUpdate(0);
};

const exportSettings = () => {
    const options = sanitizeOptions(state.options || DEFAULT_OPTIONS);
    const payload = {
        exportedAt: new Date().toISOString(),
        options,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tablimiter-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

const getDiffSummary = (currentOptions, importedOptions) => {
    const keys = Object.keys(DEFAULT_OPTIONS);
    const lines = [];

    for (const key of keys) {
        const currentValue = JSON.stringify(currentOptions[key]);
        const importedValue = JSON.stringify(importedOptions[key]);
        if (currentValue !== importedValue) {
            lines.push(`${key}: ${currentValue} -> ${importedValue}`);
        }
    }

    return lines;
};

const importSettings = async (file) => {
    if (!file) {
        return;
    }

    const content = await file.text();

    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (error) {
        showToast("Invalid JSON file", "warning");
        return;
    }

    const imported = sanitizeOptions(parsed.options || parsed);
    const current = sanitizeOptions(state.options || DEFAULT_OPTIONS);
    const diff = getDiffSummary(current, imported);

    if (diff.length === 0) {
        showToast("Imported settings are identical");
        return;
    }

    const preview = diff.slice(0, 12).join("\n");
    const accepted = window.confirm(
        `Apply ${diff.length} setting changes?\n\n${preview}${diff.length > 12 ? "\n..." : ""}`
    );

    if (!accepted) {
        return;
    }

    state.options = imported;
    applyOptionsToInputs(state.options);
    await saveOptionsNow();
    showToast("Settings imported");
};

const attachStaticInputListeners = () => {
    document
        .querySelectorAll(
            'input[type="checkbox"], input[type="number"], select, textarea'
        )
        .forEach((element) => {
            element.addEventListener("change", () => {
                queueSaveOptions();
                scheduleTabCountsUpdate(0);
            });

            if (element.tagName === "INPUT" && element.type === "number") {
                element.addEventListener("keyup", queueSaveOptions);
            }
        });

    document.querySelectorAll(".stepper-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const input = byId(button.dataset.input);
            if (!input || input.disabled) {
                return;
            }

            const min = normalizeNumber(input.min, 1, 1, 9999);
            const max = normalizeNumber(input.max, 9999, 1, 9999);
            const current = normalizeNumber(input.value, min, min, max);

            const next =
                button.dataset.action === "increment"
                    ? Math.min(max, current + 1)
                    : Math.max(min, current - 1);

            input.value = String(next);
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    });
};

const registerRuntimeListeners = () => {
    if (browserApi.storage && browserApi.storage.onChanged) {
        browserApi.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== "sync") {
                return;
            }

            // Keep current popup synchronized when options are changed elsewhere.
            let shouldRefreshOptions = false;
            for (const key of Object.keys(changes)) {
                if (key in DEFAULT_OPTIONS || key === "domainRules" || key === "groupRules" || key === "schedules") {
                    shouldRefreshOptions = true;
                    break;
                }
            }

            if (!shouldRefreshOptions) {
                return;
            }

            getStoredOptions().then((options) => {
                state.options = options;
                applyOptionsToInputs(options);
                scheduleTabCountsUpdate(0);
            });
        });
    }

    const addListener = (eventObj, listener) => {
        if (eventObj && typeof eventObj.addListener === "function") {
            eventObj.addListener(listener);
        }
    };

    const refresh = () => {
        scheduleTabCountsUpdate();
    };

    addListener(browserApi.tabs && browserApi.tabs.onCreated, refresh);
    addListener(browserApi.tabs && browserApi.tabs.onRemoved, refresh);
    addListener(browserApi.tabs && browserApi.tabs.onAttached, refresh);
    addListener(browserApi.tabs && browserApi.tabs.onDetached, refresh);
    addListener(browserApi.tabs && browserApi.tabs.onMoved, refresh);
    addListener(browserApi.tabs && browserApi.tabs.onUpdated, (_, changeInfo) => {
        if (
            changeInfo &&
            (Object.prototype.hasOwnProperty.call(changeInfo, "url") ||
                Object.prototype.hasOwnProperty.call(changeInfo, "pinned") ||
                Object.prototype.hasOwnProperty.call(changeInfo, "groupId"))
        ) {
            refresh();
        }
    });

    addListener(browserApi.windows && browserApi.windows.onCreated, refresh);
    addListener(browserApi.windows && browserApi.windows.onRemoved, refresh);
    addListener(browserApi.windows && browserApi.windows.onFocusChanged, refresh);

    if (browserApi.runtime && browserApi.runtime.onMessage) {
        browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!message || message.action !== "showToast") {
                return undefined;
            }

            showToast(message.message || "", message.level || "info", 3500);
            if (typeof sendResponse === "function") {
                sendResponse({ toastAck: true });
            }
            return true;
        });
    }
};

const bindActionButtons = () => {
    const settingsToggle = byId("settingsToggle");
    if (settingsToggle) {
        settingsToggle.addEventListener("click", () => {
            if (state.view === "settings") {
                setView("main");
            } else {
                setView("settings");
            }
        });
    }

    const sessionsToggle = byId("sessionsToggle");
    if (sessionsToggle) {
        sessionsToggle.addEventListener("click", async () => {
            if (state.view === "sessions") {
                setView("main");
                return;
            }

            setView("sessions");
            await renderSessions();
            state.sessionsLoaded = true;
        });
    }

    const duplicatesBtn = byId("duplicatesBtn");
    if (duplicatesBtn) {
        duplicatesBtn.addEventListener("click", handleDuplicatesClick);
    }

    const saveSessionBtn = byId("saveSessionBtn");
    if (saveSessionBtn) {
        saveSessionBtn.addEventListener("click", async () => {
            const name = window.prompt("Session name", `Session ${new Date().toLocaleString()}`);
            if (name === null) {
                return;
            }

            const response = await runtimeSendMessage({ action: "saveCurrentSession", name });
            if (!response || !response.ok) {
                showToast(response && response.error ? response.error : "Failed to save session", "warning");
                return;
            }

            showToast(`Saved session "${response.session.name}" (${response.session.tabCount} tabs)`);
            renderSessions();
        });
    }

    const refreshSessionsBtn = byId("refreshSessionsBtn");
    if (refreshSessionsBtn) {
        refreshSessionsBtn.addEventListener("click", () => {
            renderSessions();
        });
    }

    const addDomainRuleBtn = byId("addDomainRuleBtn");
    if (addDomainRuleBtn) {
        addDomainRuleBtn.addEventListener("click", () => {
            state.options.domainRules.push({
                id: `rule-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
                domain: "example.com",
                behavior: "allow",
            });
            state.options.domainRules = normalizeDomainRules(state.options.domainRules);
            renderDomainRuleEditor();
            saveOptionsNow();
        });
    }

    const addScheduleBtn = byId("addScheduleBtn");
    if (addScheduleBtn) {
        addScheduleBtn.addEventListener("click", () => {
            state.options.schedules.push({
                id: `schedule-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
                name: `Schedule ${state.options.schedules.length + 1}`,
                days: [1, 2, 3, 4, 5],
                start: "09:00",
                end: "17:00",
                maxWindow: null,
                maxTotal: null,
                maxDomain: null,
            });
            state.options.schedules = normalizeSchedules(state.options.schedules);
            renderSchedulesEditor();
            saveOptionsNow();
        });
    }

    const showStatusBtn = byId("showStatusBtn");
    if (showStatusBtn) {
        showStatusBtn.addEventListener("click", async () => {
            const response = await runtimeSendMessage({ action: "showStatusNotification" });
            if (!response || !response.ok) {
                showToast(response && response.error ? response.error : "Failed to show status", "warning");
                return;
            }

            showToast("Status notification sent");
        });
    }

    const exportBtn = byId("exportBtn");
    if (exportBtn) {
        exportBtn.addEventListener("click", exportSettings);
    }

    const importBtn = byId("importBtn");
    const importInput = byId("importInput");

    if (importBtn && importInput) {
        importBtn.addEventListener("click", () => {
            importInput.click();
        });

        importInput.addEventListener("change", async () => {
            const file = importInput.files && importInput.files[0];
            if (!file) {
                return;
            }

            await importSettings(file);
            importInput.value = "";
        });
    }
};

const init = async () => {
    state.options = await getStoredOptions();
    applyOptionsToInputs(state.options);

    bindActionButtons();
    attachStaticInputListeners();
    registerRuntimeListeners();

    setView("main");
    await runTabCountsUpdate();
};

document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
        console.error("Failed to initialize options page:", error);
        showToast("Failed to initialize popup", "warning", 4500);
    });
});
