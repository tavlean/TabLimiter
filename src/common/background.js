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
    badgeDisplayMode: "remaining", // remaining | open | fraction
    closeStrategy: "newest", // newest | oldest | lru
    notificationMode: "system", // system | toast
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

const BADGE_MODE_SET = new Set(["remaining", "open", "fraction"]);
const CLOSE_STRATEGY_SET = new Set(["newest", "oldest", "lru"]);
const NOTIFICATION_MODE_SET = new Set(["system", "toast"]);
const NOTIFICATION_ID_PREFIX = "tablimiter";
const WARNING_STATE = new Map();

const PLACE_LABEL = {
    total: "all windows",
    window: "this window",
    domain: "this domain",
    group: "this group",
};

const storageSyncGet = (keys) =>
    new Promise((resolve) => {
        chrome.storage.sync.get(keys, (data) => resolve(data || {}));
    });

const storageSyncSet = (value) =>
    new Promise((resolve) => {
        chrome.storage.sync.set(value, () => resolve());
    });

const storageLocalGet = (keys) =>
    new Promise((resolve) => {
        chrome.storage.local.get(keys, (data) => resolve(data || {}));
    });

const storageLocalSet = (value) =>
    new Promise((resolve) => {
        chrome.storage.local.set(value, () => resolve());
    });

const tabQuery = (params = {}) =>
    new Promise((resolve) => {
        chrome.tabs.query(params, (tabs) => resolve(tabs || []));
    });

const getAllWindows = (populate = true) =>
    new Promise((resolve) => {
        chrome.windows.getAll({ populate }, (windows) => resolve(windows || []));
    });

const getTabGroup = (groupId) =>
    new Promise((resolve) => {
        if (!chrome.tabGroups || typeof chrome.tabGroups.get !== "function") {
            resolve(null);
            return;
        }

        chrome.tabGroups.get(groupId, (group) => {
            if (chrome.runtime.lastError) {
                resolve(null);
                return;
            }
            resolve(group || null);
        });
    });

const clearNotification = (notificationId) =>
    new Promise((resolve) => {
        chrome.notifications.clear(notificationId, () => resolve());
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

    const domainCandidate = trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");

    try {
        const parsed =
            domainCandidate.includes("/") || domainCandidate.includes(":")
                ? new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
                : new URL(`https://${domainCandidate}`);

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }

        return parsed.hostname.toLowerCase().replace(/^www\./, "");
    } catch (error) {
        const stripped = domainCandidate.replace(/^www\./, "");
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

const domainMatchesRule = (domain, ruleDomain) => {
    if (!domain || !ruleDomain) {
        return false;
    }

    return domain === ruleDomain || domain.endsWith(`.${ruleDomain}`);
};

const parseTimeString = (value, fallbackMinutes) => {
    if (typeof value !== "string") {
        return fallbackMinutes;
    }

    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        return fallbackMinutes;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return fallbackMinutes;
    }

    return hour * 60 + minute;
};

const toTimeString = (minutes) => {
    const clamped = Math.min(1439, Math.max(0, minutes));
    const hour = String(Math.floor(clamped / 60)).padStart(2, "0");
    const minute = String(clamped % 60).padStart(2, "0");
    return `${hour}:${minute}`;
};

const normalizeDomainRules = (rules) => {
    if (!Array.isArray(rules)) {
        return [];
    }

    const output = [];
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

        const normalizedRule = {
            id:
                typeof rawRule.id === "string" && rawRule.id
                    ? rawRule.id
                    : `${domain}-${behavior}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            domain,
            behavior,
        };

        if (behavior === "custom") {
            normalizedRule.limit = normalizeNumber(rawRule.limit, DEFAULT_OPTIONS.maxDomain, 1, 9999);
        }

        output.push(normalizedRule);
    }

    output.sort((a, b) => a.domain.localeCompare(b.domain));
    return output;
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

        const parsedGroupId = Number(rawRule.groupId);
        if (!Number.isInteger(parsedGroupId) || parsedGroupId < 0) {
            continue;
        }

        output.push({
            groupId: parsedGroupId,
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

    const start = parseTimeString(raw.start, 9 * 60);
    const end = parseTimeString(raw.end, 17 * 60);

    const schedule = {
        id:
            typeof raw.id === "string" && raw.id
                ? raw.id
                : `schedule-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 6)}`,
        name:
            typeof raw.name === "string" && raw.name.trim()
                ? raw.name.trim()
                : `Schedule ${index + 1}`,
        days: Array.from(new Set(days)).sort((a, b) => a - b),
        start: toTimeString(start),
        end: toTimeString(end),
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

    return schedule;
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

const sanitizeOptions = (rawOptions) => {
    const source = rawOptions && typeof rawOptions === "object" ? rawOptions : {};

    const options = {
        ...DEFAULT_OPTIONS,
        ...source,
    };

    options.maxTotal = normalizeNumber(source.maxTotal, DEFAULT_OPTIONS.maxTotal, 1, 9999);
    options.maxWindow = normalizeNumber(source.maxWindow, DEFAULT_OPTIONS.maxWindow, 1, 9999);
    options.maxDomain = normalizeNumber(source.maxDomain, DEFAULT_OPTIONS.maxDomain, 1, 9999);

    options.exceedTabNewWindow = Boolean(source.exceedTabNewWindow);
    options.enableDomainLimit =
        source.enableDomainLimit === undefined ? DEFAULT_OPTIONS.enableDomainLimit : Boolean(source.enableDomainLimit);
    options.coloredFavicons = Boolean(source.coloredFavicons);
    options.displayAlert = source.displayAlert === undefined ? true : Boolean(source.displayAlert);
    options.countPinnedTabs = Boolean(source.countPinnedTabs);
    options.displayBadge = Boolean(source.displayBadge);

    options.badgeDisplayMode = BADGE_MODE_SET.has(source.badgeDisplayMode)
        ? source.badgeDisplayMode
        : DEFAULT_OPTIONS.badgeDisplayMode;

    options.closeStrategy = CLOSE_STRATEGY_SET.has(source.closeStrategy)
        ? source.closeStrategy
        : DEFAULT_OPTIONS.closeStrategy;

    options.notificationMode = NOTIFICATION_MODE_SET.has(source.notificationMode)
        ? source.notificationMode
        : DEFAULT_OPTIONS.notificationMode;

    options.softLimitsEnabled = Boolean(source.softLimitsEnabled);
    options.softLimitWindowClose = normalizeNumber(
        source.softLimitWindowClose,
        options.maxWindow,
        1,
        9999
    );
    options.softLimitTotalClose = normalizeNumber(source.softLimitTotalClose, options.maxTotal, 1, 9999);
    options.softLimitDomainClose = normalizeNumber(
        source.softLimitDomainClose,
        options.maxDomain,
        1,
        9999
    );

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

const getOptions = async () => {
    const syncData = await storageSyncGet(null);
    return sanitizeOptions(syncData);
};

const getGroupRule = (options, groupId) => {
    if (!Number.isInteger(groupId) || groupId < 0) {
        return null;
    }

    for (const rule of options.groupRules) {
        if (rule.groupId === groupId) {
            return rule;
        }
    }
    return null;
};

const isTabCountedInWindow = (tab, options) => {
    if (!tab) {
        return false;
    }
    return options.countPinnedTabs ? true : !tab.pinned;
};

const isTabIncludedInGlobal = (tab, options) => {
    if (!isTabCountedInWindow(tab, options)) {
        return false;
    }

    const rule = getGroupRule(options, tab.groupId);
    if (rule && rule.includeInGlobal === false) {
        return false;
    }

    return true;
};

const getMatchingDomainRules = (options, domain) => {
    if (!domain) {
        return [];
    }

    return options.domainRules
        .filter((rule) => domainMatchesRule(domain, rule.domain))
        .sort((a, b) => b.domain.length - a.domain.length);
};

const getDominantDomainRule = (options, domain) => {
    const matched = getMatchingDomainRules(options, domain);
    return matched.length > 0 ? matched[0] : null;
};

const isDomainAllowlisted = (options, domain) => {
    const rule = getDominantDomainRule(options, domain);
    return Boolean(rule && rule.behavior === "allow");
};

const isDomainBlocklisted = (options, domain) => {
    const rule = getDominantDomainRule(options, domain);
    return Boolean(rule && rule.behavior === "block");
};

const getDomainCustomLimit = (options, domain) => {
    const rule = getDominantDomainRule(options, domain);
    if (!rule || rule.behavior !== "custom") {
        return null;
    }

    return normalizeNumber(rule.limit, options.maxDomain, 1, 9999);
};

const isScheduleActiveNow = (schedule, now) => {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.getDay();
    const previousDay = (currentDay + 6) % 7;

    const start = parseTimeString(schedule.start, 0);
    const end = parseTimeString(schedule.end, 24 * 60 - 1);

    if (start === end) {
        return schedule.days.includes(currentDay);
    }

    if (start < end) {
        return schedule.days.includes(currentDay) && minutes >= start && minutes < end;
    }

    if (schedule.days.includes(currentDay) && minutes >= start) {
        return true;
    }

    if (schedule.days.includes(previousDay) && minutes < end) {
        return true;
    }

    return false;
};

const getActiveSchedule = (options, now = new Date()) => {
    if (!options.schedulesEnabled || !Array.isArray(options.schedules) || options.schedules.length === 0) {
        return null;
    }

    for (const schedule of options.schedules) {
        if (isScheduleActiveNow(schedule, now)) {
            return schedule;
        }
    }

    return null;
};

const getEffectiveLimits = (options, now = new Date()) => {
    const activeSchedule = getActiveSchedule(options, now);

    const hardLimits = {
        window: options.maxWindow,
        total: options.maxTotal,
        domain: options.maxDomain,
    };

    if (activeSchedule) {
        if (activeSchedule.maxWindow) {
            hardLimits.window = normalizeNumber(activeSchedule.maxWindow, hardLimits.window, 1, 9999);
        }
        if (activeSchedule.maxTotal) {
            hardLimits.total = normalizeNumber(activeSchedule.maxTotal, hardLimits.total, 1, 9999);
        }
        if (activeSchedule.maxDomain) {
            hardLimits.domain = normalizeNumber(activeSchedule.maxDomain, hardLimits.domain, 1, 9999);
        }
    }

    const closeThresholds = {
        window: options.softLimitsEnabled
            ? normalizeNumber(options.softLimitWindowClose, hardLimits.window, 1, 9999)
            : hardLimits.window,
        total: options.softLimitsEnabled
            ? normalizeNumber(options.softLimitTotalClose, hardLimits.total, 1, 9999)
            : hardLimits.total,
        domain: options.softLimitsEnabled
            ? normalizeNumber(options.softLimitDomainClose, hardLimits.domain, 1, 9999)
            : hardLimits.domain,
    };

    const warningThresholds = {
        window: options.softLimitsEnabled
            ? normalizeNumber(
                  options.softLimitWindowWarn,
                  Math.max(1, closeThresholds.window - 1),
                  1,
                  closeThresholds.window
              )
            : null,
        total: options.softLimitsEnabled
            ? normalizeNumber(
                  options.softLimitTotalWarn,
                  Math.max(1, closeThresholds.total - 1),
                  1,
                  closeThresholds.total
              )
            : null,
        domain: options.softLimitsEnabled
            ? normalizeNumber(
                  options.softLimitDomainWarn,
                  Math.max(1, closeThresholds.domain - 1),
                  1,
                  closeThresholds.domain
              )
            : null,
    };

    return {
        activeSchedule,
        hardLimits,
        closeThresholds,
        warningThresholds,
    };
};

const pickByStrategy = (tabs, strategy) => {
    if (!tabs || tabs.length === 0) {
        return null;
    }

    if (strategy === "oldest") {
        return tabs.reduce((selected, tab) => (tab.id < selected.id ? tab : selected), tabs[0]);
    }

    if (strategy === "lru") {
        return tabs.reduce((selected, tab) => {
            const selectedAccess = Number(selected.lastAccessed || selected.id || 0);
            const tabAccess = Number(tab.lastAccessed || tab.id || 0);
            return tabAccess < selectedAccess ? tab : selected;
        }, tabs[0]);
    }

    return tabs.reduce((selected, tab) => (tab.id > selected.id ? tab : selected), tabs[0]);
};

const getClosableCandidateTabs = ({ place, tab, tabs, options, domain }) => {
    let candidates = [];

    if (place === "total") {
        candidates = tabs.filter((openTab) => isTabIncludedInGlobal(openTab, options));
    } else if (place === "window") {
        candidates = tabs.filter(
            (openTab) => openTab.windowId === tab.windowId && isTabCountedInWindow(openTab, options)
        );
    } else if (place === "domain") {
        candidates = tabs.filter(
            (openTab) =>
                isTabCountedInWindow(openTab, options) && getDomainFromUrl(openTab.url) === domain
        );
    } else if (place === "group") {
        candidates = tabs.filter(
            (openTab) =>
                isTabCountedInWindow(openTab, options) && openTab.groupId === tab.groupId
        );
    }

    return candidates.filter((candidate) => {
        const candidateDomain = getDomainFromUrl(candidate.url);
        return !isDomainAllowlisted(options, candidateDomain);
    });
};

const renderTemplate = (template, values) =>
    template.replace(/\{\s*(\S+?)\s*\}/g, (_, key) => {
        if (key in values && values[key] !== undefined && values[key] !== null) {
            return String(values[key]);
        }
        return "?";
    });

const sendToast = (payload) =>
    new Promise((resolve) => {
        let resolved = false;

        try {
            chrome.runtime.sendMessage(payload, (response) => {
                if (resolved) {
                    return;
                }
                resolved = true;
                if (chrome.runtime.lastError) {
                    resolve(false);
                    return;
                }
                resolve(Boolean(response && response.toastAck));
            });
        } catch (error) {
            resolve(false);
        }

        setTimeout(() => {
            if (resolved) {
                return;
            }
            resolved = true;
            resolve(false);
        }, 100);
    });

const showSystemNotification = async ({ title, message, warning = false }) => {
    const notificationId = `${NOTIFICATION_ID_PREFIX}-${warning ? "warn" : "info"}-${Date.now()}`;

    await new Promise((resolve) => {
        chrome.notifications.create(
            notificationId,
            {
                type: "basic",
                iconUrl: "assets/icon48.png",
                title,
                message,
                buttons: warning ? [{ title: "Got it" }] : [],
                priority: warning ? 1 : 0,
            },
            () => resolve()
        );
    });

    if (!warning) {
        return;
    }

    setTimeout(() => {
        clearNotification(notificationId);
    }, 15000);
};

const displayAlert = async (options, context, warning = false) => {
    if (!options.displayAlert) {
        return;
    }

    const place = context.place || "total";

    const template = warning ? options.warningMessage : options.alertMessage;
    const values = {
        place: PLACE_LABEL[place] || place,
        which: PLACE_LABEL[place] || place,
        maxPlace: context.maxPlace,
        maxWhich: context.maxPlace,
        currentCount: context.currentCount,
        domain: context.domain || "",
        windowCount: context.windowCount,
        strategy: options.closeStrategy,
    };

    const rendered = renderTemplate(template, values);

    if (options.notificationMode === "toast") {
        const toastSent = await sendToast({
            action: "showToast",
            level: warning ? "warning" : "info",
            message: rendered,
        });

        if (toastSent) {
            return;
        }
    }

    await showSystemNotification({
        title: warning ? "Tab Limiter Warning" : "Tab Limiter",
        message: rendered,
        warning,
    });
};

const getWarningKey = (place, details = {}) => {
    if (place === "total") {
        return "total";
    }
    if (place === "window") {
        return `window:${details.windowId}`;
    }
    if (place === "domain") {
        return `domain:${details.domain}`;
    }
    if (place === "group") {
        return `group:${details.groupId}`;
    }
    return `${place}:default`;
};

const maybeWarnThreshold = async ({
    options,
    place,
    warnThreshold,
    currentCount,
    maxPlace,
    domain,
    windowId,
    groupId,
}) => {
    if (!warnThreshold || warnThreshold < 1) {
        return;
    }

    const warningKey = getWarningKey(place, { domain, windowId, groupId });

    if (currentCount <= warnThreshold) {
        WARNING_STATE.delete(warningKey);
        return;
    }

    if (WARNING_STATE.has(warningKey)) {
        return;
    }

    WARNING_STATE.set(warningKey, true);
    await displayAlert(
        options,
        {
            place,
            maxPlace,
            currentCount,
            domain,
            windowCount: place === "window" ? currentCount : undefined,
        },
        true
    );
};

const getTabCounts = ({ tabs, options, limits, targetTab, targetDomain }) => {
    const totalCount = tabs.filter((tab) => isTabIncludedInGlobal(tab, options)).length;
    const windowCount = tabs.filter(
        (tab) => tab.windowId === targetTab.windowId && isTabCountedInWindow(tab, options)
    ).length;

    const domainTabs = targetDomain
        ? tabs.filter(
              (tab) => isTabCountedInWindow(tab, options) && getDomainFromUrl(tab.url) === targetDomain
          )
        : [];

    const domainCount = domainTabs.length;

    const groupTabs =
        Number.isInteger(targetTab.groupId) && targetTab.groupId >= 0
            ? tabs.filter(
                  (tab) =>
                      tab.groupId === targetTab.groupId && isTabCountedInWindow(tab, options)
              )
            : [];

    const groupCount = groupTabs.length;

    const groupRule = getGroupRule(options, targetTab.groupId);
    const groupLimit =
        groupRule && groupRule.limit !== null
            ? normalizeNumber(groupRule.limit, limits.closeThresholds.window, 1, 9999)
            : limits.closeThresholds.window;

    return {
        totalCount,
        windowCount,
        domainCount,
        groupCount,
        domainTabs,
        groupTabs,
        groupLimit,
    };
};

const evaluateExceedance = ({ options, tab, domain, limits, counts }) => {
    if (domain && isDomainBlocklisted(options, domain)) {
        return {
            place: "domain",
            reason: "block",
            maxPlace: 0,
            currentCount: counts.domainCount || 1,
        };
    }

    if (domain && isDomainAllowlisted(options, domain)) {
        return null;
    }

    const domainCustomLimit = domain ? getDomainCustomLimit(options, domain) : null;
    const domainLimit = domainCustomLimit || limits.closeThresholds.domain;
    const shouldEnforceDomain = options.enableDomainLimit || Boolean(domainCustomLimit);

    if (counts.totalCount > limits.closeThresholds.total && isTabIncludedInGlobal(tab, options)) {
        return {
            place: "total",
            reason: "limit",
            maxPlace: limits.closeThresholds.total,
            currentCount: counts.totalCount,
        };
    }

    if (shouldEnforceDomain && domain && counts.domainCount > domainLimit) {
        return {
            place: "domain",
            reason: "limit",
            maxPlace: domainLimit,
            currentCount: counts.domainCount,
        };
    }

    if (Number.isInteger(tab.groupId) && tab.groupId >= 0 && counts.groupCount > counts.groupLimit) {
        return {
            place: "group",
            reason: "limit",
            maxPlace: counts.groupLimit,
            currentCount: counts.groupCount,
        };
    }

    if (counts.windowCount > limits.closeThresholds.window && isTabCountedInWindow(tab, options)) {
        return {
            place: "window",
            reason: "limit",
            maxPlace: limits.closeThresholds.window,
            currentCount: counts.windowCount,
        };
    }

    return null;
};

const tryMoveTabToOtherWindow = async ({ tab, options, domain, limits }) => {
    const windows = await getAllWindows(true);

    let bestWindow = null;
    let bestScore = -1;

    for (const window of windows) {
        if (!window || !Array.isArray(window.tabs) || window.id === tab.windowId) {
            continue;
        }

        const countedTabs = window.tabs.filter((openTab) => isTabCountedInWindow(openTab, options));
        const remainingCapacity = limits.closeThresholds.window - countedTabs.length;

        if (remainingCapacity <= 0) {
            continue;
        }

        let relatedCount = 0;
        if (domain) {
            for (const openTab of countedTabs) {
                if (getDomainFromUrl(openTab.url) === domain) {
                    relatedCount += 1;
                }
            }
        }

        const score = relatedCount * 1000 + remainingCapacity;
        if (score > bestScore) {
            bestScore = score;
            bestWindow = window;
        }
    }

    try {
        if (bestWindow) {
            await new Promise((resolve, reject) => {
                chrome.tabs.move(tab.id, { windowId: bestWindow.id, index: -1 }, (movedTab) => {
                    if (chrome.runtime.lastError || !movedTab) {
                        reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "move failed"));
                        return;
                    }
                    resolve();
                });
            });

            await new Promise((resolve) => {
                chrome.windows.update(bestWindow.id, { focused: true }, () => resolve());
            });

            return true;
        }

        await new Promise((resolve, reject) => {
            chrome.windows.create({ tabId: tab.id, focused: true }, (window) => {
                if (chrome.runtime.lastError || !window) {
                    reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "window create failed"));
                    return;
                }
                resolve();
            });
        });

        return true;
    } catch (error) {
        console.error("Tab move failed:", error);
        return false;
    }
};

const closeTabById = async (tabId) => {
    if (typeof tabId !== "number") {
        return false;
    }

    return new Promise((resolve) => {
        chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
};

const enforceForTab = async (tab, options) => {
    if (!tab || typeof tab.id !== "number") {
        return;
    }

    const tabs = await tabQuery({});
    const limits = getEffectiveLimits(options);
    const domain = getDomainFromUrl(tab.url);

    const counts = getTabCounts({
        tabs,
        options,
        limits,
        targetTab: tab,
        targetDomain: domain,
    });

    await maybeWarnThreshold({
        options,
        place: "total",
        warnThreshold: limits.warningThresholds.total,
        currentCount: counts.totalCount,
        maxPlace: limits.closeThresholds.total,
    });

    await maybeWarnThreshold({
        options,
        place: "window",
        warnThreshold: limits.warningThresholds.window,
        currentCount: counts.windowCount,
        maxPlace: limits.closeThresholds.window,
        windowId: tab.windowId,
    });

    const domainCustomLimit = domain ? getDomainCustomLimit(options, domain) : null;
    const domainWarnLimit = domainCustomLimit || limits.warningThresholds.domain;
    const domainCloseLimit = domainCustomLimit || limits.closeThresholds.domain;

    if (domain && (options.enableDomainLimit || domainCustomLimit)) {
        await maybeWarnThreshold({
            options,
            place: "domain",
            warnThreshold: domainWarnLimit,
            currentCount: counts.domainCount,
            maxPlace: domainCloseLimit,
            domain,
        });
    }

    const exceeded = evaluateExceedance({ options, tab, domain, limits, counts });

    if (!exceeded) {
        return;
    }

    if (exceeded.reason === "block") {
        const removed = await closeTabById(tab.id);
        if (removed) {
            await displayAlert(options, {
                place: "domain",
                maxPlace: 0,
                currentCount: counts.domainCount,
                domain,
                windowCount: counts.windowCount,
            });
        }
        return;
    }

    if (exceeded.place === "window" && options.exceedTabNewWindow) {
        const moved = await tryMoveTabToOtherWindow({ tab, options, domain, limits });
        if (moved) {
            await displayAlert(options, {
                place: "window",
                maxPlace: limits.closeThresholds.window,
                currentCount: counts.windowCount,
                domain,
                windowCount: counts.windowCount,
            });
            return;
        }
    }

    const candidates = getClosableCandidateTabs({
        place: exceeded.place,
        tab,
        tabs,
        options,
        domain,
    });

    const selected = pickByStrategy(candidates, options.closeStrategy);
    if (!selected) {
        return;
    }

    const removed = await closeTabById(selected.id);
    if (!removed) {
        return;
    }

    await displayAlert(options, {
        place: exceeded.place,
        maxPlace: exceeded.maxPlace,
        currentCount: exceeded.currentCount,
        domain,
        windowCount: counts.windowCount,
    });
};

const computeBadgeColor = (ratio) => {
    if (ratio <= 0.25) {
        return "#7c3aed";
    }
    if (ratio <= 0.45) {
        return "#2563eb";
    }
    if (ratio <= 0.7) {
        return "#059669";
    }
    if (ratio <= 0.85) {
        return "#ca8a04";
    }
    if (ratio < 1) {
        return "#ea580c";
    }
    return "#dc2626";
};

const formatFractionBadge = (openCount, maxCount) => {
    const left = String(Math.min(99, openCount));
    const right = String(Math.min(99, maxCount));
    return `${left}/${right}`;
};

const updateBadge = async (optionsArg = null) => {
    const options = optionsArg || (await getOptions());

    if (!options.displayBadge) {
        chrome.action.setBadgeText({ text: "" });
        return;
    }

    const limits = getEffectiveLimits(options);

    const [windowTabs, allTabs] = await Promise.all([
        tabQuery({ currentWindow: true }),
        tabQuery({}),
    ]);

    const windowCount = windowTabs.filter((tab) => isTabCountedInWindow(tab, options)).length;
    const totalCount = allTabs.filter((tab) => isTabIncludedInGlobal(tab, options)).length;

    const windowRemaining = limits.closeThresholds.window - windowCount;
    const totalRemaining = limits.closeThresholds.total - totalCount;

    let badgeText = "";
    if (options.badgeDisplayMode === "open") {
        badgeText = String(Math.min(9999, totalCount));
    } else if (options.badgeDisplayMode === "fraction") {
        badgeText = formatFractionBadge(windowCount, limits.closeThresholds.window);
    } else {
        badgeText = String(Math.min(windowRemaining, totalRemaining));
    }

    const ratio = Math.max(
        limits.closeThresholds.window > 0 ? windowCount / limits.closeThresholds.window : 0,
        limits.closeThresholds.total > 0 ? totalCount / limits.closeThresholds.total : 0
    );

    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: computeBadgeColor(ratio) });
    if (typeof chrome.action.setBadgeTextColor === "function") {
        chrome.action.setBadgeTextColor({ color: "#ffffff" });
    }
};

const ensureRecurringAlarm = () => {
    if (!chrome.alarms || typeof chrome.alarms.create !== "function") {
        return;
    }

    chrome.alarms.create("schedule-tick", { periodInMinutes: 5 });
};

const syncGroupRulesWithOpenGroups = async (options) => {
    if (!chrome.tabGroups || typeof chrome.tabGroups.get !== "function") {
        return options;
    }

    const tabs = await tabQuery({});
    const groupIds = Array.from(
        new Set(
            tabs
                .map((tab) => tab.groupId)
                .filter((groupId) => Number.isInteger(groupId) && groupId >= 0)
        )
    );

    if (groupIds.length === 0) {
        return options;
    }

    const existingMap = new Map(options.groupRules.map((rule) => [rule.groupId, { ...rule }]));
    let changed = false;

    for (const groupId of groupIds) {
        const group = await getTabGroup(groupId);
        const existing = existingMap.get(groupId);

        if (!existing) {
            existingMap.set(groupId, {
                groupId,
                includeInGlobal: true,
                limit: null,
                name: group && group.title ? group.title : `Group ${groupId}`,
                color: group && group.color ? group.color : "grey",
            });
            changed = true;
            continue;
        }

        const nextName = group && group.title ? group.title : existing.name;
        const nextColor = group && group.color ? group.color : existing.color;
        if (existing.name !== nextName || existing.color !== nextColor) {
            existing.name = nextName;
            existing.color = nextColor;
            changed = true;
        }
    }

    if (!changed) {
        return options;
    }

    const groupRules = Array.from(existingMap.values()).sort((a, b) => a.groupId - b.groupId);
    await storageSyncSet({ groupRules });
    return {
        ...options,
        groupRules,
    };
};

const sanitizeAndStoreOptions = async (rawPatch) => {
    const existing = await getOptions();
    const merged = sanitizeOptions({
        ...existing,
        ...rawPatch,
    });

    await storageSyncSet({
        ...merged,
        defaultOptions: DEFAULT_OPTIONS,
    });

    return merged;
};

const getSavedSessions = async () => {
    const local = await storageLocalGet(["savedSessions"]);
    return Array.isArray(local.savedSessions) ? local.savedSessions : [];
};

const saveSessions = async (sessions) => {
    await storageLocalSet({ savedSessions: sessions.slice(0, 10) });
};

const sanitizeSessionName = (name, fallback = "Session") => {
    if (typeof name !== "string") {
        return fallback;
    }
    const trimmed = name.trim();
    return trimmed || fallback;
};

const createSessionFromTabs = (tabs, providedName) => {
    const tabEntries = tabs
        .filter((tab) => typeof tab.url === "string" && /^https?:\/\//.test(tab.url))
        .map((tab) => ({
            url: tab.url,
            title: tab.title || tab.url,
            pinned: Boolean(tab.pinned),
        }));

    return {
        id: `session-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        name: sanitizeSessionName(
            providedName,
            `Session ${new Date().toLocaleString()}`
        ),
        createdAt: Date.now(),
        tabCount: tabEntries.length,
        tabs: tabEntries,
    };
};

const listSessions = async () => {
    const sessions = await getSavedSessions();
    return sessions
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((session) => ({
            id: session.id,
            name: session.name,
            createdAt: session.createdAt,
            tabCount: session.tabCount,
        }));
};

const saveCurrentSession = async (name) => {
    const tabs = await tabQuery({});
    const session = createSessionFromTabs(tabs, name);

    if (!session.tabs.length) {
        throw new Error("No restorable web tabs found to save.");
    }

    const existing = await getSavedSessions();
    const next = [session, ...existing].slice(0, 10);
    await saveSessions(next);

    return {
        id: session.id,
        name: session.name,
        tabCount: session.tabCount,
        createdAt: session.createdAt,
    };
};

const restoreSession = async (sessionId) => {
    const sessions = await getSavedSessions();
    const session = sessions.find((item) => item.id === sessionId);

    if (!session) {
        throw new Error("Session not found.");
    }

    let restored = 0;
    for (const item of session.tabs) {
        await new Promise((resolve) => {
            chrome.tabs.create({ url: item.url, pinned: Boolean(item.pinned), active: false }, () => {
                if (!chrome.runtime.lastError) {
                    restored += 1;
                }
                resolve();
            });
        });
    }

    return { restored, sessionName: session.name };
};

const renameSession = async (sessionId, name) => {
    const sessions = await getSavedSessions();
    let changed = false;

    const next = sessions.map((session) => {
        if (session.id !== sessionId) {
            return session;
        }

        changed = true;
        return {
            ...session,
            name: sanitizeSessionName(name, session.name),
        };
    });

    if (!changed) {
        throw new Error("Session not found.");
    }

    await saveSessions(next);
};

const deleteSession = async (sessionId) => {
    const sessions = await getSavedSessions();
    const next = sessions.filter((session) => session.id !== sessionId);
    if (next.length === sessions.length) {
        throw new Error("Session not found.");
    }
    await saveSessions(next);
};

const normalizeUrlForDuplicateDetection = (url) => {
    if (!url) {
        return null;
    }

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }

        parsed.hash = "";
        if (parsed.pathname === "/") {
            parsed.pathname = "";
        }
        return parsed.toString();
    } catch (error) {
        return null;
    }
};

const scanDuplicates = async () => {
    const tabs = await tabQuery({});
    const map = new Map();

    for (const tab of tabs) {
        const key = normalizeUrlForDuplicateDetection(tab.url);
        if (!key) {
            continue;
        }

        const current = map.get(key) || [];
        current.push(tab);
        map.set(key, current);
    }

    const groups = [];
    let duplicateTabs = 0;

    for (const [url, groupTabs] of map.entries()) {
        if (groupTabs.length <= 1) {
            continue;
        }

        duplicateTabs += groupTabs.length - 1;
        groups.push({
            url,
            count: groupTabs.length,
            tabIds: groupTabs.map((tab) => tab.id),
        });
    }

    groups.sort((a, b) => b.count - a.count || a.url.localeCompare(b.url));

    return {
        duplicateTabs,
        groups,
    };
};

const closeDuplicateTabs = async () => {
    const tabs = await tabQuery({});
    const map = new Map();

    for (const tab of tabs) {
        const key = normalizeUrlForDuplicateDetection(tab.url);
        if (!key) {
            continue;
        }

        const current = map.get(key) || [];
        current.push(tab);
        map.set(key, current);
    }

    let removedCount = 0;

    for (const groupTabs of map.values()) {
        if (groupTabs.length <= 1) {
            continue;
        }

        const keep = groupTabs.reduce((selected, tab) => {
            const selectedAccess = Number(selected.lastAccessed || selected.id || 0);
            const tabAccess = Number(tab.lastAccessed || tab.id || 0);
            return tabAccess > selectedAccess ? tab : selected;
        }, groupTabs[0]);

        const toRemove = groupTabs.filter((tab) => tab.id !== keep.id).map((tab) => tab.id);
        if (!toRemove.length) {
            continue;
        }

        await new Promise((resolve) => {
            chrome.tabs.remove(toRemove, () => {
                if (!chrome.runtime.lastError) {
                    removedCount += toRemove.length;
                }
                resolve();
            });
        });
    }

    return { removedCount };
};

const closeDomainTabs = async (domain) => {
    const normalized = normalizeDomain(domain);
    if (!normalized) {
        throw new Error("Invalid domain.");
    }

    const tabs = await tabQuery({});
    const toRemove = tabs
        .filter((tab) => getDomainFromUrl(tab.url) === normalized)
        .map((tab) => tab.id)
        .filter((id) => typeof id === "number");

    if (!toRemove.length) {
        return { removedCount: 0 };
    }

    await new Promise((resolve, reject) => {
        chrome.tabs.remove(toRemove, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });

    return { removedCount: toRemove.length };
};

const getStatusSnapshot = async () => {
    const options = await getOptions();
    const limits = getEffectiveLimits(options);

    const [allTabs, currentWindowTabs, windows] = await Promise.all([
        tabQuery({}),
        tabQuery({ currentWindow: true }),
        getAllWindows(false),
    ]);

    const totalOpen = allTabs.filter((tab) => isTabIncludedInGlobal(tab, options)).length;
    const windowOpen = currentWindowTabs.filter((tab) => isTabCountedInWindow(tab, options)).length;

    const totalLeft = Math.max(0, limits.closeThresholds.total - totalOpen);
    const windowLeft = Math.max(0, limits.closeThresholds.window - windowOpen);

    const activeSchedule = limits.activeSchedule
        ? {
              id: limits.activeSchedule.id,
              name: limits.activeSchedule.name,
          }
        : null;

    return {
        limits: {
            maxTotal: limits.closeThresholds.total,
            maxWindow: limits.closeThresholds.window,
            maxDomain: limits.closeThresholds.domain,
        },
        counts: {
            totalOpen,
            totalLeft,
            windowOpen,
            windowLeft,
            windowCount: windows.length,
        },
        activeSchedule,
    };
};

const showStatusNotification = async () => {
    const snapshot = await getStatusSnapshot();
    const message = `Window: ${snapshot.counts.windowOpen}/${snapshot.limits.maxWindow} | Total: ${snapshot.counts.totalOpen}/${snapshot.limits.maxTotal} | ${snapshot.counts.totalLeft} left`;
    await showSystemNotification({
        title: "Tab Limiter Status",
        message,
        warning: false,
    });
};

const handleRuntimeMessage = async (request) => {
    if (!request || typeof request !== "object") {
        return null;
    }

    if (request.action === "updateBadge") {
        const options = request.options ? sanitizeOptions(request.options) : await getOptions();
        await updateBadge(options);
        return { ok: true };
    }

    if (request.action === "getStatus") {
        const snapshot = await getStatusSnapshot();
        return { ok: true, snapshot };
    }

    if (request.action === "scanDuplicates") {
        const result = await scanDuplicates();
        return { ok: true, ...result };
    }

    if (request.action === "closeDuplicates") {
        const result = await closeDuplicateTabs();
        await updateBadge();
        return { ok: true, ...result };
    }

    if (request.action === "closeDomainTabs") {
        const result = await closeDomainTabs(request.domain);
        await updateBadge();
        return { ok: true, ...result };
    }

    if (request.action === "saveCurrentSession") {
        const result = await saveCurrentSession(request.name);
        return { ok: true, session: result };
    }

    if (request.action === "listSessions") {
        const sessions = await listSessions();
        return { ok: true, sessions };
    }

    if (request.action === "restoreSession") {
        const result = await restoreSession(request.sessionId);
        await updateBadge();
        return { ok: true, ...result };
    }

    if (request.action === "renameSession") {
        await renameSession(request.sessionId, request.name);
        return { ok: true };
    }

    if (request.action === "deleteSession") {
        await deleteSession(request.sessionId);
        return { ok: true };
    }

    if (request.action === "saveOptions") {
        const options = await sanitizeAndStoreOptions(request.options || {});
        const synced = await syncGroupRulesWithOpenGroups(options);
        await updateBadge(synced);
        return { ok: true, options: synced };
    }

    if (request.action === "showStatusNotification") {
        await showStatusNotification();
        return { ok: true };
    }

    return null;
};

const init = async () => {
    const existing = await storageSyncGet(null);
    const options = sanitizeOptions(existing);

    const patch = {
        defaultOptions: DEFAULT_OPTIONS,
    };

    for (const [key, value] of Object.entries(options)) {
        if (!(key in existing)) {
            patch[key] = value;
        }
    }

    if (Object.keys(patch).length > 0) {
        await storageSyncSet(patch);
    }

    ensureRecurringAlarm();

    const synced = await syncGroupRulesWithOpenGroups(options);
    await updateBadge(synced);
};

const triggerRefresh = async () => {
    try {
        const options = await getOptions();
        await updateBadge(options);
    } catch (error) {
        console.error("Refresh failed:", error);
    }
};

const handleTabEvent = async (tab) => {
    try {
        const options = await getOptions();
        await enforceForTab(tab, options);
        await updateBadge(options);
    } catch (error) {
        console.error("Error handling tab event:", error);
    }
};

chrome.runtime.onInstalled.addListener(() => {
    init().catch((error) => console.error("Init failed on install:", error));
});

if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
        init().catch((error) => console.error("Init failed on startup:", error));
    });
}

chrome.tabs.onCreated.addListener((tab) => {
    handleTabEvent(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const shouldCheck =
        Object.prototype.hasOwnProperty.call(changeInfo, "url") ||
        Object.prototype.hasOwnProperty.call(changeInfo, "pinned") ||
        Object.prototype.hasOwnProperty.call(changeInfo, "groupId");

    if (shouldCheck) {
        handleTabEvent(tab);
        return;
    }

    triggerRefresh();
});

chrome.tabs.onRemoved.addListener(() => {
    triggerRefresh();
});

if (chrome.tabs.onAttached) {
    chrome.tabs.onAttached.addListener(() => {
        triggerRefresh();
    });
}

if (chrome.tabs.onDetached) {
    chrome.tabs.onDetached.addListener(() => {
        triggerRefresh();
    });
}

if (chrome.tabs.onMoved) {
    chrome.tabs.onMoved.addListener(() => {
        triggerRefresh();
    });
}

if (chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener(() => {
        triggerRefresh();
    });
}

if (chrome.windows.onCreated) {
    chrome.windows.onCreated.addListener(() => {
        triggerRefresh();
    });
}

if (chrome.windows.onRemoved) {
    chrome.windows.onRemoved.addListener(() => {
        triggerRefresh();
    });
}

if (chrome.tabGroups && chrome.tabGroups.onUpdated) {
    chrome.tabGroups.onUpdated.addListener(async () => {
        try {
            const options = await getOptions();
            await syncGroupRulesWithOpenGroups(options);
            await updateBadge();
        } catch (error) {
            console.error("Failed to sync tab groups:", error);
        }
    });
}

if (chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (!alarm || alarm.name !== "schedule-tick") {
            return;
        }

        triggerRefresh();
    });
}

if (chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener((command) => {
        if (command === "show-status") {
            showStatusNotification().catch((error) => {
                console.error("Failed to show status notification:", error);
            });
        }
    });
}

chrome.notifications.onButtonClicked.addListener((notificationId) => {
    if (!notificationId || !notificationId.startsWith(`${NOTIFICATION_ID_PREFIX}-warn-`)) {
        return;
    }

    clearNotification(notificationId);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "showToast") {
        // Toast relay messages are handled by open UI pages.
        return false;
    }

    handleRuntimeMessage(request)
        .then((response) => {
            sendResponse(response || { ok: false });
        })
        .catch((error) => {
            sendResponse({
                ok: false,
                error: error && error.message ? error.message : "Unknown error",
            });
        });

    return true;
});

init().catch((error) => {
    console.error("Initialization failed:", error);
});
