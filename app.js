const wordEl = document.getElementById("word");
const phoneticEl = document.getElementById("phonetic");
const statusEl = document.getElementById("status");
const meaningEl = document.getElementById("meaning");
const nextBtn = document.getElementById("nextBtn");
const repeatBtn = document.getElementById("repeatBtn");
const showMeaningBtn = document.getElementById("showMeaningBtn");
const micBtn = document.getElementById("micBtn");
const helpBtn = document.getElementById("helpBtn");
const overlayEl = document.getElementById("touch-overlay");
const statsEl = document.getElementById("stats");
const statsCurrentEl = document.getElementById("stats-current");
const statsTotalEl = document.getElementById("stats-total");
const statsToggleBtn = document.getElementById("statsToggle");
const toggleBtns = Array.from(document.querySelectorAll(".toggle-btn"));

let words = [];
let current = null;
let recognition = null;
let listening = false;
let started = false;
let micEnabled = false;
let currentFile = "words-1500.json";
let history = [];
let historyIndex = -1;
let helpActive = false;
let statsVisible = false;
let statsExpanded = false;
const learnedWords = new Set();
const learnedOrder = [];
const learnedIndex = new Map();
const meaningWords = new Set();
const longTermLearned = new Set();
const longTermMeaning = new Set();
const LONG_TERM_KEY = "words-longterm-v1";
const IDLE_LIMIT_MS = 6 * 1000;
const TIME_SAVE_EVERY_MS = 10 * 1000;
let sessionTimeMs = 0;
let longTermTimeMs = 0;
let lastTickAt = Date.now();
let lastActiveAt = Date.now();
let lastTimeSaveAt = 0;
let windowFocused = true;

const defaultSources = ["words-1500.json", "words.json", "Worlds.json", "worlds.json"];

function extractWords(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.words)) return data.words;
  return [];
}

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .trim();
}

function splitMeaning(text) {
  return (text || "")
    .split(/[/;；,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isCorrect(transcript, word) {
  const norm = normalize(transcript);
  if (!norm) return false;

  const accept = [];
  if (word.accept && Array.isArray(word.accept)) {
    accept.push(...word.accept);
  }
  accept.push(...splitMeaning(word.cn));

  return accept.some((item) => {
    const n = normalize(item);
    if (n.length < 2) return false;
    return norm.includes(n) || n.includes(norm);
  });
}

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.classList.toggle("hidden", !text);
  statusEl.classList.remove("ok", "bad");
  if (type) statusEl.classList.add(type);
}

function speakWord(word) {
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(word.en);
  utter.lang = "en-US";
  utter.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

function wordKey(word) {
  if (!word) return "";
  return `${word.en}||${word.cn || ""}`;
}

function loadLongTermStats() {
  if (!window.localStorage) return;
  try {
    const raw = localStorage.getItem(LONG_TERM_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.learned)) {
      data.learned.forEach((key) => {
        if (typeof key === "string" && key) longTermLearned.add(key);
      });
    }
    if (data && Array.isArray(data.meaning)) {
      data.meaning.forEach((key) => {
        if (typeof key === "string" && key) longTermMeaning.add(key);
      });
    }
    if (data && typeof data.timeMs === "number" && Number.isFinite(data.timeMs)) {
      longTermTimeMs = Math.max(0, data.timeMs);
    }
  } catch (err) {
    // ignore invalid storage data
  }
}

function saveLongTermStats() {
  if (!window.localStorage) return;
  try {
    const payload = {
      learned: Array.from(longTermLearned),
      meaning: Array.from(longTermMeaning),
      timeMs: longTermTimeMs,
    };
    localStorage.setItem(LONG_TERM_KEY, JSON.stringify(payload));
  } catch (err) {
    // ignore storage failures
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateStatsToggleLabel() {
  if (!statsToggleBtn) return;
  statsToggleBtn.setAttribute("aria-expanded", statsExpanded ? "true" : "false");
  statsToggleBtn.setAttribute("aria-label", statsExpanded ? "收起总统计" : "展开总统计");
}

function updateStats() {
  if (!statsEl) return;
  statsEl.classList.toggle("expanded", statsExpanded);
  updateStatsToggleLabel();
  if (!statsVisible) {
    statsEl.classList.add("hidden");
    return;
  }
  statsEl.classList.remove("hidden");
  let currentIndex = 0;
  if (current) {
    const key = wordKey(current);
    const idx = learnedIndex.get(key);
    if (typeof idx === "number") currentIndex = idx + 1;
  }
  if (statsCurrentEl) {
    statsCurrentEl.textContent = `第 ${currentIndex}/${learnedWords.size} · 中文 ${meaningWords.size}`;
  }
  if (statsTotalEl) {
    statsTotalEl.textContent = `总计 ${longTermLearned.size} · 中文 ${longTermMeaning.size} · 用时 ${formatDuration(longTermTimeMs)} · 本次 ${formatDuration(sessionTimeMs)}`;
  }
}

function markLearned(word) {
  const key = wordKey(word);
  if (!key) return;
  if (!learnedWords.has(key)) {
    learnedWords.add(key);
    learnedIndex.set(key, learnedOrder.length);
    learnedOrder.push(key);
    if (!longTermLearned.has(key)) {
      longTermLearned.add(key);
      saveLongTermStats();
    }
    updateStats();
  }
}

function markMeaning(word) {
  const key = wordKey(word);
  if (!key) return;
  if (!meaningWords.has(key)) {
    meaningWords.add(key);
    if (!longTermMeaning.has(key)) {
      longTermMeaning.add(key);
      saveLongTermStats();
    }
    updateStats();
  }
}

function toggleStats() {
  statsVisible = !statsVisible;
  updateStats();
}

function toggleStatsExpanded() {
  statsExpanded = !statsExpanded;
  updateStats();
}

function markActive() {
  lastActiveAt = Date.now();
}

function shouldCountTime(now) {
  if (document.hidden) return false;
  if (!windowFocused) return false;
  if (now - lastActiveAt > IDLE_LIMIT_MS) return false;
  return true;
}

function tickTime() {
  const now = Date.now();
  const delta = now - lastTickAt;
  lastTickAt = now;
  if (delta <= 0) return;
  if (!shouldCountTime(now)) return;
  sessionTimeMs += delta;
  longTermTimeMs += delta;
  if (now - lastTimeSaveAt >= TIME_SAVE_EVERY_MS) {
    lastTimeSaveAt = now;
    saveLongTermStats();
  }
  updateStats();
}

function showMeaning() {
  if (!current) return;
  meaningEl.textContent = `${current.cn}`;
  markMeaning(current);
}

function renderWord(word) {
  current = word;
  wordEl.textContent = current.en;
  phoneticEl.textContent = current.phonetic || "";
  meaningEl.textContent = "";
  setStatus(micEnabled ? "请说出中文意思" : "", null);
  repeatBtn.disabled = false;
  nextBtn.disabled = false;
  showMeaningBtn.disabled = false;
  markLearned(current);
  updateStats();
  speakWord(current);
  if (micEnabled && recognition && started) {
    startListening();
  }
}

function nextWord() {
  if (!words.length) return;
  if (historyIndex < history.length - 1) {
    historyIndex += 1;
    renderWord(history[historyIndex]);
    return;
  }
  const pick = words[Math.floor(Math.random() * words.length)];
  history.push(pick);
  historyIndex = history.length - 1;
  renderWord(pick);
}

function prevWord() {
  if (!history.length) return;
  if (historyIndex <= 0) {
    setStatus("已经是第一个单词", null);
    return;
  }
  historyIndex -= 1;
  renderWord(history[historyIndex]);
}

function startListening() {
  if (!recognition) return;
  if (listening) return;
  listening = true;
  setStatus("正在听你说...", null);
  recognition.start();
}

function stopListening() {
  if (!recognition) return;
  if (!listening) return;
  recognition.stop();
}

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("当前浏览器不支持语音识别", "bad");
    return null;
  }
  const rec = new SpeechRecognition();
  rec.lang = "zh-CN";
  rec.interimResults = false;
  rec.maxAlternatives = 3;

  rec.onresult = (event) => {
    markActive();
    const transcript = Array.from(event.results)
      .map((r) => r[0].transcript)
      .join(" ");

    const ok = isCorrect(transcript, current);
    const wantsNext = /(?:下一个|继续|next)/i.test(transcript);
    const wantsPrev = /(?:上一个|上个|previous|prev|back)/i.test(transcript);
    const wantsRepeat = /(?:朗读|read|repeat)/i.test(transcript);
    const wantsChinese = /(?:中文|汉语|意思)/i.test(transcript);
    if (ok) {
      setStatus(`正确：${transcript}`, "ok");
    } else {
      setStatus(`不太对：${transcript}`, "bad");
    }
    showMeaning();

    listening = false;
    if (wantsNext) {
      nextWord();
      return;
    }
    if (wantsPrev) {
      prevWord();
      return;
    }
    if (wantsRepeat) {
      speakWord(current);
    }
    if (wantsChinese) {
      showMeaning();
    }
    if (ok) {
      setTimeout(() => {
        nextWord();
      }, 1000);
    }
  };

  rec.onerror = () => {
    listening = false;
    setStatus("识别失败，请再试一次", "bad");
  };

  rec.onend = () => {
    listening = false;
  };

  return rec;
}

function updateMicUI() {
  if (!micBtn) return;
  micBtn.textContent = "麦克风";
  micBtn.classList.toggle("active", micEnabled);
  micBtn.setAttribute("aria-pressed", micEnabled ? "true" : "false");
  if (!micEnabled) stopListening();
}

function setHelp(active) {
  helpActive = active;
  if (overlayEl) overlayEl.classList.toggle("help-on", helpActive);
  if (helpBtn) {
    helpBtn.classList.toggle("active", helpActive);
    helpBtn.setAttribute("aria-pressed", helpActive ? "true" : "false");
  }
}

function getSources(file) {
  if (file === "words-1500.json") return [...defaultSources];
  return [file];
}

function loadWordsFromInline(file) {
  if (!window.WORD_LISTS) return false;
  const list = window.WORD_LISTS[file];
  if (Array.isArray(list) && list.length) {
    words = list;
    return true;
  }
  return false;
}

async function loadWords(file) {
  words = [];
  history = [];
  historyIndex = -1;
  learnedWords.clear();
  learnedOrder.length = 0;
  learnedIndex.clear();
  meaningWords.clear();
  sessionTimeMs = 0;
  lastTickAt = Date.now();
  lastActiveAt = Date.now();
  updateStats();
  if (loadWordsFromInline(file)) return true;
  const sources = getSources(file);
  for (const name of sources) {
    try {
      const res = await fetch(name);
      if (!res.ok) continue;
      const data = await res.json();
      const list = extractWords(data);
      if (list.length) {
        words = list;
        history = [];
        historyIndex = -1;
        return true;
      }
    } catch (err) {
      // ignore and try next source
    }
  }

  const tip = location.protocol === "file:"
    ? "当前通过本地文件打开，浏览器限制无法直接读取 JSON"
    : `词表加载失败，请检查 ${file}`;
  setStatus(tip, "bad");
  return false;
}

async function autoStart() {
  if (!started) {
    const ok = await loadWords(currentFile);
    if (!ok || !words.length) {
      if (!words.length) {
        setStatus("词表为空，请先填充 words-1500.json", "bad");
      }
      return;
    }
    started = true;
  }

  if (micEnabled && !recognition) {
    recognition = setupRecognition();
    if (!recognition) {
      setStatus("当前浏览器不支持语音识别", "bad");
      return;
    }
  }

  nextWord();
}

nextBtn.addEventListener("click", () => {
  nextWord();
});

repeatBtn.addEventListener("click", () => {
  if (current) speakWord(current);
});

showMeaningBtn.addEventListener("click", () => {
  showMeaning();
});

if (micBtn) {
  micBtn.addEventListener("click", async () => {
    micEnabled = !micEnabled;
    if (micEnabled) {
      if (!recognition) {
        recognition = setupRecognition();
        if (!recognition) {
          micEnabled = false;
          updateMicUI();
          return;
        }
      }
      if (!started) {
        await autoStart();
      } else if (current) {
        startListening();
      }
    }
    updateMicUI();
  });
}

if (helpBtn) {
  helpBtn.addEventListener("click", () => {
    setHelp(!helpActive);
  });
}

if (statsToggleBtn) {
  statsToggleBtn.addEventListener("click", (event) => {
    markActive();
    event.stopPropagation();
    toggleStatsExpanded();
  });
}

toggleBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const file = btn.dataset.file;
    if (!file) return;
    currentFile = file;
    toggleBtns.forEach((b) => b.classList.toggle("active", b === btn));
    stopListening();
    const ok = await loadWords(currentFile);
    if (ok && words.length) {
      nextWord();
    }
  });
});

loadLongTermStats();
document.addEventListener("pointerdown", markActive, { passive: true });
document.addEventListener("touchstart", markActive, { passive: true });
window.addEventListener("focus", () => {
  windowFocused = true;
  lastTickAt = Date.now();
  markActive();
});
window.addEventListener("blur", () => {
  windowFocused = false;
});
document.addEventListener("visibilitychange", () => {
  lastTickAt = Date.now();
  if (!document.hidden) {
    markActive();
  }
});
window.addEventListener("beforeunload", () => {
  saveLongTermStats();
});
setInterval(tickTime, 1000);
updateMicUI();
autoStart();

const pressedKeys = new Set();

document.addEventListener("keydown", async (event) => {
  markActive();
  const target = event.target;
  if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) {
    return;
  }
  if (target && target.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key || "";
  if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return;
  if (event.repeat) return;
  if (pressedKeys.has(key)) return;
  pressedKeys.add(key);

  if (!started) {
    await autoStart();
  }

  if (key.toLowerCase() === "r") {
    if (current) speakWord(current);
    return;
  }

  if (key.toLowerCase() === "c") {
    if (current) {
      const showing = meaningEl.textContent && meaningEl.textContent.trim().length > 0;
      if (showing) {
        meaningEl.textContent = "";
      } else {
        showMeaning();
      }
    }
    return;
  }

  if (key.toLowerCase() === "m") {
    if (micBtn) {
      micBtn.click();
    } else {
      micEnabled = !micEnabled;
      if (micEnabled) {
        if (!recognition) {
          recognition = setupRecognition();
          if (!recognition) {
            micEnabled = false;
            updateMicUI();
            return;
          }
        }
        if (!started) {
          await autoStart();
        } else if (current) {
          startListening();
        }
      }
      updateMicUI();
    }
    return;
  }

  stopListening();
  nextWord();
});

document.addEventListener("keyup", (event) => {
  const key = event.key || "";
  pressedKeys.delete(key);
});

// --- Touch overlay: create six absolute zones around `.app` and bind actions ---
(function () {
  const overlay = overlayEl;
  if (!overlay) return;
  const areas = Array.from(overlay.querySelectorAll(".touch-area"));
  const appEl = document.querySelector(".app");

  function forwardIfOverApp(x, y) {
    const list = document.elementsFromPoint(x, y);
    if (!list || !list.length) return false;
    for (const el of list) {
      if (!el) continue;
      if (overlay.contains(el)) continue;
      if (appEl && appEl.contains(el)) {
        const evt = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        });
        el.dispatchEvent(evt);
        return true;
      }
    }
    return false;
  }

  function handleEvent(e) {
    const p = e.touches ? e.touches[0] : e;
    const x = p.clientX;
    const y = p.clientY;
    if (forwardIfOverApp(x, y)) return;

    const zone = this.dataset.zone;
    if (zone === "tl" || zone === "tr") {
      prevWord();
      return;
    }
    if (zone === "tm") {
      toggleStats();
      return;
    }
    if (zone === "lm" || zone === "rm") {
      showMeaning();
      return;
    }
    if (zone === "bm") {
      if (repeatBtn) repeatBtn.click();
      return;
    }
    if (zone === "bl" || zone === "br") {
      if (nextBtn) nextBtn.click();
      return;
    }
  }

  function updateTouchAreas() {
    if (!appEl) return;
    const appRect = appEl.getBoundingClientRect();
    const vw = Math.max(window.innerWidth || 0, document.documentElement.clientWidth);
    const vh = Math.max(window.innerHeight || 0, document.documentElement.clientHeight);
    const col1 = vw / 3;
    const col2 = (vw * 2) / 3;

    areas.forEach((area) => {
      const zone = area.dataset.zone;
      let left = 0,
        top = 0,
        width = 0,
        height = 0;
      if (zone === "tl") {
        left = 0;
        top = 0;
        width = Math.max(0, col1);
        height = Math.max(0, appRect.top);
      } else if (zone === "tm") {
        left = Math.max(0, col1);
        top = 0;
        width = Math.max(0, col2 - col1);
        height = Math.max(0, appRect.top);
      } else if (zone === "lm") {
        left = 0;
        top = Math.max(0, appRect.top);
        width = Math.max(0, appRect.left);
        height = Math.max(0, appRect.height);
      } else if (zone === "rm") {
        left = Math.max(0, appRect.right);
        top = Math.max(0, appRect.top);
        width = Math.max(0, vw - appRect.right);
        height = Math.max(0, appRect.height);
      } else if (zone === "tr") {
        left = Math.max(0, col2);
        top = 0;
        width = Math.max(0, vw - col2);
        height = Math.max(0, appRect.top);
      } else if (zone === "bl") {
        left = 0;
        top = Math.max(0, appRect.bottom);
        width = Math.max(0, col1);
        height = Math.max(0, vh - appRect.bottom);
      } else if (zone === "bm") {
        left = Math.max(0, col1);
        top = Math.max(0, appRect.bottom);
        width = Math.max(0, col2 - col1);
        height = Math.max(0, vh - appRect.bottom);
      } else if (zone === "br") {
        left = Math.max(0, col2);
        top = Math.max(0, appRect.bottom);
        width = Math.max(0, vw - col2);
        height = Math.max(0, vh - appRect.bottom);
      }

      area.style.left = left + "px";
      area.style.top = top + "px";
      area.style.width = width + "px";
      area.style.height = height + "px";

      if (width > 0 && height > 0) {
        area.style.pointerEvents = "auto";
      } else {
        area.style.pointerEvents = "none";
      }
    });
  }

  window.addEventListener("resize", updateTouchAreas);
  window.addEventListener("scroll", updateTouchAreas, true);
  setTimeout(updateTouchAreas, 30);

  areas.forEach((a) => {
    if (window.PointerEvent) {
      a.addEventListener("pointerdown", function (ev) {
        // handle touch/pen on press
        if (ev.pointerType === "mouse") return;
        ev.preventDefault();
        handleEvent.call(this, ev);
      });

      a.addEventListener("pointerup", function (ev) {
        // handle mouse on release
        if (ev.pointerType === "mouse") {
          ev.preventDefault();
          handleEvent.call(this, ev);
        }
      });

      // block click events to avoid duplicate handling when pointer events are supported
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      });
    } else {
      // fallback for older browsers: touchstart for touch, click for mouse
      a.addEventListener(
        "touchstart",
        function (ev) {
          ev.preventDefault();
          handleEvent.call(this, ev);
        },
        { passive: false }
      );
      a.addEventListener("click", function (ev) {
        handleEvent.call(this, ev);
      });
    }
  });

  // initial calc
  updateTouchAreas();
})();

// --- Auto button: automatically click "next" every 3 seconds when enabled ---
const autoBtn = document.getElementById("autoBtn");
let autoIntervalId = null;
let autoEnabled = false;

function updateAutoUI() {
  if (!autoBtn) return;
  autoBtn.classList.toggle("active", autoEnabled);
  autoBtn.setAttribute("aria-pressed", autoEnabled ? "true" : "false");
}

function startAuto() {
  if (autoIntervalId) return;
  autoIntervalId = setInterval(() => {
    markActive();
    if (nextBtn) nextBtn.click();
  }, 3500);
}

function stopAuto() {
  if (!autoIntervalId) return;
  clearInterval(autoIntervalId);
  autoIntervalId = null;
}

if (autoBtn) {
  autoBtn.addEventListener("click", async () => {
    autoEnabled = !autoEnabled;
    if (autoEnabled) {
      if (!started) {
        const ok = await loadWords(currentFile);
        if (!ok) {
          autoEnabled = false;
          updateAutoUI();
          return;
        }
        started = true;
      }
      startAuto();
    } else {
      stopAuto();
    }
    updateAutoUI();
  });
}

updateAutoUI();

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register("sw.js");
  } catch (err) {
    console.warn("Service Worker register failed:", err);
  }
}

registerServiceWorker();
