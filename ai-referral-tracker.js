(function () {
  "use strict";

  var COOKIE_NAME = "innerlabs_attribution";
  var COOKIE_VERSION = 1;
  var COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
  var AI_SOURCE_WINDOW_MS = COOKIE_MAX_AGE_SECONDS * 1000;
  var VISIT_TIMEOUT_MS = 30 * 60 * 1000;
  var DIRECT_SOURCE = "direct";
  var CONSENT_RETRY_INTERVAL_MS = 2000;
  var CONSENT_MAX_RETRIES = 30;

  var AI_SOURCES = [
    { id: "chatgpt", label: "ChatGPT", domains: ["chatgpt.com", "chat.openai.com"] },
    { id: "perplexity", label: "Perplexity", domains: ["perplexity.ai"] },
    { id: "gemini", label: "Gemini", domains: ["gemini.google.com"] },
    { id: "copilot", label: "Copilot", domains: ["copilot.microsoft.com"] },
    { id: "claude", label: "Claude", domains: ["claude.ai"] },
    { id: "deepseek", label: "DeepSeek", domains: ["chat.deepseek.com"] },
    { id: "grok", label: "Grok", domains: ["grok.com"] },
    { id: "metaai", label: "Meta AI", domains: ["meta.ai"] },
    { id: "mistral", label: "Mistral", domains: ["chat.mistral.ai"] },
    { id: "you", label: "You.com", domains: ["you.com"] },
    { id: "phind", label: "Phind", domains: ["phind.com"] },
    { id: "poe", label: "Poe", domains: ["poe.com"] }
  ];

  var DEFAULT_FIELD_NAMES = {
    firstSource: "innerlabs_first_source",
    lastSource: "innerlabs_last_source",
    aiSources: "innerlabs_ai_sources"
  };

  var scriptTag = document.currentScript;
  var siteKey = readScriptAttribute("data-site");
  var fieldNames = DEFAULT_FIELD_NAMES;
  var attribution = null;

  function readScriptAttribute(attributeName) {
    if (!scriptTag) {
      return null;
    }
    return scriptTag.getAttribute(attributeName);
  }

  function buildFieldNames(fieldMapText) {
    var names = {};
    for (var key in DEFAULT_FIELD_NAMES) {
      names[key] = DEFAULT_FIELD_NAMES[key];
    }
    if (!fieldMapText) {
      return names;
    }
    var fieldMap = JSON.parse(fieldMapText);
    for (var fieldKey in names) {
      var defaultName = names[fieldKey];
      if (fieldMap[defaultName]) {
        names[fieldKey] = fieldMap[defaultName];
      }
    }
    return names;
  }

  function removeWwwPrefix(hostname) {
    if (hostname.indexOf("www.") === 0) {
      return hostname.substring(4);
    }
    return hostname;
  }

  function readReferrerHost() {
    if (!document.referrer) {
      return null;
    }
    return new URL(document.referrer).hostname.toLowerCase();
  }

  function readUtmSource() {
    var utmSource = new URLSearchParams(window.location.search).get("utm_source");
    if (!utmSource) {
      return null;
    }
    return utmSource.toLowerCase();
  }

  function isInternalHost(referrerHost) {
    var siteHost = removeWwwPrefix(window.location.hostname.toLowerCase());
    var referrerSiteHost = removeWwwPrefix(referrerHost);
    if (referrerSiteHost === siteHost) {
      return true;
    }
    if (referrerSiteHost.endsWith("." + siteHost)) {
      return true;
    }
    return siteHost.endsWith("." + referrerSiteHost);
  }

  function findAiSourceByReferrer(referrerHost) {
    if (!referrerHost) {
      return null;
    }
    for (var i = 0; i < AI_SOURCES.length; i++) {
      var aiSource = AI_SOURCES[i];
      for (var j = 0; j < aiSource.domains.length; j++) {
        var domain = aiSource.domains[j];
        if (referrerHost === domain || referrerHost.endsWith("." + domain)) {
          return aiSource;
        }
      }
    }
    return null;
  }

  function findAiSourceByUtmSource(utmSource) {
    if (!utmSource) {
      return null;
    }
    for (var i = 0; i < AI_SOURCES.length; i++) {
      var aiSource = AI_SOURCES[i];
      if (utmSource === aiSource.id) {
        return aiSource;
      }
      for (var j = 0; j < aiSource.domains.length; j++) {
        if (utmSource.indexOf(aiSource.domains[j]) !== -1) {
          return aiSource;
        }
      }
    }
    return null;
  }

  function detectVisit() {
    var referrerHost = readReferrerHost();
    var utmSource = readUtmSource();
    var aiSource = findAiSourceByReferrer(referrerHost);
    if (!aiSource) {
      aiSource = findAiSourceByUtmSource(utmSource);
    }

    var source = DIRECT_SOURCE;
    var isInternalNavigation = false;
    if (utmSource) {
      source = utmSource;
    } else if (referrerHost && isInternalHost(referrerHost)) {
      isInternalNavigation = true;
    } else if (referrerHost) {
      source = removeWwwPrefix(referrerHost);
    }

    return {
      source: source,
      aiSource: aiSource,
      isInternalNavigation: isInternalNavigation
    };
  }

  function recordAiSource(aiSources, aiSource, now) {
    for (var i = 0; i < aiSources.length; i++) {
      if (aiSources[i].label === aiSource.label) {
        aiSources[i].seenAt = now;
        return;
      }
    }
    aiSources.push({ label: aiSource.label, seenAt: now });
  }

  function removeExpiredAiSources(aiSources, now) {
    var activeAiSources = [];
    for (var i = 0; i < aiSources.length; i++) {
      if (now - aiSources[i].seenAt <= AI_SOURCE_WINDOW_MS) {
        activeAiSources.push(aiSources[i]);
      }
    }
    return activeAiSources;
  }

  function buildAttribution(savedAttribution, now) {
    var updatedAttribution = savedAttribution;
    if (!updatedAttribution) {
      updatedAttribution = {
        v: COOKIE_VERSION,
        firstSource: null,
        lastSource: null,
        aiSources: [],
        lastSeenAt: 0
      };
    }

    var visit = detectVisit();
    var isVisitExpired = now - updatedAttribution.lastSeenAt > VISIT_TIMEOUT_MS;
    var isContinuingVisit = visit.isInternalNavigation;
    if (visit.source === DIRECT_SOURCE && !isVisitExpired) {
      isContinuingVisit = true;
    }

    if (!isContinuingVisit || !updatedAttribution.lastSource) {
      updatedAttribution.lastSource = visit.source;
    }
    if (!updatedAttribution.firstSource) {
      updatedAttribution.firstSource = updatedAttribution.lastSource;
    }
    if (visit.aiSource) {
      recordAiSource(updatedAttribution.aiSources, visit.aiSource, now);
    }
    updatedAttribution.aiSources = removeExpiredAiSources(updatedAttribution.aiSources, now);
    updatedAttribution.lastSeenAt = now;
    return updatedAttribution;
  }

  function joinAiSourceLabels(aiSources) {
    var labels = [];
    for (var i = 0; i < aiSources.length; i++) {
      labels.push(aiSources[i].label);
    }
    return labels.join(";");
  }

  function getAttribution() {
    if (!attribution || !isTrackingAllowed()) {
      return null;
    }
    return {
      firstSource: attribution.firstSource,
      lastSource: attribution.lastSource,
      aiSources: joinAiSourceLabels(attribution.aiSources)
    };
  }

  function readGoogleConsentState() {
    var dataLayer = window.dataLayer;
    if (!Array.isArray(dataLayer)) {
      return null;
    }
    var analyticsStorage = null;
    for (var i = 0; i < dataLayer.length; i++) {
      var entry = dataLayer[i];
      if (entry && entry[0] === "consent" && entry[2] && entry[2].analytics_storage) {
        analyticsStorage = entry[2].analytics_storage;
      }
    }
    return analyticsStorage;
  }

  function getConsentState() {
    var googleConsentState = readGoogleConsentState();
    if (googleConsentState) {
      return googleConsentState;
    }
    if (window.Cookiebot && window.Cookiebot.consent) {
      if (window.Cookiebot.consent.statistics) {
        return "granted";
      }
      return "denied";
    }
    if (typeof window.OnetrustActiveGroups === "string") {
      if (window.OnetrustActiveGroups.indexOf("C0002") !== -1) {
        return "granted";
      }
      return "denied";
    }
    return "none";
  }

  function isTrackingAllowed() {
    var consentState = getConsentState();
    return consentState === "granted" || consentState === "none";
  }

  function readSavedAttribution() {
    var cookies = document.cookie.split("; ");
    for (var i = 0; i < cookies.length; i++) {
      var separatorIndex = cookies[i].indexOf("=");
      var cookieName = cookies[i].substring(0, separatorIndex);
      if (cookieName !== COOKIE_NAME) {
        continue;
      }
      try {
        var savedAttribution = JSON.parse(decodeURIComponent(cookies[i].substring(separatorIndex + 1)));
        if (savedAttribution.v === COOKIE_VERSION) {
          return savedAttribution;
        }
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  function saveAttribution(attributionToSave) {
    var cookieValue = encodeURIComponent(JSON.stringify(attributionToSave));
    var hostLabels = window.location.hostname.split(".");
    for (var i = hostLabels.length - 2; i >= 0; i--) {
      var candidateDomain = hostLabels.slice(i).join(".");
      document.cookie = COOKIE_NAME + "=" + cookieValue + "; max-age=" + COOKIE_MAX_AGE_SECONDS +
        "; path=/; domain=" + candidateDomain + "; SameSite=Lax";
      if (readSavedAttribution()) {
        return;
      }
    }
    document.cookie = COOKIE_NAME + "=" + cookieValue + "; max-age=" + COOKIE_MAX_AGE_SECONDS + "; path=/; SameSite=Lax";
  }

  function setFieldValue(input, value) {
    var valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillField(form, fieldName, value) {
    if (!value) {
      return;
    }
    var existingInput = form.querySelector('[name="' + fieldName + '"]');
    if (existingInput) {
      if (!existingInput.value) {
        setFieldValue(existingInput, value);
      }
      return;
    }
    var hiddenInput = document.createElement("input");
    hiddenInput.type = "hidden";
    hiddenInput.name = fieldName;
    hiddenInput.value = value;
    form.appendChild(hiddenInput);
  }

  function fillForm(form) {
    var currentAttribution = getAttribution();
    if (!currentAttribution) {
      return;
    }
    fillField(form, fieldNames.firstSource, currentAttribution.firstSource);
    fillField(form, fieldNames.lastSource, currentAttribution.lastSource);
    fillField(form, fieldNames.aiSources, currentAttribution.aiSources);
  }

  function fillAllForms() {
    for (var i = 0; i < document.forms.length; i++) {
      fillForm(document.forms[i]);
    }
  }

  function saveWhenAllowed(attributionToSave) {
    var retryCount = 0;
    var tryToSave = function () {
      if (isTrackingAllowed()) {
        saveAttribution(attributionToSave);
        fillAllForms();
        return;
      }
      retryCount++;
      if (retryCount < CONSENT_MAX_RETRIES) {
        setTimeout(tryToSave, CONSENT_RETRY_INTERVAL_MS);
      }
    };
    tryToSave();
  }

  function watchForNewForms() {
    var observer = new MutationObserver(fillAllForms);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener("submit", function (event) {
      fillForm(event.target);
    }, true);

    window.addEventListener("message", function (event) {
      if (event.data && event.data.type === "hsFormCallback" && event.data.eventName === "onFormReady") {
        fillAllForms();
      }
    });
  }

  function start() {
    fieldNames = buildFieldNames(readScriptAttribute("data-field-map"));
    attribution = buildAttribution(readSavedAttribution(), Date.now());
    window.InnerLabs = { getAttribution: getAttribution };
    saveWhenAllowed(attribution);
    fillAllForms();
    watchForNewForms();
  }

  try {
    if (!siteKey) {
      return;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        try {
          start();
        } catch (error) {
          return;
        }
      });
    } else {
      start();
    }
  } catch (error) {
    return;
  }
})();
