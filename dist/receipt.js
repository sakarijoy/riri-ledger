(() => {
  "use strict";

  const progress = $("receipt-progress");
  const status = $("receipt-status");
  const review = $("receipt-review");
  const amount = $("receipt-amount");
  const date = $("receipt-date");
  const merchant = $("receipt-merchant");
  const type = $("receipt-type");
  const category = $("receipt-category");
  const recognize = $("recognize-photo");
  const error = $("receipt-error");
  const resourceRoot = new URL("./ocr/v6/", location.protocol === "file:"
    ? "https://sakarijoy.github.io/riri-ledger/" : document.baseURI);
  let library;
  let active = null;
  let reviewRequest = null;

  function loadLibrary() {
    if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
    if (library) return library;
    library = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => fail(), 30000);
      function fail() {
        clearTimeout(timeout);
        script.remove();
        library = null;
        reject(new Error("识别资源未下载完成，请联网后重试。"));
      }
      script.src = new URL("tesseract.min.js", resourceRoot).href;
      script.onload = () => {
        clearTimeout(timeout);
        if (globalThis.Tesseract) resolve(globalThis.Tesseract);
        else fail();
      };
      script.onerror = fail;
      document.head.append(script);
    });
    return library;
  }

  function cancel(clear = false) {
    if (active) {
      active.cancelled = true;
      clearTimeout(active.timeout);
      active.abort?.();
      if (active.worker) active.worker.terminate().catch(() => {});
      active = null;
    }
    progress.hidden = true;
    recognize.disabled = $("save-entry").disabled;
    if (clear) {
      review.hidden = true;
      reviewRequest = null;
      $("receipt-raw").textContent = "";
    }
  }

  function validDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match || match[1] === "0000") return false;
    const day = new Date(0);
    day.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return day.getUTCFullYear() === Number(match[1]) &&
      day.getUTCMonth() === Number(match[2]) - 1 && day.getUTCDate() === Number(match[3]);
  }

  function parseReceipt(text) {
    const lines = text.normalize("NFKC").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const candidates = new Map();
    let parsedDate = "";
    let parsedMerchant = "";
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const compact = line.replace(/\s/g, "");
      const dateMatch = /(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/.exec(compact);
      if (!parsedDate && dateMatch) {
        const value = dateMatch[1] + "-" + dateMatch[2].padStart(2, "0") + "-" + dateMatch[3].padStart(2, "0");
        if (validDate(value)) parsedDate = value;
      }
      if (!parsedMerchant && /^(?:商户名称|商家名称|收款商户|收款方|商户|收款人)[:：]/.test(compact)) {
        parsedMerchant = compact.replace(/^(?:商户名称|商家名称|收款商户|收款方|商户|收款人)[:：]/, "");
      }
      const keyword = /实付|实收|实付款|支付金额|付款金额|交易金额|合计|总计|价税合计|金额/.test(compact);
      const monetary = /[¥￥]|RMB|CNY|人民币|元/.test(line);
      const priorKeyword = index > 0 && /实付|支付金额|交易金额|合计|总计/.test(lines[index - 1].replace(/\s/g, ""));
      if (/订单号|交易单号|商户单号|银行卡号|电话|手机|余额|优惠|折扣|税率|找零/.test(compact) && !/实付|支付金额/.test(compact)) continue;
      const matches = line.matchAll(/[-−]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g);
      for (const match of matches) {
        const number = match[0].replace(/[\s,]/g, "").replace("−", "-");
        if (!keyword && !monetary && !priorKeyword && !number.includes(".")) continue;
        if (/\d{3,}/.test(number.split(".")[0]) && !number.includes(".") && !monetary && !keyword) continue;
        if (dateMatch && !keyword && !monetary) continue;
        const [whole, decimals = ""] = number.replace("-", "").split(".");
        const cents = (Number(whole) * 100 + Number(decimals.padEnd(2, "0"))) * (number.startsWith("-") ? -1 : 1);
        if (!Number.isSafeInteger(cents) || cents === 0 || Math.abs(cents) > 99999999999) continue;
        const score = (/实付|实收|付款金额|支付金额/.test(compact) ? 5 : keyword ? 3 : priorKeyword ? 2 : 0) + (monetary ? 2 : 0);
        if (!candidates.has(cents) || candidates.get(cents).score < score) {
          candidates.set(cents, { cents, score, label: line.slice(0, 40) });
        }
      }
    }
    if (!parsedMerchant) {
      parsedMerchant = lines.slice(0, 5).find(line =>
        /餐厅|餐饮|饭店|咖啡|商店|超市|便利店|酒店|书店|药房|有限公司/.test(line) &&
        !/金额|地址|时间|日期|订单/.test(line.replace(/\s/g, ""))) ?? "";
    }
    const normalized = lines.join("").replace(/\s/g, "");
    const parsedType = /收款成功|收入金额|转入金额|到账金额/.test(normalized) ? "income" : /支付成功|付款成功|实付|消费/.test(normalized) ? "expense" : "";
    let parsedCategory = "";
    if (parsedType !== "income") {
      if (/餐厅|餐饮|饭店|咖啡|奶茶|午餐|早餐|晚餐/.test(normalized)) parsedCategory = "餐饮";
      else if (/打车|出租车|地铁|公交|车票|停车费/.test(normalized)) parsedCategory = "交通";
      else if (/超市|便利店|购物|商场/.test(normalized)) parsedCategory = "购物";
      else if (/房租|水费|电费|物业费/.test(normalized)) parsedCategory = "居住";
    }
    return { candidates: Array.from(candidates.values()).sort((a, b) => b.score - a.score).slice(0, 20),
      date: parsedDate, merchant: parsedMerchant.slice(0, 100), type: parsedType, category: parsedCategory };
  }

  function refreshCategories(selected = "") {
    const selectedType = type.value || fields.type.value;
    category.replaceChildren(new Option("保留当前分类", ""));
    for (const name of Object.keys(categories[selectedType])) {
      category.add(new Option(name, name, false, name === selected));
    }
  }

  function displayResult(text, request) {
    const result = parseReceipt(text);
    amount.replaceChildren(new Option("保留当前金额", ""));
    for (const candidate of result.candidates) {
      amount.add(new Option(money(candidate.cents) + " · " + candidate.label, String(candidate.cents)));
    }
    if (result.candidates.length) amount.value = String(result.candidates[0].cents);
    date.value = result.date;
    syncDateDisplay(date);
    merchant.value = result.merchant;
    type.value = result.type;
    refreshCategories(result.category);
    $("receipt-raw").textContent = text.slice(0, 15000);
    error.textContent = result.candidates.length ? "" : "未找到可用金额，请核对识别原文并手动填写。";
    reviewRequest = request;
    review.hidden = false;
    $("receipt-review-title").scrollIntoView({ block: "nearest" });
  }

  async function receiptImage() {
    const source = typeof photoRecognitionSource === "string"
      ? await loadPhoto(photoRecognitionSource) : photoRecognitionSource;
    const sourceWidth = source.naturalWidth || source.width;
    const sourceHeight = source.naturalHeight || source.height;
    const scale = Math.min(1, 2400 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = photoTurns % 2 ? height : width;
    canvas.height = photoTurns % 2 ? width : height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(photoTurns * Math.PI / 2);
    context.drawImage(source, -width / 2, -height / 2, width, height);
    return canvas;
  }

  recognize.addEventListener("click", async () => {
    if (!entryPhoto || active || $("save-entry").disabled) return;
    cancel(true);
    const job = { request: photoRequest, cancelled: false, worker: null };
    const interrupted = new Promise((resolve, reject) => {
      job.abort = () => reject(new Error("cancelled"));
    });
    interrupted.catch(() => {});
    active = job;
    const current = () => active === job && !job.cancelled && editor.open && photoRequest === job.request;
    progress.hidden = false;
    recognize.disabled = true;
    status.textContent = "正在加载本地识别资源，首次使用请保持联网…";
    job.timeout = setTimeout(() => {
      if (!current()) return;
      cancel();
      progress.hidden = false;
      status.textContent = "识别超时，请检查网络或裁剪照片后重试。";
      $("cancel-receipt").hidden = true;
    }, 120000);
    $("cancel-receipt").hidden = false;
    try {
      const engine = await loadLibrary();
      if (!current()) return;
      const image = await receiptImage();
      if (!current()) return;
      const workerReady = engine.createWorker(["chi_sim", "eng"], 1, {
        workerPath: new URL("worker.min.js", resourceRoot).href,
        corePath: resourceRoot.href,
        langPath: resourceRoot.href.replace(/\/$/, ""),
        errorHandler: () => job.abort(),
        logger: (message) => {
          if (!current()) return;
          status.textContent = message.status === "recognizing text"
            ? "正在识别 " + Math.round(message.progress * 100) + "%"
            : "正在准备识别资源，首次使用可能需要稍等…";
        },
      }).then((worker) => {
        if (!current()) {
          worker.terminate().catch(() => {});
          throw new Error("cancelled");
        }
        return worker;
      });
      job.worker = await Promise.race([workerReady, interrupted]);
      if (!current()) return;
      await job.worker.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
      const result = await job.worker.recognize(image);
      if (!current()) return;
      if (!result.data.text.trim()) {
        status.textContent = "未识别到文字，请调整方向，或裁剪到清晰的账单区域后重试。";
        $("cancel-receipt").hidden = true;
      } else {
        progress.hidden = true;
        displayResult(result.data.text, job.request);
      }
    } catch {
      if (current()) {
        status.textContent = "无法完成识别，请联网重试，或换一张清晰的账单照片。";
        $("cancel-receipt").hidden = true;
      }
    } finally {
      clearTimeout(job.timeout);
      if (job.worker) await job.worker.terminate().catch(() => {});
      if (active === job) {
        active = null;
        recognize.disabled = $("save-entry").disabled;
      }
    }
  });

  $("apply-receipt").addEventListener("click", () => {
    if (reviewRequest !== photoRequest || !editor.open) return cancel(true);
    if (date.value && !validDate(date.value)) {
      error.textContent = "请填写有效日期。";
      return;
    }
    const changing = (amount.value && entryAmount.cents !== null) ||
      (date.value && date.value !== fields.date.value) || (merchant.value.trim() && fields.note.value.trim());
    if (changing && !window.confirm("将核对后的识别结果填入当前账单？已有的对应内容将被替换。")) return;
    if (amount.value) entryAmount.reset(Number(amount.value));
    if (date.value) {
      fields.date.value = date.value;
      syncDateDisplay(fields.date);
    }
    if (merchant.value.trim()) fields.note.value = merchant.value.trim();
    if (type.value && type.value !== fields.type.value) {
      fields.type.value = type.value;
      updateCategories();
    }
    if (category.value && Object.hasOwn(categories[fields.type.value], category.value)) fields.category.value = category.value;
    cancel(true);
    $("photo-status").textContent = "识别结果已填入，请核对后保存记录。";
    entryAmount.button.focus();
  });
  type.addEventListener("change", () => refreshCategories());
  $("cancel-receipt").addEventListener("click", () => cancel(true));
  $("dismiss-receipt").addEventListener("click", () => cancel(true));
  document.addEventListener("photochange", () => cancel(true));
  editor.addEventListener("close", () => {
    cancel(true);
    photoRecognitionSource = "";
  });
})();
