(() => {
  "use strict";

  const key = "riri-monthly-asset-state-v1";
  const legacySnapshotsKey = "riri-monthly-assets-v1";
  const legacyColumnsKey = "riri-monthly-asset-columns-v1";
  const legacyAccounts = [
    ["icbc", "工商银行"],
    ["ccb", "建设银行"],
    ["pingan", "平安银行"],
    ["cmbDebit", "招商银行借记卡"],
    ["cmbCredit", "招商银行信用卡"],
    ["bohai", "渤海银行"],
    ["wechat", "微信钱包"],
    ["alipayCash", "支付宝活期"],
    ["alipayInvestment", "支付宝理财"],
    ["citic", "中信证券"],
  ];
  const assetTypes = {
    bank: "银行账户",
    wallet: "电子钱包",
    investment: "投资理财",
    credit: "信用卡",
    other: "其他",
  };
  const numberFormat = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const signedFormat = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero",
  });
  const dialog = $("asset-editor");
  const assetForm = $("asset-form");
  const dateField = assetForm.elements.date;
  const error = $("asset-form-error");
  const columnsDialog = $("asset-columns-editor");
  const newColumnForm = $("new-asset-column");
  const columnStatus = $("asset-columns-status");
  let editorColumns = [];
  const amountFields = new Map();
  let loadedMonth = "";

  function readAssets() {
    const stored = localStorage.getItem(key);
    if (stored !== null) {
      const state = JSON.parse(stored);
      return { ...state, columns: state.columns.map(withAssetType) };
    }
    const snapshots = JSON.parse(localStorage.getItem(legacySnapshotsKey) ?? "{}");
    const previousColumns = localStorage.getItem(legacyColumnsKey);
    const columns = previousColumns === null
      ? legacyAccounts.filter(([id]) => hasHistory(snapshots, id)).map(([id, name]) => ({ id, name }))
      : JSON.parse(previousColumns).map(({ id, name }) => ({ id, name }));
    return { snapshots, columns: columns.map(withAssetType), dates: {} };
  }

  function inferAssetType(name) {
    if (/信用卡|贷记卡|花呗/.test(name)) return "credit";
    if (/余额宝|零钱通|证券|基金|投资|理财|股票|债券/.test(name)) return "investment";
    if (/银行|借记卡|储蓄|存款/.test(name)) return "bank";
    if (/支付宝|微信|钱包|零钱/.test(name)) return "wallet";
    return "other";
  }

  function withAssetType(column) {
    const type = Object.hasOwn(assetTypes, column.type) ? column.type : inferAssetType(column.name);
    return { ...column, type };
  }

  function groupColumns(columns) {
    return Object.keys(assetTypes)
      .map((type) => [type, columns.filter((column) => column.type === type)])
      .filter(([, members]) => members.length);
  }

  function assetGroup(type, collapsible = false) {
    const section = document.createElement(collapsible ? "details" : "section");
    section.className = "asset-group";
    section.dataset.assetType = type;
    const header = document.createElement(collapsible ? "summary" : "header");
    header.className = "asset-group-heading";
    const title = document.createElement(collapsible ? "span" : "h3");
    title.className = "asset-group-title";
    title.textContent = assetTypes[type];
    header.append(title);
    section.append(header);
    return { section, header };
  }

  function hasHistory(snapshots, id) {
    return Object.values(snapshots).some((snapshot) => Object.hasOwn(snapshot, id));
  }

  function saveAssets(snapshots, columns, dates) {
    localStorage.setItem(key, JSON.stringify({ snapshots, columns, dates }));
  }

  function validMonth(value) {
    return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) && !value.startsWith("0000");
  }

  function monthEnd(value) {
    const [year, number] = value.split("-").map(Number);
    const end = new Date(0);
    end.setUTCFullYear(year, number, 0);
    return value + "-" + end.getUTCDate();
  }

  function validDate(value) {
    const month = value.slice(0, 7);
    return validMonth(month) && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
      && value.slice(-2) !== "00" && value <= monthEnd(month);
  }

  function previousMonth(value) {
    const [year, number] = value.split("-").map(Number);
    return number === 1
      ? String(year - 1).padStart(4, "0") + "-12"
      : value.slice(0, 5) + String(number - 1).padStart(2, "0");
  }

  function total(snapshot) {
    return Object.values(snapshot).reduce((sum, amount) => sum + amount, 0);
  }

  function monthChange(snapshots, month) {
    const previous = snapshots[previousMonth(month)];
    return previous ? total(snapshots[month]) - total(previous) : null;
  }

  function showChange(element, amount) {
    element.textContent = amount === null ? "—" : signedFormat.format(amount / 100);
    element.classList.toggle("asset-positive", amount > 0);
    element.classList.toggle("asset-negative", amount < 0);
  }

  function deleteMonth(month, recordedOn) {
    if (!window.confirm("删除 " + recordedOn + " 的资产记录？该月的账户余额将一并移除。")) return;
    try {
      const { snapshots, columns, dates = {} } = readAssets();
      if (Object.hasOwn(snapshots, month)) {
        delete snapshots[month];
        delete dates[month];
        saveAssets(snapshots, columns, dates);
      }
    } catch {
      announce("删除失败，请检查浏览器存储。");
      return;
    }
    renderAssets();
    $("add-asset-month").focus();
    announce("已删除 " + month + " 的资产记录");
  }

  function monthActions(month, recordedOn) {
    const actions = document.createElement("footer");
    actions.className = "asset-card-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "asset-date";
    edit.textContent = "编辑余额";
    edit.setAttribute("aria-label", "编辑余额，" + recordedOn + " 的资产记录");
    edit.addEventListener("click", () => openAssetEditor(month));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "asset-delete";
    remove.textContent = "删除记录";
    remove.setAttribute("aria-label", "删除记录，" + recordedOn + " 的资产记录");
    remove.addEventListener("click", () => deleteMonth(month, recordedOn));
    actions.append(edit, remove);
    return actions;
  }

  function monthCard(month, recordedOn, groups, snapshot, change, state) {
    const card = document.createElement("details");
    card.className = "asset-card";
    card.dataset.month = month;
    card.open = state.open;
    const heading = document.createElement("summary");
    const period = document.createElement("span");
    period.className = "asset-period";
    const [year, number] = month.split("-");
    const title = document.createElement("strong");
    title.textContent = year + " 年 " + Number(number) + " 月";
    const date = document.createElement("time");
    date.dateTime = recordedOn;
    date.textContent = recordedOn + " 记录";
    period.append(title, date);
    const metric = document.createElement("span");
    metric.className = "asset-month-metric";
    const amount = document.createElement("strong");
    amount.textContent = money(total(snapshot));
    const delta = document.createElement("span");
    delta.className = "asset-month-delta";
    const value = document.createElement("span");
    showChange(value, change);
    delta.append("较上月 ", value);
    metric.append(amount, delta);
    heading.append(period, metric);

    const body = document.createElement("div");
    body.className = "asset-card-body";
    for (const [type, columns] of groups) {
      const { section, header } = assetGroup(type, true);
      section.open = !state.collapsedTypes?.has(type);
      const subtotal = document.createElement("strong");
      const balances = columns.map(({ id }) => snapshot[id]).filter((balance) => balance != null);
      subtotal.textContent = balances.length ? money(balances.reduce((sum, balance) => sum + balance, 0)) : "—";
      header.append(subtotal);
      const list = document.createElement("dl");
      for (const { id, name } of columns) {
        const row = document.createElement("div");
        row.className = "asset-account-row";
        const label = document.createElement("dt");
        const balance = document.createElement("dd");
        label.textContent = name;
        balance.textContent = snapshot[id] == null ? "—" : numberFormat.format(snapshot[id] / 100);
        row.append(label, balance);
        list.append(row);
      }
      section.append(list);
      body.append(section);
    }
    card.append(heading, body, monthActions(month, recordedOn));
    return card;
  }

  function renderAssets() {
    let snapshots;
    let columns;
    let dates;
    try {
      ({ snapshots, columns, dates = {} } = readAssets());
    } catch {
      announce("无法读取月度资产记录，请检查浏览器存储。");
      return;
    }

    const months = Object.keys(snapshots).filter(validMonth).sort().reverse();
    const latest = months[0];
    const change = latest ? monthChange(snapshots, latest) : null;
    $("latest-asset-total").textContent = latest ? money(total(snapshots[latest])) : "—";
    $("latest-asset-month").textContent = latest ? dates[latest] ?? monthEnd(latest) : "暂无记录";
    showChange($("latest-asset-change"), change);
    $("asset-comparison").textContent = change === null
      ? "保存相邻两个月后计算差值"
      : "对比 " + (dates[previousMonth(latest)] ?? monthEnd(previousMonth(latest)));

    $("no-assets").hidden = !!months.length;
    $("no-assets").querySelector("p").textContent = columns.length
      ? "还没有资产记录"
      : "先在「管理列目」中添加要统计的资产";
    const cards = $("asset-cards");
    const previousStates = new Map(Array.from(cards.children, (card) => [card.dataset.month, {
      open: card.open,
      collapsedTypes: new Set(Array.from(card.querySelectorAll(".asset-group:not([open])"),
        (group) => group.dataset.assetType)),
    }]));
    const groups = groupColumns(columns);
    cards.replaceChildren();
    for (const month of months) {
      const recordedOn = dates[month] ?? monthEnd(month);
      cards.append(monthCard(month, recordedOn, groups, snapshots[month],
        monthChange(snapshots, month), previousStates.get(month) ?? { open: month === latest }));
    }
  }

  function loadMonthFields() {
    const fields = $("asset-fields");
    if (fields.contains(amountKeypad)) closeAmountKeypad();
    fields.replaceChildren();
    amountFields.clear();
    editorColumns = [];
    try {
      const { snapshots, columns, dates = {} } = readAssets();
      loadedMonth = dateField.value.slice(0, 7);
      const snapshot = snapshots[loadedMonth] ?? {};
      $("asset-date-note").textContent = snapshots[loadedMonth]
        ? "该月已有 " + (dates[loadedMonth] ?? monthEnd(loadedMonth)) + " 的记录，保存后将更新该月数据。"
        : "填写这一天各账户的余额。每月保留一条记录。";
      editorColumns = columns;
      for (const [type, members] of groupColumns(editorColumns)) {
        const { section } = assetGroup(type);
        const inputs = document.createElement("div");
        inputs.className = "asset-group-inputs field-grid";
        for (const { id, name } of members) {
          const container = document.createElement("div");
          const amount = createAmountField(container, name, 12, "选填");
          amount.reset(snapshot[id]);
          amountFields.set(id, amount);
          inputs.append(container);
        }
        section.append(inputs);
        fields.append(section);
      }
      error.textContent = editorColumns.length ? "" : "请先在「管理列目」中新增资产列目。";
    } catch {
      error.textContent = "无法读取这个月的余额，请检查浏览器存储。";
    }
  }

  function openAssetEditor(existingMonth) {
    try {
      const { columns, dates = {} } = readAssets();
      if (!columns.length) {
        openColumnEditor();
        return;
      }
      dateField.value = existingMonth ? dates[existingMonth] ?? monthEnd(existingMonth) : today;
      syncDateDisplay(dateField);
    } catch {
      announce("无法读取月度资产记录，请检查浏览器存储。");
      return;
    }
    dateField.min = existingMonth ? existingMonth + "-01" : "0001-01-01";
    dateField.max = existingMonth ? monthEnd(existingMonth) : "9999-12-31";
    $("asset-editor-title").textContent = existingMonth ? "编辑资产记录" : "记录资产";
    loadMonthFields();
    dialog.showModal();
    dateField.focus();
  }

  function openColumnEditor() {
    newColumnForm.reset();
    columnStatus.textContent = "";
    renderColumnEditor();
    columnsDialog.showModal();
    newColumnForm.elements.columnType.focus();
  }

  function assetTypeField(selectedType = "") {
    const label = document.createElement("label");
    label.className = "field";
    label.textContent = "资产类型";
    const select = document.createElement("select");
    select.name = "columnType";
    select.required = true;
    if (!selectedType) {
      const placeholder = new Option("选择类型", "", true, true);
      placeholder.disabled = true;
      select.add(placeholder);
    }
    for (const [type, name] of Object.entries(assetTypes)) {
      const selected = type === selectedType;
      select.add(new Option(name, type, selected, selected));
    }
    label.append(select);
    return label;
  }

  function renderColumnEditor() {
    const list = $("asset-column-list");
    list.replaceChildren();
    let columns;
    try {
      ({ columns } = readAssets());
    } catch {
      columnStatus.textContent = "无法读取列目，请检查浏览器存储。";
      return;
    }
    if (!columns.length) {
      const empty = document.createElement("p");
      empty.textContent = "还没有资产列目。";
      list.append(empty);
    }
    for (const column of columns) {
      const row = document.createElement("form");
      row.className = "asset-column-form";
      row.autocomplete = "off";
      row.dataset.assetType = column.type;
      const typeField = assetTypeField(column.type);
      const label = document.createElement("label");
      label.className = "field";
      label.textContent = "账户名称";
      const input = document.createElement("textarea");
      input.rows = 1;
      input.autocomplete = "off";
      input.value = column.name;
      input.maxLength = 30;
      input.required = true;
      label.append(input);
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "secondary";
      save.textContent = "保存";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "删除";
      remove.setAttribute("aria-label", "删除列目" + column.name);
      const actions = document.createElement("div");
      actions.className = "asset-column-actions";
      actions.append(save, remove);
      row.append(typeField, label, actions);
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        if (updateColumn(column.id, input.value, row.elements.columnType.value)) {
          list.querySelectorAll("form")[columns.indexOf(column)].querySelector("select").focus();
        }
      });
      remove.addEventListener("click", () => {
        if (updateColumn(column.id)) newColumnForm.elements.columnName.focus();
      });
      list.append(row);
    }
  }

  function updateColumn(id, name, type) {
    if (name !== undefined) name = name.replace(/\s*\n\s*/g, " ").trim();
    let message;
    try {
      const { snapshots, columns, dates = {} } = readAssets();
      const column = columns.find((item) => item.id === id);
      if (id && !column) {
        renderColumnEditor();
        columnStatus.textContent = "此列目已被移除。";
        return;
      }
      if (name !== undefined) {
        if (!Object.hasOwn(assetTypes, type)) {
          columnStatus.textContent = "请选择资产类型。";
          return;
        }
        if (!name || name.length > 30) {
          columnStatus.textContent = "请输入 1 至 30 个字符的列目名称。";
          return;
        }
        const reserved = ["月末日期", "记录日期", "合计", "差值"];
        if (reserved.includes(name) || columns.some((item) => item.id !== id && item.name === name)) {
          columnStatus.textContent = "这个名称已被使用，请换一个名称。";
          return;
        }
        if (column) Object.assign(column, { name, type });
        else columns.push({ id: "asset-" + crypto.randomUUID(), name, type });
        message = column ? "已保存列目。" : "已新增列目。";
      } else {
        if (hasHistory(snapshots, id) && !window.confirm(
          "删除「" + column.name + "」及其所有月份的余额？只有此列余额的月份也会删除。此操作无法撤销。"
        )) return;
        for (const [month, snapshot] of Object.entries(snapshots)) {
          if (!Object.hasOwn(snapshot, id)) continue;
          delete snapshot[id];
          if (!Object.keys(snapshot).length) {
            delete snapshots[month];
            delete dates[month];
          }
        }
        columns.splice(columns.indexOf(column), 1);
        message = "已删除列目。";
      }
      saveAssets(snapshots, columns, dates);
    } catch {
      columnStatus.textContent = "无法保存列目，请检查浏览器存储。";
      return;
    }
    renderColumnEditor();
    renderAssets();
    columnStatus.textContent = message;
    return true;
  }

  newColumnForm.prepend(assetTypeField());
  newColumnForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const { columnName, columnType } = newColumnForm.elements;
    if (updateColumn(null, columnName.value, columnType.value)) {
      newColumnForm.reset();
      columnType.focus();
    }
  });
  $("manage-asset-columns").addEventListener("click", openColumnEditor);
  $("close-asset-columns").addEventListener("click", () => columnsDialog.close());

  assetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const recordedOn = dateField.value;
    const month = recordedOn.slice(0, 7);
    if (!validDate(recordedOn) || !dateField.validity.valid) {
      error.textContent = "请选择有效的记录日期。";
      dateField.focus();
      return;
    }
    if (month !== loadedMonth) {
      loadMonthFields();
      error.textContent = "已切换月份，请核对该月余额后保存。";
      return;
    }
    const snapshot = {};
    for (const { id } of editorColumns) {
      const cents = amountFields.get(id).cents;
      if (cents !== null) snapshot[id] = cents;
    }
    if (!Object.keys(snapshot).length) {
      error.textContent = "请至少填写一个账户的余额。余额为零时可填写 0。";
      return;
    }
    try {
      const { snapshots, columns, dates = {} } = readAssets();
      const previous = snapshots[month] ?? {};
      if (editorColumns.some(({ id }) => !columns.some((column) => column.id === id))) {
        error.textContent = "列目已在其他页面调整，请重新打开余额表单。";
        return;
      }
      for (const [id, amount] of Object.entries(previous)) {
        if (!editorColumns.some((column) => column.id === id)) snapshot[id] = amount;
      }
      if (Object.values(snapshot).reduce((sum, amount) => sum + Math.abs(amount), 0) > Number.MAX_SAFE_INTEGER / 2) {
        error.textContent = "余额金额过大，无法准确计算合计。";
        return;
      }
      snapshots[month] = snapshot;
      dates[month] = recordedOn;
      saveAssets(snapshots, columns, dates);
    } catch {
      error.textContent = "保存失败，请检查浏览器存储。";
      return;
    }
    dialog.close();
    renderAssets();
    $("add-asset-month").focus();
    announce("已保存资产记录");
  });

  $("add-asset-month").addEventListener("click", () => openAssetEditor());
  $("close-asset-editor").addEventListener("click", () => dialog.close());
  dateField.addEventListener("change", () => {
    if (validDate(dateField.value) && dateField.value.slice(0, 7) !== loadedMonth) loadMonthFields();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== legacySnapshotsKey && event.key !== legacyColumnsKey && event.key !== null) return;
    if (!$("assets").hidden) renderAssets();
    if (columnsDialog.open) renderColumnEditor();
  });
  function route() {
    const pages = ["overview", "assets", "combined"];
    const hash = window.location.hash.slice(1);
    const page = pages.includes(hash) && (hash !== "combined" || combinedAccess) ? hash : "overview";
    $("nav-combined").hidden = !combinedAccess;
    $("export").hidden = page !== "overview";
    for (const id of pages) {
      const active = id === page;
      $(id).hidden = !active;
      const link = $("nav-" + id);
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (page === "assets") renderAssets();
    if (page === "combined") {
      render();
      document.dispatchEvent(new Event("combinedpageopen"));
    }
  }
  window.addEventListener("hashchange", route);
  document.addEventListener("combinedaccesschange", route);
  route();

  const backupDialog = $("backup-dialog");
  const backupStatus = $("backup-status");
  const restoreButton = $("restore-backup");
  let pendingBackup = null;
  let backupSelection = 0;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validBackup(backup) {
    if (backup?.format !== "riri-ledger" || backup.version !== 1 ||
      !Array.isArray(backup.records) || !Array.isArray(backup.hiddenPresets)) return false;
    if (backup.budgets !== undefined && (!isObject(backup.budgets) ||
      !Object.entries(backup.budgets).every(([period, plan]) => {
        const monthly = validMonth(period);
        if (typeof plan === "number") return monthly && Number.isSafeInteger(plan) && plan > 0 && plan <= 999999999999;
        return (monthly || (/^\d{4}$/.test(period) && period !== "0000")) &&
          isObject(plan) && Object.entries(plan).every(([category, amount]) =>
            Object.hasOwn(categories.expense, category) && Number.isSafeInteger(amount) &&
            Math.abs(amount) <= 99999999999);
      }))) return false;
    if (backup.budgetNames !== undefined && (!isObject(backup.budgetNames) ||
      !Object.entries(backup.budgetNames).every(([category, name]) =>
        Object.hasOwn(categories.expense, category) && typeof name === "string" && name.trim() && name.length <= 24))) return false;
    if (backup.partnerTotals !== undefined && (!isObject(backup.partnerTotals) ||
      !Object.entries(backup.partnerTotals).every(([period, totals]) =>
        validMonth(period) && isObject(totals) && [totals.income, totals.expense].every(validPartnerAmount)))) return false;
    const entryIds = new Set();
    for (const entry of backup.records) {
      if (!isObject(entry) || typeof entry.id !== "string" || !entry.id || entryIds.has(entry.id) ||
        !Object.hasOwn(categories, entry.type) || !Object.hasOwn(categories[entry.type], entry.category) ||
        typeof entry.date !== "string" || !validDate(entry.date) ||
        !Number.isSafeInteger(entry.amount) || entry.amount === 0 || Math.abs(entry.amount) > 99999999999 ||
        typeof entry.note !== "string" || (entry.location !== undefined && typeof entry.location !== "string") ||
        (entry.photo !== undefined && (typeof entry.photo !== "string" || entry.photo.length > 160000 ||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(entry.photo)))) return false;
      if (entry.locationPoint !== undefined) {
        const point = entry.locationPoint;
        if (!isObject(point) || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 ||
          !Number.isFinite(point.lng) || Math.abs(point.lng) > 180) return false;
      }
      entryIds.add(entry.id);
    }
    if (!isObject(backup.assets)) return false;
    const { columns, snapshots, dates = {} } = backup.assets;
    if (!Array.isArray(columns) || !isObject(snapshots) || !isObject(dates) ||
      !backup.hiddenPresets.every((name) => typeof name === "string")) return false;
    const ids = new Set();
    for (const column of columns) {
      if (!isObject(column) || typeof column.id !== "string" || !/^[a-z][a-z0-9-]*$/i.test(column.id) ||
        ids.has(column.id) || typeof column.name !== "string" || !column.name.trim() ||
        (column.type !== undefined && !Object.hasOwn(assetTypes, column.type))) return false;
      ids.add(column.id);
    }
    for (const [month, snapshot] of Object.entries(snapshots)) {
      if (!validMonth(month) || !isObject(snapshot) || !Object.entries(snapshot).every(([id, value]) =>
        ids.has(id) && Number.isSafeInteger(value)) ||
        Object.values(snapshot).reduce((sum, value) => sum + Math.abs(value), 0) > Number.MAX_SAFE_INTEGER / 2) return false;
    }
    return Object.entries(dates).every(([month, date]) => Object.hasOwn(snapshots, month) &&
      typeof date === "string" && validDate(date) && date.startsWith(month + "-"));
  }

  $("open-backup").addEventListener("click", () => {
    backupSelection += 1;
    pendingBackup = null;
    restoreButton.hidden = true;
    backupStatus.textContent = "";
    backupDialog.showModal();
  });
  $("close-backup").addEventListener("click", () => backupDialog.close());

  $("download-backup").addEventListener("click", () => {
    try {
      const backup = {
        format: "riri-ledger",
        version: 1,
        records: JSON.parse(localStorage.getItem(storageKey) ?? "[]"),
        assets: readAssets(),
        budgets: readBudgets(),
        budgetNames: readBudgetNames(),
        partnerTotals: readPartnerTotals(),
        hiddenPresets: [], // Required by earlier versions of the backup importer.
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
      const download = document.createElement("a");
      download.href = url;
      download.download = "日日记账备份-" + today + ".json";
      download.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      backupStatus.textContent = "已下载备份。";
    } catch {
      backupStatus.textContent = "无法生成备份，请检查浏览器存储。";
    }
  });

  $("choose-backup").addEventListener("click", () => $("backup-file").click());
  $("backup-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    pendingBackup = null;
    restoreButton.hidden = true;
    const selection = ++backupSelection;
    backupStatus.textContent = "正在检查备份文件…";
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("Backup too large");
      const backup = JSON.parse(await file.text());
      if (!backupDialog.open || selection !== backupSelection) return;
      if (!validBackup(backup)) throw new Error("Invalid backup");
      pendingBackup = backup;
      const { records: entries, assets, budgets } = backup;
      backupStatus.textContent = `备份中有 ${entries.length} 笔账单、${entries.filter((entry) => entry.photo).length} 张照片、${Object.keys(assets.snapshots).length} 个月的资产记录。`
        + (budgets ? `另有 ${Object.keys(budgets).filter((month) => validMonth(month) && monthlyBudget(month, budgets) !== null).length} 个月的支出额度。` : "");
      restoreButton.hidden = false;
    } catch {
      if (backupDialog.open && selection === backupSelection) backupStatus.textContent = "无法读取备份，请选择 20 MB 以内的日日记账备份文件。";
    }
  });

  restoreButton.addEventListener("click", () => {
    if (!pendingBackup) return;
    const dataTypes = ["账单", "月度资产"];
    if (pendingBackup.budgets) dataTypes.push("支出额度");
    if (pendingBackup.partnerTotals) dataTypes.push("对方收支汇总");
    if (!window.confirm("恢复会替换当前浏览器里的" + dataTypes.join("、") + "。确定继续？")) return;
    const changes = [
      [storageKey, pendingBackup.records],
      [key, pendingBackup.assets],
    ];
    if (pendingBackup.budgets) changes.push([budgetKey, pendingBackup.budgets]);
    if (pendingBackup.budgetNames) changes.push([budgetNamesKey, pendingBackup.budgetNames]);
    if (pendingBackup.partnerTotals) changes.push([partnerTotalsKey, pendingBackup.partnerTotals]);
    const previous = [];
    try {
      for (const [target] of changes) previous.push([target, localStorage.getItem(target)]);
      for (const [target] of changes) localStorage.removeItem(target);
      for (const [target, value] of changes) localStorage.setItem(target, JSON.stringify(value));
    } catch {
      if (previous.length === changes.length) {
        try {
          for (const [target] of previous) localStorage.removeItem(target);
          for (const [target, value] of previous) if (value !== null) localStorage.setItem(target, value);
        } catch {
          backupStatus.textContent = "浏览器存储出错，请保留备份文件。";
          return;
        }
      }
      backupStatus.textContent = "恢复失败，请检查浏览器存储空间。";
      return;
    }
    records = pendingBackup.records;
    pendingBackup = null;
    restoreButton.hidden = true;
    $("ledger-search").value = "";
    filter = "all";
    render();
    route();
    document.dispatchEvent(new Event("ledgerchange"));
    backupDialog.close();
    announce("已恢复账本");
  });
})();
