import { FUELS, type Fuel, type Mix } from '../data/schema';
import { MODE_LADDER } from '../music/harmony';
import { NOTE_NAMES, pitchClasses, type Mode } from '../music/theory';
import { FUEL_NAMES, MODE_NAMES, percent } from './format';

interface VoiceNote {
  kind: string;
  text: string;
}

/** Programme notes: what each voice is, and what moves it. */
export const VOICE_NOTES: Record<Fuel, VoiceNote> = {
  wind: {
    kind: 'a slowly evolving pad',
    text: 'Four held voices that slide from chord to chord, with the hiss of moving air underneath. More wind makes it louder and wider, opens its filter and sets it swaying faster.',
  },
  solar: {
    kind: 'bright bells',
    text: 'Short figures that climb or fall through the scale on bell-like tones. They ring more often as the sun’s share grows, and stop at dusk.',
  },
  hydro: {
    kind: 'running water',
    text: 'Noise through two wandering filters, with droplets tuned to the scale falling on top. A small voice, as hydro is a small part of the grid.',
  },
  biomass: {
    kind: 'a warm, sung line',
    text: 'One voice singing through vowel-like filters, mostly moving by step and landing on a note of the chord on strong beats.',
  },
  imports: {
    kind: 'distant chords',
    text: 'Soft chords that swell in from far away whenever the harmony moves: power arriving through the cables from mainland Europe and Ireland.',
  },
  nuclear: {
    kind: 'a steady pulse',
    text: 'A soft beat on every crotchet, on the root of the chord. Nuclear output barely changes from hour to hour, so neither does the pulse.',
  },
  other: {
    kind: 'stray plucked notes',
    text: 'Everything the API files under “other”: the occasional plucked note.',
  },
  coal: {
    kind: 'harsh grit',
    text: 'Crushed, crackling noise on the bass. Britain’s last coal power station, Ratcliffe-on-Soar, closed on 30 September 2024, so this voice should stay silent.',
  },
  gas: {
    kind: 'a low drone',
    text: 'A held D and A at the bottom of the texture. As gas fills in, the drone grows louder and brighter, and on a dirty grid its strings drift out of tune and beat against each other.',
  },
};

/** Order the notes read in: the big, familiar voices first. */
const READING_ORDER: readonly Fuel[] = ['wind', 'gas', 'solar', 'nuclear', 'imports', 'biomass', 'hydro', 'other', 'coal'];

/** How each voice is written in the score. */
const WRITTEN: Record<Fuel, string> = {
  wind: 'Two staves, treble and bass, joined by a brace: a held chord each bar, with hairpins for the phrase.',
  solar: 'Treble clef sounding an octave higher; quavers and semiquavers, marked l.v. (let ring).',
  hydro: 'A one-line percussion staff: a roll for the water, crossed heads for the droplets.',
  biomass: 'Treble clef: the melody, in crotchets, quavers, minims and their dotted forms.',
  imports: 'Treble clef: chords at the start of each half-phrase, marked lontano.',
  nuclear: 'Bass clef: four crotchets every bar on the root of the chord.',
  other: 'Treble clef: the odd crotchet, marked pizz.',
  coal: 'A one-line percussion staff: semiquaver crossed heads. Rests, almost always.',
  gas: 'Bass clef sounding an octave lower: D and A held as tied semibreves.',
};

export function renderVoices(list: HTMLElement): Map<Fuel, { share: HTMLElement; button: HTMLButtonElement }> {
  const refs = new Map<Fuel, { share: HTMLElement; button: HTMLButtonElement }>();
  for (const fuel of READING_ORDER) {
    const note = VOICE_NOTES[fuel];
    const li = document.createElement('li');
    li.innerHTML = `<div><h3>${FUEL_NAMES[fuel]}<em>${note.kind}</em></h3><p>${note.text}</p><p class="written">${WRITTEN[fuel]}</p><p class="share"></p></div>`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button audition';
    button.setAttribute('aria-pressed', 'false');
    button.textContent = fuel === 'coal' ? 'Hear it anyway' : 'Hear it alone';
    button.dataset.fuel = fuel;
    li.append(button);
    list.append(li);
    const share = li.querySelector<HTMLElement>('.share');
    if (share) refs.set(fuel, { share, button });
  }
  return refs;
}

export function updateVoiceShares(refs: Map<Fuel, { share: HTMLElement }>, mix: Mix, label: string): void {
  for (const fuel of FUELS) {
    const ref = refs.get(fuel);
    if (!ref) continue;
    const s = mix[fuel];
    ref.share.textContent = s > 0 ? `${percent(s)} of generation ${label}.` : `Silent ${label}: ${FUEL_NAMES[fuel].toLowerCase()} isn’t generating.`;
  }
}

const scaleText = (mode: Mode): string => pitchClasses(mode).map((pc) => NOTE_NAMES[pc]).join(' ');

/**
 * The key rule in one plain sentence, straight from the ladder: "The cleaner
 * the grid, the brighter the key: D Lydian below 60 g CO₂/kWh, D major from
 * 60 g, … and D Phrygian from 240 g."
 */
export function keyRule(): string {
  const steps = MODE_LADDER.map((band, i) => {
    const name = `D ${MODE_NAMES[band.mode]}`;
    const next = MODE_LADDER[i + 1];
    return i === 0 ? `${name} below ${next?.from ?? 0} g CO₂/kWh` : `${name} from ${band.from} g`;
  });
  const last = steps.pop() ?? '';
  return `The cleaner the grid, the brighter the key: ${steps.join(', ')} and ${last}.`;
}

export function renderLadder(list: HTMLElement): Map<Mode, HTMLElement> {
  const items = new Map<Mode, HTMLElement>();
  MODE_LADDER.forEach((band, i) => {
    const next = MODE_LADDER[i + 1];
    const range = next ? (i === 0 ? `under ${next.from} g` : `${band.from}–${next.from} g`) : `${band.from} g and up`;
    const li = document.createElement('li');
    li.innerHTML = `<span class="range">${range}</span><span class="mode-name">D ${MODE_NAMES[band.mode]}<em>${band.marking}</em></span><span class="scale">${scaleText(band.mode)}</span>`;
    list.append(li);
    items.set(band.mode, li);
  });
  return items;
}
