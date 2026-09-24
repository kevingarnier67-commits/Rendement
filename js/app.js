(() => {
  "use strict";

  const KEY = "rendement.app.v3";
  const OLD_KEY = "rendement.timer.v2";

  // Couleurs système iOS (la valeur exacte dépend du thème, voir css/style.css).
  const TONES = ["blue", "purple", "orange", "teal", "pink", "yellow", "green", "indigo"];
  // Anciennes couleurs (hex de la 1re version, noms de la version précédente) → couleurs iOS.
  const LEGACY_TONES = {
    "#4da3ff": "blue", "#b07cff": "purple", "#ff9d42": "orange", "#2fd4b5": "teal",
    "#ff6b9d": "pink", "#ffd84d": "yellow", "#6ee7a0": "green", "#ff8360": "indigo",
    violet: "purple", amber: "yellow", cyan: "indigo",
  };

  const DEFAULT_CATEGORIES = [
    { id: "cms", label: "TEMPS CMS", tone: "blue", builtin: true },
    { id: "cf", label: "TEMPS CF", tone: "purple", builtin: true },
    { id: "rep", label: "TEMPS RÉPARATION", tone: "orange", builtin: true },
  ];

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function toneOf(item) {
    if (!item) return null;
    if (TONES.includes(item.tone)) return item.tone;
    return LEGACY_TONES[item.tone] || LEGACY_TONES[String(item.color || "").toLowerCase()] || null;
  }

  const DEFAULT_BASE = 455;

  // Cadence de référence : refQty pièces en refMin minutes. Stockée telle quelle (pas de temps/pièce arrondi)
  // pour que 470 Cages donnent exactement 60 min.
  const DEFAULT_PRODUCTS = [
    { id: "poles", label: "Pôles", refQty: "", refMin: "" },
    { id: "poles80", label: "Pôles 80/100A", refQty: "", refMin: "" },
    { id: "s1", label: "S1", refQty: "96", refMin: "35" },
    { id: "liaisons", label: "Liaisons", refQty: "144", refMin: "40" },
    { id: "cages", label: "Cages", refQty: "470", refMin: "60" },
    { id: "mfv", label: "MFV", refQty: "", refMin: "" },
  ];
  const RATES_VERSION = 1;
  const DEFAULT_TARGET = "100";

  // Les cadences sont mémorisées d'un jour à l'autre ; seules les quantités (qty) sont remises à zéro.
  function freshCalc() {
    return {
      base: DEFAULT_BASE,
      products: DEFAULT_PRODUCTS.map((p) => ({ ...p, builtin: true })),
      qty: {},
      ratesVersion: RATES_VERSION,
      target: DEFAULT_TARGET,
    };
  }

  function unitToRate(unit) {
    return parseNum(unit) > 0 ? { refQty: "1", refMin: unit } : { refQty: "", refMin: "" };
  }

  function normalizeCalc(calc) {
    if (!calc) return freshCalc();
    let next;
    if (Array.isArray(calc.products)) {
      next = calc;
      next.products.forEach((p) => {
        if (p.refQty === undefined) Object.assign(p, unitToRate(p.unit));
        delete p.unit;
      });
    } else {
      // migration depuis la version à lignes libres (quantité × min/pièce sans nom de matière)
      next = freshCalc();
      if (calc.base != null && calc.base !== "") next.base = calc.base;
      (calc.lines || [])
        .filter((l) => parseNum(l.qty) > 0 || parseNum(l.unit) > 0)
        .forEach((l, i) => {
          const id = uuid();
          next.products.push({ id, label: `Référence ${i + 1}`, ...unitToRate(l.unit), builtin: false });
          next.qty[id] = l.qty;
        });
    }
    if ((next.ratesVersion || 0) < RATES_VERSION) {
      DEFAULT_PRODUCTS.filter((d) => d.refQty).forEach((d) => {
        const p = next.products.find((x) => x.id === d.id);
        if (p) { p.refQty = d.refQty; p.refMin = d.refMin; }
      });
      next.ratesVersion = RATES_VERSION;
    }
    if (next.target == null) next.target = DEFAULT_TARGET;
    if (!next.qty || typeof next.qty !== "object") next.qty = {};
    return next;
  }

  function normalizeCategories(categories) {
    const used = [];
    categories.forEach((c) => {
      c.tone = toneOf(c) || TONES.find((t) => !used.includes(t)) || TONES[used.length % TONES.length];
      delete c.color;
      used.push(c.tone);
    });
    return categories;
  }

  function minutesFor(qty, p) {
    const refQty = parseNum(p.refQty);
    const refMin = parseNum(p.refMin);
    return refQty > 0 && refMin > 0 ? (qty * refMin) / refQty : null;
  }

  function freshState() {
    return {
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      totals: {},
      active: null,
      history: [],
      calc: freshCalc(),
    };
  }

  // Vérifie et complète un état lu (stockage local ou fichier de sauvegarde). null si invalide.
  function normalizeState(s) {
    if (!s || !Array.isArray(s.categories) || !s.categories.every((c) => c && c.id && c.label)) return null;
    s.calc = normalizeCalc(s.calc);
    normalizeCategories(s.categories);
    if (!s.totals || typeof s.totals !== "object") s.totals = {};
    if (!Array.isArray(s.history)) s.history = [];
    if (s.active && !(s.active.id && s.active.startedAt)) s.active = null;
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = normalizeState(JSON.parse(raw));
        if (s) return s;
      }
      // migration depuis la version précédente (3 catégories fixes, pas d'historique)
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        const o = JSON.parse(old);
        const s = freshState();
        if (o && o.totals) s.totals = o.totals;
        if (o && o.active) s.active = o.active;
        localStorage.removeItem(OLD_KEY);
        return s;
      }
    } catch (e) { /* état corrompu -> repart de zéro */ }
    return freshState();
  }

  let state = load();

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  // ---------- formatting ----------
  function pad2(n) { return String(n).padStart(2, "0"); }

  // Tout est exprimé en minutes, jamais en heures (ex : 75 min, pas 1:15).
  function minutesOf(ms) { return Math.floor(ms / 60000); }

  function formatMinutes(ms) { return `${minutesOf(ms)} min`; }

  function formatMinSec(ms) {
    const totalSec = Math.floor(ms / 1000);
    return `${pad2(Math.floor(totalSec / 60))}:${pad2(totalSec % 60)}`;
  }

  function formatNumber(n, decimals) {
    return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  function parseNum(str) {
    const n = parseFloat(String(str).replace(",", ".").replace(/\s/g, ""));
    return isFinite(n) ? n : 0;
  }

  function digitsOnly(v) { return v.replace(/\D+/g, ""); }

  function decimalOnly(v) {
    let s = v.replace(/[^\d.,]/g, "").replace(/\./g, ",");
    const i = s.indexOf(",");
    if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, "");
    return s;
  }

  // Filtre la saisie en direct (chiffres seulement) et renvoie la valeur propre.
  function bindNumeric(input, sanitize, onValue) {
    input.addEventListener("input", () => {
      const clean = sanitize(input.value);
      if (clean !== input.value) input.value = clean;
      onValue(clean);
    });
  }

  function icon(name) {
    return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  function setTone(node, tone) {
    TONES.forEach((t) => node.classList.remove(`tone-${t}`));
    if (tone) node.classList.add(`tone-${tone}`);
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function plural(n, one, many) { return n < 2 ? one : many; }

  function rateLabel(p) {
    const q = parseNum(p.refQty);
    const m = parseNum(p.refMin);
    if (!(q > 0 && m > 0)) return null;
    return `${formatNumber(q, 2)} ${plural(q, "pièce", "pièces")} en ${formatNumber(m, 2)} min`;
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    date: $("today-date"),
    navbar: $("navbar"),
    navbarTitle: $("navbar-title"),
    stopwatch: document.querySelector(".stopwatch"),
    statusText: $("clock-status-text"),
    time: $("clock-time"),
    stop: $("btn-stop"),
    catList: $("cat-list"),
    grandTotal: $("grand-total"),
    saveDay: $("btn-save-day"),
    finish: $("btn-finish"),
    reset: $("btn-reset"),
    manageCats: $("btn-manage-cats"),
    calcBase: $("calc-base"),
    calcMinuted: $("calc-minuted"),
    calcNet: $("calc-net"),
    calcNet2: $("calc-net-2"),
    calcProducts: $("calc-products"),
    calcAddProduct: $("btn-add-product"),
    calcProduced: $("calc-produced"),
    calcRendement: $("calc-rendement"),
    calcResult: $("calc-result"),
    calcRing: $("calc-ring"),
    calcGap: $("calc-gap"),
    calcTarget: $("calc-target"),
    historySummary: $("history-summary"),
    historyAvg: $("history-avg"),
    historyChart: $("history-chart"),
    historyChartFooter: $("history-chart-footer"),
    exportBtn: $("btn-export"),
    importBtn: $("btn-import"),
    importFile: $("import-file"),
    tabRunning: $("tab-running"),
    tabRunningSr: $("tab-running-sr"),
    calcClear: $("btn-calc-clear"),
    historyList: $("history-list"),
    historyEmpty: $("history-empty"),
    emptyGo: $("btn-empty-go"),
    dlgCats: $("dlg-cats"),
    formAddCat: $("form-add-cat"),
    newCatInput: $("new-cat-input"),
    newCatError: $("new-cat-error"),
    customCatSection: $("custom-cat-section"),
    customCatList: $("custom-cat-list"),
    dlgCatsClose: $("dlg-cats-close"),
    dlgRate: $("dlg-rate"),
    formRate: $("form-rate"),
    rateTitle: $("dlg-rate-title"),
    rateQty: $("rate-qty"),
    rateMin: $("rate-min"),
    rateHint: $("rate-hint"),
    rateCancel: $("dlg-rate-cancel"),
    rateDeleteSection: $("rate-delete-section"),
    rateDelete: $("rate-delete"),
    dlgAlert: $("dlg-alert"),
    formAlert: $("form-alert"),
    alertTitle: $("alert-title"),
    alertText: $("alert-text"),
    alertField: $("alert-field"),
    alertLabel: $("alert-label"),
    alertInput: $("alert-input"),
    alertError: $("alert-error"),
    alertCancel: $("alert-cancel"),
    alertOk: $("alert-ok"),
    dlgAction: $("dlg-action"),
    actionTitle: $("action-title"),
    actionText: $("action-text"),
    actionOk: $("action-ok"),
    actionCancel: $("action-cancel"),
    toast: $("toast"),
    toastText: $("toast-text"),
    toastAction: $("toast-action"),
    live: $("live"),
  };

  el.date.textContent = capitalize(new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  }));

  // Message éphémère, avec une action facultative (ex. Annuler).
  let toastTimeout = null;
  let toastRun = null;
  function hideToast() {
    clearTimeout(toastTimeout);
    el.toast.hidden = true;
    toastRun = null;
  }
  function toast(msg, action = null) {
    el.toastText.textContent = msg;
    el.live.textContent = "";
    requestAnimationFrame(() => {
      el.live.textContent = action ? `${msg}. Bouton ${action.label} disponible.` : msg;
    });
    toastRun = action ? action.run : null;
    el.toastAction.hidden = !action;
    if (action) el.toastAction.textContent = action.label;
    el.toast.hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(hideToast, action ? 8000 : 3000);
  }
  el.toastAction.addEventListener("click", () => {
    const run = toastRun;
    hideToast();
    if (run) run();
  });
  // Tant que le doigt ou le focus est sur le message, il reste affiché.
  ["pointerenter", "focusin"].forEach((t) => el.toast.addEventListener(t, () => clearTimeout(toastTimeout)));
  ["pointerleave", "focusout"].forEach((t) => el.toast.addEventListener(t, () => {
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(hideToast, 4000);
  }));

  // ---------- alertes et menus d'action ----------
  const hasDialog = typeof HTMLDialogElement === "function" && typeof el.dlgAlert.showModal === "function";

  function openDialog(d) { if (hasDialog) d.showModal(); else d.setAttribute("open", ""); }
  function closeDialog(d) { if (hasDialog) { if (d.open) d.close(); } else d.removeAttribute("open"); }

  // Feuille : glisser vers le bas depuis la poignée, ou toucher la zone assombrie, pour la fermer.
  function makeDismissible(sheet, onDismiss) {
    const handle = sheet.querySelector(".sheet-handle");
    let startY = null;
    let startT = 0;
    let dy = 0;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, input")) return;
      startY = e.clientY;
      startT = e.timeStamp;
      dy = 0;
      handle.setPointerCapture(e.pointerId);
      sheet.classList.add("is-dragging");
    });
    handle.addEventListener("pointermove", (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = (e) => {
      if (startY === null) return;
      const speed = dy / Math.max(1, e.timeStamp - startT);
      startY = null;
      sheet.classList.remove("is-dragging");
      sheet.style.transform = "";
      if (dy > 110 || (dy > 30 && speed > 0.6)) onDismiss();
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) onDismiss(); });
  }

  function showFieldError(input, errorEl, message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
    input.classList.toggle("is-invalid", !!message);
    if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }

  // Action destructive → menu d'action (bas d'écran) ; confirmation ou saisie → alerte.
  // Renvoie true / la valeur saisie si confirmé, null si annulé.
  function ask({ title, text = "", confirmLabel, danger = false, input = null }) {
    if (!hasDialog) {
      if (input) {
        const v = (prompt(title) || "").trim();
        const err = v ? (input.validate && input.validate(v)) : "vide";
        if (err) { if (err !== "vide") toast(err); return Promise.resolve(null); }
        return Promise.resolve(v);
      }
      return Promise.resolve(confirm(text ? `${title}\n\n${text}` : title) || null);
    }
    if (danger && !input) return askAction({ title, text, confirmLabel });
    return new Promise((resolve) => {
      el.alertTitle.textContent = title;
      el.alertText.textContent = text;
      el.alertOk.textContent = confirmLabel;
      el.alertField.hidden = !input;
      showFieldError(el.alertInput, el.alertError, "");
      if (input) {
        el.alertLabel.textContent = input.label;
        el.alertInput.placeholder = input.placeholder || "";
        el.alertInput.value = "";
      }
      const finish = (value) => {
        el.formAlert.removeEventListener("submit", onSubmit);
        el.alertCancel.removeEventListener("click", onCancel);
        el.dlgAlert.removeEventListener("cancel", onCancel);
        el.alertInput.removeEventListener("input", onType);
        closeDialog(el.dlgAlert);
        resolve(value);
      };
      const onSubmit = (e) => {
        e.preventDefault();
        if (!input) { finish(true); return; }
        const v = el.alertInput.value.trim();
        const err = v ? (input.validate && input.validate(v)) : input.emptyMessage;
        if (err) { showFieldError(el.alertInput, el.alertError, err); el.alertInput.focus(); return; }
        finish(v);
      };
      const onCancel = (e) => { if (e) e.preventDefault(); finish(null); };
      const onType = () => showFieldError(el.alertInput, el.alertError, "");
      el.formAlert.addEventListener("submit", onSubmit);
      el.alertCancel.addEventListener("click", onCancel);
      el.dlgAlert.addEventListener("cancel", onCancel);
      el.alertInput.addEventListener("input", onType);
      openDialog(el.dlgAlert);
      (input ? el.alertInput : el.alertCancel).focus();
    });
  }

  function askAction({ title, text, confirmLabel }) {
    return new Promise((resolve) => {
      el.actionTitle.textContent = title;
      el.actionText.textContent = text;
      el.actionOk.textContent = confirmLabel;
      const finish = (value) => {
        el.actionOk.removeEventListener("click", onOk);
        el.actionCancel.removeEventListener("click", onCancel);
        el.dlgAction.removeEventListener("cancel", onCancel);
        el.dlgAction.removeEventListener("click", onBackdrop);
        closeDialog(el.dlgAction);
        resolve(value);
      };
      const onOk = () => finish(true);
      const onCancel = (e) => { if (e) e.preventDefault(); finish(null); };
      const onBackdrop = (e) => { if (e.target === el.dlgAction) finish(null); };
      el.actionOk.addEventListener("click", onOk);
      el.actionCancel.addEventListener("click", onCancel);
      el.dlgAction.addEventListener("cancel", onCancel);
      el.dlgAction.addEventListener("click", onBackdrop);
      openDialog(el.dlgAction);
      el.actionCancel.focus();
    });
  }

  // ---------- chrono ----------
  function totalOf(id) { return state.totals[id] || 0; }

  function activeElapsed() {
    return state.active ? Date.now() - state.active.startedAt : 0;
  }

  function stopActive() {
    if (!state.active) return;
    state.totals[state.active.id] = totalOf(state.active.id) + activeElapsed();
    state.active = null;
    persist();
  }

  function startCategory(id) {
    state.active = { id, startedAt: Date.now() };
    persist();
  }

  function liveTotalOf(id) {
    return totalOf(id) + (state.active && state.active.id === id ? activeElapsed() : 0);
  }

  // Somme des minutes affichées par poste, pour que le total colle toujours au détail.
  function minutedMinutes() {
    return state.categories.reduce((acc, c) => acc + minutesOf(liveTotalOf(c.id)), 0);
  }

  // ---------- postes ----------
  function renderCats() {
    el.catList.innerHTML = "";
    state.categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "row cat";
      btn.dataset.cat = cat.id;
      setTone(btn, cat.tone);
      btn.innerHTML = `
        <span class="row-icon" aria-hidden="true">${icon("timer")}</span>
        <span class="row-text">
          <span class="row-title cat-name"></span>
          <span class="row-subtitle cat-sub" hidden>En cours</span>
        </span>
        <span class="row-value cat-min">0 min</span>
        <span class="cat-toggle" aria-hidden="true">${icon("play")}</span>`;
      btn.querySelector(".cat-name").textContent = cat.label;
      btn.addEventListener("click", () => {
        if (toastRun) hideToast();
        if (state.active && state.active.id === cat.id) {
          stopActive();
        } else {
          stopActive();
          startCategory(cat.id);
        }
        render();
      });
      el.catList.appendChild(btn);
    });
  }

  function render() {
    const activeId = state.active ? state.active.id : null;
    const activeCat = activeId ? state.categories.find((c) => c.id === activeId) : null;

    Array.from(el.catList.children).forEach((btn) => {
      const id = btn.dataset.cat;
      const isActive = id === activeId;
      const wasActive = btn.classList.contains("is-running");
      btn.classList.toggle("is-running", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      btn.querySelector(".cat-sub").hidden = !isActive;
      if (isActive !== wasActive) {
        btn.querySelector(".cat-toggle use").setAttribute("href", isActive ? "#i-stop" : "#i-play");
      }
      btn.querySelector(".cat-min").textContent = formatMinutes(liveTotalOf(id));
    });

    el.stopwatch.classList.toggle("is-running", !!activeCat);
    setTone(el.stopwatch, activeCat ? activeCat.tone : null);
    el.stop.hidden = !activeCat;
    if (activeCat) {
      el.statusText.textContent = activeCat.label;
      el.time.textContent = formatMinSec(activeElapsed());
    } else {
      el.statusText.textContent = "Aucun poste en cours";
      el.time.textContent = "00:00";
    }

    el.grandTotal.textContent = `${minutedMinutes()} min`;
    el.tabRunning.hidden = !activeCat;
    el.tabRunningSr.hidden = !activeCat;
    setTone(el.tabRunning, activeCat ? activeCat.tone : null);
    renderCalcResults();
  }

  el.stop.addEventListener("click", () => { stopActive(); render(); });

  // ---------- calcul du rendement ----------
  // Temps de production = base (455 min) − minutes minutées.
  // Rendement = minutes produites (Σ quantité × cadence de chaque matière) ÷ temps de production.
  function computeCalc() {
    const base = parseNum(state.calc.base);
    const minuted = minutedMinutes();
    const net = base - minuted;
    const items = state.calc.products
      .map((p) => {
        const qty = parseNum(state.calc.qty[p.id]);
        return {
          label: p.label,
          qty,
          refQty: parseNum(p.refQty),
          refMin: parseNum(p.refMin),
          minutes: minutesFor(qty, p) || 0,
        };
      })
      .filter((i) => i.qty > 0);
    const produced = items.reduce((acc, i) => acc + i.minutes, 0);
    const rendement = net > 0 && produced > 0 ? (produced / net) * 100 : null;
    const target = parseNum(state.calc.target) > 0 ? parseNum(state.calc.target) : parseNum(DEFAULT_TARGET);
    return { base, minuted, net, produced, rendement, target, items };
  }

  const RING_LENGTH = 2 * Math.PI * 52;

  // Ce qu'il reste à produire pour atteindre l'objectif, en minutes.
  function gapText(c) {
    const t = formatNumber(c.target, 1);
    if (c.net <= 0) return "Plus de temps de production : vérifie la base et les minutes minutées.";
    if (c.rendement == null) return `Saisis ta production pour voir ton rendement. Objectif : ${t} %.`;
    const missing = (c.net * c.target) / 100 - c.produced;
    if (missing > 0.05) return `Encore ${formatNumber(missing, 1)} min de production pour atteindre ${t} %.`;
    return `Objectif de ${t} % atteint.`;
  }

  function renderCalcResults() {
    const c = computeCalc();
    el.calcMinuted.textContent = `${c.minuted} min`;
    el.calcNet.textContent = `${formatNumber(c.net, 1)} min`;
    el.calcNet2.textContent = `${formatNumber(c.net, 1)} min`;
    el.calcProduced.textContent = `${formatNumber(c.produced, 1)} min`;
    el.calcRendement.textContent = c.rendement == null ? "--" : `${formatNumber(c.rendement, 1)} %`;
    const progress = Math.min((c.rendement || 0) / c.target, 1);
    el.calcRing.style.strokeDasharray = `${RING_LENGTH}`;
    el.calcRing.style.strokeDashoffset = `${RING_LENGTH * (1 - progress)}`;
    el.calcResult.classList.toggle("is-reached", c.rendement != null && c.rendement >= c.target);
    el.calcGap.textContent = gapText(c);
    state.calc.products.forEach((p) => {
      const row = el.calcProducts.querySelector(`[data-prod="${p.id}"]`);
      if (!row) return;
      const qty = parseNum(state.calc.qty[p.id]);
      const minutes = minutesFor(qty, p);
      const out = row.querySelector(".prod-total");
      const missingRate = qty > 0 && minutes == null;
      out.textContent = missingRate ? "Cadence manquante" : `${formatNumber(minutes || 0, 1)} min`;
      out.classList.toggle("is-warn", missingRate);
      const label = rateLabel(p);
      const rate = row.querySelector(".prod-rate");
      rate.textContent = label || "Définir la cadence";
      rate.classList.toggle("is-missing", !label);
      row.querySelector(".prod-open").setAttribute("aria-label",
        `${p.label}, cadence ${label || "non définie"}. Modifier la cadence`);
    });
  }

  function renderCalcProducts() {
    el.calcBase.value = state.calc.base;
    el.calcTarget.value = state.calc.target;
    el.calcProducts.innerHTML = "";
    state.calc.products.forEach((p, idx) => {
      const row = document.createElement("div");
      row.className = "row prod";
      row.dataset.prod = p.id;
      const uid = `p${idx}`;
      row.innerHTML = `
        <button type="button" class="prod-open" aria-haspopup="dialog">
          <span class="prod-name"></span>
          <span class="prod-rate"></span>
        </button>
        <span class="prod-qty">
          <input type="text" inputmode="numeric" id="${uid}-qty" class="field prod-qty-input" placeholder="Qté" autocomplete="off" />
          <span class="prod-total" aria-live="polite">0 min</span>
        </span>`;
      row.querySelector(".prod-name").textContent = p.label;
      const qty = row.querySelector(".prod-qty-input");
      qty.setAttribute("aria-label", `Quantité ${p.label}`);
      qty.value = state.calc.qty[p.id] || "";
      bindNumeric(qty, digitsOnly, (v) => { state.calc.qty[p.id] = v; persist(); renderCalcResults(); });
      row.querySelector(".prod-open").addEventListener("click", () => openRateSheet(p));
      el.calcProducts.appendChild(row);
    });
  }

  // ---------- feuille : cadence ----------
  let rateTarget = null;

  function updateRateHint() {
    const q = parseNum(el.rateQty.value);
    const m = parseNum(el.rateMin.value);
    el.rateHint.textContent = q > 0 && m > 0
      ? `Soit ${formatNumber(m / q, 3)} min par pièce, ou ${formatNumber((q / m) * 60, 1)} pièces par heure.`
      : "Exemple : 470 pièces en 60 minutes.";
  }

  function openRateSheet(p) {
    rateTarget = p;
    el.rateTitle.textContent = p.label;
    el.rateQty.value = p.refQty;
    el.rateMin.value = p.refMin;
    el.rateDeleteSection.hidden = !!p.builtin;
    updateRateHint();
    openDialog(el.dlgRate);
    el.rateQty.focus();
  }

  bindNumeric(el.rateQty, digitsOnly, updateRateHint);
  bindNumeric(el.rateMin, decimalOnly, updateRateHint);
  el.rateCancel.addEventListener("click", () => closeDialog(el.dlgRate));
  makeDismissible(el.dlgRate, () => closeDialog(el.dlgRate));
  el.formRate.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!rateTarget) return;
    rateTarget.refQty = el.rateQty.value;
    rateTarget.refMin = el.rateMin.value;
    persist();
    closeDialog(el.dlgRate);
    renderCalcResults();
  });
  el.rateDelete.addEventListener("click", async () => {
    const p = rateTarget;
    closeDialog(el.dlgRate);
    const ok = await ask({ title: `Supprimer ${p.label} ?`, text: "Sa cadence et sa quantité du jour seront effacées.", confirmLabel: "Supprimer la matière", danger: true });
    if (!ok) return;
    state.calc.products = state.calc.products.filter((x) => x.id !== p.id);
    delete state.calc.qty[p.id];
    persist();
    renderCalcProducts();
    renderCalcResults();
  });

  // ---------- enregistrer / remettre à zéro ----------
  function resetTotals() {
    state.totals = {};
    state.active = null;
    persist();
  }

  el.saveDay.addEventListener("click", () => {
    const hasMinutes = minutedMinutes() > 0;
    if (!hasMinutes && computeCalc().produced === 0) { toast("Rien à enregistrer pour l'instant"); return; }
    const before = {
      totals: { ...state.totals },
      active: state.active ? { ...state.active } : null,
      qty: { ...state.calc.qty },
    };
    stopActive();
    const items = state.categories
      .map((c) => ({ label: c.label, tone: c.tone, ms: totalOf(c.id) }))
      .filter((i) => minutesOf(i.ms) > 0);
    const totalMs = items.reduce((acc, i) => acc + minutesOf(i.ms) * 60000, 0);
    const calc = computeCalc();
    const now = new Date();
    const entryId = uuid();
    state.history.unshift({
      id: entryId,
      savedAt: now.getTime(),
      dateLabel: now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      items,
      totalMs,
      calc: calc.produced > 0 ? calc : null,
    });
    state.calc.qty = {};
    resetTotals();
    renderCalcProducts();
    renderHistory();
    render();
    showView("view-history");
    toast("Journée enregistrée", {
      label: "Annuler",
      run: () => {
        state.history = state.history.filter((e) => e.id !== entryId);
        state.totals = before.totals;
        state.active = before.active;
        state.calc.qty = before.qty;
        persist();
        renderCalcProducts();
        renderHistory();
        render();
        showView("view-calc");
        toast("Enregistrement annulé");
      },
    });
  });

  el.finish.addEventListener("click", () => showView("view-calc"));
  el.emptyGo.addEventListener("click", () => showView("view-calc"));

  bindNumeric(el.calcBase, decimalOnly, (v) => {
    state.calc.base = v;
    persist();
    renderCalcResults();
  });

  bindNumeric(el.calcTarget, decimalOnly, (v) => {
    state.calc.target = v;
    persist();
    renderCalcResults();
    renderHistory();
  });

  el.calcAddProduct.addEventListener("click", async () => {
    const label = await ask({
      title: "Nouvelle matière",
      text: "Tu pourras ensuite régler sa cadence.",
      confirmLabel: "Ajouter",
      input: {
        label: "Nom de la matière",
        placeholder: "Nom de la matière",
        emptyMessage: "Écris le nom de la matière.",
        validate: (v) => state.calc.products.some((p) => p.label.toLowerCase() === v.toLowerCase())
          ? "Cette matière existe déjà." : null,
      },
    });
    if (!label) return;
    const p = { id: uuid(), label, refQty: "", refMin: "", builtin: false };
    state.calc.products.push(p);
    persist();
    renderCalcProducts();
    renderCalcResults();
    openRateSheet(p);
  });

  el.calcClear.addEventListener("click", async () => {
    const ok = await ask({ title: "Effacer les quantités ?", text: "Les cadences sont conservées.", confirmLabel: "Effacer les quantités", danger: true });
    if (!ok) return;
    state.calc.qty = {};
    persist();
    renderCalcProducts();
    renderCalcResults();
  });

  el.reset.addEventListener("click", async () => {
    const ok = await ask({
      title: "Remettre les compteurs à zéro ?",
      text: "Les minutes minutées d'aujourd'hui seront effacées sans être enregistrées.",
      confirmLabel: "Remettre à zéro",
      danger: true,
    });
    if (!ok) return;
    resetTotals();
    render();
    toast("Compteurs remis à zéro");
  });

  // ---------- historique ----------
  function historyRow(title, value, { subtitle = "", strong = false } = {}) {
    const row = document.createElement("div");
    row.className = "row";
    const text = document.createElement("span");
    text.className = "row-text";
    const t = document.createElement("span");
    t.className = "row-title" + (strong ? " row-strong" : "");
    t.textContent = title;
    text.appendChild(t);
    if (subtitle) {
      const s = document.createElement("span");
      s.className = "row-subtitle";
      s.textContent = subtitle;
      text.appendChild(s);
    }
    const v = document.createElement("span");
    v.className = strong ? "day-score" : "row-value";
    v.textContent = value;
    row.append(text, v);
    return row;
  }

  // Graphique des dernières journées (7 max), de la plus ancienne à la plus récente.
  function renderChart() {
    const days = state.history.filter((e) => e.calc && e.calc.rendement != null).slice(0, 7).reverse();
    el.historySummary.hidden = days.length === 0;
    if (!days.length) return;
    const target = computeCalc().target;
    const values = days.map((d) => d.calc.rendement);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const top = Math.max(target * 1.15, ...values.map((v) => v * 1.08));
    el.historyAvg.textContent = `${formatNumber(avg, 1)} %`;
    el.historyChart.innerHTML = "";

    const plot = document.createElement("div");
    plot.className = "chart-plot";
    const line = document.createElement("span");
    line.className = "chart-target";
    line.style.bottom = `${(target / top) * 100}%`;
    plot.appendChild(line);
    const labels = document.createElement("div");
    labels.className = "chart-labels";

    days.forEach((d) => {
      const r = d.calc.rendement;
      const col = document.createElement("div");
      col.className = "chart-col";
      const bar = document.createElement("span");
      bar.className = "chart-bar" + (r >= target ? " is-reached" : "");
      bar.style.height = `${Math.max((r / top) * 100, 2)}%`;
      const val = document.createElement("span");
      val.className = "chart-val";
      val.style.bottom = `calc(${(r / top) * 100}% + 4px)`;
      val.textContent = `${Math.round(r)} %`;
      col.append(bar, val);
      plot.appendChild(col);

      const date = new Date(d.savedAt);
      const lab = document.createElement("span");
      lab.className = "chart-day";
      lab.innerHTML = `<span></span><span></span>`;
      lab.children[0].textContent = date.toLocaleDateString("fr-FR", { weekday: "short" });
      lab.children[1].textContent = date.getDate();
      labels.appendChild(lab);
    });
    el.historyChart.append(plot, labels);
    el.historyChart.setAttribute("aria-label", "Rendement des dernières journées : " +
      days.map((d) => `${d.dateLabel} ${formatNumber(d.calc.rendement, 1)} %`).join(", ") +
      `. Moyenne ${formatNumber(avg, 1)} %.`);
    const reached = values.filter((v) => v >= target).length;
    el.historyChartFooter.textContent =
      `Pointillés : objectif de ${formatNumber(target, 1)} %, atteint ${reached} ${plural(reached, "fois", "fois")} sur ${days.length}.`;
  }

  function shareText(entry) {
    const lines = [`Rendement – ${capitalize(entry.dateLabel)}`];
    const c = entry.calc;
    if (c && c.rendement != null) lines.push(`Rendement : ${formatNumber(c.rendement, 1)} %`);
    if (c) {
      lines.push(`Minutes produites : ${formatNumber(c.produced, 1)} min`);
      const prod = (c.items || []).map((i) => `${i.label} ${formatNumber(i.qty, 2)}`).join(", ");
      if (prod) lines.push(`Production : ${prod}`);
      lines.push(`Temps de production : ${formatNumber(c.net, 1)} min (${formatNumber(c.base, 1)} − ${c.minuted} min minutées)`);
    }
    lines.push(`Minutes minutées : ${formatMinutes(entry.totalMs)}`);
    entry.items.forEach((i) => lines.push(`  ${i.label} : ${minutesOf(i.ms)} min`));
    return lines.join("\n");
  }

  async function shareEntry(entry) {
    const text = shareText(entry);
    if (navigator.share) {
      try { await navigator.share({ title: "Rendement", text }); return; } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("Résumé copié");
    } catch (e) {
      toast("Partage impossible sur cet appareil");
    }
  }

  function renderHistory() {
    renderChart();
    el.historyList.innerHTML = "";
    el.historyEmpty.hidden = state.history.length > 0;
    state.history.forEach((entry) => {
      const section = document.createElement("section");
      section.className = "group day";
      const header = document.createElement("h2");
      header.className = "group-header";
      header.textContent = capitalize(entry.dateLabel);
      const list = document.createElement("div");
      list.className = "list";

      if (entry.calc && entry.calc.rendement != null) {
        list.appendChild(historyRow("Rendement", `${formatNumber(entry.calc.rendement, 1)} %`, { strong: true }));
      }
      const minutedDetail = entry.items.map((i) => `${i.label} ${minutesOf(i.ms)}`).join(" · ");
      list.appendChild(historyRow("Minutes minutées", formatMinutes(entry.totalMs), { subtitle: minutedDetail }));
      if (entry.calc) {
        const c = entry.calc;
        const prodDetail = (c.items || []).map((i) => `${i.label} ${formatNumber(i.qty, 2)}`).join(" · ");
        list.appendChild(historyRow("Minutes produites", `${formatNumber(c.produced, 1)} min`, { subtitle: prodDetail }));
        list.appendChild(historyRow("Temps de production", `${formatNumber(c.net, 1)} min`,
          { subtitle: `${formatNumber(c.base, 1)} − ${c.minuted} min minutées` }));
      }
      const share = document.createElement("button");
      share.type = "button";
      share.className = "row row-action";
      share.innerHTML = `${icon("export")}<span>Partager</span>`;
      share.addEventListener("click", () => shareEntry(entry));
      list.appendChild(share);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "row row-destructive";
      del.textContent = "Supprimer la journée";
      del.addEventListener("click", async () => {
        const ok = await ask({ title: "Supprimer cette journée ?", text: capitalize(entry.dateLabel), confirmLabel: "Supprimer la journée", danger: true });
        if (!ok) return;
        state.history = state.history.filter((e) => e.id !== entry.id);
        persist();
        renderHistory();
      });
      list.appendChild(del);

      section.append(header, list);
      el.historyList.appendChild(section);
    });
  }

  // ---------- onglets + barre de navigation compacte ----------
  let titleObserver = null;

  function watchLargeTitle(view) {
    if (titleObserver) titleObserver.disconnect();
    el.navbarTitle.textContent = view.dataset.title;
    el.navbar.classList.remove("is-visible");
    const h1 = view.querySelector(".large-title h1");
    if (!h1 || !("IntersectionObserver" in window)) return;
    titleObserver = new IntersectionObserver(([e]) => {
      el.navbar.classList.toggle("is-visible", !e.isIntersecting);
    }, { rootMargin: "-60px 0px 0px 0px" });
    titleObserver.observe(h1);
  }

  function showView(viewId) {
    document.querySelectorAll(".tab").forEach((b) => {
      if (b.dataset.view === viewId) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === viewId));
    window.scrollTo(0, 0);
    watchLargeTitle($(viewId));
  }

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  // ---------- feuille : postes ----------
  function nextTone() {
    const used = state.categories.map((c) => c.tone);
    return TONES.find((t) => !used.includes(t)) || TONES[state.categories.length % TONES.length];
  }

  function renderCustomCats() {
    const customs = state.categories.filter((c) => !c.builtin);
    el.customCatSection.hidden = customs.length === 0;
    el.customCatList.innerHTML = "";
    customs.forEach((cat) => {
      const row = document.createElement("div");
      row.className = "row cat";
      setTone(row, cat.tone);
      row.innerHTML = `<span class="row-icon" aria-hidden="true">${icon("timer")}</span><span class="row-title"></span>`;
      row.querySelector(".row-title").textContent = cat.label;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-inline-tint";
      del.style.color = "var(--red)";
      del.textContent = "Supprimer";
      del.setAttribute("aria-label", `Supprimer ${cat.label}`);
      del.addEventListener("click", async () => {
        const hasTime = totalOf(cat.id) > 0 || (state.active && state.active.id === cat.id);
        closeDialog(el.dlgCats);
        const ok = await ask({
          title: `Supprimer ${cat.label} ?`,
          text: hasTime ? "Le temps compté aujourd'hui sur ce poste sera perdu." : "",
          confirmLabel: "Supprimer le poste",
          danger: true,
        });
        if (ok) {
          if (state.active && state.active.id === cat.id) state.active = null;
          delete state.totals[cat.id];
          state.categories = state.categories.filter((c) => c.id !== cat.id);
          persist();
          renderCats();
          render();
        }
        openCatsSheet();
      });
      row.appendChild(del);
      el.customCatList.appendChild(row);
    });
  }

  function openCatsSheet() {
    el.newCatInput.value = "";
    showFieldError(el.newCatInput, el.newCatError, "");
    renderCustomCats();
    openDialog(el.dlgCats);
  }

  el.manageCats.addEventListener("click", openCatsSheet);
  el.dlgCatsClose.addEventListener("click", () => closeDialog(el.dlgCats));
  makeDismissible(el.dlgCats, () => closeDialog(el.dlgCats));
  el.newCatInput.addEventListener("input", () => showFieldError(el.newCatInput, el.newCatError, ""));

  el.formAddCat.addEventListener("submit", (e) => {
    e.preventDefault();
    const label = el.newCatInput.value.trim().toUpperCase();
    let err = null;
    if (!label) err = "Écris le nom du poste.";
    else if (state.categories.some((c) => c.label === label)) err = "Ce poste existe déjà.";
    if (err) { showFieldError(el.newCatInput, el.newCatError, err); el.newCatInput.focus(); return; }
    state.categories.push({ id: uuid(), label, tone: nextTone(), builtin: false });
    persist();
    el.newCatInput.value = "";
    renderCats();
    render();
    renderCustomCats();
    toast(`${label} ajouté`);
  });

  // ---------- sauvegarde ----------
  el.exportBtn.addEventListener("click", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const name = `rendement-sauvegarde-${day}.json`;
    const data = JSON.stringify({ app: "rendement", version: 1, exportedAt: Date.now(), state }, null, 2);
    const file = new File([data], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Sauvegarde Rendement" }); return; } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Sauvegarde exportée");
  });

  el.importBtn.addEventListener("click", () => el.importFile.click());

  el.importFile.addEventListener("change", async () => {
    const f = el.importFile.files && el.importFile.files[0];
    el.importFile.value = "";
    if (!f) return;
    let next = null;
    try {
      const parsed = JSON.parse(await f.text());
      next = normalizeState(parsed && parsed.state ? parsed.state : parsed);
    } catch (e) { next = null; }
    if (!next) { toast("Ce fichier n'est pas une sauvegarde Rendement"); return; }
    const days = next.history.length;
    const ok = await ask({
      title: "Remplacer les données ?",
      text: `Les postes, compteurs, cadences et l'historique de cet iPhone seront remplacés par la sauvegarde (${days} ${plural(days, "journée", "journées")}).`,
      confirmLabel: "Remplacer les données",
      danger: true,
    });
    if (!ok) return;
    state = next;
    persist();
    renderCats();
    renderCalcProducts();
    render();
    renderHistory();
    toast("Sauvegarde importée");
  });

  // ---------- chrono en direct ----------
  setInterval(() => { if (state.active) render(); }, 250);

  // ---------- init ----------
  persist();
  renderCats();
  renderCalcProducts();
  render();
  renderHistory();
  showView("view-timer");

  // ---------- bannière d'installation ----------
  const INSTALL_DISMISS_KEY = "rendement.installDismissed.v1";
  const installBanner = $("install-banner");
  const installIos = $("install-ios");
  const installAndroid = $("install-android");
  const installButton = $("install-button");
  const installDismiss = $("install-dismiss");
  let deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function maybeShowInstallBanner() {
    if (isStandalone()) return;
    if (localStorage.getItem(INSTALL_DISMISS_KEY)) return;
    if (isIos()) {
      installIos.hidden = false;
      installBanner.hidden = false;
    } else if (deferredInstallPrompt) {
      installAndroid.hidden = false;
      installBanner.hidden = false;
    }
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    maybeShowInstallBanner();
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBanner.hidden = true;
  });

  installDismiss.addEventListener("click", () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    installBanner.hidden = true;
  });

  window.addEventListener("appinstalled", () => { installBanner.hidden = true; });

  maybeShowInstallBanner();

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();
