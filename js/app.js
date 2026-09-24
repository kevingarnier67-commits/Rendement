(() => {
  "use strict";

  const KEY = "rendement.app.v3";
  const OLD_KEY = "rendement.timer.v2";

  // Tons de voyant (andon) : la couleur réelle dépend du thème, voir css/style.css.
  const TONES = ["blue", "violet", "orange", "teal", "pink", "amber", "green", "cyan"];
  const LEGACY_COLOR_TONES = {
    "#4da3ff": "blue", "#b07cff": "violet", "#ff9d42": "orange", "#2fd4b5": "teal",
    "#ff6b9d": "pink", "#ffd84d": "amber", "#6ee7a0": "green", "#ff8360": "cyan",
  };

  const DEFAULT_CATEGORIES = [
    { id: "cms", label: "TEMPS CMS", tone: "blue", builtin: true },
    { id: "cf", label: "TEMPS CF", tone: "violet", builtin: true },
    { id: "rep", label: "TEMPS RÉPARATION", tone: "orange", builtin: true },
  ];

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function toneOf(item) {
    if (item && TONES.includes(item.tone)) return item.tone;
    return (item && LEGACY_COLOR_TONES[String(item.color || "").toLowerCase()]) || null;
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

  // Les cadences sont mémorisées d'un jour à l'autre ; seules les quantités (qty) sont remises à zéro.
  function freshCalc() {
    return {
      base: DEFAULT_BASE,
      products: DEFAULT_PRODUCTS.map((p) => ({ ...p, builtin: true })),
      qty: {},
      ratesVersion: RATES_VERSION,
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

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.categories)) {
          s.calc = normalizeCalc(s.calc);
          normalizeCategories(s.categories);
          return s;
        }
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

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    date: $("today-date"),
    clock: document.querySelector(".clock"),
    statusText: $("clock-status-text"),
    time: $("clock-time"),
    hint: $("clock-hint"),
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
    calcGauge: $("calc-gauge"),
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
    dlgAsk: $("dlg-ask"),
    formAsk: $("form-ask"),
    askTitle: $("dlg-ask-title"),
    askText: $("dlg-ask-text"),
    askField: $("dlg-ask-field"),
    askLabel: $("dlg-ask-label"),
    askInput: $("dlg-ask-input"),
    askError: $("dlg-ask-error"),
    askCancel: $("dlg-ask-cancel"),
    askOk: $("dlg-ask-ok"),
    toast: $("toast"),
  };

  el.date.textContent = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });

  let toastTimeout = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { el.toast.hidden = true; }, 3000);
  }

  // ---------- fenêtres (confirmation / saisie) ----------
  const hasDialog = typeof HTMLDialogElement === "function" && typeof el.dlgAsk.showModal === "function";

  function showFieldError(input, errorEl, message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
    input.classList.toggle("is-invalid", !!message);
    if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }

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
    return new Promise((resolve) => {
      el.askTitle.textContent = title;
      el.askText.textContent = text;
      el.askOk.textContent = confirmLabel;
      el.askOk.classList.toggle("is-danger", danger);
      el.askField.hidden = !input;
      showFieldError(el.askInput, el.askError, "");
      if (input) {
        el.askLabel.textContent = input.label;
        el.askInput.placeholder = input.placeholder || "";
        el.askInput.value = "";
      }

      const finish = (value) => {
        el.formAsk.removeEventListener("submit", onSubmit);
        el.askCancel.removeEventListener("click", onCancel);
        el.dlgAsk.removeEventListener("cancel", onCancel);
        el.askInput.removeEventListener("input", onType);
        if (el.dlgAsk.open) el.dlgAsk.close();
        resolve(value);
      };
      const onSubmit = (e) => {
        e.preventDefault();
        if (!input) { finish(true); return; }
        const v = el.askInput.value.trim();
        const err = v ? (input.validate && input.validate(v)) : input.emptyMessage;
        if (err) { showFieldError(el.askInput, el.askError, err); el.askInput.focus(); return; }
        finish(v);
      };
      const onCancel = (e) => { if (e) e.preventDefault(); finish(null); };
      const onType = () => showFieldError(el.askInput, el.askError, "");

      el.formAsk.addEventListener("submit", onSubmit);
      el.askCancel.addEventListener("click", onCancel);
      el.dlgAsk.addEventListener("cancel", onCancel);
      el.askInput.addEventListener("input", onType);
      el.dlgAsk.showModal();
      (input ? el.askInput : el.askCancel).focus();
    });
  }

  // ---------- timer logic ----------
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

  // Somme des minutes affichées par catégorie, pour que le total colle toujours au détail.
  function minutedMinutes() {
    return state.categories.reduce((acc, c) => acc + minutesOf(liveTotalOf(c.id)), 0);
  }

  // ---------- catégories (voyants andon) ----------
  function renderCats() {
    el.catList.innerHTML = "";
    state.categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat";
      btn.dataset.cat = cat.id;
      setTone(btn, cat.tone);
      btn.innerHTML = `
        <span class="cat-swatch" aria-hidden="true"></span>
        <span class="cat-text">
          <span class="cat-name"></span>
          <span class="cat-sub" hidden>En cours</span>
        </span>
        <span class="cat-min">0 min</span>
        <span class="cat-btn" aria-hidden="true">${icon("play")}</span>`;
      btn.querySelector(".cat-name").textContent = cat.label;
      btn.addEventListener("click", () => {
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

  // ---------- main render ----------
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
        btn.querySelector(".cat-btn use").setAttribute("href", isActive ? "#i-stop" : "#i-play");
      }
      btn.querySelector(".cat-min").textContent = formatMinutes(liveTotalOf(id));
    });

    el.clock.classList.toggle("is-running", !!activeCat);
    setTone(el.clock, activeCat ? activeCat.tone : null);
    if (activeCat) {
      el.statusText.textContent = activeCat.label;
      el.time.textContent = formatMinSec(activeElapsed());
      el.hint.textContent = "Touche à nouveau le poste pour arrêter";
    } else {
      el.statusText.textContent = "En attente";
      el.time.textContent = "00:00";
      el.hint.textContent = "Touche une catégorie pour lancer le chrono";
    }

    el.grandTotal.textContent = `${minutedMinutes()} min`;
    renderCalcResults();
  }

  // ---------- calculatrice de rendement ----------
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
    return { base, minuted, net, produced, rendement, items };
  }

  function renderCalcResults() {
    const c = computeCalc();
    el.calcMinuted.textContent = `${c.minuted} min`;
    el.calcNet.textContent = `${formatNumber(c.net, 1)} min`;
    el.calcNet2.textContent = `${formatNumber(c.net, 1)} min`;
    el.calcProduced.textContent = `${formatNumber(c.produced, 1)} min`;
    el.calcRendement.textContent = c.rendement == null ? "--" : `${formatNumber(c.rendement, 1)} %`;
    el.calcGauge.style.width = `${Math.min(c.rendement || 0, 100)}%`;
    state.calc.products.forEach((p) => {
      const row = el.calcProducts.querySelector(`[data-prod="${p.id}"]`);
      if (!row) return;
      const qty = parseNum(state.calc.qty[p.id]);
      const minutes = minutesFor(qty, p);
      const out = row.querySelector(".prod-total");
      const missingRate = qty > 0 && minutes == null;
      out.textContent = missingRate ? "Cadence manquante" : `= ${formatNumber(minutes || 0, 1)} min`;
      out.classList.toggle("is-warn", missingRate);
      row.classList.toggle("is-filled", qty > 0);
      const hasRate = parseNum(p.refQty) > 0 && parseNum(p.refMin) > 0;
      const toggle = row.querySelector(".prod-rate-toggle");
      toggle.classList.toggle("is-missing", !hasRate);
      const refQty = parseNum(p.refQty);
      row.querySelector(".prod-rate-text").textContent = hasRate
        ? `${formatNumber(refQty, 2)} ${refQty < 2 ? "pièce" : "pièces"} en ${formatNumber(parseNum(p.refMin), 2)} min`
        : "Définir la cadence";
    });
  }

  function renderCalcProducts() {
    el.calcBase.value = state.calc.base;
    el.calcProducts.innerHTML = "";
    state.calc.products.forEach((p, idx) => {
      const row = document.createElement("div");
      row.className = "prod";
      row.dataset.prod = p.id;
      const uid = `p${idx}`;
      // La cadence change rarement : affichée en texte, éditable à la demande. La quantité reste le champ principal.
      row.innerHTML = `
        <div class="prod-main">
          <div class="prod-head">
            <h3 class="prod-name"></h3>
            <button type="button" class="btn-icon danger prod-delete">${icon("trash")}</button>
          </div>
          <button type="button" class="prod-rate-toggle" aria-expanded="false" aria-controls="${uid}-editor">
            <span class="visually-hidden">Cadence :</span>
            <span class="prod-rate-text"></span>
            ${icon("pencil-simple")}
          </button>
        </div>
        <div class="prod-qty">
          <label class="field-label" for="${uid}-qty">Quantité</label>
          <input type="text" inputmode="numeric" id="${uid}-qty" class="field prod-qty-input" placeholder="0" autocomplete="off" />
          <p class="prod-total" aria-live="polite">= 0 min</p>
        </div>
        <div class="prod-rate-editor" id="${uid}-editor" hidden>
          <span class="field-label" id="${uid}-rate"></span>
          <div class="prod-rate-inputs" role="group" aria-labelledby="${uid}-rate">
            <input type="text" inputmode="numeric" class="field prod-rate-qty" placeholder="0" autocomplete="off" />
            <span class="unit">pièces en</span>
            <input type="text" inputmode="decimal" class="field prod-rate-min" placeholder="0" autocomplete="off" />
            <span class="unit">min</span>
            <button type="button" class="btn btn-secondary btn-inline prod-rate-done">Terminé</button>
          </div>
        </div>`;
      row.querySelector(".prod-name").textContent = p.label;
      row.querySelector(`#${uid}-rate`).textContent = `Cadence ${p.label}`;
      const rateQty = row.querySelector(".prod-rate-qty");
      const rateMin = row.querySelector(".prod-rate-min");
      const qty = row.querySelector(".prod-qty-input");
      const toggle = row.querySelector(".prod-rate-toggle");
      const editor = row.querySelector(".prod-rate-editor");
      rateQty.setAttribute("aria-label", `Pièces de référence, ${p.label}`);
      rateMin.setAttribute("aria-label", `Minutes de référence, ${p.label}`);
      rateQty.value = p.refQty;
      rateMin.value = p.refMin;
      qty.value = state.calc.qty[p.id] || "";
      const setEditor = (open) => {
        editor.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        (open ? rateQty : toggle).focus();
      };
      toggle.addEventListener("click", () => setEditor(editor.hidden));
      row.querySelector(".prod-rate-done").addEventListener("click", () => setEditor(false));
      bindNumeric(rateQty, digitsOnly, (v) => { p.refQty = v; persist(); renderCalcResults(); });
      bindNumeric(rateMin, decimalOnly, (v) => { p.refMin = v; persist(); renderCalcResults(); });
      bindNumeric(qty, digitsOnly, (v) => { state.calc.qty[p.id] = v; persist(); renderCalcResults(); });
      const del = row.querySelector(".prod-delete");
      if (p.builtin) {
        del.remove();
      } else {
        del.setAttribute("aria-label", `Supprimer ${p.label}`);
        del.addEventListener("click", async () => {
          const ok = await ask({ title: `Supprimer ${p.label} ?`, text: "Sa cadence et sa quantité du jour seront effacées.", confirmLabel: "Supprimer", danger: true });
          if (!ok) return;
          state.calc.products = state.calc.products.filter((x) => x.id !== p.id);
          delete state.calc.qty[p.id];
          persist();
          renderCalcProducts();
          renderCalcResults();
        });
      }
      el.calcProducts.appendChild(row);
    });
  }

  // ---------- enregistrer / remettre à zéro ----------
  function resetTotals() {
    state.totals = {};
    state.active = null;
    persist();
  }

  el.saveDay.addEventListener("click", async () => {
    const hasMinutes = minutedMinutes() > 0;
    if (!hasMinutes && computeCalc().produced === 0) { toast("Rien à enregistrer pour l'instant"); return; }
    const ok = await ask({
      title: "Enregistrer la journée ?",
      text: "Les minutes minutées et la production sont archivées dans l'historique, puis les compteurs repartent à zéro.",
      confirmLabel: "Enregistrer",
    });
    if (!ok) return;
    stopActive();
    const items = state.categories
      .map((c) => ({ label: c.label, tone: c.tone, ms: totalOf(c.id) }))
      .filter((i) => minutesOf(i.ms) > 0);
    const totalMs = items.reduce((acc, i) => acc + minutesOf(i.ms) * 60000, 0);
    const calc = computeCalc();
    const now = new Date();
    state.history.unshift({
      id: uuid(),
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
    toast("Journée enregistrée");
  });

  el.finish.addEventListener("click", () => showView("view-calc"));
  el.emptyGo.addEventListener("click", () => showView("view-calc"));

  bindNumeric(el.calcBase, decimalOnly, (v) => {
    state.calc.base = v;
    persist();
    renderCalcResults();
  });

  el.calcAddProduct.addEventListener("click", async () => {
    const label = await ask({
      title: "Nouvelle matière",
      confirmLabel: "Ajouter",
      input: {
        label: "Nom de la matière",
        placeholder: "Ex. : Bobines",
        emptyMessage: "Écris le nom de la matière.",
        validate: (v) => state.calc.products.some((p) => p.label.toLowerCase() === v.toLowerCase())
          ? "Cette matière existe déjà." : null,
      },
    });
    if (!label) return;
    state.calc.products.push({ id: uuid(), label, refQty: "", refMin: "", builtin: false });
    persist();
    renderCalcProducts();
    renderCalcResults();
    toast(`${label} ajoutée`);
  });

  el.calcClear.addEventListener("click", async () => {
    const ok = await ask({ title: "Effacer les quantités ?", text: "Les cadences sont conservées.", confirmLabel: "Effacer", danger: true });
    if (!ok) return;
    state.calc.qty = {};
    persist();
    renderCalcProducts();
    renderCalcResults();
  });

  el.reset.addEventListener("click", async () => {
    const ok = await ask({
      title: "Remettre à zéro ?",
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
  function dayRow(label, value, { tone = null, total = false } = {}) {
    const row = document.createElement("div");
    row.className = "day-row" + (total ? " is-total" : "");
    const left = document.createElement("span");
    left.className = "day-row-label";
    if (tone !== null) {
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.setAttribute("aria-hidden", "true");
      if (tone) setTone(row, tone);
      left.appendChild(sw);
    }
    left.appendChild(document.createTextNode(label));
    const right = document.createElement("span");
    right.className = "day-row-value";
    right.textContent = value;
    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  function dayGroup(title, rows) {
    const g = document.createElement("div");
    g.className = "day-group";
    const h = document.createElement("h4");
    h.className = "day-group-title";
    h.textContent = title;
    g.appendChild(h);
    rows.forEach((r) => g.appendChild(r));
    return g;
  }

  function renderHistory() {
    el.historyList.innerHTML = "";
    el.historyEmpty.hidden = state.history.length > 0;
    state.history.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "panel day";

      const head = document.createElement("header");
      head.className = "day-head";
      const date = document.createElement("h3");
      date.className = "day-date";
      date.textContent = entry.dateLabel;
      const score = document.createElement("p");
      score.className = "day-score";
      const scoreLabel = document.createElement("span");
      scoreLabel.className = "day-score-label";
      if (entry.calc && entry.calc.rendement != null) {
        scoreLabel.textContent = "Rendement";
        score.append(scoreLabel, `${formatNumber(entry.calc.rendement, 1)} %`);
      } else {
        scoreLabel.textContent = "Minuté";
        score.append(scoreLabel, formatMinutes(entry.totalMs));
      }
      head.append(date, score);
      card.appendChild(head);

      const minutedRows = entry.items.map((i) => dayRow(i.label, formatMinutes(i.ms), { tone: toneOf(i) || "" }));
      minutedRows.push(dayRow("Total", formatMinutes(entry.totalMs), { total: true }));
      card.appendChild(dayGroup("Minutes minutées", minutedRows));

      if (entry.calc) {
        const c = entry.calc;
        const prodRows = (c.items || []).map((i) => {
          const detail = i.refQty
            ? `${formatNumber(i.qty, 2)} (${formatNumber(i.refQty, 2)} en ${formatNumber(i.refMin, 2)} min)`
            : `${formatNumber(i.qty, 2)} × ${formatNumber(i.unit || 0, 3)}`;
          return dayRow(`${i.label} · ${detail}`, `${formatNumber(i.minutes, 1)} min`);
        });
        prodRows.push(dayRow("Minutes produites", `${formatNumber(c.produced, 1)} min`, { total: true }));
        prodRows.push(dayRow("Temps de production", `${formatNumber(c.base, 1)} − ${c.minuted} = ${formatNumber(c.net, 1)} min`));
        card.appendChild(dayGroup("Production", prodRows));
      }

      const actions = document.createElement("div");
      actions.className = "day-actions";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-danger-quiet btn-inline";
      del.innerHTML = `${icon("trash")}<span>Supprimer</span>`;
      del.setAttribute("aria-label", `Supprimer la journée du ${entry.dateLabel}`);
      del.addEventListener("click", async () => {
        const ok = await ask({ title: "Supprimer cette journée ?", text: entry.dateLabel, confirmLabel: "Supprimer", danger: true });
        if (!ok) return;
        state.history = state.history.filter((e) => e.id !== entry.id);
        persist();
        renderHistory();
      });
      actions.appendChild(del);
      card.appendChild(actions);

      el.historyList.appendChild(card);
    });
  }

  // ---------- onglets ----------
  function showView(viewId) {
    document.querySelectorAll(".tab").forEach((b) => {
      if (b.dataset.view === viewId) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === viewId));
    window.scrollTo(0, 0);
  }

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  // ---------- gestion des catégories ----------
  function nextTone() {
    const used = state.categories.map((c) => c.tone);
    return TONES.find((t) => !used.includes(t)) || TONES[state.categories.length % TONES.length];
  }

  function renderCustomCats() {
    const customs = state.categories.filter((c) => !c.builtin);
    el.customCatSection.hidden = customs.length === 0;
    el.customCatList.innerHTML = "";
    customs.forEach((cat) => {
      const li = document.createElement("li");
      setTone(li, cat.tone);
      const left = document.createElement("span");
      left.className = "item-label";
      left.innerHTML = `<span class="swatch" aria-hidden="true"></span>`;
      left.appendChild(document.createTextNode(cat.label));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-icon danger";
      del.innerHTML = icon("trash");
      del.setAttribute("aria-label", `Supprimer ${cat.label}`);
      del.addEventListener("click", async () => {
        const hasTime = totalOf(cat.id) > 0 || (state.active && state.active.id === cat.id);
        el.dlgCats.close();
        const ok = await ask({
          title: `Supprimer ${cat.label} ?`,
          text: hasTime ? "Le temps compté aujourd'hui sur ce poste sera perdu." : "",
          confirmLabel: "Supprimer",
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
        openCatsDialog();
      });
      li.appendChild(left);
      li.appendChild(del);
      el.customCatList.appendChild(li);
    });
  }

  function openCatsDialog() {
    el.newCatInput.value = "";
    showFieldError(el.newCatInput, el.newCatError, "");
    renderCustomCats();
    if (hasDialog) el.dlgCats.showModal(); else el.dlgCats.setAttribute("open", "");
  }

  function closeCatsDialog() {
    if (hasDialog) el.dlgCats.close(); else el.dlgCats.removeAttribute("open");
  }

  el.manageCats.addEventListener("click", openCatsDialog);
  el.dlgCatsClose.addEventListener("click", closeCatsDialog);
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

  // ---------- chrono en direct ----------
  setInterval(() => { if (state.active) render(); }, 500);

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
