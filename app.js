(() => {
  "use strict";

  const MANIFEST_URL = "tests.json";
  const COURSE_EMOJI = ["🥂", "🥗", "🍝", "🍰"];
  const HAPPY_FACES = ["🥰", "😍", "😊", "😘"];
  const SAD_FACES = ["😬", "😐", "🙄", "😳"];
  const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const LANG_KEY = "uiLang";
  const I18N = window.I18N;

  const $ = (id) => document.getElementById(id);

  let uiLang = "en";
  let tests = [];         // entries from tests.json
  let currentTest = null; // manifest entry of the selected test (null when loaded from a local file)
  let data = null;        // parsed test JSON
  let quiz = [];          // questions for the current run
  let index = 0;
  let score = 0;
  let mistakes = [];
  let playerName = "";
  let reaction = null;    // { prefix, text } shown in the feedback box
  let wrongStreak = 0;    // consecutive wrong answers - Professor Pigeon escalates at 3
  let profLine = null;    // { set, i } - which pigeon line is shown (re-translated on language switch)
  const lastProfLine = {};
  let lastError = "";

  // ---------- gender ----------
  // "m" / "f" / "x" (rather not say). Questions may carry "variants": { "m": {...}, "f": {...} }
  // that override any field; "x" uses the base (neutral) version.
  const GENDER_KEY = "userGender";
  let gender = null;
  try { gender = ["m", "f", "x"].includes(localStorage.getItem(GENDER_KEY)) ? localStorage.getItem(GENDER_KEY) : null; } catch (e) { /* storage unavailable */ }

  // A value with gender keys ({ m, f, x }) resolves to the user's gender.
  function byGender(v) {
    if (v && typeof v === "object" && !Array.isArray(v) && ("m" in v || "f" in v || "x" in v)) {
      return v[gender] ?? v.x ?? v.m;
    }
    return v;
  }

  const withVariant = (q) => ({ ...q, ...((q.variants && q.variants[gender]) || {}) });

  // ---------- i18n ----------
  function tr(key, vars) {
    const s = byGender(I18N.strings[uiLang][key] ?? I18N.strings.en[key] ?? key);
    return typeof s === "string" && vars ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : s;
  }

  function plural(key, n) {
    const forms = tr(key);
    return forms[new Intl.PluralRules(uiLang).select(n)] || forms.other;
  }

  // Test content may be a plain string or { "en": "...", "pl": "...", "ru": "..." }.
  function loc(value) {
    if (value == null || typeof value !== "object") return value ?? "";
    return value[uiLang] ?? value.en ?? Object.values(value)[0] ?? "";
  }

  function detectLang() {
    const supported = I18N.languages.map((l) => l.code);
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (supported.includes(saved)) return saved;
    } catch (e) { /* storage unavailable */ }
    for (const l of navigator.languages || [navigator.language || ""]) {
      const code = l.slice(0, 2).toLowerCase();
      if (supported.includes(code)) return code;
    }
    return "en";
  }

  function renderLangSwitch() {
    const nav = $("lang-switch");
    nav.innerHTML = "";
    I18N.languages.forEach((l) => {
      const b = document.createElement("button");
      b.textContent = l.label;
      b.title = l.name;
      b.lang = l.code;
      b.setAttribute("aria-pressed", String(l.code === uiLang));
      b.addEventListener("click", () => setLang(l.code));
      nav.appendChild(b);
    });
  }

  // ---------- color themes ----------
  // "color" is the browser UI color (meta theme-color) matching the page background.
  const THEMES = [
    { id: "pink", key: "themePink", color: "#fb6f92" },
    { id: "graphite", key: "themeGraphite", color: "#24272c" },
    { id: "green", key: "themeGreen", color: "#173a2e" },
    { id: "burgundy", key: "themeBurgundy", color: "#4a1022" }
  ];
  const THEME_KEY = "uiTheme";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "pink"; // no attribute = pink base theme
  }

  function renderThemeSwitch() {
    const nav = $("theme-switch");
    nav.innerHTML = "";
    THEMES.forEach((t) => {
      const b = document.createElement("button");
      b.className = `swatch swatch-${t.id}`;
      b.title = tr(t.key);
      b.setAttribute("aria-label", tr(t.key));
      b.setAttribute("aria-pressed", String(t.id === currentTheme()));
      b.addEventListener("click", () => setTheme(t.id));
      nav.appendChild(b);
    });
  }

  function setTheme(id) {
    const theme = THEMES.find((t) => t.id === id) || THEMES[0];
    if (theme.id === "pink") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme.id);
    try { localStorage.setItem(THEME_KEY, theme.id); } catch (e) { /* storage unavailable */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme.color;
    renderThemeSwitch();
  }

  function setLang(code) {
    uiLang = code;
    try { localStorage.setItem(LANG_KEY, code); } catch (e) { /* storage unavailable */ }
    document.documentElement.lang = code;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = tr(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", tr(el.dataset.i18nAria)); });
    renderLangSwitch();
    renderThemeSwitch();
    refresh();
  }

  // Re-render the dynamic parts of whichever screen is visible.
  function refresh() {
    const active = document.querySelector(".screen.active");
    switch (active && active.id) {
      case "screen-picker": renderPicker(); if (currentTab === "lessons") renderCourses(); break;
      case "screen-lesson": renderLessonStep(); break;
      case "screen-welcome": renderWelcome(); break;
      case "screen-quiz": renderQuestion(true); break;
      case "screen-result": renderResult(); break;
      case "screen-error": $("error-text").textContent = tr("errorPrefix") + lastError; break;
    }
    updateTitle();
  }

  function updateTitle() {
    const onTest = data && !$("screen-picker").classList.contains("active");
    document.title = onTest ? loc(data.title) : tr("pickerTitle");
  }

  // ---------- helpers ----------
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Random line index from an i18n array, never the same one twice in a row.
  function pickLine(set) {
    const count = tr(set).length;
    let i = Math.floor(Math.random() * count);
    if (count > 1 && i === lastProfLine[set]) i = (i + 1) % count;
    lastProfLine[set] = i;
    return { set, i };
  }

  function setPigeonMood(el, mood) {
    el.classList.remove("happy", "angry");
    void el.offsetWidth; // restart the CSS animation
    if (mood) el.classList.add(mood);
  }

  function show(screenId) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(screenId).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Copy of the JSON files bundled by build.ps1 (tests-data.js), used when fetch() is not possible.
  function bundled(url) {
    const b = window.TEST_DATA;
    if (!b) return undefined;
    return url === MANIFEST_URL ? b.manifest : b.files && b.files[url];
  }

  // Load a JSON file from the server; fall back to the bundle (needed for file:// pages).
  function fetchJson(url) {
    const fallback = (err) => {
      const data = bundled(url);
      if (data) return data;
      throw err;
    };
    if (location.protocol === "file:") return Promise.resolve().then(() => fallback(new Error(`${url} (file://)`)));
    return fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}`);
        return r.json();
      })
      .catch(fallback);
  }

  // Only allow relative paths to .json files on this server.
  const isSafePath = (p) => typeof p === "string" && /^[\w\-./]+\.json$/.test(p) && !p.includes("..");

  function setUrlTest(id) {
    const url = new URL(location.href);
    if (id) url.searchParams.set("test", id);
    else url.searchParams.delete("test");
    history.replaceState(null, "", url);
  }

  function showError(err) {
    console.error(err);
    lastError = err.message;
    $("error-text").textContent = tr("errorPrefix") + lastError;
    $("btn-error-back").hidden = tests.length === 0;
    show("screen-error");
  }

  // ---------- test picker ----------
  function loadManifest() {
    return fetchJson(MANIFEST_URL).then((json) => {
      tests = (json.tests || []).filter((t) => t && t.id && isSafePath(t.file));
      if (!tests.length) throw new Error("tests.json has no valid tests.");
    });
  }

  function renderGender() {
    document.querySelectorAll("#gender-choice button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.gender === gender));
    });
    $("test-list").classList.toggle("locked", !gender);
    $("gender-needed").hidden = !!gender;
  }

  function setGender(g) {
    gender = g;
    try { localStorage.setItem(GENDER_KEY, g); } catch (e) { /* storage unavailable */ }
    setLang(uiLang); // re-apply gendered interface texts
  }

  document.querySelectorAll("#gender-choice button").forEach((b) => {
    b.addEventListener("click", () => setGender(b.dataset.gender));
  });

  function renderPicker() {
    renderGender();
    const list = $("test-list");
    list.innerHTML = "";
    tests.forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "test-card";

      const emoji = document.createElement("span");
      emoji.className = "test-emoji";
      emoji.textContent = t.emoji || "💘";

      const body = document.createElement("span");
      body.className = "test-body";
      const title = document.createElement("span");
      title.className = "test-title";
      title.textContent = loc(t.title) || t.id;
      const meta = document.createElement("span");
      meta.className = "test-meta";
      meta.textContent = [loc(t.language), t.levels].filter(Boolean).join(" · ");
      const desc = document.createElement("span");
      desc.className = "test-desc";
      desc.textContent = loc(t.description);
      body.append(title, meta, desc);

      const arrow = document.createElement("span");
      arrow.className = "test-arrow";
      arrow.textContent = "➜";

      btn.append(emoji, body, arrow);
      btn.disabled = !gender;
      btn.addEventListener("click", () => selectTest(t));
      list.appendChild(btn);
    });
  }

  function showPicker() {
    setUrlTest(null);
    renderPicker();
    setTab(currentTab);
    show("screen-picker");
    updateTitle();
  }

  // ---------- tabs: Tests / Lessons ----------
  const TAB_KEY = "uiTab";
  let currentTab = "tests";
  try { if (localStorage.getItem(TAB_KEY) === "lessons") currentTab = "lessons"; } catch (e) { /* storage unavailable */ }

  function setTab(tab) {
    currentTab = tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch (e) { /* storage unavailable */ }
    document.querySelectorAll(".tabs [role=tab]").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $("pane-tests").hidden = tab !== "tests";
    $("pane-lessons").hidden = tab !== "lessons";
    if (tab === "lessons") loadCourses().then(renderCourses).catch(() => {
      $("course-list").innerHTML = "";
      const p = document.createElement("p");
      p.className = "gender-needed";
      p.textContent = tr("lessonsError");
      $("course-list").appendChild(p);
    });
  }

  document.querySelectorAll(".tabs [role=tab]").forEach((b) => {
    b.addEventListener("click", () => setTab(b.dataset.tab));
  });

  function selectTest(t) {
    show("screen-loading");
    fetchJson(t.file)
      .then((json) => {
        currentTest = t;
        setUrlTest(t.id);
        onTestLoaded(json);
      })
      .catch(showError);
  }

  // ---------- test data ----------
  function validate(json) {
    if (!json || !Array.isArray(json.questions) || json.questions.length === 0) {
      throw new Error("The JSON file has no \"questions\" array.");
    }
    json.questions.forEach((q, i) => {
      if (!q.question || !Array.isArray(q.options) || q.options.length < 2 ||
          typeof q.answer !== "number" || !q.options[q.answer]) {
        throw new Error(`Question #${i + 1} is missing "question", "options" or a valid "answer" index.`);
      }
    });
    json.settings = json.settings || {};
    json.reactions = json.reactions || { correct: ["💖"], wrong: ["💔"] };
    json.levels = (json.levels || []).slice().sort((a, b) => a.minPercent - b.minPercent);
    return json;
  }

  function levelRange(questions) {
    const found = [...new Set(questions.map((q) => q.level).filter(Boolean))]
      .sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));
    if (!found.length) return tr("mixed");
    return found.length === 1 ? found[0] : `${found[0]} - ${found[found.length - 1]}`;
  }

  function onTestLoaded(json) {
    data = validate(json);
    show("screen-welcome");
    renderWelcome();
    updateTitle();
  }

  function renderWelcome() {
    $("title").textContent = loc(data.title) || (currentTest && loc(currentTest.title)) || "💘";
    $("subtitle").textContent = loc(data.subtitle);
    $("test-emoji").textContent = (currentTest && currentTest.emoji) || "💘";
    $("btn-change-test").hidden = tests.length === 0;
    const count = Math.min(data.settings.questionsPerTest || data.questions.length, data.questions.length);
    $("menu-note").textContent = tr("menuNote", {
      count,
      questions: plural("questions", count),
      levels: levelRange(data.questions)
    });
  }

  // ---------- quiz flow ----------
  function startQuiz() {
    playerName = $("player-name").value.trim();
    $("player-name").blur(); // hide the mobile keyboard
    const s = data.settings;
    let pool = s.shuffleQuestions ? shuffle(data.questions) : data.questions.slice();
    if (s.questionsPerTest) pool = pool.slice(0, s.questionsPerTest);

    // Apply the gender variant, then prepare options (optionally shuffled)
    // while tracking where the right answer ends up.
    quiz = pool.map(withVariant).map((q) => {
      const opts = q.options.map((text, i) => ({ text, correct: i === q.answer }));
      return { ...q, opts: s.shuffleOptions ? shuffle(opts) : opts, chosen: null };
    });

    index = 0;
    score = 0;
    mistakes = [];
    wrongStreak = 0;
    $("meter-fill").style.width = "50%";
    $("meter-emoji").textContent = "😊";
    show("screen-quiz");
    renderQuestion();
  }

  function courseLabel() {
    const n = Math.min(COURSE_EMOJI.length - 1, Math.floor((index / quiz.length) * COURSE_EMOJI.length));
    return `${COURSE_EMOJI[n]} ${tr("course" + (n + 1))}`;
  }

  // keepState = true re-renders texts only (used after a language switch).
  function renderQuestion(keepState) {
    const q = quiz[index];
    const total = quiz.length;
    const contentLang = data.lang || null;

    $("counter").textContent = `${index + 1} / ${total}`;
    $("course").textContent = courseLabel();
    $("progress-bar").style.width = `${(index / total) * 100}%`;
    $("level-tag").textContent = q.level || "";
    $("level-tag").hidden = !q.level;
    $("scenario").textContent = loc(q.scenario) || tr("defaultScenario");
    $("question").textContent = loc(q.question);
    ["scenario", "question", "options"].forEach((id) => {
      if (contentLang) $(id).lang = contentLang; else $(id).removeAttribute("lang");
    });

    if (keepState) {
      [...$("options").children].forEach((b, i) => { b.textContent = loc(q.opts[i].text); });
      if (q.chosen) fillFeedback();
      return;
    }

    const avatar = $("date-avatar");
    avatar.className = "avatar";
    avatar.textContent = "🥰";

    const box = $("options");
    box.innerHTML = "";
    q.opts.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.dataset.letter = String.fromCharCode(65 + i);
      btn.textContent = loc(opt.text);
      btn.addEventListener("click", () => answer(btn, opt));
      box.appendChild(btn);
    });

    $("feedback").hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function answer(btn, opt) {
    const q = quiz[index];
    q.chosen = opt;
    const buttons = [...$("options").children];
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (q.opts[i].correct) b.classList.add("correct");
      else if (b !== btn) b.classList.add("faded");
    });

    const avatar = $("date-avatar");
    const fb = $("feedback");
    if (opt.correct) {
      score++;
      wrongStreak = 0;
      avatar.textContent = pick(HAPPY_FACES);
      avatar.classList.add("happy");
      fb.className = "feedback good";
      reaction = { prefix: "💖 ", text: pick(data.reactions.correct) };
      profLine = pickLine("pigeonCorrect");
      heartBurst(btn);
      if (navigator.vibrate) navigator.vibrate(30);
    } else {
      wrongStreak++;
      btn.classList.add("wrong");
      avatar.textContent = pick(SAD_FACES);
      avatar.classList.add("sad");
      fb.className = "feedback bad";
      reaction = { prefix: "💔 ", text: pick(data.reactions.wrong) };
      profLine = pickLine(wrongStreak >= 3 ? "pigeonFinal" : "pigeonWrong");
      mistakes.push({ q, yours: opt.text, right: q.opts.find((o) => o.correct).text });
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    }

    fillFeedback();
    fb.hidden = false;
    setPigeonMood($("prof-pigeon"), opt.correct ? "happy" : "angry");
    // Wait for the smooth scroll to the feedback box so the poop lands next to the pigeon.
    if (!opt.correct) setTimeout(() => warningShot($("prof-pigeon"), wrongStreak >= 3 ? 3 : 1), 400);
    updateMeter();
    fb.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function fillFeedback() {
    const q = quiz[index];
    $("reaction").textContent = reaction ? reaction.prefix + loc(reaction.text) : "";
    $("prof-line").textContent = profLine ? tr(profLine.set)[profLine.i] : "";
    $("explanation").textContent = loc(q.explanation);
    $("btn-next").textContent = index === quiz.length - 1 ? tr("verdictBtn") : tr("next");
  }

  function updateMeter() {
    const pct = Math.round((score / (index + 1)) * 100);
    $("meter-fill").style.width = `${Math.max(4, pct)}%`;
    $("meter-emoji").textContent = pct >= 80 ? "🔥" : pct >= 60 ? "😍" : pct >= 40 ? "🙂" : pct >= 20 ? "😬" : "🧊";
  }

  function next() {
    index++;
    if (index < quiz.length) renderQuestion();
    else showResult();
  }

  function levelFor(pct) {
    let result = { code: "?", emoji: "💘", title: "💘", description: "" };
    for (const lvl of data.levels) if (pct >= lvl.minPercent) result = lvl;
    return result;
  }

  function showResult() {
    $("progress-bar").style.width = "100%";
    renderResult();
    $("review-box").open = false;
    show("screen-result");
    if (score / quiz.length >= 0.6) for (let i = 0; i < 4; i++) setTimeout(() => heartBurst($("result-emoji")), i * 250);
  }

  function renderResult() {
    const pct = Math.round((score / quiz.length) * 100);
    const lvl = levelFor(pct);

    $("result-name").textContent = playerName || tr("stranger");
    $("result-emoji").textContent = lvl.emoji;
    $("result-level").textContent = lvl.code;
    $("result-title").textContent = loc(lvl.title);
    $("result-score").textContent = tr("score", { score, total: quiz.length, pct });
    $("result-desc").textContent = loc(lvl.description);
    // Pigeon verdict: 0-34% / 35-59% / 60-84% / 85%+
    const verdict = pct >= 85 ? 3 : pct >= 60 ? 2 : pct >= 35 ? 1 : 0;
    $("result-prof-line").textContent = tr("pigeonResult")[verdict];
    $("result-pigeon").classList.toggle("angry", verdict === 0);
    $("result-pigeon").classList.toggle("happy", verdict >= 2);

    const list = $("review-list");
    list.innerHTML = "";
    mistakes.forEach((m) => {
      const li = document.createElement("li");
      const qEl = document.createElement("span");
      qEl.className = "q";
      qEl.textContent = loc(m.q.question);
      const yours = document.createElement("div");
      yours.className = "yours";
      yours.textContent = `${tr("youSaid")} ${loc(m.yours)}`;
      const right = document.createElement("div");
      right.className = "right";
      right.textContent = `${tr("betterLine")} ${loc(m.right)}`;
      li.append(qEl, yours, right);
      list.appendChild(li);
    });
    $("review-summary").textContent = tr("review", { n: mistakes.length });
    $("review-box").hidden = mistakes.length === 0;
    $("btn-other-test").hidden = tests.length < 2;
  }

  // ---------- lessons ----------
  // lessons.json lists course files; each course has categories → lessons → cards + practice.
  // Progress is kept per lesson in localStorage: { "course/lesson": { best, total } }.
  const LESSONS_URL = "lessons.json";
  const PROGRESS_KEY = "lessonProgress";
  let coursesPromise = null;
  let courses = [];
  let lesson = null; // the lesson being played: { course, ref, cards, practice, step, score }

  function loadCourses() {
    if (!coursesPromise) {
      coursesPromise = fetchJson(LESSONS_URL)
        .then((m) => Promise.all((m.courses || []).filter((c) => c && c.id && isSafePath(c.file))
          .map((c) => fetchJson(c.file).then((data) => ({ ...data, id: c.id })))))
        .then((list) => { courses = list; return list; })
        .catch((err) => { coursesPromise = null; throw err; });
    }
    return coursesPromise;
  }

  function getProgress() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { return {}; }
  }

  function saveLessonResult(key, score, total) {
    const all = getProgress();
    const prev = all[key];
    all[key] = { best: Math.max(score, prev ? prev.best : 0), total };
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
  }

  const lessonKey = (course, l) => `${course.id}/${l.id}`;
  const stars = (best, total) => "★".repeat(best) + "☆".repeat(Math.max(0, total - best));

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderCourses() {
    const list = $("course-list");
    list.innerHTML = "";
    const progress = getProgress();

    courses.forEach((course) => {
      const all = course.categories.flatMap((c) => c.lessons);
      const done = all.filter((l) => progress[lessonKey(course, l)]).length;

      const head = el("div", "course-head");
      head.append(el("span", "course-emoji", course.emoji || "📚"));
      const info = el("div", "course-info");
      info.append(el("h3", "course-title", loc(course.title)), el("p", "course-sub", loc(course.subtitle)));
      head.append(info);
      list.append(head);

      const bar = el("div", "progress course-progress");
      const fill = el("div", "progress-bar");
      fill.style.width = `${all.length ? (done / all.length) * 100 : 0}%`;
      bar.append(fill);
      list.append(bar, el("p", "course-count", tr("courseProgress", { done, total: all.length })));

      course.categories.forEach((cat) => {
        const catDone = cat.lessons.filter((l) => progress[lessonKey(course, l)]).length;
        const section = el("section", "lesson-cat");
        const h = el("h4", "lesson-cat-title");
        h.append(el("span", null, `${cat.emoji || ""} ${loc(cat.title)}`), el("span", "lesson-cat-count", `${catDone}/${cat.lessons.length}`));
        section.append(h);

        cat.lessons.forEach((l, i) => {
          const p = progress[lessonKey(course, l)];
          const btn = el("button", "lesson-item" + (p ? " done" : ""));
          btn.append(el("span", "lesson-num", p ? "✓" : String(i + 1)));
          const body = el("span", "lesson-item-body");
          body.append(el("span", "lesson-item-title", loc(l.title)));
          const meta = el("span", "lesson-item-meta");
          if (l.level) meta.append(el("span", "level-tag", l.level));
          if (p) meta.append(el("span", "lesson-stars", stars(p.best, p.total)));
          body.append(meta);
          btn.append(body, el("span", "test-arrow", "➜"));
          btn.addEventListener("click", () => startLesson(course, l));
          section.append(btn);
        });
        list.append(section);
      });
    });
  }

  function startLesson(course, ref) {
    const prepared = withVariant(ref);
    lesson = {
      course,
      ref,
      cards: (prepared.cards || []).map(withVariant),
      practice: (prepared.practice || []).map(withVariant).map((q) => ({
        ...q,
        opts: shuffle(q.options.map((text, i) => ({ text, correct: i === q.answer }))),
        chosen: null,
        prof: null
      })),
      step: 0,
      score: 0,
      saved: false
    };
    show("screen-lesson");
    renderLessonStep();
  }

  function nextLessonOf(course, ref) {
    const all = course.categories.flatMap((c) => c.lessons);
    return all[all.indexOf(ref) + 1] || null;
  }

  function renderLessonStep() {
    if (!lesson) return;
    const { cards, practice } = lesson;
    const total = cards.length + practice.length;
    const step = lesson.step;
    $("lesson-title").textContent = loc(lesson.ref.title);
    $("lesson-level").textContent = lesson.ref.level || "";
    $("lesson-level").hidden = !lesson.ref.level;
    $("lesson-counter").textContent = `${Math.min(step + 1, total)} / ${total}`;
    $("lesson-progress").style.width = `${(Math.min(step, total) / total) * 100}%`;
    $("lesson-counter").hidden = step >= total;

    const body = $("lesson-body");
    body.innerHTML = "";
    if (step < cards.length) renderLessonCard(body, cards[step], step);
    else if (step < total) renderLessonPractice(body, practice[step - cards.length], step - cards.length);
    else renderLessonSummary(body);
  }

  function lessonNextButton(label) {
    const b = el("button", "btn btn-primary btn-block", label);
    b.addEventListener("click", () => { lesson.step++; renderLessonStep(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    return b;
  }

  function renderLessonCard(body, card, i) {
    const box = el("div", "lesson-card");
    box.append(el("p", "lesson-step-label", tr("lessonCard", { n: i + 1, total: lesson.cards.length })));
    const phrase = el("p", "lesson-phrase", loc(card.phrase));
    phrase.lang = lesson.course.lang || "pl";
    box.append(phrase, el("p", "lesson-meaning", loc(card.meaning)));
    if (card.example) {
      const ex = el("div", "lesson-example");
      const exText = el("p", null, loc(card.example));
      exText.lang = lesson.course.lang || "pl";
      ex.append(el("span", "lesson-example-label", tr("lessonExample")), exText);
      box.append(ex);
    }
    if (card.note) box.append(el("p", "lesson-note", loc(card.note)));
    body.append(box);
    const last = i === lesson.cards.length - 1;
    body.append(lessonNextButton(last && lesson.practice.length ? tr("lessonPractice") : tr("next")));
  }

  function renderLessonPractice(body, q, i) {
    body.append(el("p", "lesson-step-label", tr("lessonExercise", { n: i + 1, total: lesson.practice.length })));
    const question = el("h3", "question", loc(q.question));
    question.lang = lesson.course.lang || "pl";
    body.append(question);

    const options = el("div", "options");
    const fb = el("div", "feedback");
    fb.hidden = true;

    const showFeedback = () => {
      fb.className = "feedback " + (q.chosen.correct ? "good" : "bad");
      fb.innerHTML = "";
      const prof = el("div", "prof");
      const pig = el("div", "prof-pigeon" + (q.animate ? (q.chosen.correct ? " happy" : " angry") : ""));
      pig.innerHTML = '<svg viewBox="0 0 120 120"><use href="#pigeon"/></svg>';
      if (!q.chosen.correct) pig.style.setProperty("--brow", "1");
      else pig.style.setProperty("--blush", "1");
      const bubble = el("div", "prof-bubble");
      bubble.append(el("p", "prof-name", tr("profName")), el("p", "prof-line", tr(q.prof.set)[q.prof.i]));
      if (q.explanation) bubble.append(el("p", "explanation", loc(q.explanation)));
      prof.append(pig, bubble);
      const last = i === lesson.practice.length - 1;
      fb.append(prof, lessonNextButton(last ? tr("verdictBtn") : tr("next")));
      fb.hidden = false;
      return pig;
    };

    q.opts.forEach((opt, k) => {
      const b = el("button", "option", loc(opt.text));
      b.dataset.letter = String.fromCharCode(65 + k);
      b.lang = lesson.course.lang || "pl";
      if (q.chosen) {
        b.disabled = true;
        if (opt.correct) b.classList.add("correct");
        else if (opt === q.chosen) b.classList.add("wrong");
        else b.classList.add("faded");
      }
      b.addEventListener("click", () => {
        if (q.chosen) return;
        q.chosen = opt;
        q.animate = true;
        if (opt.correct) lesson.score++;
        q.prof = pickLine(opt.correct ? "pigeonCorrect" : "pigeonWrong");
        renderLessonStep();
        const btn = $("lesson-body").querySelectorAll(".option")[k];
        const pig = $("lesson-body").querySelector(".prof-pigeon");
        if (opt.correct) { heartBurst(btn); if (navigator.vibrate) navigator.vibrate(30); }
        else {
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
          setTimeout(() => warningShot(pig, 1), 400);
        }
        $("lesson-body").querySelector(".feedback").scrollIntoView({ behavior: "smooth", block: "nearest" });
        q.animate = false;
      });
      options.append(b);
    });
    body.append(options, fb);
    if (q.chosen) showFeedback();
  }

  function renderLessonSummary(body) {
    const total = lesson.practice.length;
    const key = lessonKey(lesson.course, lesson.ref);
    if (!lesson.saved) {
      saveLessonResult(key, lesson.score, total);
      lesson.saved = true;
      if (lesson.score === total) setTimeout(() => heartBurst($("lesson-body").querySelector(".big-emoji")), 200);
    }
    const pct = total ? Math.round((lesson.score / total) * 100) : 100;
    const box = el("div", "lesson-summary");
    box.append(el("div", "big-emoji pop", pct === 100 ? "🎓" : pct >= 60 ? "🌹" : "📚"));
    box.append(el("h2", "lesson-done-title", tr("lessonDone")));
    if (total) {
      box.append(el("p", "lesson-stars big", stars(lesson.score, total)));
      box.append(el("p", "score", tr("score", { score: lesson.score, total, pct })));
    }
    const verdict = pct >= 85 ? 3 : pct >= 60 ? 2 : pct >= 35 ? 1 : 0;
    const prof = el("div", "prof");
    const pig = el("div", "prof-pigeon" + (verdict >= 2 ? " happy" : verdict === 0 ? " angry" : ""));
    pig.innerHTML = '<svg viewBox="0 0 120 120"><use href="#pigeon"/></svg>';
    const bubble = el("div", "prof-bubble");
    bubble.append(el("p", "prof-name", tr("profName")), el("p", "prof-line", tr("pigeonResult")[verdict]));
    prof.append(pig, bubble);
    box.append(prof);

    const actions = el("div", "actions");
    const next = nextLessonOf(lesson.course, lesson.ref);
    if (next) {
      const b = el("button", "btn btn-primary btn-block", tr("lessonNextLesson"));
      b.addEventListener("click", () => startLesson(lesson.course, next));
      actions.append(b);
    } else {
      box.append(el("p", "lesson-all-done", tr("lessonAllDone")));
    }
    const again = el("button", "btn btn-ghost btn-block", tr("lessonRepeat"));
    again.addEventListener("click", () => startLesson(lesson.course, lesson.ref));
    actions.append(again);
    box.append(actions);
    body.append(box);
  }

  $("btn-lesson-back").addEventListener("click", () => { currentTab = "lessons"; showPicker(); });
  $("btn-reset-progress").addEventListener("click", () => {
    if (!window.confirm(tr("resetConfirm"))) return;
    try { localStorage.removeItem(PROGRESS_KEY); } catch (e) { /* storage unavailable */ }
    renderCourses();
  });

  // ---------- eye candy ----------
  function heartBurst(el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < 12; i++) {
      const h = document.createElement("span");
      h.className = "burst-heart";
      h.textContent = pick(["💖", "💕", "💗", "❤️", "✨"]);
      const angle = (Math.PI * 2 * i) / 12;
      const dist = 50 + Math.random() * 50;
      h.style.left = `${cx}px`;
      h.style.top = `${cy}px`;
      h.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      h.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 950);
    }
  }

  // Professor Pigeon's "warning shot": poop falls from the top of the screen
  // and lands just next to the pigeon - a deliberate miss. Count grows with the wrong streak.
  function warningShot(target, count) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = target.getBoundingClientRect();
    for (let n = 0; n < count; n++) {
      const p = document.createElement("span");
      p.className = "poop";
      p.textContent = "💩";
      const side = n % 2 === 0 ? 1 : -1;
      const x = Math.min(window.innerWidth - 36, Math.max(4, r.left + r.width / 2 + side * (40 + n * 22) - 14));
      const landY = Math.min(window.innerHeight - 40, r.bottom - 10);
      p.style.left = `${x}px`;
      document.body.appendChild(p);
      const fall = p.animate(
        [{ transform: "translateY(-60px) rotate(0deg)" }, { transform: `translateY(${landY + 60}px) rotate(${side * 200}deg)` }],
        { duration: 750, delay: n * 220, easing: "cubic-bezier(.55, 0, 1, .45)", fill: "forwards" }
      );
      fall.onfinish = () => {
        p.textContent = "💥";
        p.animate(
          [{ transform: `translateY(${landY + 60}px) scale(1.4)`, opacity: 1 }, { transform: `translateY(${landY + 60}px) scale(0.6)`, opacity: 0 }],
          { duration: 500, fill: "forwards" }
        ).onfinish = () => p.remove();
      };
    }
  }

  function spawnFloatingHeart() {
    const h = document.createElement("span");
    h.className = "float-heart";
    h.textContent = pick(["❤️", "💕", "💖", "🌹", "💘", "🍷"]);
    h.style.left = `${Math.random() * 95}%`;
    h.style.fontSize = `${14 + Math.random() * 22}px`;
    const duration = 7 + Math.random() * 6;
    h.style.animationDuration = `${duration}s`;
    $("hearts").appendChild(h);
    setTimeout(() => h.remove(), duration * 1000);
  }

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setInterval(spawnFloatingHeart, window.innerWidth < 600 ? 1500 : 900);
  }

  // ---------- events ----------
  $("btn-start").addEventListener("click", startQuiz);
  $("player-name").addEventListener("keydown", (e) => { if (e.key === "Enter") startQuiz(); });
  $("btn-next").addEventListener("click", next);
  $("btn-restart").addEventListener("click", () => { show("screen-welcome"); renderWelcome(); });
  $("btn-other-test").addEventListener("click", showPicker);
  $("btn-change-test").addEventListener("click", showPicker);
  $("btn-error-back").addEventListener("click", showPicker);
  $("btn-retry").addEventListener("click", () => location.reload());

  // Keyboard shortcuts (desktop): 1-4 / A-D pick an answer, Enter goes next.
  document.addEventListener("keydown", (e) => {
    if (!$("screen-quiz").classList.contains("active")) return;
    if (!$("feedback").hidden) {
      if (e.key === "Enter" && document.activeElement !== $("btn-next")) next();
      return;
    }
    const key = e.key.toUpperCase();
    let i = "1234".indexOf(key);
    if (i === -1) i = "ABCD".indexOf(key);
    const btn = $("options").children[i];
    if (i >= 0 && btn) btn.click();
  });

  // ---------- start ----------
  setTheme(currentTheme()); // set by the inline script in <head> from the saved choice
  setLang(detectLang());
  loadManifest()
    .then(() => {
      const wanted = new URLSearchParams(location.search).get("test");
      // The test list is always the first screen, unless a direct link (?test=id) says otherwise.
      const t = tests.find((x) => x.id === wanted);
      if (t && gender) selectTest(t);
      else showPicker();
    })
    .catch(showError);
})();
