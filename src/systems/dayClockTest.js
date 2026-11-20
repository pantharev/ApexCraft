// The day clock's rules (DayClock.js). Plain Node: `node src/systems/dayClockTest.js`.
import {
  DAY_SECONDS, SUNSET, NIGHT_START, NIGHT_END, NEW_WORLD_T, WAKE_T, TWILIGHT,
  phaseOf, isNightAt, sunUpAt, canSleepAt, phaseSeconds, clockOf,
} from './DayClock.js';

let fails = 0;
function ok(cond, msg) {
  console.log(`${cond ? 'ok' : 'FAIL'} - ${msg}`);
  if (!cond) fails++;
}
const near = (a, b) => Math.abs(a - b) < 1e-6;

// The lengths the game promises.
const s = phaseSeconds();
ok(DAY_SECONDS === 1200, 'a full day is 20 minutes');
ok(near(s.day, 600), `daytime lasts 10 minutes (${s.day} s)`);
ok(near(s.dusk, 50) && near(s.dawn, 50), `dusk and dawn last 50 seconds each (${s.dusk} s, ${s.dawn} s)`);
ok(near(s.night, 500), `night lasts 8 minutes 20 seconds (${s.night} s)`);
ok(near(s.day + s.dusk + s.night + s.dawn, DAY_SECONDS), 'the four parts add up to the day');

// Which part a moment falls in.
ok(phaseOf(0) === 'day' && phaseOf(0.25) === 'day' && phaseOf(SUNSET - 1e-9) === 'day', 'sunrise to sunset is day');
ok(phaseOf(SUNSET) === 'dusk' && phaseOf(NIGHT_START - 1e-9) === 'dusk', 'the 50 seconds after sunset are dusk');
ok(phaseOf(NIGHT_START) === 'night' && phaseOf(0.75) === 'night' && phaseOf(NIGHT_END - 1e-9) === 'night', 'then night, through midnight');
ok(phaseOf(NIGHT_END) === 'dawn' && phaseOf(1 - 1e-9) === 'dawn', 'the last 50 seconds are dawn');
ok(phaseOf(1) === 'day' && phaseOf(1.25) === 'day' && phaseOf(-0.25) === 'night', 'time wraps round');

// The rules that hang off it.
ok(!isNightAt(0.52) && isNightAt(0.6) && !isNightAt(0.97), 'monsters wait for night proper: not dusk, not dawn');
ok(sunUpAt(0.1) && !sunUpAt(0.52) && !sunUpAt(0.97), 'the undead burn only while the sun is up: not at dusk, not before sunrise');
ok(!canSleepAt(0.4) && !canSleepAt(0.51) && canSleepAt(0.53) && canSleepAt(0.75) && canSleepAt(0.97) && !canSleepAt(0.99),
  'beds work from mid-dusk to mid-dawn');
ok(phaseOf(NEW_WORLD_T) === 'day' && NEW_WORLD_T < 0.05, 'a new world starts just after sunrise');
ok(phaseOf(WAKE_T) === 'day' && !canSleepAt(WAKE_T), 'sleeping ends at sunrise, and you cannot go straight back to bed');
ok(phaseOf(0.78) === 'night' && !sunUpAt(0.78), 'the Zombies night lock (t = 0.78) is night');

// The HUD clock.
ok(clockOf(0) === '06:00' && clockOf(0.25) === '12:00' && clockOf(SUNSET) === '18:00', 'sunrise 06:00, noon 12:00, sunset 18:00');
ok(clockOf(NIGHT_START) === '19:00' && clockOf(0.75) === '00:00' && clockOf(NIGHT_END) === '05:00', 'night 19:00 to 05:00, midnight between');

// The sky times its colours against the sun's depth at the end of dusk.
ok(near(TWILIGHT, Math.sin(Math.PI / 12)), 'dusk ends with the sun 15 degrees below the horizon');

console.log(`\n${fails === 0 ? 'DAY CLOCK TESTS PASSED' : `${fails} DAY CLOCK TEST(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
