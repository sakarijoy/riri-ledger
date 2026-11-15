(() => {
  "use strict";

  const settingsKey = "riri-github-summary-settings-v1";
  const sessionKey = "riri-github-summary-token-v1";
  const loginPattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
  const repositoryPattern = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}$/i;
  const tokenPattern = /^github_pat_[a-zA-Z0-9_]+$/;
  const periodPattern = /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/;
  const emptyTotals = { income: 0, expense: 0 };
  const dialog = $("github-sync-dialog");
  const form = $("github-sync-form");
  const error = $("github-sync-error");

  function storageValue(storage, key) {
    try { return JSON.parse(storage.getItem(key) ?? "null"); }
    catch { return null; }
  }

  function cacheKey(settings) {
    return "riri-github-summary-cache-v1:" + settings.repoId + ":" + settings.login + ":" + settings.partner;
  }

  function loadCache(settings) {
    return (settings && storageValue(localStorage, cacheKey(settings))) ?? { sent: {}, partner: null };
  }

  let settings = storageValue(localStorage, settingsKey);
  let token = settings?.rememberedToken ?? storageValue(sessionStorage, sessionKey);
  let cache = loadCache(settings);
  let running = false;
  let queued = false;
  let setupVersion = 0;

  function connectionStatus(message) {
    $("github-sync-status").textContent = message;
    $("sync-github-now").hidden = !settings || !token;
  }

  function showCachedTotals() {
    githubPartnerTotals = cache.partner;
    if (!$("combined").hidden) render();
  }

  function configureStatus() {
    if (!settings) connectionStatus("尚未连接私有汇总仓库。");
    else if (!token) connectionStatus("请打开连接设置，重新输入令牌以继续同步。");
    else connectionStatus("已连接 " + settings.repository);
  }

  async function request(path, credential, body) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch("https://api.github.com" + path, {
        method: body ? "PUT" : "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + credential,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: abort.signal,
      });
      return { status: response.status, data: response.ok ? await response.json() : null };
    } finally {
      clearTimeout(timeout);
    }
  }

  function repoPath(connection) {
    return "/repos/" + connection.repository;
  }

  function summaryPath(connection, login) {
    return repoPath(connection) + "/contents/riri-summaries/" + login + ".json";
  }

  function isPrivateRepo(info, connection) {
    return info?.private === true && Number.isSafeInteger(info.id) &&
      (connection.repoId === undefined || connection.repoId === info.id);
  }

  function validMonths(months) {
    return months !== null && typeof months === "object" && !Array.isArray(months) &&
      Object.entries(months).every(([period, totals]) => periodPattern.test(period) &&
        validPartnerAmount(totals?.income) && validPartnerAmount(totals?.expense));
  }

  async function readSummary(connection, login, credential) {
    const result = await request(summaryPath(connection, login) + "?ref=" + encodeURIComponent(connection.branch), credential);
    if (result.status === 404) return { months: {}, sha: null };
    if (result.status !== 200 || result.data.encoding !== "base64") {
      throw Error("无法读取 GitHub 汇总，请检查仓库与令牌权限。");
    }
    let summary;
    try { summary = JSON.parse(atob(result.data.content)); }
    catch { throw Error("GitHub 上的汇总文件格式不正确。"); }
    if (summary?.version !== 1 || summary.login !== login || !validMonths(summary.months)) {
      throw Error("GitHub 上的汇总文件格式不正确。");
    }
    return { months: summary.months, sha: result.data.sha };
  }

  function localMonths() {
    const months = {};
    for (const entry of records ?? []) {
      const period = entry.date.slice(0, 7);
      const totals = months[period] ??= { ...emptyTotals };
      totals[entry.type] += entry.amount;
    }
    return months;
  }

  function sameTotals(first, second) {
    return first?.income === second?.income && first?.expense === second?.expense;
  }

  async function publish(connection, credential, changes, stillConnected) {
    const repo = await request(repoPath(connection), credential);
    if (repo.status !== 200 || !isPrivateRepo(repo.data, connection)) {
      throw Error("同步需要原来的私有仓库，请检查仓库和权限。");
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!stillConnected()) return;
      const remote = await readSummary(connection, connection.login, credential);
      if (!stillConnected() || Object.entries(changes).every(([period, totals]) => sameTotals(totals, remote.months[period]))) return;
      const content = btoa(JSON.stringify({
        version: 1, login: connection.login, months: { ...remote.months, ...changes },
      }));
      const result = await request(summaryPath(connection, connection.login), credential, {
        message: "Update monthly totals",
        branch: connection.branch,
        content,
        ...(remote.sha ? { sha: remote.sha } : {}),
      });
      if ([200, 201].includes(result.status)) return;
      if (![409, 422].includes(result.status)) break;
    }
    throw Error("无法发布汇总，请检查令牌的 Contents 读写权限。");
  }

  function persistCache(connection) {
    localStorage.setItem(cacheKey(connection), JSON.stringify(cache));
  }

  async function sync() {
    if (!settings || !token) return;
    if (!navigator.onLine) {
      connectionStatus("当前离线，联网后会继续同步。");
      return;
    }
    if (running) {
      queued = true;
      return;
    }
    running = true;
    const connection = settings;
    const credential = token;
    const stillConnected = () => settings === connection && token === credential;
    connectionStatus("正在同步…");
    try {
      const local = localMonths();
      if (!validMonths(local)) throw Error("本机有月份金额超出同步范围。");
      const periods = new Set([...Object.keys(local), ...Object.keys(cache.sent)]);
      const changes = Object.fromEntries(Array.from(periods)
        .filter((period) => !sameTotals(local[period], cache.sent[period]))
        .map((period) => [period, local[period] ?? emptyTotals]));
      if (records !== null && Object.keys(changes).length) {
        await publish(connection, credential, changes, stillConnected);
        if (!stillConnected()) return;
        cache.sent = local;
        persistCache(connection);
      }
      const partner = await readSummary(connection, connection.partner, credential);
      if (!stillConnected()) return;
      cache.partner = partner.months;
      persistCache(connection);
      showCachedTotals();
      connectionStatus("最近同步 " + new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } catch (failure) {
      if (stillConnected()) {
        connectionStatus(failure instanceof TypeError || failure.name === "AbortError"
          ? "无法连接 GitHub，稍后会重试。"
          : failure.message || "同步失败，请稍后重试。");
      }
    } finally {
      running = false;
      if (queued) {
        queued = false;
        sync();
      }
    }
  }

  $("open-github-sync").addEventListener("click", () => {
    setupVersion += 1;
    form.reset();
    form.elements.repository.value = settings?.repository ?? "";
    form.elements.partner.value = settings?.partner ?? "";
    form.elements.remember.checked = Boolean(settings?.rememberedToken);
    $("disconnect-github-sync").hidden = !settings;
    error.textContent = "";
    dialog.showModal();
  });
  $("close-github-sync").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { form.elements.token.value = ""; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const repository = form.elements.repository.value.trim();
    const partner = form.elements.partner.value.trim().toLowerCase();
    const credential = form.elements.token.value.trim();
    const remember = form.elements.remember.checked;
    if (!repositoryPattern.test(repository) || repository.split("/").some((part) => part === "." || part === "..") ||
      !loginPattern.test(partner) || !tokenPattern.test(credential)) {
      error.textContent = "请填写组织名/仓库名、对方的用户名和自己的细粒度令牌。";
      return;
    }
    const connect = $("connect-github-sync");
    if (connect.disabled) return;
    const version = setupVersion;
    connect.disabled = true;
    error.textContent = "正在验证账号和仓库…";
    try {
      const account = await request("/user", credential);
      const login = account.data?.login?.toLowerCase();
      if (account.status !== 200 || !loginPattern.test(login ?? "")) throw Error("令牌验证失败，请检查是否已过期。");
      if (login === partner) throw Error("请填写对方的 GitHub 用户名。");
      const repo = await request("/repos/" + repository, credential);
      if (repo.status !== 200 || !isPrivateRepo(repo.data, {}) || repo.data.permissions?.push === false) {
        throw Error("请选择有写入权限的私有仓库。");
      }
      const branch = repo.data.default_branch;
      const folder = await request("/repos/" + repository + "/contents?ref=" + encodeURIComponent(branch), credential);
      if (folder.status !== 200) throw Error("请先在仓库创建 README，并确认令牌有 Contents 读写权限。");
      if (!dialog.open || version !== setupVersion) return;
      const next = { repository, repoId: repo.data.id, branch, login, partner };
      if (remember) next.rememberedToken = credential;
      else sessionStorage.setItem(sessionKey, JSON.stringify(credential));
      localStorage.setItem(settingsKey, JSON.stringify(next));
      if (remember) sessionStorage.removeItem(sessionKey);
      settings = next;
      token = credential;
      cache = loadCache(settings);
      showCachedTotals();
      dialog.close();
      sync();
    } catch (failure) {
      if (dialog.open && version === setupVersion) error.textContent = failure instanceof TypeError || failure.name === "AbortError"
        ? "无法连接 GitHub，请检查网络。"
        : failure.message || "连接失败。";
    } finally {
      connect.disabled = false;
    }
  });
  $("disconnect-github-sync").addEventListener("click", () => {
    try {
      localStorage.removeItem(settingsKey);
      sessionStorage.removeItem(sessionKey);
    } catch {
      error.textContent = "无法清除本机连接，请检查浏览器存储。";
      return;
    }
    settings = null;
    token = null;
    cache = loadCache(null);
    showCachedTotals();
    configureStatus();
    dialog.close();
  });
  $("sync-github-now").addEventListener("click", sync);
  document.addEventListener("ledgerchange", sync);
  document.addEventListener("combinedpageopen", sync);
  window.addEventListener("online", sync);
  window.addEventListener("offline", () => {
    if (settings && token) connectionStatus("当前离线，联网后会继续同步。");
  });
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey) sync();
    if (event.key === settingsKey || event.key === null) {
      settings = storageValue(localStorage, settingsKey);
      sessionStorage.removeItem(sessionKey);
      token = settings?.rememberedToken ?? null;
      cache = loadCache(settings);
      showCachedTotals();
      configureStatus();
      sync();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sync();
  });
  setInterval(() => {
    if (!document.hidden) sync();
  }, 60000);

  showCachedTotals();
  configureStatus();
  sync();
})();
