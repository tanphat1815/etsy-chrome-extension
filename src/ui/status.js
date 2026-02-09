import { setClass, setText } from './dom-helpers.js';

export function setTeeinblueStatus(elStatus, text, kind = "muted") {
  setClass(elStatus, `${kind} status`);
  setText(elStatus, text);
}

export function setMainStatus(elStatus, text, kind = "muted") {
  setClass(elStatus, `footer ${kind}`);
  setText(elStatus, text);
}

export function showTargetState(elNotOnTarget, elOnTarget, isOnTarget) {
  elNotOnTarget.classList.toggle("hidden", isOnTarget);
  elOnTarget.classList.toggle("hidden", !isOnTarget);
}
