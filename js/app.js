"use strict";

const STORAGE_KEY = "saldo-personal-finance-v1";
const THEME_STORAGE_KEY = "saldo-theme-preference";
const CLOUD_SHEET_KEY = "saldo-google-sheet-v1";
const CLOUD_BASELINE_KEY = "saldo-google-baseline-v1";
const PALETTE = ["#d9ff43", "#3458ff", "#ff7554", "#d592ff", "#31c7a2", "#f5c451", "#f0709b", "#79c9ff", "#a0c768", "#c28b62"];
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
let voiceSessionId = 0;
let toastTimer;
let cloudSheet = readLocalJson(CLOUD_SHEET_KEY, null);
let cloudBaseline = readLocalStorageValue(CLOUD_BASELINE_KEY);
let cloudSyncTimer = null;
let cloudSyncing = false;
let cloudSyncPending = false;

const googleSheets = window.SaldoGoogleSheets;
googleSheets?.configure(window.SALDO_GOOGLE_CONFIG);

const dialog = $("#expense-dialog");
const budgetDialog = $("#budget-dialog");
const form = $("#expense-form");
const budgetForm = $("#budget-form");
const budgetInput = $("#budget-amount");
const titleInput = $("#expense-title");
const amountInput = $("#expense-amount");
const categoryInput = $("#expense-category");
const dateInput = $("#expense-date");
const noteInput = $("#expense-note");
const categoryManagerDialog = $("#category-manager-dialog");
const categoryManagerList = $("#category-manager-list");
let categoryDraft = [];

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

function readLocalJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function readLocalStorageValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function getInitialTheme() {
  const savedTheme = readLocalStorageValue(THEME_STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme, savePreference = false) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  const toggle = $("#theme-toggle");
  toggle.setAttribute("aria-label", isDark ? "Attiva tema chiaro" : "Attiva tema scuro");
  toggle.title = isDark ? "Attiva tema chiaro" : "Attiva tema scuro";
  $(".theme-toggle-icon").textContent = isDark ? "☀" : "◐";
  $(".theme-toggle-label").textContent = isDark ? "Tema chiaro" : "Tema scuro";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#141512" : "#f0eee6");
  if (savePreference) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The selected theme remains applied for this page even when storage is unavailable.
    }
  }
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
  scheduleCloudSync();
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
  persist();

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
    $("#category-donut").style.background = "conic-gradient(var(--surface-muted) 0 100%)";
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
  resetVoiceInput();
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

function openBudgetDialog() {
  $("#budget-error").textContent = "";
  budgetInput.value = state.budget.toFixed(2);
  budgetDialog.showModal();
  setTimeout(() => {
    budgetInput.focus();
    budgetInput.select();
  }, 40);
}

function saveBudget(event) {
  event.preventDefault();
  const budget = Number(budgetInput.value);
  if (!Number.isFinite(budget) || budget <= 0) {
    $("#budget-error").textContent = "Inserisci un importo valido, maggiore di zero.";
    budgetInput.focus();
    return;
  }

  state.budget = Math.round(budget * 100) / 100;
  persist();
  renderSummary();
  budgetDialog.close();
  showToast("Budget mensile aggiornato.");
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

function openCategoryManager() {
  categoryDraft = state.categories.map((category) => ({ ...category, originalName: category.name }));
  $("#category-manager-error").textContent = "";
  $("#new-category-name").value = "";
  $("#new-category-icon").value = "✨";
  $("#new-category-color").value = PALETTE[0];
  renderCategoryManager();
  categoryManagerDialog.showModal();
}

function renderCategoryManager() {
  categoryManagerList.replaceChildren();
  categoryDraft.forEach((category, index) => {
    if (!/^#[\da-f]{6}$/i.test(category.color)) category.color = PALETTE[index % PALETTE.length];
    const row = document.createElement("div");
    row.className = "category-editor-row";

    const nameWrap = document.createElement("div");
    nameWrap.className = "category-editor-name-wrap";

    const iconInput = document.createElement("input");
    iconInput.className = "field-input category-editor-icon";
    iconInput.type = "text";
    iconInput.maxLength = 8;
    iconInput.value = category.icon || "✦";
    iconInput.setAttribute("aria-label", `Icona per ${category.name}`);
    iconInput.dataset.categoryIndex = index;
    iconInput.dataset.categoryField = "icon";

    const nameInput = document.createElement("input");
    nameInput.className = "field-input category-editor-name";
    nameInput.type = "text";
    nameInput.maxLength = 50;
    nameInput.value = category.name;
    nameInput.setAttribute("aria-label", `Nome categoria ${category.name}`);
    nameInput.dataset.categoryIndex = index;
    nameInput.dataset.categoryField = "name";

    nameWrap.append(iconInput, nameInput);

    const colorInput = document.createElement("input");
    colorInput.className = "category-editor-color";
    colorInput.type = "color";
    colorInput.value = /^#[\da-f]{6}$/i.test(category.color) ? category.color : PALETTE[index % PALETTE.length];
    colorInput.setAttribute("aria-label", `Colore categoria ${category.name}`);
    colorInput.dataset.categoryIndex = index;
    colorInput.dataset.categoryField = "color";

    const removeButton = document.createElement("button");
    removeButton.className = "category-remove-button";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Rimuovi categoria ${category.name}`);
    removeButton.dataset.removeCategory = index;
    removeButton.disabled = categoryDraft.length === 1;

    row.append(nameWrap, colorInput, removeButton);
    categoryManagerList.append(row);
  });
}

function addManagedCategory() {
  const nameInput = $("#new-category-name");
  const name = nameInput.value.trim();
  const error = $("#category-manager-error");
  if (!name) {
    error.textContent = "Inserisci il nome della categoria da aggiungere.";
    nameInput.focus();
    return;
  }
  if (categoryDraft.some((category) => category.name.toLocaleLowerCase("it-IT") === name.toLocaleLowerCase("it-IT"))) {
    error.textContent = "Esiste già una categoria con questo nome.";
    nameInput.focus();
    return;
  }

  categoryDraft.push({
    name,
    icon: $("#new-category-icon").value.trim() || "✦",
    color: $("#new-category-color").value,
    originalName: null,
  });
  nameInput.value = "";
  $("#new-category-icon").value = "✨";
  error.textContent = "";
  renderCategoryManager();
  nameInput.focus();
}

function saveManagedCategories(event) {
  event.preventDefault();
  const error = $("#category-manager-error");
  const categories = categoryDraft.map((category) => ({
    ...category,
    name: category.name.trim(),
    icon: category.icon.trim() || "✦",
  }));

  if (!categories.length) {
    error.textContent = "Mantieni almeno una categoria.";
    return;
  }
  if (categories.some((category) => !category.name)) {
    error.textContent = "Ogni categoria deve avere un nome.";
    return;
  }
  if (categories.some((category) => category.name.length > 50)) {
    error.textContent = "Il nome di una categoria non può superare 50 caratteri.";
    return;
  }
  const uniqueNames = new Set(categories.map((category) => category.name.toLocaleLowerCase("it-IT")));
  if (uniqueNames.size !== categories.length) {
    error.textContent = "I nomi delle categorie devono essere univoci.";
    return;
  }

  const categoryByOriginalName = new Map(categories.filter((category) => category.originalName).map((category) => [category.originalName, category.name]));
  const fallbackCategory = categories.find((category) => category.name.toLocaleLowerCase("it-IT") === "altro") || categories[0];
  state.expenses = state.expenses.map((expense) => ({
    ...expense,
    category: categoryByOriginalName.get(expense.category) || fallbackCategory.name,
  }));
  state.categories = categories.map(({ originalName, ...category }) => category);
  persist();
  render();
  categoryManagerDialog.close();
  showToast("Categorie aggiornate.");
}

categoryManagerList.addEventListener("input", (event) => {
  const input = event.target.closest("[data-category-field]");
  if (!input) return;
  const category = categoryDraft[Number(input.dataset.categoryIndex)];
  if (category) category[input.dataset.categoryField] = input.value;
  $("#category-manager-error").textContent = "";
});

categoryManagerList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-category]");
  if (!button) return;
  const index = Number(button.dataset.removeCategory);
  const category = categoryDraft[index];
  if (!category || categoryDraft.length === 1) return;

  const expenseCount = state.expenses.filter((expense) => expense.category === category.originalName).length;
  if (expenseCount && !window.confirm(`Questa categoria è usata da ${expenseCount} ${expenseCount === 1 ? "spesa" : "spese"}. Se la rimuovi, verranno spostate in “Altro” o nella prima categoria disponibile. Continuare?`)) return;

  categoryDraft.splice(index, 1);
  $("#category-manager-error").textContent = "";
  renderCategoryManager();
});

$("#add-managed-category").addEventListener("click", addManagedCategory);
$("#category-manager-form").addEventListener("submit", saveManagedCategories);
document.querySelectorAll("[data-close-category-manager]").forEach((button) => {
  button.addEventListener("click", () => categoryManagerDialog.close());
});
categoryManagerDialog.addEventListener("click", (event) => {
  if (event.target === categoryManagerDialog) categoryManagerDialog.close();
});

function cloudSnapshot(value = state) {
  return JSON.stringify({ schemaVersion: 1, data: value });
}

function normalizeDataState(value) {
  const candidate = value?.data && typeof value.data === "object" ? value.data : value;
  if (!candidate || !Array.isArray(candidate.categories) || !Array.isArray(candidate.expenses)) {
    throw new Error("Il file o il foglio non contiene dati Saldo validi.");
  }

  const categories = candidate.categories
    .filter((category) => category && typeof category.name === "string")
    .map((category) => ({
      name: category.name.trim(),
      icon: typeof category.icon === "string" && category.icon.trim() ? category.icon.trim() : "✦",
      color: /^#[\da-f]{6}$/i.test(category.color) ? category.color : PALETTE[0],
    }));
  const normalizedNames = categories.map((category) => category.name.toLocaleLowerCase("it-IT"));
  if (!categories.length || categories.some((category) => !category.name || category.name.length > 50) || new Set(normalizedNames).size !== normalizedNames.length) {
    throw new Error("Le categorie importate devono avere nomi validi e univoci.");
  }

  const fallbackCategory = categories.find((category) => category.name.toLocaleLowerCase("it-IT") === "altro") || categories[0];
  const expenses = candidate.expenses.map((expense) => {
    if (!isValidExpense(expense) || !expense.title.trim() || !Number.isFinite(Number(expense.amount)) || Number(expense.amount) <= 0) {
      throw new Error("Una o più spese nel backup non sono valide.");
    }
    return {
      ...expense,
      amount: Number(expense.amount),
      category: categories.some((category) => category.name === expense.category) ? expense.category : fallbackCategory.name,
      note: typeof expense.note === "string" ? expense.note : "",
      createdAt: Number(expense.createdAt) || Date.now(),
    };
  });
  const budget = Number(candidate.budget);
  if (!Number.isFinite(budget) || budget < 0) throw new Error("Il budget nel backup non è valido.");
  return { expenses, categories, budget };
}

function saveCloudLink(sheet, baseline) {
  cloudSheet = sheet;
  cloudBaseline = baseline;
  try {
    if (sheet) localStorage.setItem(CLOUD_SHEET_KEY, JSON.stringify(sheet));
    else localStorage.removeItem(CLOUD_SHEET_KEY);
    if (baseline === null) localStorage.removeItem(CLOUD_BASELINE_KEY);
    else localStorage.setItem(CLOUD_BASELINE_KEY, baseline);
  } catch (error) {
    console.warn("Non è stato possibile salvare le impostazioni di sincronizzazione.", error);
  }
  updateDataManager();
}

function updateDataManager(message = "") {
  const configured = googleSheets?.isConfigured() || false;
  $("#storage-mode-label").textContent = cloudSheet ? "Locale + Google Sheets" : "Solo su questo dispositivo";
  const connectButton = $("#connect-google-sheet");
  const changeButton = $("#change-google-sheet");
  const disconnectButton = $("#disconnect-google-sheet");
  const status = $("#cloud-status");
  const setupNote = $("#google-setup-note");
  connectButton.disabled = !configured;
  connectButton.textContent = cloudSheet ? "Ricollega al foglio" : "Scegli il tuo foglio";
  changeButton.hidden = !cloudSheet || !configured;
  disconnectButton.hidden = !cloudSheet;
  if (!configured) {
    setupNote.textContent = `Google Sheets non è ancora configurato dal proprietario dell’app. Mancano: ${googleSheets?.missingConfiguration().join(", ") || "configurazione Google"}.`;
  } else {
    setupNote.innerHTML = 'Crea un foglio Google se non ne hai già uno. <a href="https://sheets.new" target="_blank" rel="noopener">Crea un foglio</a>. L’app aggiungerà una scheda “Saldo” senza modificare le altre schede.';
  }
  if (message) status.textContent = message;
  else if (cloudSheet) status.textContent = `Foglio selezionato: ${cloudSheet.name}. Ricollega Google per sincronizzare in questa sessione.`;
  else status.textContent = "Non collegato. Scegli un foglio nel tuo Drive per sincronizzare i dati.";
}

function openDataManager() {
  updateDataManager();
  $("#data-manager-dialog").showModal();
}

function hasMeaningfulLocalData() {
  return state.expenses.length > 0 || state.categories.some((category, index) => category.name !== DEFAULT_CATEGORIES[index]?.name);
}

function applyDataState(nextState) {
  state = nextState;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Non è stato possibile aggiornare la copia locale.", error);
  }
  render();
}

async function connectGoogleSheet(chooseAnother = false) {
  const connectButton = $("#connect-google-sheet");
  connectButton.disabled = true;
  updateDataManager("Autorizzazione Google in corso…");
  try {
    await googleSheets.authorize();
    const selected = cloudSheet && !chooseAnother ? cloudSheet : await googleSheets.pickSpreadsheet();
    if (!selected) {
      updateDataManager();
      return;
    }

    updateDataManager("Lettura del foglio selezionato…");
    const remote = await googleSheets.readState(selected.id);
    const existingLink = cloudSheet?.id === selected.id;
    const localJson = cloudSnapshot();
    let remoteJson = null;

    if (remote.data) {
      const remoteState = normalizeDataState(remote.data);
      remoteJson = cloudSnapshot(remoteState);
      if (existingLink && cloudBaseline && localJson !== cloudBaseline && remoteJson === cloudBaseline) {
        saveCloudLink({ ...selected, name: remote.title }, cloudBaseline);
        updateDataManager("Invio al foglio delle modifiche locali in sospeso…");
        await syncCloudState();
        return;
      }

      if (existingLink && cloudBaseline && localJson === cloudBaseline && remoteJson !== cloudBaseline) {
        applyDataState(remoteState);
        saveCloudLink({ ...selected, name: remote.title }, remoteJson);
        updateDataManager(`Aggiornato dal foglio “${remote.title}”.`);
        return;
      }

      if (existingLink && cloudBaseline && localJson !== cloudBaseline && remoteJson !== cloudBaseline) {
        const keepLocal = window.confirm("Il foglio e questo dispositivo sono stati modificati dall’ultima sincronizzazione. OK: mantieni e carica la copia di questo dispositivo. Annulla: usa i dati del foglio.");
        if (keepLocal) {
          saveCloudLink({ ...selected, name: remote.title }, remoteJson);
          await syncCloudState();
          return;
        }
      } else if (hasMeaningfulLocalData() && localJson !== remoteJson) {
        const useSheet = window.confirm("Il foglio contiene dati. Vuoi caricarli e sostituire i dati locali di questo browser? Esporta prima un backup se vuoi conservarli.");
        if (!useSheet) {
          updateDataManager();
          return;
        }
      }

      applyDataState(remoteState);
    } else {
      if (cloudBaseline && existingLink) {
        const restoreSheet = window.confirm("La scheda Saldo nel foglio risulta vuota. Vuoi ripristinarla con i dati di questo dispositivo?");
        if (!restoreSheet) {
          updateDataManager("Il foglio è vuoto; i dati locali sono rimasti intatti. Esporta un backup o ricollega un altro foglio.");
          return;
        }
      } else if (hasMeaningfulLocalData()) {
        const migrate = window.confirm("Il foglio non contiene ancora dati Saldo. Vuoi copiare in esso le spese, le categorie e il budget di questo browser?");
        if (!migrate) {
          updateDataManager();
          return;
        }
      }
      remoteJson = await googleSheets.writeState(selected.id, state);
    }

    saveCloudLink({ ...selected, name: remote.title }, remoteJson);
    updateDataManager(`Sincronizzato con “${remote.title}”.`);
    showToast("Foglio Google collegato.");
  } catch (error) {
    console.error("Collegamento Google Sheets non riuscito:", error);
    updateDataManager(error.message || "Non riesco a collegare il foglio Google.");
  } finally {
    connectButton.disabled = !(googleSheets?.isConfigured());
  }
}

function scheduleCloudSync() {
  if (!cloudSheet) return;
  clearTimeout(cloudSyncTimer);
  updateDataManager("Salvato su questo dispositivo; sincronizzazione in attesa…");
  cloudSyncTimer = setTimeout(syncCloudState, 700);
}

async function syncCloudState() {
  if (!cloudSheet) return;
  if (cloudSyncing) {
    cloudSyncPending = true;
    return;
  }
  cloudSyncing = true;
  try {
    const remote = await googleSheets.readState(cloudSheet.id);
    let localJson = cloudSnapshot();
    const remoteState = remote.data ? normalizeDataState(remote.data) : null;
    const remoteJson = remoteState ? cloudSnapshot(remoteState) : null;

    if (remoteJson !== cloudBaseline) {
      if (localJson === cloudBaseline && remoteState) {
        applyDataState(remoteState);
        localJson = cloudSnapshot();
      } else if (!remoteState) {
        const restoreSheet = window.confirm("La scheda Saldo nel foglio è vuota o è stata rimossa. Vuoi ripristinarla con i dati di questo dispositivo?");
        if (!restoreSheet) {
          updateDataManager("Foglio vuoto: i dati locali sono rimasti intatti e non sono stati sincronizzati.");
          return;
        }
      } else if (localJson !== remoteJson) {
        const keepLocal = window.confirm("Il foglio Google contiene modifiche più recenti di quelle caricate qui. OK: sovrascrivi il foglio con questa copia. Annulla: carica qui i dati dal foglio.");
        if (!keepLocal && remoteState) {
          applyDataState(remoteState);
          saveCloudLink(cloudSheet, remoteJson);
          updateDataManager(`Aggiornato dal foglio “${cloudSheet.name}”.`);
          return;
        }
      }
    }

    if (localJson !== remoteJson) {
      updateDataManager("Sincronizzazione con Google Sheets…");
      cloudBaseline = await googleSheets.writeState(cloudSheet.id, state);
      localStorage.setItem(CLOUD_BASELINE_KEY, cloudBaseline);
    } else {
      cloudBaseline = remoteJson;
      if (remoteJson !== null) localStorage.setItem(CLOUD_BASELINE_KEY, remoteJson);
    }
    updateDataManager(`Sincronizzato con “${cloudSheet.name}”.`);
  } catch (error) {
    console.error("Sincronizzazione Google Sheets non riuscita:", error);
    updateDataManager(`Dati salvati in locale. Sincronizzazione non riuscita: ${error.message}`);
  } finally {
    cloudSyncing = false;
    if (cloudSyncPending) {
      cloudSyncPending = false;
      scheduleCloudSync();
    }
  }
}

function exportDataBackup() {
  const backup = {
    application: "Saldo",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: state,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `saldo-backup-${dateKey(new Date())}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Backup esportato.");
}

async function importDataBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    const importedState = normalizeDataState(backup);
    if (!window.confirm(`Il backup contiene ${importedState.expenses.length} spese e ${importedState.categories.length} categorie. Vuoi sostituire i dati presenti in questo browser?`)) return;
    applyDataState(importedState);
    persist();
    showToast("Backup ripristinato.");
  } catch (error) {
    $("#cloud-status").textContent = error.message || "Il file selezionato non è un backup Saldo valido.";
  } finally {
    $("#import-data-file").value = "";
  }
}

function disconnectGoogleSheet() {
  if (!window.confirm("Vuoi disconnettere il foglio? I dati locali restano su questo browser e il foglio Google non verrà modificato.")) return;
  clearTimeout(cloudSyncTimer);
  googleSheets?.disconnect();
  saveCloudLink(null, null);
  showToast("Foglio Google disconnesso.");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function resetVoiceInput() {
  voiceSessionId += 1;
  const activeRecognition = recognition;
  recognition = null;
  if (activeRecognition) activeRecognition.abort();

  const button = $("#voice-button");
  button.classList.remove("is-listening");
  button.disabled = false;
  button.innerHTML = "🎙 <span>Parla</span>";
  $("#voice-status").textContent = "Ad esempio: “12 euro per il pranzo”";
}

async function parseVoiceExpense(transcript) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch("/api/parse-expense", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        categories: state.categories.map((category) => category.name),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Il server non ha risposto entro 30 secondi. Controlla che il deploy Vercel sia aggiornato e verifica i log della funzione.");
    }
    throw new Error("Non riesco a raggiungere il backend. Controlla la connessione e il deploy Vercel.");
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.text();
  let result;
  try {
    result = body ? JSON.parse(body) : {};
  } catch {
    if (response.status === 404) {
      throw new Error("Il backend /api/parse-expense non è stato trovato nel deploy. Verifica che Vercel stia eseguendo l'app Express, non solo i file statici.");
    }
    throw new Error(`Il server ha restituito una risposta non JSON (HTTP ${response.status}). Verifica il deploy del backend su Vercel.`);
  }
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
  resetVoiceInput();
  const sessionId = ++voiceSessionId;
  const activeRecognition = new SpeechRecognition();
  recognition = activeRecognition;
  activeRecognition.lang = "it-IT";
  activeRecognition.interimResults = false;
  activeRecognition.maxAlternatives = 1;
  const button = $("#voice-button");
  button.classList.add("is-listening");
  button.innerHTML = "● <span>Ti ascolto…</span>";
  $("#voice-status").textContent = "Parla ora: “12 euro per il pranzo”. La dettatura dipende dal browser.";
  activeRecognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    button.disabled = true;
    $("#voice-status").textContent = `Ho capito: “${transcript}”. Interpreto la spesa…`;
    try {
      const parsed = await parseVoiceExpense(transcript);
      if (sessionId !== voiceSessionId || !dialog.open) return;
      titleInput.value = parsed.description;
      amountInput.value = parsed.amount;
      categoryInput.value = parsed.category;
      $("#form-error").textContent = "";
      $("#voice-status").textContent = `Compilato: “${transcript}”. Controlla i campi prima di salvare.`;
    } catch (error) {
      if (sessionId !== voiceSessionId || !dialog.open) return;
      $("#form-error").textContent = error.message;
      $("#voice-status").textContent = `Errore durante l'interpretazione: ${error.message}`;
    } finally {
      if (sessionId === voiceSessionId && dialog.open) button.disabled = false;
    }
  };
  activeRecognition.onerror = (event) => {
    if (sessionId !== voiceSessionId || !dialog.open) return;
    $("#voice-status").textContent = event.error === "not-allowed" ? "Consenti l'accesso al microfono nelle impostazioni del browser." : "Non ho capito: riprova oppure inserisci i dati manualmente.";
  };
  activeRecognition.onend = () => {
    if (sessionId !== voiceSessionId) return;
    if (recognition === activeRecognition) recognition = null;
    button.classList.remove("is-listening");
    button.innerHTML = "🎙 <span>Parla</span>";
    button.disabled = false;
  };
  try { activeRecognition.start(); } catch {
    if (sessionId === voiceSessionId) resetVoiceInput();
  }
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
$("#budget-edit").addEventListener("click", openBudgetDialog);
budgetForm.addEventListener("submit", saveBudget);
document.querySelectorAll("[data-close-budget]").forEach((button) => {
  button.addEventListener("click", () => budgetDialog.close());
});
budgetDialog.addEventListener("click", (event) => {
  if (event.target === budgetDialog) budgetDialog.close();
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
dialog.addEventListener("close", resetVoiceInput);
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
$("#add-category").addEventListener("click", addCategory);
$("#manage-categories").addEventListener("click", openCategoryManager);
$("#manage-data").addEventListener("click", openDataManager);
$("#theme-toggle").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
});
$("#connect-google-sheet").addEventListener("click", connectGoogleSheet);
$("#change-google-sheet").addEventListener("click", () => connectGoogleSheet(true));
$("#disconnect-google-sheet").addEventListener("click", disconnectGoogleSheet);
$("#export-data").addEventListener("click", exportDataBackup);
$("#import-data").addEventListener("click", () => $("#import-data-file").click());
$("#import-data-file").addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (file) importDataBackup(file);
});
document.querySelectorAll("[data-close-data-manager]").forEach((button) => {
  button.addEventListener("click", () => $("#data-manager-dialog").close());
});
$("#data-manager-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
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

applyTheme(getInitialTheme());
render();
updateDataManager();
