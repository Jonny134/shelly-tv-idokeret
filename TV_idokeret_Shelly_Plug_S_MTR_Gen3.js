/*
======================================================
TV NAPI IDOLIMIT + LED + DASHBOARD + BONUSZIDO
Shelly Plug S MTR Gen3
======================================================

FOGYASZTAS:
> 30 W = TV-hasznalat szamlalasa
Napi alapkeret = 120 perc
Bonusz = +20 perc / gombnyomas

DASHBOARD:
number:200 = Hatralevo ido (perc)
number:201 = Mai felhasznalt ido (perc) - UJ
button:200 = +20 perc

LED:
> 60 perc = ZOLD
31-60 perc = SARGA
11-30 perc = PIROS
1-10 perc = VILLOGO PIROS
0 perc = SOTETKEK + TV OFF

LED szinvaltasnal:
LED mode OFF -> SWITCH
(A TV relejet NEM kapcsoljuk)
======================================================
*/

let TV_WATTS = 30;
let DAILY_LIMIT = 120 * 60;
let BONUS_STEP = 20 * 60;

let CHECK_INTERVAL = 5;
let SAVE_INTERVAL = 30;

let used = 0;
let bonus = 0;
let savedUsed = 0;
let savedDay = 0;
let locked = false;

let ledState = "";
let ledBusy = false;
let blinkOn = true;

let shownMinutes = -1;
let shownUsedMinutes = -1; // UJ: aktualisan megjelenitett felhasznalt percek

let GREEN = [0, 100, 0];
let YELLOW = [100, 100, 0];
let RED = [100, 0, 0];
let DARK_BLUE = [0, 0, 100];

let display = Virtual.getHandle("number:200");
let usedDisplay = Virtual.getHandle("number:201"); // UJ
let bonusButton = Virtual.getHandle("button:200");

function getTotalLimit() {
  return DAILY_LIMIT + bonus;
}

function getRemaining() {
  let remaining = getTotalLimit() - used;
  if (remaining < 0) remaining = 0;
  return remaining;
}

// DASHBOARD: mindket szamkomponenst frissitjuk.
function updateDisplay() {
  let remainingMinutes = Math.ceil(getRemaining() / 60);
  if (remainingMinutes > 1440) remainingMinutes = 1440;

  if (display && remainingMinutes !== shownMinutes) {
    shownMinutes = remainingMinutes;
    display.setValue(remainingMinutes);
  }

  let usedMinutes = Math.floor(used / 60);
  if (usedMinutes > 1440) usedMinutes = 1440;

  if (usedDisplay && usedMinutes !== shownUsedMinutes) {
    shownUsedMinutes = usedMinutes;
    usedDisplay.setValue(usedMinutes);
  }
}

function makeLEDConfig(r, g, b, brightness) {
  return {
    leds: {
      mode: "switch",
      colors: {
        "switch:0": {
          on: {rgb: [r, g, b], brightness: brightness},
          off: {rgb: [r, g, b], brightness: brightness}
        }
      }
    }
  };
}

function setLED(r, g, b, brightness, refresh, state) {
  if (ledBusy) return false;
  ledBusy = true;

  let config = makeLEDConfig(r, g, b, brightness);

  function fail(stage, err) {
    print("LED HIBA [" + stage + "]: " + err);
    ledBusy = false;
    if (refresh && ledState === state) {
      ledState = "";
    }
  }

  function applyColor() {
    Shelly.call("PLUGS_UI.SetConfig", {config: config}, function(res, err) {
      if (err !== 0) {
        fail("szin", err);
        return;
      }
      ledBusy = false;
    });
  }

  if (refresh) {
    // Csak a LED modjat kapcsoljuk ki, a TV tapellatasat nem.
    Shelly.call("PLUGS_UI.SetConfig", {
      config: {leds: {mode: "off"}}
    }, function(res, err) {
      if (err !== 0) {
        fail("frissites", err);
        return;
      }
      applyColor();
    });
  } else {
    applyColor();
  }
  return true;
}

function updateLED() {
  let remaining = getRemaining();
  let nextState = "";
  let rgb = GREEN;
  let brightness = 100;

  if (locked || remaining <= 0) {
    nextState = "finished";
    rgb = DARK_BLUE;
    brightness = 25;
  } else if (remaining <= 10 * 60) {
    nextState = "blink";
    rgb = RED;
    brightness = 100;
  } else if (remaining <= 30 * 60) {
    nextState = "red";
    rgb = RED;
    brightness = 100;
  } else if (remaining <= 60 * 60) {
    nextState = "yellow";
    rgb = YELLOW;
    brightness = 100;
  } else {
    nextState = "green";
    rgb = GREEN;
    brightness = 100;
  }

  if (ledState !== nextState) {
    if (setLED(rgb[0], rgb[1], rgb[2], brightness, true, nextState)) {
      ledState = nextState;
      blinkOn = true;
      print("LED allapot: " + nextState);
    }
  }
}

Timer.set(1000, true, function() {
  if (ledState !== "blink") return;
  if (ledBusy) return;

  blinkOn = !blinkOn;
  setLED(RED[0], RED[1], RED[2], blinkOn ? 100 : 0, false, "blink");
});

function saveState() {
  Shelly.call("KVS.Set", {
    key: "tv_daily_limit",
    value: {used: used, bonus: bonus, day: savedDay, locked: locked}
  });
  savedUsed = used;
}

function powerOn() {
  Shelly.call("Switch.Set", {id: 0, on: true});
}

function powerOff() {
  Shelly.call("Switch.Set", {id: 0, on: false});
}

function getCurrentDay(callback) {
  Shelly.call("Sys.GetStatus", {}, function(res, err) {
    if (err !== 0 || !res ||
        res.unixtime === null || res.unixtime === undefined) {
      callback(0);
      return;
    }

    let offset = res.utc_offset;
    if (typeof offset !== "number") offset = 0;
    callback(Math.floor((res.unixtime + offset) / 86400));
  });
}

function checkDay(callback) {
  getCurrentDay(function(day) {
    if (day === 0) {
      callback();
      return;
    }

    if (savedDay === 0) {
      savedDay = day;
      saveState();
      callback();
      return;
    }

    if (day !== savedDay) {
      used = 0;
      bonus = 0;
      savedUsed = 0;
      locked = false;
      savedDay = day;

      saveState();
      powerOn();
      ledState = "";
      updateLED();
      updateDisplay();
      print("UJ NAP - 120 perc TV ido.");
    }

    callback();
  });
}

function addBonus() {
  checkDay(function() {
    bonus += BONUS_STEP;
    locked = false;
    saveState();
    powerOn();

    ledState = "";
    updateLED();
    updateDisplay();

    print(
      "+20 PERC. Osszes bonusz: " + Math.floor(bonus / 60) +
      " perc. Hatralevo: " + Math.ceil(getRemaining() / 60) + " perc."
    );
  });
}

function tick() {
  checkDay(function() {
    let sw = Shelly.getComponentStatus("switch", 0);
    if (!sw) return;

    if (locked || getRemaining() <= 0) {
      if (!locked) {
        locked = true;
        saveState();
      }
      if (sw.output) powerOff();
      updateLED();
      updateDisplay();
      return;
    }

    if (sw.output && sw.apower > TV_WATTS) {
      used += CHECK_INTERVAL;

      if ((used - savedUsed) >= SAVE_INTERVAL) {
        saveState();
        print("TV ido: " + Math.floor(used / 60) +
          " / " + Math.floor(getTotalLimit() / 60) + " perc");
      }

      if (getRemaining() <= 0) {
        used = getTotalLimit();
        locked = true;
        saveState();
        powerOff();
        ledState = "";
        updateLED();
        updateDisplay();
        print("TV IDOKERET ELFOGYOTT - SOTETKEK LED");
        return;
      }
    }

    updateLED();
    updateDisplay();
  });
}

Shelly.call("KVS.Get", {key: "tv_daily_limit"}, function(res, err) {
  if (err === 0 && res && res.value) {
    used = res.value.used || 0;
    bonus = res.value.bonus || 0;
    savedUsed = used;
    savedDay = res.value.day || 0;
    locked = res.value.locked || false;

    print("Mentett TV ido: " + Math.floor(used / 60) +
      " perc. Bonusz: " + Math.floor(bonus / 60) + " perc.");
  } else {
    used = 0;
    bonus = 0;
    savedUsed = 0;
    savedDay = 0;
    locked = false;
    saveState();
  }

  checkDay(function() {
    if (locked || getRemaining() <= 0) {
      locked = true;
      powerOff();
      print("Idokeret elfogyott - TV OFF.");
    } else {
      powerOn();
      print("TV engedelyezve. Hatralevo: " +
        Math.ceil(getRemaining() / 60) + " perc.");
    }

    ledState = "";
    updateLED();
    updateDisplay();

    if (bonusButton) {
      bonusButton.on("single_push", function() {addBonus();});
      print("+20 perc gomb aktiv.");
    } else {
      print("HIBA: button:200 nem talalhato!");
    }

    if (!display) print("HIBA: number:200 nem talalhato!");
    if (!usedDisplay) print("HIBA: number:201 nem talalhato!");

    Timer.set(CHECK_INTERVAL * 1000, true, tick);
    print("TV LIMIT + LED + DASHBOARD AKTIV.");
  });
});
