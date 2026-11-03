/** The page's elements that the app reads and writes. */
export interface Elements {
  status: HTMLElement;
  key: HTMLElement;
  whenShort: HTMLElement;
  scoreCanvas: HTMLCanvasElement;
  cursorCanvas: HTMLCanvasElement;
  play: HTMLButtonElement;
  playLabel: HTMLElement;
  mute: HTMLButtonElement;
  volume: HTMLInputElement;
  headline: HTMLElement;
  mixline: HTMLElement;
  intensityline: HTMLElement;
  when: HTMLElement;
  ribbonCanvas: HTMLCanvasElement;
  scrub: HTMLInputElement;
  yesterday: HTMLButtonElement;
  yesterdayQuick: HTMLButtonElement;
  onwards: HTMLButtonElement;
  live: HTMLButtonElement;
  liveQuick: HTMLButtonElement;
  credit: HTMLElement;
  stage: HTMLElement;
  region: HTMLSelectElement;
  shortcuts: HTMLInputElement;
  ladder: HTMLElement;
  voices: HTMLElement;
  announcer: HTMLElement;
  recordForm: HTMLFormElement;
  recordDate: HTMLInputElement;
  recordPress: HTMLButtonElement;
  recordStatus: HTMLElement;
  recordResult: HTMLElement;
  recordPlay: HTMLButtonElement;
  recordWav: HTMLAnchorElement;
  recordPng: HTMLAnchorElement;
  recordNotes: HTMLElement;
  sleeve: HTMLCanvasElement;
  sleeveCaption: HTMLElement;
  ossia: HTMLButtonElement;
  ossiaNotes: HTMLElement;
  ossiaTable: HTMLTableElement;
  ossiaFallback: HTMLElement;
  ossiaLoudness: HTMLElement;
  ossiaKey: HTMLElement;
  keyRule: HTMLElement;
}

function $<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`#${id} is missing from the page`);
  return node;
}

/** Finds every element the app drives; fails loudly if the page is missing one. */
export function elements(): Elements {
  return {
    status: $('status', HTMLElement),
    key: $('key', HTMLElement),
    whenShort: $('when-short', HTMLElement),
    scoreCanvas: $('score', HTMLCanvasElement),
    cursorCanvas: $('cursor', HTMLCanvasElement),
    play: $('play', HTMLButtonElement),
    playLabel: $('play-label', HTMLElement),
    mute: $('mute', HTMLButtonElement),
    volume: $('volume', HTMLInputElement),
    headline: $('headline', HTMLElement),
    mixline: $('mixline', HTMLElement),
    intensityline: $('intensityline', HTMLElement),
    when: $('when', HTMLElement),
    ribbonCanvas: $('ribbon', HTMLCanvasElement),
    scrub: $('scrub', HTMLInputElement),
    yesterday: $('yesterday', HTMLButtonElement),
    yesterdayQuick: $('yesterday-quick', HTMLButtonElement),
    liveQuick: $('live-quick', HTMLButtonElement),
    credit: $('credit', HTMLElement),
    stage: $('stage', HTMLElement),
    region: $('region', HTMLSelectElement),
    shortcuts: $('shortcuts', HTMLInputElement),
    onwards: $('onwards', HTMLButtonElement),
    live: $('live', HTMLButtonElement),
    ladder: $('ladder', HTMLElement),
    voices: $('voices', HTMLElement),
    announcer: $('announcer', HTMLElement),
    recordForm: $('record-form', HTMLFormElement),
    recordDate: $('record-date', HTMLInputElement),
    recordPress: $('record-press', HTMLButtonElement),
    recordStatus: $('record-status', HTMLElement),
    recordResult: $('record-result', HTMLElement),
    recordPlay: $('record-play', HTMLButtonElement),
    recordWav: $('record-wav', HTMLAnchorElement),
    recordPng: $('record-png', HTMLAnchorElement),
    recordNotes: $('record-notes', HTMLElement),
    sleeve: $('sleeve', HTMLCanvasElement),
    sleeveCaption: $('sleeve-caption', HTMLElement),
    ossia: $('ossia', HTMLButtonElement),
    ossiaNotes: $('ossia-notes', HTMLElement),
    ossiaTable: $('ossia-table', HTMLTableElement),
    ossiaFallback: $('ossia-fallback', HTMLElement),
    ossiaLoudness: $('ossia-loudness', HTMLElement),
    ossiaKey: $('ossia-key', HTMLElement),
    keyRule: $('key-rule', HTMLElement),
  };
}
