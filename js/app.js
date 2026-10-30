"use strict";

const STORAGE_KEY = "saldo-personal-finance-v1";
const PALETTE = ["#7565f0", "#37ae91", "#f1a94e", "#e46d78", "#51a7d8", "#aa78d5", "#8fbd59", "#ee83b0", "#75849b", "#c28b62"];
const DEFAULT_CATEGORIES = [
  { name: "Alimentari", icon: "🥑", color: PALETTE[0] },
  { name: "Trasporti", icon: "🚇", color: PALETTE[1] },
  { name: "Casa", icon: "🏠", color: PALETTE[2] },
  { name: "Ristoranti", icon: "🍜", color: PALETTE[3] },
  { name: "Shopping", icon: "🛍️", color: PALETTE[4] },
  { name: "Salute", icon: "💊", color: PALETTE[5] },
  { name: "Svago", icon: "🎟️", color: PALETTE[6] },
  { name: "Altro", icon: "✦", color: PALETTE[8] },
];
const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
const dateFormatter = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" });
const shortDateFormatter = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const todayKey = dateKey(new Date());

let state = loadState();
let currentPeriod = "month";
let editingId = null;
let recognition = null;
let toastTimer;

const dialog = $("#expense-dialog");
const form = $("#expense-form");
const titleInput = $("#expense-title");
const amountInput = $("#expense-amount");
const categoryInput = $("#expense-category");
const dateInput = $("#expense-date");
const noteInput = $("#expense-note");

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && Array.isArray(stored.expenses) && Array.isArray(stored.categories)) {
      return {
        expenses: stored.expenses.filter(isValidExpense),
        categories: stored.categories.filter((category) => category && typeof category.name === "string"),
        budget: Number.isFinite(stored.budget) && stored.budget >= 0 ? stored.budget : 1200,
      };
    }
  } catch (error) {
    console.warn("Non è stato possibile leggere i dati locali.", error);
  }
  return { expenses: [], categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })), budget: 1200 };
}

function isValidExpense(item) {
  return item && typeof item.id === "string" && typeof item.title === "string" && Number.isFinite(Number(item.amount)) && typeof item.date === "string";
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast("Spazio locale non disponibile: i dati potrebbero non essere salvati.");
    console.error("Salvataggio locale non riuscito.", error);
  }
}

function categoryFor(name) {
  return state.categories.find((category) => category.name === name) || state.categories[state.categories.length - 1] || DEFAULT_CATEGORIES.at(-1);
}

function getMonthExpenses(date = new Date()) {
  return state.expenses.filter((item) => {
    const expenseDate = new Date(`${item.date}T12:00:00`);
    return expenseDate.getMonth() === date.getMonth() && expenseDate.getFullYear() === date.getFullYear();
  });
}

function render() {
  renderCategories();
  renderSummary();
  renderChart();
  renderTransactions();
}

function renderCategories() {
  const selected = categoryInput.value;
  categoryInput.innerHTML = "";
  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = `${category.icon || "✦"}  ${category.name}`;
    categoryInput.append(option);
  });
  if (state.categories.some((category) => category.name === selected)) categoryInput.value = selected;

  const filter = $("#category-filter");
  const filterValue = filter.value || "all";
  filter.innerHTML = '<option value="all">Tutte le categorie</option>';
  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    filter.append(option);
  });
  filter.value = state.categories.some((category) => category.name === filterValue) ? filterValue : "all";
}

function renderSummary() {
  const now = new Date();
  const monthExpenses = getMonthExpenses(now);
  const total = monthExpenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const dayCount = Math.max(now.getDate(), 1);
  const remaining = Math.max(state.budget - total, 0);
  const monthName = new Intl.DateTimeFormat("it-IT", { month: "long" }).format(now);
  $("#month-name").textContent = monthName.toLocaleUpperCase("it-IT");
  $("#today-label").textContent = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" }).format(now).toLocaleUpperCase("it-IT");
  $("#month-total").textContent = money(total);
  $("#daily-average").textContent = money(total / dayCount);
  $("#expense-count").textContent = monthExpenses.length;
  $("#budget-label").textContent = money(state.budget);
  $("#budget-progress").style.width = `${state.budget > 0 ? Math.min((total / state.budget) * 100, 100) : (total > 0 ? 100 : 0)}%`;
  $("#budget-progress").classList.toggle("is-over", total > state.budget);
  $("#budget-footnote").innerHTML = total > state.budget
    ? `Hai superato il budget di <strong>${money(total - state.budget)}</strong>`
    : `Hai ancora <strong>${money(remaining)}</strong> a disposizione`;

  const byCategory = new Map();
  monthExpenses.forEach((item) => byCategory.set(item.category, (byCategory.get(item.category) || 0) + Number(item.amount)));
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
  $("#top-category-note").textContent = top ? `Più spesa in ${top[0]}` : "Aggiungi la tua prima spesa";
  renderDonut(byCategory, total);
}

function renderDonut(byCategory, total) {
  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const legend = $("#category-legend");
  $("#category-total").textContent = money(total).replace(/,\d{2}/, "");
  if (!sorted.length) {
    $("#category-donut").style.background = "conic-gradient(#eeeff4 0 100%)";
    legend.innerHTML = '<p class="empty-legend">Le categorie appariranno qui.</p>';
    return;
  }
  let offset = 0;
  const segments = sorted.map(([name, value]) => {
    const start = offset;
    offset += (value / total) * 100;
    return `${categoryFor(name).color || PALETTE[0]} ${start}% ${offset}%`;
  });
  $("#category-donut").style.background = `conic-gradient(${segments.join(", ")})`;
  legend.innerHTML = sorted.slice(0, 5).map(([name, value]) => {
    const category = categoryFor(name);
    return `<div class="legend-row"><span class="legend-dot" style="background:${escapeHtml(category.color || PALETTE[0])}"></span><span class="legend-name">${escapeHtml(category.name)}</span><strong class="legend-amount">${Math.round((value / total) * 100)}%</strong></div>`;
  }).join("");
}

function getChartBuckets() {
  const now = new Date();
  if (currentPeriod === "week") {
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    const day = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - day);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return { key: dateKey(date), label: new Intl.DateTimeFormat("it-IT", { weekday: "short" }).format(date).replace(".", ""), amount: 0 };
    });
  }
  if (currentPeriod === "year") {
    return Array.from({ length: 12 }, (_, index) => ({ key: `${now.getFullYear()}-${String(index + 1).padStart(2, "0")}`, label: new Intl.DateTimeFormat("it-IT", { month: "short" }).format(new Date(now.getFullYear(), index, 1)).replace(".", ""), amount: 0 }));
  }
  const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), index + 1);
    return { key: dateKey(date), label: String(index + 1), amount: 0 };
  });
}

function renderChart() {
  const buckets = getChartBuckets();
  const lookup = new Map(buckets.map((bucket, index) => [bucket.key, index]));
  state.expenses.forEach((item) => {
    const date = new Date(`${item.date}T12:00:00`);
    const key = currentPeriod === "year" ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : item.date;
    const index = lookup.get(key);
    if (index !== undefined) buckets[index].amount += Number(item.amount);
  });
  const values = buckets.map((bucket) => bucket.amount);
  const max = Math.max(...values, 0);
  const ceiling = max === 0 ? 100 : Math.ceil(max / 50) * 50;
  const points = buckets.map((bucket, index) => {
    const x = buckets.length === 1 ? 360 : 5 + (index / (buckets.length - 1)) * 710;
    const y = 200 - (bucket.amount / ceiling) * 175;
    return { x, y, ...bucket };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  $("#chart-line").setAttribute("points", line);
  $("#chart-area-path").setAttribute("d", points.length ? `M ${points[0].x},200 L ${line.replaceAll(" ", " L ")} L ${points.at(-1).x},200 Z` : "");
  const pointIndices = new Set(points.length <= 8 ? points.map((_, index) => index) : [0, Math.round((points.length - 1) / 3), Math.round(((points.length - 1) * 2) / 3), points.length - 1]);
  $("#chart-points").innerHTML = [...pointIndices].map((index) => `<circle class="chart-point" cx="${points[index].x}" cy="${points[index].y}" r="4"/>`).join("");
  const labelIndices = points.length <= 7 ? points.map((_, index) => index) : currentPeriod === "month" ? [0, 7, 14, 21, points.length - 1].filter((index, i, arr) => arr.indexOf(index) === i && index < points.length) : [0, 3, 6, 9];
  $("#chart-labels").innerHTML = labelIndices.map((index) => `<span>${escapeHtml(points[index].label)}</span>`).join("");
  $("#y-max").textContent = compactMoney(ceiling);
  $("#y-mid").textContent = compactMoney(ceiling / 2);
  $("#period-total").textContent = money(values.reduce((sum, value) => sum + value, 0));
  const periodName = currentPeriod === "week" ? "della settimana" : currentPeriod === "year" ? "dell'anno" : "del mese";
  $("#spending-chart").setAttribute("aria-label", `Grafico delle spese ${periodName}`);
}

function compactMoney(value) {
  if (value >= 1000) return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(value / 1000)}k €`;
  return `${Math.round(value)} €`;
}

function renderTransactions() {
  const query = $("#expense-search").value.trim().toLocaleLowerCase("it-IT");
  const category = $("#category-filter").value;
  const filtered = state.expenses.filter((item) => {
    const matchesText = !query || `${item.title} ${item.category} ${item.note || ""}`.toLocaleLowerCase("it-IT").includes(query);
    return matchesText && (category === "all" || item.category === category);
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const list = $("#expense-list");
  if (!filtered.length) {
    const noExpenses = state.expenses.length === 0;
    list.innerHTML = `<div class="empty-state"><strong>${noExpenses ? "Qui troverai le tue spese" : "Nessuna spesa trovata"}</strong>${noExpenses ? "Aggiungi la prima spesa: ci vorrà solo un attimo." : "Prova a cambiare ricerca o categoria."}</div>`;
    $("#list-footer").textContent = "";
    return;
  }
  list.innerHTML = filtered.map((item) => {
    const category = categoryFor(item.category);
    const date = new Date(`${item.date}T12:00:00`);
    return `<article class="transaction-row" data-id="${escapeHtml(item.id)}"><div class="transaction-main"><span class="transaction-emoji" style="background:${tint(category.color || PALETTE[0])}">${escapeHtml(category.icon || "✦")}</span><span class="transaction-name">${escapeHtml(item.title)}${item.note ? `<small class="transaction-note">${escapeHtml(item.note)}</small>` : ""}</span></div><span class="transaction-category">${escapeHtml(item.category)}</span><time class="transaction-date" datetime="${escapeHtml(item.date)}">${dateFormatter.format(date)}</time><strong class="transaction-amount">− ${money(Number(item.amount))}</strong><span class="row-actions"><button class="row-action" data-action="edit" aria-label="Modifica ${escapeHtml(item.title)}">Modifica</button><button class="row-action" data-action="delete" aria-label="Elimina ${escapeHtml(item.title)}">Elimina</button></span></article>`;
  }).join("");
  $("#list-footer").textContent = filtered.length === 1 ? "1 spesa" : `${filtered.length} spese`;
}

function tint(hex) {
  const color = hex.replace("#", "");
  const num = parseInt(color, 16);
  return `#${[num >> 16, (num >> 8) & 255, num & 255].map((value) => Math.round(value + (255 - value) * 0.88).toString(16).padStart(2, "0")).join("")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function openDialog(expense = null) {
  editingId = expense?.id || null;
  form.reset();
  $("#dialog-title").textContent = expense ? "Modifica la spesa" : "Aggiungi una spesa";
  $("#save-expense").innerHTML = expense ? "Salva modifiche <span>→</span>" : "Salva spesa <span>→</span>";
  $("#form-error").textContent = "";
  $("#voice-status").textContent = "Ad esempio: “12 euro per il pranzo”";
  dateInput.value = expense?.date || todayKey;
  renderCategories();
  if (expense) {
    titleInput.value = expense.title;
    amountInput.value = expense.amount;
    categoryInput.value = expense.category;
    noteInput.value = expense.note || "";
  }
  dialog.showModal();
  setTimeout(() => (expense ? titleInput : amountInput).focus(), 40);
}

function addCategory() {
  const answer = window.prompt("Nome della nuova categoria:");
  const name = answer?.trim();
  if (!name) return;
  if (state.categories.some((item) => item.name.toLocaleLowerCase("it-IT") === name.toLocaleLowerCase("it-IT"))) {
    showToast("Esiste già una categoria con questo nome.");
    return;
  }
  const icons = ["✨", "🧾", "🎁", "🐾", "📱", "🌿"];
  state.categories.push({ name, icon: icons[state.categories.length % icons.length], color: PALETTE[state.categories.length % PALETTE.length] });
  persist();
  render();
  categoryInput.value = name;
  showToast(`Categoria “${name}” aggiunta.`);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

async function parseVoiceExpense(transcript) {
  const response = await fetch("/api/parse-expense", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      categories: state.categories.map((category) => category.name),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Interpretazione della frase non riuscita.");
  return result;
}

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $("#voice-status").textContent = "Il riconoscimento vocale non è supportato da questo browser. Puoi compilare i campi.";
    showToast("La dettatura non è disponibile in questo browser.");
    return;
  }
  if (recognition) recognition.abort();
  recognition = new SpeechRecognition();
  recognition.lang = "it-IT";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  const button = $("#voice-button");
  button.classList.add("is-listening");
  button.innerHTML = "● <span>Ti ascolto…</span>";
  $("#voice-status").textContent = "Parla ora: “12 euro per il pranzo”. La dettatura dipende dal browser.";
  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    const button = $("#voice-button");
    button.disabled = true;
    $("#voice-status").textContent = `Ho capito: “${transcript}”. Interpreto la spesa…`;
    try {
      const parsed = await parseVoiceExpense(transcript);
      titleInput.value = parsed.description;
      amountInput.value = parsed.amount;
      categoryInput.value = parsed.category;
      $("#form-error").textContent = "";
      $("#voice-status").textContent = `Compilato: “${transcript}”. Controlla i campi prima di salvare.`;
    } catch (error) {
      $("#form-error").textContent = error.message;
      $("#voice-status").textContent = `Ho capito: “${transcript}”, ma non sono riuscito a interpretarlo.`;
    } finally {
      button.disabled = false;
    }
  };
  recognition.onerror = (event) => {
    $("#voice-status").textContent = event.error === "not-allowed" ? "Consenti l'accesso al microfono nelle impostazioni del browser." : "Non ho capito: riprova oppure inserisci i dati manualmente.";
  };
  recognition.onend = () => {
    button.classList.remove("is-listening");
    button.innerHTML = "🎙 <span>Parla</span>";
  };
  try { recognition.start(); } catch { button.classList.remove("is-listening"); }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  const amount = Number(amountInput.value);
  const date = dateInput.value;
  if (!title || !Number.isFinite(amount) || amount <= 0 || !date) {
    $("#form-error").textContent = "Inserisci una descrizione, un importo valido e una data.";
    return;
  }
  const existing = state.expenses.find((item) => item.id === editingId);
  const expense = { id: editingId || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`), title, amount: Math.round(amount * 100) / 100, category: categoryInput.value, date, note: noteInput.value.trim(), createdAt: existing?.createdAt || Date.now() };
  if (editingId) state.expenses = state.expenses.map((item) => item.id === editingId ? expense : item);
  else state.expenses.push(expense);
  persist();
  dialog.close();
  render();
  showToast(editingId ? "Spesa aggiornata." : "Spesa aggiunta.");
});

$("[data-open-expense]").addEventListener("click", () => openDialog());
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
$("#add-category").addEventListener("click", addCategory);
$("#manage-categories").addEventListener("click", addCategory);
$("#voice-button").addEventListener("click", startVoiceInput);
$("#expense-search").addEventListener("input", renderTransactions);
$("#category-filter").addEventListener("change", renderTransactions);

$("#expense-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const row = button.closest("[data-id]");
  const expense = state.expenses.find((item) => item.id === row.dataset.id);
  if (!expense) return;
  if (button.dataset.action === "edit") openDialog(expense);
  if (button.dataset.action === "delete" && window.confirm(`Vuoi eliminare “${expense.title}”?`)) {
    state.expenses = state.expenses.filter((item) => item.id !== expense.id);
    persist();
    render();
    showToast("Spesa eliminata.");
  }
});

document.querySelectorAll(".period-tab").forEach((button) => button.addEventListener("click", () => {
  currentPeriod = button.dataset.period;
  document.querySelectorAll(".period-tab").forEach((tab) => tab.classList.toggle("is-selected", tab === button));
  renderChart();
}));

$("#budget-edit").addEventListener("click", () => {
  const value = window.prompt("Qual è il tuo budget mensile in euro?", String(state.budget).replace(".", ","));
  if (value === null) return;
  const budget = Number(value.replace(",", "."));
  if (!Number.isFinite(budget) || budget <= 0) {
    showToast("Inserisci un budget valido, maggiore di zero.");
    return;
  }
  state.budget = Math.round(budget * 100) / 100;
  persist();
  renderSummary();
  showToast("Budget mensile aggiornato.");
});

render();
