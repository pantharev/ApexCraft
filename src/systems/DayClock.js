// The clock: how long a day lasts and what part of it a moment falls in.
// Pure numbers — no three.js, no DOM — so the rules can be tested on their own
// (dayClockTest.js) and shared by the sky (DayNight.js), the mobs and the HUD.
//
// A day is 20 minutes, split the way Minecraft splits its 24,000 ticks:
//
//   day     06:00 – 18:00   10 min       the sun is up
//   dusk    18:00 – 19:00   50 s         the sun has set; the sky is going dark
//   night   19:00 – 05:00   8 min 20 s   monsters spawn, beds work
//   dawn    05:00 – 06:00   50 s         first light, before the sun is up
//
// Time of day is `t` in [0, 1): 0 = sunrise (06:00), 0.25 = noon, 0.5 = sunset
// (18:00), 0.75 = midnight. That is what saves store and the host broadcasts,
// so the length of the day can change without touching either.

export const DAY_SECONDS = 1200;
export const TICKS = 24000;                 // Minecraft's ticks in a day, for reading the table above

export const SUNSET = 12000 / TICKS;        // 0.5
export const NIGHT_START = 13000 / TICKS;   // dusk ends
export const NIGHT_END = 23000 / TICKS;     // dawn begins
// Beds work a little either side of the night proper, as in Minecraft.
export const SLEEP_FROM = 12542 / TICKS;
export const SLEEP_UNTIL = 23460 / TICKS;

export const NEW_WORLD_T = 0.03;            // a new world opens just after sunrise: a whole day ahead
export const WAKE_T = 0.01;                 // ...and a night slept through ends at sunrise

// How far below the horizon the sun is (as the sine of its angle) when dusk
// ends and when dawn begins. The sky's colours are timed against this, so that
// dark falls exactly over the 50 seconds of dusk.
export const TWILIGHT = Math.sin((NIGHT_START - SUNSET) * Math.PI * 2);

// Into [0, 1). (Not ((t % 1) + 1) % 1: adding 1 costs the last bits, which
// would put a moment exactly on a boundary on the wrong side of it.)
const wrap = (t) => t - Math.floor(t);

export function phaseOf(t) {
  t = wrap(t);
  if (t < SUNSET) return 'day';
  if (t < NIGHT_START) return 'dusk';
  if (t < NIGHT_END) return 'night';
  return 'dawn';
}

// Night proper: when monsters spawn and villagers head home.
export const isNightAt = (t) => phaseOf(t) === 'night';
// The sun is above the horizon: when the undead burn.
export const sunUpAt = (t) => wrap(t) < SUNSET;
export const canSleepAt = (t) => { t = wrap(t); return t >= SLEEP_FROM && t < SLEEP_UNTIL; };

// How long each part of the day lasts, in seconds, for a day of `daySeconds`.
export function phaseSeconds(daySeconds = DAY_SECONDS) {
  return {
    day: SUNSET * daySeconds,
    dusk: (NIGHT_START - SUNSET) * daySeconds,
    night: (NIGHT_END - NIGHT_START) * daySeconds,
    dawn: (1 - NIGHT_END) * daySeconds,
  };
}

// 24-hour clock string for the HUD (t = 0 is 06:00).
export function clockOf(t) {
  const minutes = Math.floor(((wrap(t) * 24 + 6) % 24) * 60 + 1e-6);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
