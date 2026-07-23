(() => {
  "use strict";

  const KEY = "rendement.timer.v2";

  const CATEGORIES = {
    cms: { label: "TEMPS CMS", color: "var(--cms)" },
    cf: { label: "TEMPS CF", color: "var(--cf)" },
    rep: { label: "TEMPS RÉPARATION", color: "var(--rep)" },
  };

  // Nettoyage des données de l'ancienne version de l'app
  ["rendement.settings.v1", "rendement.entries.v1", "rendement.draft.v1", "rendement.activeTimer.v1"]
    .forEach((k) => localStorage.removeItem(k));

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.totals) return s;
      }
    } catch (e) { /* état corrompu -> repart de zéro */ }
    return { totals: { cms: 0, cf: 0, rep: 0 }, active: null };
  }

  let state = load();

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  // ---------- formatting ----------
  function pad2(n) { return String(n).padStart(2, "0"); }

  function formatHMS(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }

  function formatTotal(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    date: $("today-date"),
    status: $("hero-status"),
    statusText: $("hero-status-text"),
    timer: $("hero-timer"),
    hint: $("hero-hint"),
    grandTotal: $("grand-total"),
    reset: $("btn-reset"),
  };
  const catButtons = Array.from(document.querySelectorAll(".cat"));
  const totalEls = { cms: $("total-cms"), cf: $("total-cf"), rep: $("total-rep") };

  el.date.textContent = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });

  // ---------- timer logic ----------
  function activeElapsed() {
    return state.active ? Date.now() - state.active.startedAt : 0;
  }

  function stopActive() {
    if (!state.active) return;
    state.totals[state.active.id] += activeElapsed();
    state.active = null;
    persist();
  }

  function startCategory(id) {
    state.active = { id, startedAt: Date.now() };
    persist();
  }

  catButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.cat;
      if (state.active && state.active.id === id) {
        stopActive();
      } else {
        stopActive(); // bascule directe d'une catégorie à l'autre
        startCategory(id);
      }
      render();
    });
  });

  el.reset.addEventListener("click", () => {
    if (!confirm("Remettre tous les compteurs à zéro ?")) return;
    state = { totals: { cms: 0, cf: 0, rep: 0 }, active: null };
    persist();
    render();
  });

  // ---------- rendering ----------
  function render() {
    const activeId = state.active ? state.active.id : null;
    const activeColor = activeId ? CATEGORIES[activeId].color : null;

    catButtons.forEach((btn) => {
      const id = btn.dataset.cat;
      const isActive = id === activeId;
      btn.classList.toggle("active", isActive);
      btn.querySelector(".cat-action").textContent = isActive ? "■" : "▶";
      const total = state.totals[id] + (isActive ? activeElapsed() : 0);
      totalEls[id].textContent = formatTotal(total);
    });

    if (activeId) {
      el.status.classList.remove("idle");
      el.status.classList.add("running");
      el.status.style.setProperty("--active-color", activeColor);
      el.statusText.textContent = CATEGORIES[activeId].label;
      el.timer.classList.add("running");
      el.timer.style.setProperty("--active-color", activeColor);
      el.timer.textContent = formatHMS(activeElapsed());
      el.hint.textContent = "Appuie à nouveau pour arrêter";
    } else {
      el.status.classList.add("idle");
      el.status.classList.remove("running");
      el.statusText.textContent = "En attente";
      el.timer.classList.remove("running");
      el.timer.textContent = "00:00:00";
      el.hint.textContent = "Appuie sur une catégorie pour démarrer";
    }

    const grand = state.totals.cms + state.totals.cf + state.totals.rep + activeElapsed();
    el.grandTotal.textContent = formatTotal(grand);
  }

  setInterval(() => { if (state.active) render(); }, 500);
  render();

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();
