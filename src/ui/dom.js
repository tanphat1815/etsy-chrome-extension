/**
 * Define DOM selectors (popup page).
 */
export function getDomRefs() {
  return {
    apiKeyInput: document.getElementById("apiKeyInput"),
    submitBtn: document.getElementById("submit"),
    teeinblueStatus: document.getElementById("teeinblueStatus"),

    stateNotOnTarget: document.getElementById("stateNotOnTarget"),
    stateOnTarget: document.getElementById("stateOnTarget"),
    redirectLink: document.getElementById("redirectLink"),

    currentUrl: document.getElementById("currentUrl"),

    scanBtn: document.getElementById("scanBtn"),
    syncAllBtn: document.getElementById("syncAllBtn"),
    mainStatus: document.getElementById("mainStatus"),
    ordersList: document.getElementById("ordersList"),

    langSel: document.getElementById("languageSelect"),
  };
}
