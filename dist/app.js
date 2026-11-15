"use strict";

const $ = (id) => document.getElementById(id);
const storageKey = "riri-ledger-v1";
const budgetKey = "riri-expense-plans-v1";
const budgetNamesKey = "riri-expense-plan-names-v1";
const partnerTotalsKey = "riri-partner-monthly-totals-v1";
const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" });
const categories = {
  expense: {
    "餐饮": ["food", "#167a76", "#e3f4f2"],
    "购物": ["bag", "#df8a58", "#fff1e7"],
    "交通": ["train", "#4a83d4", "#e9f2ff"],
    "居住": ["home", "#315d92", "#e6eef9"],
    "休闲": ["spark", "#3fa691", "#e5f8f2"],
    "其他": ["wallet", "#777689", "#eeedf2"],
  },
  income: {
    "工资": ["wallet", "#188361", "#e7f7ef"],
    "奖金": ["spark", "#cb793f", "#fff1e7"],
    "兼职": ["bag", "#457dc4", "#e9f2ff"],
    "其他": ["wallet", "#777689", "#eeedf2"],
  },
};

const today = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai",
}).format();
let month = today.slice(0, 7);
let filter = "all";
let editingId = null;
let noticeTimer;
let entryPoint = null;
let photoRequest = 0;
let entryPhoto = "";
let photoSource = "";
let photoTurns = 0;
const form = $("entry-form");
const fields = form.elements;
const editor = $("editor");
const filters = document.querySelectorAll("[data-filter]");
const monthInputs = document.querySelectorAll("[data-month-input]");
const monthLabels = document.querySelectorAll("[data-month-label]");
const monthButtons = document.querySelectorAll("[data-month-step]");
const demo = [
  ["expense", "餐饮", 4200, 14, "午餐"],
  ["expense", "购物", 16800, 13, "日用品"],
  ["expense", "交通", 2650, 12, "通勤打车"],
  ["expense", "休闲", 9600, 10, "周末电影"],
  ["expense", "餐饮", 12800, 8, "朋友聚餐"],
  ["expense", "居住", 280000, 5, "房租"],
  ["income", "工资", 850000, 3, "工资到账"],
].map(([type, category, amount, day, note], index) => ({
  id: String(index),
  type,
  category,
  amount,
  date: today.slice(0, 7) + "-" + String(Math.min(day, Number(today.slice(-2)))).padStart(2, "0"),
  note,
}));

function announce(message) {
  $("notice").textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $("notice").textContent = ""; }, 3600);
}

function load() {
  try {
    const data = localStorage.getItem(storageKey);
    return data === null ? null : JSON.parse(data);
  } catch {
    announce("无法读取浏览器里的账本。");
    return null;
  }
}

let records = load();
let githubPartnerTotals = null;
window.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === null) {
    records = load();
    render();
  }
  if (event.key === budgetKey || event.key === partnerTotalsKey) render();
});

function save(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    records = next;
  } catch {
    return false;
  }
  document.dispatchEvent(new Event("ledgerchange"));
  return true;
}

function money(cents) {
  return currency.format(cents / 100);
}

function monthRecords() {
  return (records ?? demo).filter((entry) => entry.date.startsWith(month + "-"))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function sumAmounts(entries) {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}

function monthLabel(period) {
  return Number(period.slice(0, 4)) + "年" + Number(period.slice(5)) + "月";
}

function renderEntries(entries) {
  const query = $("ledger-search").value.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) =>
    (filter === "all" || entry.type === filter) &&
    (!query || [entry.note, entry.location, entry.category].some((value) =>
      value?.toLocaleLowerCase().includes(query))));
  $("ledger-count").textContent = "共 " + visible.length + " 笔记录";
  const list = $("entries");
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = '<svg aria-hidden="true"><use href="#book"/></svg><p></p>';
    empty.querySelector("p").textContent = query ? "没有找到符合搜索条件的账单"
      : filter === "all" ? "本月还没有记录" : "本月还没有这类记录";
    list.append(empty);
    return;
  }
  for (const entry of visible) {
    const row = $("entry-template").content.firstElementChild.cloneNode(true);
    const [icon, color, background] = categories[entry.type][entry.category];
    const badge = row.querySelector(".category-icon");
    badge.style.setProperty("--category-color", color);
    badge.style.setProperty("--category-bg", background);
    badge.querySelector("use").setAttribute("href", "#" + icon);
    row.querySelector("strong").textContent = entry.note || entry.category;
    row.querySelector("small").textContent = entry.category + " · " + entry.date.slice(5).replace("-", "/");
    const location = row.querySelector(".entry-location");
    if (entry.location) {
      location.textContent = "地点：" + entry.location;
      location.hidden = false;
    }
    row.querySelector(".entry-photo").hidden = !entry.photo;
    const amount = row.querySelector(".entry-amount");
    const cashFlow = entry.type === "income" ? entry.amount : -entry.amount;
    amount.textContent = (cashFlow < 0 ? "−" : "+") + money(Math.abs(cashFlow));
    if (cashFlow > 0) amount.classList.add("income");
    if (records === null) {
      row.disabled = true;
      row.classList.add("sample");
      row.querySelector(".edit-icon").style.visibility = "hidden";
    } else {
      row.addEventListener("click", () => openEditor(entry));
    }
    list.append(row);
  }
}

function drawChart(rows, { title, description, centerLabel, centerAmount, emptyMessage }) {
  $("chart-title").textContent = title;
  $("chart-description").textContent = description;
  $("ring-label").textContent = centerLabel;
  $("ring-total").textContent = money(centerAmount);
  const legend = $("legend");
  legend.replaceChildren();
  const magnitude = rows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const stops = [];
  let current = 0;
  for (const { label, amount, color } of rows) {
    const percent = magnitude ? Math.abs(amount) / magnitude * 100 : 0;
    if (percent) stops.push(color + " " + current + "% " + (current + percent) + "%");
    current += percent;
    const row = document.createElement("div");
    row.className = "legend-item";
    row.style.setProperty("--dot", color);
    row.innerHTML = "<i></i><span></span><strong></strong><small></small>";
    row.children[1].textContent = label;
    row.children[2].textContent = money(amount);
    row.children[3].textContent = Math.round(percent) + "%";
    legend.append(row);
  }
  $("ring").style.background = stops.length ? "conic-gradient(" + stops.join(",") + ")" : "";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.textContent = emptyMessage;
    legend.append(empty);
  }
}

function renderCategoryChart(entries, total, type) {
  const label = type === "income" ? "收入" : "支出";
  const totals = new Map();
  for (const entry of entries) {
    totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.amount);
  }
  const rows = Array.from(totals, ([name, amount]) => ({
    label: name, amount, color: categories[type][name][1],
  })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  drawChart(rows, {
    title: label + "分类",
    description: rows.some(({ amount }) => amount < 0)
      ? "按各类别净" + label + "的绝对值计算占比"
      : "本月各类别净" + label + "占比",
    centerLabel: "总" + label,
    centerAmount: total,
    emptyMessage: "本月暂无" + label,
  });
}

function readBudgets() {
  return JSON.parse(localStorage.getItem(budgetKey) ?? "{}");
}

function readBudgetNames() {
  return JSON.parse(localStorage.getItem(budgetNamesKey) ?? "{}");
}

function readPartnerTotals() {
  return JSON.parse(localStorage.getItem(partnerTotalsKey) ?? "{}");
}

function validPartnerAmount(amount) {
  return Number.isSafeInteger(amount) && Math.abs(amount) < 100000000000000;
}

function writePartnerMonth(period, summary) {
  const totals = readPartnerTotals();
  if (summary === null) delete totals[period];
  else totals[period] = summary;
  localStorage.setItem(partnerTotalsKey, JSON.stringify(totals));
}

function renderCombined() {
  let imported = {};
  let message = githubPartnerTotals === null
    ? "可导入对方发来的月度收支汇总。"
    : "对方尚未同步该月的收支汇总。";
  try {
    imported = readPartnerTotals() ?? {};
  } catch {
    message = "无法读取对方的收支汇总。";
  }

  const history = new Map();
  for (let period = month; history.size < 6; period = shiftedMonth(period, -1)) {
    const partner = githubPartnerTotals?.[period] ?? imported[period];
    history.set(period, partner ? { income: partner.income, expense: partner.expense } : null);
    if (period === "0001-01") break;
  }
  for (const entry of records ?? []) {
    const totals = history.get(entry.date.slice(0, 7));
    if (totals) totals[entry.type] += entry.amount;
  }

  const current = history.get(month);
  const previous = month === "0001-01" ? null : history.get(shiftedMonth(month, -1));
  $("combined-balance").textContent = current ? money(current.income - current.expense) : "—";
  for (const type of ["income", "expense"]) {
    $("combined-" + type).textContent = current ? money(current[type]) : "—";
    const change = current && previous ? current[type] - previous[type] : null;
    $("combined-" + type + "-change").textContent = change === null ? ""
      : change === 0 ? "较上月持平" : "较上月 " + (change > 0 ? "+" : "") + money(change);
  }
  $("combined-status").textContent = current ? "" : message;
  renderCombinedTrend(Array.from(history).filter(([, totals]) => totals).reverse());
}

function renderCombinedTrend(rows) {
  const list = $("combined-trend-list");
  list.replaceChildren();
  list.hidden = !rows.length;
  $("combined-trend-key").hidden = !rows.length;
  $("combined-trend-empty").hidden = Boolean(rows.length);
  const amounts = rows.flatMap(([, totals]) => [totals.income, totals.expense]);
  const min = Math.min(0, ...amounts);
  const max = Math.max(0, ...amounts);
  const range = Math.max(1, max - min);
  list.style.setProperty("--zero-position", ((0 - min) / range) * 100 + "%");
  for (const [period, totals] of rows) {
    const row = document.createElement("li");
    row.className = "combined-trend-row";
    const label = document.createElement("span");
    label.className = "combined-trend-month";
    label.textContent = monthLabel(period);
    const values = document.createElement("div");
    values.className = "combined-trend-values";
    for (const [type, name] of [["income", "收入"], ["expense", "支出"]]) {
      const amount = totals[type];
      const value = document.createElement("div");
      value.className = "combined-trend-value combined-" + type;
      const track = document.createElement("span");
      track.className = "combined-trend-track";
      track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.className = "combined-trend-fill";
      fill.style.setProperty("--bar-start", ((Math.min(0, amount) - min) / range) * 100 + "%");
      fill.style.setProperty("--bar-size", (Math.abs(amount) / range) * 100 + "%");
      track.append(fill);
      const formatted = document.createElement("span");
      formatted.className = "combined-trend-amount";
      const accessibleLabel = document.createElement("span");
      accessibleLabel.className = "sr-only";
      accessibleLabel.textContent = name + " ";
      formatted.append(accessibleLabel, money(amount));
      value.append(track, formatted);
      values.append(value);
    }
    row.append(label, values);
    list.append(row);
  }
}

function monthlyBudget(month, budgets) {
  const saved = budgets[month];
  const amount = typeof saved === "number"
    ? saved
    : Object.values(saved ?? {}).reduce((sum, categoryAmount) => sum + categoryAmount, 0);
  return amount > 0 ? amount : null;
}

const budgetPercent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });

function renderBudgetProgress(expense, limit) {
  const used = Math.max(0, expense);
  const fraction = limit === null ? 0 : used / limit;
  const over = limit !== null && used > limit;
  const fill = over ? "#b84c43" : "#0d706c";
  const arc = Math.min(fraction, 1) * 100 + "%";
  $("chart-title").textContent = "额度概览";
  $("chart-description").textContent = limit === null
    ? "设置本月支出额度后即可查看使用率。"
    : "本月净支出占计划额度的比例";
  $("ring-label").textContent = limit === null ? "未设置额度" : over ? "超过计划" : "已使用";
  $("ring-total").textContent = limit === null ? "—" : budgetPercent.format(fraction);
  $("ring").style.background = fraction > 0
    ? "conic-gradient(" + fill + " 0 " + arc + ", #e6f3f4 " + arc + " 100%)"
    : "";

  const rows = [
    [records === null ? "示例支出" : "实际支出", money(expense), fill],
    ["计划额度", limit === null ? "未设置" : money(limit), "#98b6bd"],
  ];
  if (limit !== null) {
    rows.push([over ? "超出额度" : "剩余额度", money(Math.abs(limit - used)), over ? fill : "#c8e1e4"]);
  }
  const legend = $("legend");
  legend.replaceChildren();
  for (const [label, value, color] of rows) {
    const row = document.createElement("div");
    row.className = "legend-item budget-progress-item";
    row.style.setProperty("--dot", color);
    row.innerHTML = "<i></i><span></span><strong></strong>";
    row.children[1].textContent = label;
    row.children[2].textContent = value;
    legend.append(row);
  }
}

function render() {
  const entries = monthRecords();
  const incomes = entries.filter((entry) => entry.type === "income");
  const expenses = entries.filter((entry) => entry.type === "expense");
  const income = sumAmounts(incomes);
  const expense = sumAmounts(expenses);
  if (!$("combined").hidden) renderCombined();
  const label = monthLabel(month);
  monthInputs.forEach((input) => { input.value = month; });
  monthLabels.forEach((element) => { element.textContent = label; });
  monthButtons.forEach((button) => {
    button.disabled = month === (button.dataset.monthStep === "-1" ? "0001-01" : "9999-12");
  });
  $("balance").textContent = money(income - expense);
  $("income").textContent = money(income);
  $("expense").textContent = money(expense);
  $("income-count").textContent = incomes.length + " 笔收入";
  $("expense-count").textContent = expenses.length + " 笔支出";
  $("demo-bar").hidden = records !== null;
  filters.forEach((button) => button.setAttribute("aria-pressed", button.dataset.filter === filter));
  renderEntries(entries);
  let limit = null;
  try {
    limit = monthlyBudget(month, readBudgets());
  } catch {
    // Keep transaction totals available if the budget cannot be read.
  }
  $("monthly-limit-value").textContent = limit === null ? "未设置" : money(limit);
  $("ring").setAttribute("aria-hidden", String(filter !== "all"));
  if (filter === "all") renderBudgetProgress(expense, limit);
  else if (filter === "income") renderCategoryChart(incomes, income, "income");
  else renderCategoryChart(expenses, expense, "expense");
}

function shiftedMonth(period, step) {
  const [year, number] = period.split("-").map(Number);
  const target = year * 12 + number - 1 + step;
  return String(Math.floor(target / 12)).padStart(4, "0") + "-" + String(target % 12 + 1).padStart(2, "0");
}

function shiftMonth(step) {
  month = shiftedMonth(month, step);
  render();
}

function updateCategories(selected) {
  fields.category.replaceChildren(...Object.keys(categories[fields.type.value])
    .map((name) => new Option(name, name, false, name === selected)));
}

function openEditor(entry) {
  form.reset();
  photoRequest += 1;
  setPhotoProcessing(false);
  $("photo-status").textContent = "";
  resetPhoto(entry?.photo ?? "");
  editingId = entry?.id ?? null;
  fields.type.value = entry?.type ?? "expense";
  entryAmount.reset(entry?.amount);
  fields.date.value = entry?.date ?? (month === today.slice(0, 7) ? today : month + "-01");
  syncDateDisplay(fields.date);
  fields.location.value = entry?.location ?? "";
  entryPoint = entry?.locationPoint ?? parseCoordinates(fields.location.value);
  fields.note.value = entry?.note ?? "";
  updateCategories(entry?.category);
  $("editor-title").textContent = entry ? "编辑记录" : "记一笔";
  $("delete").hidden = !entry;
  $("form-error").textContent = "";
  editor.showModal();
  $("entry-editor-body").scrollTop = 0;
}

const amountKeypad = $("amount-keypad");
const keypadSign = amountKeypad.querySelector('[data-key="-"]');
let activeAmount = null;

function closeAmountKeypad() {
  if (!activeAmount) return;
  activeAmount.button.setAttribute("aria-expanded", "false");
  amountKeypad.hidden = true;
  activeAmount = null;
}

function revealAmountKeypad(field) {
  const body = field.button.closest(".record-editor-body");
  if (!body) return;
  const dialog = body.closest("dialog");
  requestAnimationFrame(() => {
    if (activeAmount !== field || !dialog.open) return;
    const viewport = body.getBoundingClientRect();
    const top = viewport.top + 4;
    const bottom = viewport.top + body.clientHeight - 4;
    const keypad = amountKeypad.getBoundingClientRect();
    if (keypad.bottom > bottom) body.scrollTop += Math.ceil(keypad.bottom - bottom);
    else if (keypad.top < top) body.scrollTop -= Math.floor(Math.min(top - keypad.top, bottom - keypad.bottom));
  });
}

function createAmountField(container, label, maxDigits, placeholder) {
  container.className = "field money-field";
  const title = document.createElement("span");
  title.textContent = label;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "amount-display";
  button.setAttribute("aria-controls", "amount-keypad");
  button.setAttribute("aria-expanded", "false");
  container.append(title, button);
  const digitsPattern = new RegExp("^\\d{1," + maxDigits + "}(?:\\.\\d{0,2})?$");
  let draft = "";
  let negative = false;

  function draw() {
    button.textContent = (negative ? "−" : "") + (draft || placeholder);
    button.setAttribute("aria-label", label + "，" + button.textContent);
    if (activeAmount === field) keypadSign.setAttribute("aria-pressed", String(negative));
  }

  const field = {
    button,
    open() {
      closeAmountKeypad();
      activeAmount = field;
      container.append(amountKeypad);
      amountKeypad.hidden = false;
      button.setAttribute("aria-expanded", "true");
      draw();
      revealAmountKeypad(field);
    },
    reset(cents) {
      if (activeAmount === field) closeAmountKeypad();
      draft = cents == null ? "" : (Math.abs(cents) / 100).toFixed(2);
      negative = cents < 0;
      draw();
    },
    edit(key) {
      if (key === "-") negative = !negative;
      else if (key === "Backspace") draft = draft.slice(0, -1);
      else if (key === "Delete") {
        draft = "";
        negative = false;
      } else if (key === ".") {
        if (!draft.includes(".")) draft = (draft || "0") + ".";
      } else {
        const next = (draft === "0" ? "" : draft) + key;
        if (digitsPattern.test(next)) draft = next;
      }
      draw();
    },
    get cents() {
      if (!draft) return null;
      const [yuan, fraction = ""] = draft.split(".");
      const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
      return negative && cents ? -cents : cents;
    },
  };
  button.addEventListener("click", () => {
    if (activeAmount === field) closeAmountKeypad();
    else field.open();
  });
  container.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey ||
      !/^(?:[0-9.-]|Backspace|Delete)$/.test(event.key)) return;
    event.preventDefault();
    if (activeAmount !== field) field.open();
    field.edit(event.key);
  });
  field.reset();
  return field;
}

amountKeypad.addEventListener("click", (event) => {
  const key = event.target.closest("button[data-key]")?.dataset.key;
  if (key) activeAmount?.edit(key);
});
$("close-amount-keypad").addEventListener("click", () => {
  const button = activeAmount?.button;
  closeAmountKeypad();
  button?.focus();
});
document.addEventListener("close", (event) => {
  if (!event.target.open && event.target.contains(amountKeypad)) closeAmountKeypad();
}, true);

const entryAmount = createAmountField($("entry-amount-field"), "金额（元）", 9, "0.00");

const budgetEditor = $("budget-editor");
const budgetAmount = createAmountField($("budget-amount-field"), "额度（元）", 10, "未设置");
let editingBudgetMonth;

$("edit-budget").addEventListener("click", () => {
  let limit;
  try {
    limit = monthlyBudget(month, readBudgets());
  } catch {
    announce("无法读取支出额度。");
    return;
  }
  editingBudgetMonth = month;
  budgetAmount.reset(limit);
  $("budget-month").textContent = monthLabel(month) + " · 清空金额可取消额度";
  $("budget-error").textContent = "";
  budgetEditor.showModal();
  $("budget-editor-body").scrollTop = 0;
});
$("close-budget-editor").addEventListener("click", () => budgetEditor.close());
$("budget-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const amount = budgetAmount.cents;
  if (amount !== null && amount <= 0) {
    $("budget-error").textContent = "请输入大于零的额度，或清空金额。";
    budgetAmount.open();
    budgetAmount.button.focus();
    return;
  }
  try {
    const budgets = readBudgets();
    if (amount === null) delete budgets[editingBudgetMonth];
    else budgets[editingBudgetMonth] = amount;
    localStorage.setItem(budgetKey, JSON.stringify(budgets));
  } catch {
    $("budget-error").textContent = "保存失败，请检查浏览器存储。";
    return;
  }
  budgetEditor.close();
  render();
  announce(amount === null ? "已取消支出额度" : "已保存支出额度");
});

const importSummaryDialog = $("import-summary-dialog");
const importSummaryText = $("import-summary-text");
const importSummaryError = $("import-summary-error");


function parseSharedSummary(text) {
  const match = /^日日记账月度汇总\s+月份[：:]\s*(\d{4}-(?:0[1-9]|1[0-2]))\s+收入[：:]\s*(-?\d+\.\d{2})\s+支出[：:]\s*(-?\d+\.\d{2})$/.exec(text.trim());
  if (!match || match[1].startsWith("0000")) return null;
  const [, period, incomeText, expenseText] = match;
  const [income, expense] = [incomeText, expenseText].map((value) => Number(value.replace(".", "")));
  return [income, expense].every(validPartnerAmount) ? { period, income, expense } : null;
}

$("import-partner-totals").addEventListener("click", () => {
  importSummaryText.value = "";
  importSummaryError.textContent = "";
  importSummaryDialog.showModal();
});
$("close-import-summary").addEventListener("click", () => importSummaryDialog.close());
$("import-summary-form").addEventListener("submit", (event) => {
  event.preventDefault();
  importSummaryError.textContent = "";
  const summary = parseSharedSummary(importSummaryText.value);
  if (!summary) {
    importSummaryError.textContent = "请粘贴完整的日日记账月度汇总文本。";
    importSummaryText.focus();
    return;
  }
  const { period, income, expense } = summary;
  try {
    const previous = readPartnerTotals()[period];
    if (previous && (previous.income !== income || previous.expense !== expense) &&
      !window.confirm("用这份汇总更新 " + monthLabel(period) + " 的对方收支？")) return;
    writePartnerMonth(period, { income, expense });
  } catch {
    importSummaryError.textContent = "导入失败，请检查浏览器存储。";
    return;
  }
  month = period;
  importSummaryDialog.close();
  render();
  announce("已导入 " + monthLabel(period) + " 的对方汇总");
});

const partnerEditor = $("partner-editor");
const partnerIncome = createAmountField($("partner-income-field"), "对方收入（元）", 12, "填写金额");
const partnerExpense = createAmountField($("partner-expense-field"), "对方支出（元）", 12, "填写金额");
let editingPartnerMonth;

$("edit-partner-totals").addEventListener("click", () => {
  let previous;
  try {
    previous = readPartnerTotals()[month];
  } catch {
    announce("无法读取对方的收支汇总。");
    return;
  }
  editingPartnerMonth = month;
  partnerIncome.reset(previous?.income);
  partnerExpense.reset(previous?.expense);
  $("partner-month").textContent = monthLabel(month);
  $("partner-error").textContent = "";
  importSummaryDialog.close();
  partnerEditor.showModal();
  partnerEditor.querySelector(".record-editor-body").scrollTop = 0;
});
$("close-partner-editor").addEventListener("click", () => partnerEditor.close());
$("partner-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const income = partnerIncome.cents;
  const expense = partnerExpense.cents;
  const clearing = income === null && expense === null;
  if (!clearing && (income === null || expense === null)) {
    $("partner-error").textContent = "请同时填写收入和支出，其中一项没有金额时填 0。";
    (income === null ? partnerIncome : partnerExpense).button.focus();
    return;
  }
  try {
    writePartnerMonth(editingPartnerMonth, clearing ? null : { income, expense });
  } catch {
    $("partner-error").textContent = "保存失败，请检查浏览器存储。";
    return;
  }
  partnerEditor.close();
  render();
  announce(clearing ? "已移除当月汇总" : "已保存对方收支汇总");
});

function syncDateDisplay(input) {
  input.parentElement.querySelector(".date-value").textContent = input.value || "选择日期";
}

for (const input of document.querySelectorAll(".date-control input")) {
  const sync = () => syncDateDisplay(input);
  input.addEventListener("input", sync);
  input.addEventListener("change", sync);
}

function parseCoordinates(value) {
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/u);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function locationLabel(value) {
  return value.replace(/\s*\n\s*/g, " ").trim();
}

$("open-amap").addEventListener("click", (event) => {
  const link = event.currentTarget;
  const point = entryPoint ?? parseCoordinates(fields.location.value);
  const label = locationLabel(fields.location.value);
  let url = new URL("https://www.amap.com/");
  if (point) {
    url = new URL("https://uri.amap.com/marker");
    url.searchParams.set("position", point.lng.toFixed(6) + "," + point.lat.toFixed(6));
    url.searchParams.set("coordinate", "wgs84");
  } else if (label) {
    url = new URL("https://uri.amap.com/search");
    url.searchParams.set("keyword", label);
  }
  if (url.hostname === "uri.amap.com") {
    url.searchParams.set("src", "riri-ledger");
    url.searchParams.set("callnative", "0");
  }
  link.href = url.href;
});

fields.location.addEventListener("input", () => { entryPoint = null; });

function showPhoto(photo) {
  entryPhoto = photo;
  $("photo-attachment").hidden = !photo;
  if (photo) $("photo-preview").src = photo;
  else $("photo-preview").removeAttribute("src");
}

function resetPhoto(photo) {
  photoSource = photo;
  photoTurns = 0;
  showPhoto(photo);
}

function setPhotoProcessing(processing) {
  $("save-entry").disabled = processing;
  $("rotate-photo-left").disabled = processing;
  $("rotate-photo-right").disabled = processing;
}

function loadPhoto(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function readPhotoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reader.onabort = reject;
    reader.readAsDataURL(file);
  });
}

async function preparePhoto(file) {
  let url;
  try {
    let image;
    try {
      url = URL.createObjectURL(file);
      image = await loadPhoto(url);
    } catch {
      try {
        image = await loadPhoto(await readPhotoDataUrl(file));
      } catch {
        return { error: "无法读取这张照片，请重新拍照或从相册选择 JPG 或 PNG 图片。" };
      }
    }
    return { photo: encodePhoto(image, image.naturalWidth, image.naturalHeight) };
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function encodePhoto(source, width, height, turns = 0) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  const sideways = turns % 2 !== 0;
  for (const [maxSide, quality] of [[1400, 0.76], [1050, 0.76], [750, 0.76], [560, 0.66], [400, 0.58], [280, 0.50]]) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const scaledWidth = Math.max(1, Math.round(width * scale));
    const scaledHeight = Math.max(1, Math.round(height * scale));
    canvas.width = sideways ? scaledHeight : scaledWidth;
    canvas.height = sideways ? scaledWidth : scaledHeight;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(turns * Math.PI / 2);
    context.drawImage(source, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
    const photo = canvas.toDataURL("image/jpeg", quality);
    if (photo.startsWith("data:image/jpeg;base64,") && photo.length <= 160000) return photo;
  }
  throw new Error("Photo exceeds storage limit");
}

async function rotatePhoto(direction) {
  if (!photoSource || $("save-entry").disabled) return;
  const request = ++photoRequest;
  const turns = (photoTurns + direction + 4) % 4;
  const status = $("photo-status");
  setPhotoProcessing(true);
  try {
    let photo = photoSource;
    if (turns !== 0) {
      const image = await loadPhoto(photoSource);
      if (!editor.open || request !== photoRequest) return;
      photo = encodePhoto(image, image.naturalWidth, image.naturalHeight, turns);
    }
    photoTurns = turns;
    showPhoto(photo);
    status.textContent = "照片方向已调整，保存记录后生效。";
  } catch {
    if (editor.open && request === photoRequest) status.textContent = "无法旋转这张照片。";
  } finally {
    if (editor.open && request === photoRequest) setPhotoProcessing(false);
  }
}

$("rotate-photo-left").addEventListener("click", () => rotatePhoto(-1));
$("rotate-photo-right").addEventListener("click", () => rotatePhoto(1));
$("upload-photo").addEventListener("click", () => $("photo-file").click());

async function selectPhoto(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  const request = ++photoRequest;
  const status = $("photo-status");
  if (!file.size || file.size > 20 * 1024 * 1024) {
    status.textContent = file.size ? "请选择 20 MB 以内的照片。" : "没有读取到照片，请重新拍照或从相册选择。";
    setPhotoProcessing(false);
    return;
  }
  setPhotoProcessing(true);
  status.textContent = "正在处理照片…";
  try {
    const { photo, error } = await preparePhoto(file);
    if (editor.open && request === photoRequest) {
      if (photo) resetPhoto(photo);
      status.textContent = error ?? "照片将在保存记录时附加到账单。";
    }
  } catch {
    if (editor.open && request === photoRequest) status.textContent = "照片压缩失败，请试试分辨率较低的照片。";
  } finally {
    if (editor.open && request === photoRequest) setPhotoProcessing(false);
  }
}

$("photo-file").addEventListener("change", selectPhoto);

$("remove-photo").addEventListener("click", () => {
  photoRequest += 1;
  resetPhoto("");
  $("photo-status").textContent = "";
  setPhotoProcessing(false);
  $("upload-photo").focus();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("save-entry").disabled) return;
  const amount = entryAmount.cents;
  if (!amount) {
    $("form-error").textContent = "请输入非零金额，最多保留两位小数。";
    entryAmount.open();
    entryAmount.button.focus();
    return;
  }
  const current = load() ?? [];
  if (editingId && !current.some((entry) => entry.id === editingId)) {
    $("form-error").textContent = "这笔记录已被删除。";
    return;
  }
  const entry = {
    id: editingId ?? crypto.randomUUID(),
    type: fields.type.value,
    category: fields.category.value,
    amount,
    date: fields.date.value,
    location: locationLabel(fields.location.value),
    note: fields.note.value.trim(),
  };
  if (entryPoint) entry.locationPoint = entryPoint;
  if (entryPhoto) entry.photo = entryPhoto;
  const next = editingId ? current.map((item) => item.id === editingId ? entry : item) : [entry, ...current];
  if (!save(next)) {
    $("form-error").textContent = entryPhoto
      ? "保存失败，浏览器存储可能已满。可以移除本次照片后重试。"
      : "保存失败，请检查浏览器的存储设置。";
    return;
  }
  month = entry.date.slice(0, 7);
  filter = "all";
  editor.close();
  render();
  announce("已保存记录");
});

$("delete").addEventListener("click", () => {
  if (!editingId || !window.confirm("删除这笔记录？")) return;
  if (!save((load() ?? []).filter((entry) => entry.id !== editingId))) {
    $("form-error").textContent = "删除失败，请检查浏览器的存储设置。";
    return;
  }
  editor.close();
  render();
  $("add").focus();
  announce("已删除记录");
});

function csvCell(value) {
  const text = String(value);
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

$("export").addEventListener("click", () => {
  const entries = monthRecords();
  if (!entries.length) {
    announce("这个月还没有可导出的记录");
    return;
  }
  const rows = entries.map((entry) => [entry.date, entry.type === "income" ? "收入" : "支出",
    entry.category, (entry.amount / 100).toFixed(2), entry.note, entry.location ?? ""]);
  rows.unshift(["日期", "类型", "分类", "金额（元）", "备注", "地点"]);
  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = (records === null ? "示例账单-" : "账单-") + month + ".csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  announce("已导出本月账单");
});

$("add").addEventListener("click", () => openEditor());
$("ledger-search").addEventListener("input", () => renderEntries(monthRecords()));
$("close-editor").addEventListener("click", () => editor.close());
monthButtons.forEach((button) => button.addEventListener("click", () => shiftMonth(Number(button.dataset.monthStep))));
monthInputs.forEach((input) => input.addEventListener("change", () => {
  if (input.value && input.validity.valid) month = input.value;
  render();
}));
form.querySelectorAll('input[name="type"]').forEach((input) => {
  input.addEventListener("change", () => updateCategories());
});
filters.forEach((button) => button.addEventListener("click", () => {
  filter = button.dataset.filter;
  render();
}));
$("clear-demo").addEventListener("click", () => {
  if (!save(load() ?? [])) {
    announce("无法保存，请检查浏览器的存储设置。");
    return;
  }
  render();
  $("add").focus();
});

render();

function enablePageUpdates() {
  const currentVersion = document.querySelector('meta[name="ledger-version"]')?.content;
  if (window.location.protocol !== "https:" || !currentVersion) return;

  const manifestUrl = new URL("./version.json", document.baseURI);
  let pendingVersion;
  let checking = false;

  function applyUpdate() {
    if (!pendingVersion || document.hidden || document.querySelector("dialog[open]")) return;
    const next = new URL(window.location.href);
    if (next.searchParams.get("v") === pendingVersion) return;
    next.searchParams.set("v", pendingVersion);
    window.location.replace(next.href);
  }

  async function checkUpdate() {
    if (document.hidden || checking) return;
    checking = true;
    try {
      const response = await fetch(manifestUrl, { cache: "no-store" });
      if (!response.ok) return;
      const { version } = await response.json();
      if (typeof version !== "string" || !/^[a-f0-9]{16}$/.test(version)) return;
      pendingVersion = version === currentVersion ? null : version;
      applyUpdate();
    } catch {
      // A temporary network failure can be retried on the next check.
    } finally {
      checking = false;
    }
  }

  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("close", applyUpdate));
  document.addEventListener("visibilitychange", () => {
    applyUpdate();
    checkUpdate();
  });
  window.addEventListener("online", checkUpdate);
  window.setInterval(checkUpdate, 5 * 60 * 1000);
  checkUpdate();
}

enablePageUpdates();

function enableOfflineAccess() {
  if (window.location.protocol !== "https:" || !document.querySelector('meta[name="ledger-version"]')) return;
  const status = $("offline-status");
  if (!("serviceWorker" in navigator)) {
    status.textContent = "当前浏览器不支持离线使用。";
    return;
  }
  status.textContent = "正在准备离线页面…";
  const showReady = () => {
    if (navigator.serviceWorker.controller) status.textContent = "已可离线使用。断网时可从此浏览器或已准备好的主屏幕图标打开。";
  };
  navigator.serviceWorker.addEventListener("controllerchange", showReady);
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(showReady).catch(() => {
    if (!navigator.serviceWorker.controller) status.textContent = "离线缓存暂未完成，请联网重新打开。";
  });
}

enableOfflineAccess();

// iOS Safari can ignore the viewport zoom limits.
for (const eventName of ["gesturestart", "gesturechange"]) {
  document.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
}
