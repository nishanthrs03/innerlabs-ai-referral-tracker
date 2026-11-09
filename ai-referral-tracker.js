(function () {
  "use strict";

  var COOKIE_NAME = "innerlabs_ai_referral";
  var COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
  var CONSENT_RETRY_INTERVAL_MS = 2000;
  var CONSENT_MAX_RETRIES = 30;

  var AI_SOURCES = [
    { name: "chatgpt", domains: ["chatgpt.com", "chat.openai.com"] },
    { name: "perplexity", domains: ["perplexity.ai"] },
    { name: "gemini", domains: ["gemini.google.com"] },
    { name: "copilot", domains: ["copilot.microsoft.com"] },
    { name: "claude", domains: ["claude.ai"] }
  ];

  var DEFAULT_FIELD_NAMES = {
    source: "innerlabs_ai_referral_source",
    landingPage: "innerlabs_ai_referral_landing_page",
    firstSeenAt: "innerlabs_ai_referral_first_seen_at"
  };

  var scriptTag = document.currentScript;
  var siteKey = readScriptAttribute("data-site");
  var fieldNames = DEFAULT_FIELD_NAMES;
  var aiReferral = null;

  function readScriptAttribute(attributeName) {
    if (!scriptTag) {
      return null;
    }
    return scriptTag.getAttribute(attributeName);
  }

  function buildFieldNames(fieldMapText) {
    var names = {
      source: DEFAULT_FIELD_NAMES.source,
      landingPage: DEFAULT_FIELD_NAMES.landingPage,
      firstSeenAt: DEFAULT_FIELD_NAMES.firstSeenAt
    };
    if (!fieldMapText) {
      return names;
    }
    var fieldMap = JSON.parse(fieldMapText);
    for (var key in names) {
      var defaultName = names[key];
      if (fieldMap[defaultName]) {
        names[key] = fieldMap[defaultName];
      }
    }
    return names;
  }

  function findAiSourceByReferrer() {
    if (!document.referrer) {
      return null;
    }
    var referrerHost = new URL(document.referrer).hostname.toLowerCase();
    for (var i = 0; i < AI_SOURCES.length; i++) {
      var aiSource = AI_SOURCES[i];
      for (var j = 0; j < aiSource.domains.length; j++) {
        var domain = aiSource.domains[j];
        if (referrerHost === domain || referrerHost.endsWith("." + domain)) {
          return aiSource.name;
        }
      }
    }
    return null;
  }

  function findAiSourceByUtmSource() {
    var utmSource = new URLSearchParams(window.location.search).get("utm_source");
    if (!utmSource) {
      return null;
    }
    utmSource = utmSource.toLowerCase();
    for (var i = 0; i < AI_SOURCES.length; i++) {
      var aiSource = AI_SOURCES[i];
      if (utmSource === aiSource.name) {
        return aiSource.name;
      }
      for (var j = 0; j < aiSource.domains.length; j++) {
        if (utmSource.indexOf(aiSource.domains[j]) !== -1) {
          return aiSource.name;
        }
      }
    }
    return null;
  }

  function detectAiReferral() {
    var source = findAiSourceByReferrer();
    if (!source) {
      source = findAiSourceByUtmSource();
    }
    if (!source) {
      return null;
    }
    return {
      source: source,
      landingPage: window.location.pathname,
      firstSeenAt: new Date().toISOString()
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

  function readSavedAiReferral() {
    var cookies = document.cookie.split("; ");
    for (var i = 0; i < cookies.length; i++) {
      var separatorIndex = cookies[i].indexOf("=");
      var cookieName = cookies[i].substring(0, separatorIndex);
      if (cookieName === COOKIE_NAME) {
        return JSON.parse(decodeURIComponent(cookies[i].substring(separatorIndex + 1)));
      }
    }
    return null;
  }

  function saveAiReferral(referral) {
    var cookieValue = encodeURIComponent(JSON.stringify(referral));
    var hostLabels = window.location.hostname.split(".");
    for (var i = hostLabels.length - 2; i >= 0; i--) {
      var candidateDomain = hostLabels.slice(i).join(".");
      document.cookie = COOKIE_NAME + "=" + cookieValue + "; max-age=" + COOKIE_MAX_AGE_SECONDS +
        "; path=/; domain=" + candidateDomain + "; SameSite=Lax";
      if (readSavedAiReferral()) {
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
    if (!aiReferral || !isTrackingAllowed()) {
      return;
    }
    fillField(form, fieldNames.source, aiReferral.source);
    fillField(form, fieldNames.landingPage, aiReferral.landingPage);
    fillField(form, fieldNames.firstSeenAt, aiReferral.firstSeenAt);
  }

  function fillAllForms() {
    for (var i = 0; i < document.forms.length; i++) {
      fillForm(document.forms[i]);
    }
  }

  function saveWhenAllowed(referral) {
    var retryCount = 0;
    var tryToSave = function () {
      if (isTrackingAllowed()) {
        saveAiReferral(referral);
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
    var savedAiReferral = readSavedAiReferral();
    if (savedAiReferral) {
      aiReferral = savedAiReferral;
    } else {
      aiReferral = detectAiReferral();
      if (aiReferral) {
        saveWhenAllowed(aiReferral);
      }
    }
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
