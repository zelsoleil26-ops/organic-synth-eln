(function () {
  "use strict";

  // =========================================================================
  // 1. 純粋計算・フォーマットロジック（単体テスト可能）
  // =========================================================================

  function parsePositiveNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
  }

  function format2(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    return value.toFixed(2);
  }

  /**
   * 試薬1行の計算
   * - mmol = Scale * eq
   * - 固体: amount = mmol * MW [mg]
   * - 液体: amount = (mmol * MW) / (density * 1000) [mL]
   */
  function calculateRow(scaleVal, row) {
    const scaleNum = parsePositiveNumber(scaleVal);
    const eqNum = parsePositiveNumber(row.eq);
    const mwNum = parsePositiveNumber(row.mw);
    const densityNum = parsePositiveNumber(row.density);

    if (scaleNum === null || eqNum === null) {
      return {
        mmol: null,
        amount: null,
        unit: row.state === "liquid" ? "mL" : "mg",
      };
    }

    const mmol = scaleNum * eqNum;

    if (row.state === "liquid") {
      if (mwNum === null || densityNum === null) {
        return { mmol, amount: null, unit: "mL" };
      }
      const volumeMl = (mmol * mwNum) / (densityNum * 1000);
      return {
        mmol,
        amount: Number.isFinite(volumeMl) ? volumeMl : null,
        unit: "mL",
      };
    }

    // solid
    if (mwNum === null) {
      return { mmol, amount: null, unit: "mg" };
    }
    const massMg = mmol * mwNum;
    return {
      mmol,
      amount: Number.isFinite(massMg) ? massMg : null,
      unit: "mg",
    };
  }

  function format1(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    return value.toFixed(1);
  }

  /**
   * 結果1行の計算
   * - mg: mmol = 収量(mg) / MW
   * - mL: mmol = (収量(mL) * 密度(g/mL) * 1000) / MW
   * - 収率(%): (mmol / Scale) * 100
   */
  function calculateResultRow(scaleVal, row) {
    const scaleNum = parsePositiveNumber(scaleVal);
    const amountNum = parsePositiveNumber(row.amount);
    const mwNum = parsePositiveNumber(row.mw);
    const unit = row.unit === "mL" ? "mL" : "mg";
    const densityNum = parsePositiveNumber(row.density);

    if (amountNum === null || mwNum === null) {
      return { mmol: null, yieldPct: null };
    }

    let massMg = null;
    if (unit === "mL") {
      if (densityNum === null) {
        return { mmol: null, yieldPct: null };
      }
      massMg = amountNum * densityNum * 1000;
    } else {
      massMg = amountNum;
    }

    const mmol = massMg / mwNum;
    if (!Number.isFinite(mmol)) {
      return { mmol: null, yieldPct: null };
    }

    const yieldPct = scaleNum !== null ? (mmol / scaleNum) * 100 : null;
    return {
      mmol,
      yieldPct: Number.isFinite(yieldPct) ? yieldPct : null,
    };
  }

  function sanitizeMarkdownCell(text) {
    return String(text ?? "")
      .replace(/\|/g, "\\|")
      .replace(/[\r\n]+/g, " ")
      .trim();
  }

  function sanitizeTsvCell(text) {
    return String(text ?? "")
      .replace(/[\t\r\n]+/g, " ")
      .trim();
  }

  /**
   * Notion用 Markdown 出力
   */
  function buildNotionMarkdown(page) {
    const title = (page.title || "無題の実験").trim();
    const scaleNum = parsePositiveNumber(page.scale);
    const scaleText = scaleNum !== null ? `${page.scale} mmol` : "-";

    const lines = [];
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`- **Scale:** ${scaleText}`);
    lines.push("");
    lines.push("### 試薬");
    lines.push("| 試薬 | 状態 | eq | mmol | 分子量 (MW) | 密度 (g/mL) | 必要量 |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: |");

    const activeReagents = (page.reagents || []).filter(
      (r) =>
        (r.name && r.name.trim() !== "") ||
        r.eq !== "" ||
        r.mw !== "" ||
        r.density !== "" ||
        Boolean(r.imageDataUrl) ||
        (Array.isArray(r.structures) && r.structures.length > 0)
    );

    if (activeReagents.length === 0) {
      lines.push("| - | - | - | - | - | - | - |");
    } else {
      activeReagents.forEach((r) => {
        const calc = calculateRow(page.scale, r);
        const hasImages =
          (Array.isArray(r.structures) && r.structures.length > 0) || Boolean(r.imageDataUrl);
        const nameCell = sanitizeMarkdownCell(r.name || (hasImages ? "(構造式画像)" : "-"));
        const stateLabel = r.state === "liquid" ? "液体" : "固体";
        const eqCell = parsePositiveNumber(r.eq) !== null ? String(r.eq) : "-";
        const mmolCell = format2(calc.mmol);
        const mwCell = parsePositiveNumber(r.mw) !== null ? String(r.mw) : "-";
        const densityCell =
          r.state === "liquid" && parsePositiveNumber(r.density) !== null
            ? String(r.density)
            : "-";
        const amountCell = calc.amount !== null ? `${format2(calc.amount)} ${calc.unit}` : "-";
        lines.push(
          `| ${nameCell} | ${stateLabel} | ${eqCell} | ${mmolCell} | ${mwCell} | ${densityCell} | ${amountCell} |`
        );
      });
    }

    lines.push("");
    lines.push("### 溶媒");
    lines.push("| 溶媒名 | 必要量 (mL) |");
    lines.push("| --- | ---: |");

    const activeSolvents = (page.solvents || []).filter(
      (s) => (s.name && s.name.trim() !== "") || s.volume !== ""
    );

    if (activeSolvents.length === 0) {
      lines.push("| - | - |");
    } else {
      activeSolvents.forEach((s) => {
        const volNum = parsePositiveNumber(s.volume);
        const volCell = volNum !== null ? format2(volNum) : "-";
        lines.push(`| ${sanitizeMarkdownCell(s.name || "-")} | ${volCell} |`);
      });
    }

    const activeResults = (page.results || []).filter(
      (r) =>
        (r.name && r.name.trim() !== "") ||
        r.amount !== "" ||
        r.mw !== "" ||
        r.density !== "" ||
        (Array.isArray(r.structures) && r.structures.length > 0)
    );

    if (activeResults.length > 0) {
      lines.push("");
      lines.push("### 結果");
      lines.push("| 生成物 | 収量 | 密度 (g/mL) | 分子量 (MW) | mmol | 収率 (%) |");
      lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
      activeResults.forEach((r) => {
        const calc = calculateResultRow(page.scale, r);
        const hasImages = Array.isArray(r.structures) && r.structures.length > 0;
        const nameCell = sanitizeMarkdownCell(r.name || (hasImages ? "(生成物画像)" : "-"));
        const unit = r.unit === "mL" ? "mL" : "mg";
        const amountCell =
          parsePositiveNumber(r.amount) !== null ? `${format2(Number(r.amount))} ${unit}` : "-";
        const densityCell =
          unit === "mL" && parsePositiveNumber(r.density) !== null ? String(r.density) : "-";
        const mwCell = parsePositiveNumber(r.mw) !== null ? String(r.mw) : "-";
        const mmolCell = format2(calc.mmol);
        const yieldCell = calc.yieldPct !== null ? `${format1(calc.yieldPct)}%` : "-";
        lines.push(
          `| ${nameCell} | ${amountCell} | ${densityCell} | ${mwCell} | ${mmolCell} | ${yieldCell} |`
        );
      });
    }

    return lines.join("\n");
  }

  /**
   * Excel用 TSV (タブ区切り) 出力
   */
  function buildExcelTSV(page) {
    const lines = [];
    lines.push(
      ["試薬", "状態", "eq", "mmol", "分子量 (MW)", "密度 (g/mL)", "必要量", "単位"].join("\t")
    );

    const activeReagents = (page.reagents || []).filter(
      (r) =>
        (r.name && r.name.trim() !== "") ||
        r.eq !== "" ||
        r.mw !== "" ||
        r.density !== "" ||
        Boolean(r.imageDataUrl) ||
        (Array.isArray(r.structures) && r.structures.length > 0)
    );

    activeReagents.forEach((r) => {
      const calc = calculateRow(page.scale, r);
      const stateLabel = r.state === "liquid" ? "液体" : "固体";
      const eqCell = parsePositiveNumber(r.eq) !== null ? String(r.eq) : "";
      const mmolCell = calc.mmol !== null ? format2(calc.mmol) : "";
      const mwCell = parsePositiveNumber(r.mw) !== null ? String(r.mw) : "";
      const densityCell =
        r.state === "liquid" && parsePositiveNumber(r.density) !== null
          ? String(r.density)
          : "";
      const amountCell = calc.amount !== null ? format2(calc.amount) : "";
      const unitCell = calc.amount !== null ? calc.unit : "";
      const hasImages =
        (Array.isArray(r.structures) && r.structures.length > 0) || Boolean(r.imageDataUrl);
      lines.push(
        [
          sanitizeTsvCell(r.name || (hasImages ? "(構造式画像)" : "")),
          stateLabel,
          eqCell,
          mmolCell,
          mwCell,
          densityCell,
          amountCell,
          unitCell,
        ].join("\t")
      );
    });

    const activeSolvents = (page.solvents || []).filter(
      (s) => (s.name && s.name.trim() !== "") || s.volume !== ""
    );

    if (activeSolvents.length > 0) {
      lines.push("");
      lines.push(["溶媒名", "必要量 (mL)"].join("\t"));
      activeSolvents.forEach((s) => {
        const volNum = parsePositiveNumber(s.volume);
        lines.push([sanitizeTsvCell(s.name || ""), volNum !== null ? format2(volNum) : ""].join("\t"));
      });
    }

    const activeResults = (page.results || []).filter(
      (r) =>
        (r.name && r.name.trim() !== "") ||
        r.amount !== "" ||
        r.mw !== "" ||
        r.density !== "" ||
        (Array.isArray(r.structures) && r.structures.length > 0)
    );

    if (activeResults.length > 0) {
      lines.push("");
      lines.push(["生成物", "収量", "単位", "密度 (g/mL)", "分子量 (MW)", "mmol", "収率 (%)"].join("\t"));
      activeResults.forEach((r) => {
        const calc = calculateResultRow(page.scale, r);
        const hasImages = Array.isArray(r.structures) && r.structures.length > 0;
        const unit = r.unit === "mL" ? "mL" : "mg";
        const amountCell = parsePositiveNumber(r.amount) !== null ? format2(Number(r.amount)) : "";
        const unitCell = amountCell ? unit : "";
        const densityCell =
          unit === "mL" && parsePositiveNumber(r.density) !== null ? String(r.density) : "";
        const mwCell = parsePositiveNumber(r.mw) !== null ? String(r.mw) : "";
        const mmolCell = calc.mmol !== null ? format2(calc.mmol) : "";
        const yieldCell = calc.yieldPct !== null ? format1(calc.yieldPct) : "";
        lines.push(
          [
            sanitizeTsvCell(r.name || (hasImages ? "(生成物画像)" : "")),
            amountCell,
            unitCell,
            densityCell,
            mwCell,
            mmolCell,
            yieldCell,
          ].join("\t")
        );
      });
    }

    return lines.join("\n");
  }

  function isValidNotionLink(urlText) {
    const trimmed = String(urlText || "").trim();
    if (!trimmed) return false;
    return /^(https?:\/\/|notion:\/\/).+/i.test(trimmed);
  }

  function toNotionAppUrl(urlText) {
    const trimmed = String(urlText || "").trim();
    if (!isValidNotionLink(trimmed)) return "";
    if (/^notion:\/\//i.test(trimmed)) return trimmed;
    return trimmed.replace(/^https?:\/\//i, "notion://");
  }

  function toNotionWebUrl(urlText) {
    const trimmed = String(urlText || "").trim();
    if (!isValidNotionLink(trimmed)) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return trimmed.replace(/^notion:\/\//i, "https://");
  }

  // =========================================================================
  // 1.5 化学式 上付き・下付き変換ユーティリティ (Unicode)
  // =========================================================================

  const SUB_MAP = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
    a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ",
    m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ",
    u: "ᵤ", v: "ᵥ", x: "ₓ",
  };

  const SUP_MAP = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
    a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ",
    h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ",
    o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ",
    w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  };

  const REV_SUB_MAP = Object.fromEntries(Object.entries(SUB_MAP).map(([k, v]) => [v, k]));
  const REV_SUP_MAP = Object.fromEntries(Object.entries(SUP_MAP).map(([k, v]) => [v, k]));

  function toNormalScript(text) {
    return Array.from(String(text || ""))
      .map((ch) => REV_SUB_MAP[ch] ?? REV_SUP_MAP[ch] ?? ch)
      .join("");
  }

  function toSubscript(text) {
    return Array.from(toNormalScript(text))
      .map((ch) => SUB_MAP[ch] ?? ch)
      .join("");
  }

  function toSuperscript(text) {
    return Array.from(toNormalScript(text))
      .map((ch) => SUP_MAP[ch] ?? ch)
      .join("");
  }

  function toggleScript(text, mode) {
    const chars = Array.from(String(text || ""));
    if (chars.length === 0) return "";
    const targetRev = mode === "sub" ? REV_SUB_MAP : REV_SUP_MAP;
    const allAlreadyTarget = chars.every((ch) => {
      if (targetRev[ch]) return true;
      const normal = toNormalScript(ch);
      const map = mode === "sub" ? SUB_MAP : SUP_MAP;
      return !map[normal];
    });
    if (allAlreadyTarget && chars.some((ch) => Boolean(targetRev[ch]))) {
      return toNormalScript(text);
    }
    return mode === "sub" ? toSubscript(text) : toSuperscript(text);
  }

  /**
   * 化学式の自動フォーマット
   * - ^2+ / ^2- / ^13 → ²⁺ / ²⁻ / ¹³
   * - _2 → ₂
   * - 英字または閉じ括弧直後の数字 (例: H2O, Et3N, Pd(PPh3)4, 4-MeOC6H4Br) → 下付き
   * - 先頭や記号直後の数字 (例: 4-Bromobenzaldehyde, 1,4-dioxane, FeCl3·6H2Oの6, 1.6 M) は維持
   */
  function autoFormatChemicalFormula(text) {
    let result = String(text || "");
    // 明示的上付き (^2+, ^2-, ^13, ^n など)
    result = result.replace(/\^([0-9+\-()a-z]+)/g, (_, group) => toSuperscript(group));
    // 明示的下付き (_2, _n など)
    result = result.replace(/_([0-9+\-()aehijklmnoprstuvx]+)/g, (_, group) => toSubscript(group));
    // 元素記号や閉じ括弧の直後に続く数字を下付きに
    result = result.replace(/([A-Za-z)\]])(\d+)/g, (_, prefix, digits) => prefix + toSubscript(digits));
    return result;
  }

  // =========================================================================
  // 1.6 化学式・略称からの分子量 (MW) ローカル計算 & 定番試薬辞書
  // =========================================================================

  const ATOMIC_WEIGHTS = {
    H: 1.008, D: 2.0141, He: 4.0026,
    Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.180,
    Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
    K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845,
    Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.630, As: 74.922, Se: 78.971,
    Br: 79.904, Kr: 83.798,
    Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95, Ru: 101.07, Rh: 102.91,
    Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.60, I: 126.90,
    Xe: 131.29,
    Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Nd: 144.24, Sm: 150.36, Eu: 151.96, Gd: 157.25,
    Yb: 173.05, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08,
    Au: 196.97, Hg: 200.59, Tl: 204.38, Pb: 207.2, Bi: 208.98,
  };

  // 有機合成でよく使う置換基・配位子略称（長い順にマッチさせる）
  const ORGANIC_ABBREV = [
    ["TBDMS", "C6H15Si"],
    ["t-Bu", "C4H9"],
    ["n-Bu", "C4H9"],
    ["i-Bu", "C4H9"],
    ["s-Bu", "C4H9"],
    ["i-Pr", "C3H7"],
    ["n-Pr", "C3H7"],
    ["TIPS", "C9H21Si"],
    ["Fmoc", "C15H11O2"],
    ["dppf", "C34H28FeP2"],
    ["Bpin", "C6H12BO2"],
    ["OTf", "CF3O3S"],
    ["OTs", "C7H7O3S"],
    ["OMs", "CH3O3S"],
    ["OAc", "C2H3O2"],
    ["OMe", "CH3O"],
    ["OEt", "C2H5O"],
    ["Boc", "C5H9O2"],
    ["Cbz", "C8H7O2"],
    ["TBS", "C6H15Si"],
    ["TMS", "C3H9Si"],
    ["TES", "C6H15Si"],
    ["THP", "C5H9O"],
    ["MOM", "C2H5O"],
    ["PMB", "C8H9O"],
    ["Mes", "C9H11"],
    ["dba", "C17H14O"],
    ["cod", "C8H12"],
    ["pin", "C6H12O2"],
    ["Me", "CH3"],
    ["Et", "C2H5"],
    ["Pr", "C3H7"],
    ["Bu", "C4H9"],
    ["Ph", "C6H5"],
    ["Bn", "C7H7"],
    ["Bz", "C7H5O"],
    ["Ac", "C2H3O"],
    ["Ts", "C7H7O2S"],
    ["Tf", "CF3O2S"],
    ["Ms", "CH3O2S"],
    ["Cy", "C6H11"],
    ["Cp", "C5H5"],
    ["Py", "C5H5N"],
    ["py", "C5H5N"],
  ];

  // 日本語名・定番有機試薬辞書（オフラインでも即座に取得）
  const COMMON_REAGENT_DICT = {
    "炭酸カリウム": { mw: 138.21, formula: "K2CO3" },
    "炭酸セシウム": { mw: 325.82, formula: "Cs2CO3" },
    "炭酸ナトリウム": { mw: 105.99, formula: "Na2CO3" },
    "炭酸水素ナトリウム": { mw: 84.01, formula: "NaHCO3" },
    "リン酸カリウム": { mw: 212.27, formula: "K3PO4" },
    "水酸化ナトリウム": { mw: 40.00, formula: "NaOH" },
    "水酸化カリウム": { mw: 56.11, formula: "KOH" },
    "水酸化リチウム": { mw: 23.95, formula: "LiOH" },
    "水素化ホウ素ナトリウム": { mw: 37.83, formula: "NaBH4" },
    "水素化リチウムアルミニウム": { mw: 37.95, formula: "LiAlH4" },
    "水素化ナトリウム": { mw: 24.00, formula: "NaH" },
    "トリエチルアミン": { mw: 101.19, formula: "C6H15N", state: "liquid", density: 0.726 },
    "ピリジン": { mw: 79.10, formula: "C5H5N", state: "liquid", density: 0.982 },
    "ジイソプロピルエチルアミン": { mw: 129.24, formula: "C8H19N", state: "liquid", density: 0.742 },
    "酢酸パラジウム": { mw: 224.51, formula: "C4H6O4Pd" },
    "塩化チオニル": { mw: 118.97, formula: "SOCl2", state: "liquid", density: 1.638 },
    "無水酢酸": { mw: 102.09, formula: "C4H6O3", state: "liquid", density: 1.082 },
    "塩化オキサリル": { mw: 126.93, formula: "C2Cl2O2", state: "liquid", density: 1.455 },
    "硫酸マグネシウム": { mw: 120.37, formula: "MgSO4" },
    "硫酸ナトリウム": { mw: 142.04, formula: "Na2SO4" },
    "ヨウ化銅": { mw: 190.45, formula: "CuI" },
    "塩化アンモニウム": { mw: 53.49, formula: "NH4Cl" },
    "水": { mw: 18.02, formula: "H2O", state: "liquid", density: 1.000 },
    "tea": { mw: 101.19, formula: "C6H15N", state: "liquid", density: 0.726 },
    "et3n": { mw: 101.19, formula: "C6H15N", state: "liquid", density: 0.726 },
    "dipea": { mw: 129.24, formula: "C8H19N", state: "liquid", density: 0.742 },
    "diea": { mw: 129.24, formula: "C8H19N", state: "liquid", density: 0.742 },
    "dmap": { mw: 122.17, formula: "C7H10N2" },
    "dbu": { mw: 152.24, formula: "C9H16N2", state: "liquid", density: 1.018 },
    "edci": { mw: 191.70, formula: "C8H18ClN3" },
    "edc·hcl": { mw: 191.70, formula: "C8H18ClN3" },
    "wsc·hcl": { mw: 191.70, formula: "C8H18ClN3" },
    "hatu": { mw: 380.23, formula: "C10H15F6N6OP" },
    "hobt": { mw: 135.12, formula: "C6H5N3O" },
    "nbs": { mw: 177.98, formula: "C4H4BrNO2" },
    "ncs": { mw: 133.53, formula: "C4H4ClNO2" },
    "nis": { mw: 224.98, formula: "C4H4INO2" },
    "mcpba": { mw: 172.57, formula: "C7H5ClO3" },
    "tfa": { mw: 114.02, formula: "C2HF3O2", state: "liquid", density: 1.489 },
    "tbaf": { mw: 261.46, formula: "C16H36FN" },
    "boc2o": { mw: 218.25, formula: "C10H18O5" },
    "kotbu": { mw: 112.21, formula: "C4H9KO" },
    "t-buok": { mw: 112.21, formula: "C4H9KO" },
    "naotbu": { mw: 96.10, formula: "C4H9NaO" },
    "t-buona": { mw: 96.10, formula: "C4H9NaO" },
    "n-buli": { mw: 64.06, formula: "C4H9Li" },
    "lda": { mw: 107.12, formula: "C6H14LiN" },
    "lihmds": { mw: 167.33, formula: "C6H18LiNSi2" },
    "nahmds": { mw: 183.37, formula: "C6H18NNaSi2" },
    "khmds": { mw: 199.48, formula: "C6H18KNSi2" },
    "lah": { mw: 37.95, formula: "LiAlH4" },
    "dibal": { mw: 142.22, formula: "C8H19Al" },
    "dibal-h": { mw: 142.22, formula: "C8H19Al" },
    "thf": { mw: 72.11, formula: "C4H8O", state: "liquid", density: 0.889 },
    "dcm": { mw: 84.93, formula: "CH2Cl2", state: "liquid", density: 1.325 },
    "dmf": { mw: 73.09, formula: "C3H7NO", state: "liquid", density: 0.944 },
    "dmso": { mw: 78.13, formula: "C2H6OS", state: "liquid", density: 1.100 },
    "mecn": { mw: 41.05, formula: "C2H3N", state: "liquid", density: 0.786 },
    "meoh": { mw: 32.04, formula: "CH4O", state: "liquid", density: 0.792 },
    "etoh": { mw: 46.07, formula: "C2H6O", state: "liquid", density: 0.789 },
    "etoac": { mw: 88.11, formula: "C4H8O2", state: "liquid", density: 0.902 },
    "toluene": { mw: 92.14, formula: "C7H8", state: "liquid", density: 0.867 },
    "トルエン": { mw: 92.14, formula: "C7H8", state: "liquid", density: 0.867 },
    "1,4-dioxane": { mw: 88.11, formula: "C4H8O2", state: "liquid", density: 1.033 },
    "ジオキサン": { mw: 88.11, formula: "C4H8O2", state: "liquid", density: 1.033 },
  };

  function mergeAtomCounts(target, source, factor) {
    Object.keys(source).forEach((el) => {
      target[el] = (target[el] || 0) + source[el] * factor;
    });
  }

  function formatHillFormula(counts) {
    const keys = Object.keys(counts).filter((k) => counts[k] > 0);
    if (keys.length === 0) return "";
    const ordered = [];
    if (counts.C) {
      ordered.push("C");
      if (counts.H) ordered.push("H");
    }
    keys
      .filter((k) => !ordered.includes(k))
      .sort()
      .forEach((k) => ordered.push(k));
    return ordered
      .map((el) => {
        const n = counts[el];
        return n === 1 ? el : `${el}${n}`;
      })
      .join("");
  }

  function parseFormulaSegment(segment) {
    let i = 0;
    const len = segment.length;

    function parseGroup(closingChar) {
      const counts = {};
      while (i < len) {
        const ch = segment[i];
        if (closingChar && ch === closingChar) {
          i += 1;
          return counts;
        }
        if (ch === "(" || ch === "[") {
          const expectedClose = ch === "(" ? ")" : "]";
          i += 1;
          const inner = parseGroup(expectedClose);
          if (!inner) return null;
          const numStart = i;
          while (i < len && /\d/.test(segment[i])) i += 1;
          const mult = i > numStart ? parseInt(segment.slice(numStart, i), 10) : 1;
          mergeAtomCounts(counts, inner, mult);
          continue;
        }
        if (ch === ")" || ch === "]") {
          return null;
        }

        // 1) 有機略称の一致チェック
        let matchedAbbrev = null;
        for (let a = 0; a < ORGANIC_ABBREV.length; a++) {
          const [abbr, expanded] = ORGANIC_ABBREV[a];
          if (segment.startsWith(abbr, i)) {
            const afterIdx = i + abbr.length;
            const nextCh = segment[afterIdx] || "";
            // 略称直後が小文字なら別の英単語の一部なのでスキップ（例: "Methyl" の "Me"）
            if (nextCh && /[a-z]/.test(nextCh)) continue;
            matchedAbbrev = { abbr, expanded };
            break;
          }
        }
        if (matchedAbbrev) {
          i += matchedAbbrev.abbr.length;
          const numStart = i;
          while (i < len && /\d/.test(segment[i])) i += 1;
          const mult = i > numStart ? parseInt(segment.slice(numStart, i), 10) : 1;
          const subCounts = parseFormulaSegment(matchedAbbrev.expanded);
          if (!subCounts) return null;
          mergeAtomCounts(counts, subCounts, mult);
          continue;
        }

        // 2) 元素記号（2文字→1文字の優先順）
        if (/[A-Z]/.test(ch)) {
          let sym = null;
          if (i + 1 < len && /[a-z]/.test(segment[i + 1])) {
            const two = segment.slice(i, i + 2);
            if (ATOMIC_WEIGHTS[two] !== undefined) {
              sym = two;
              i += 2;
            }
          }
          if (!sym) {
            if (ATOMIC_WEIGHTS[ch] !== undefined) {
              sym = ch;
              i += 1;
            } else {
              return null;
            }
          }
          const numStart = i;
          while (i < len && /\d/.test(segment[i])) i += 1;
          const mult = i > numStart ? parseInt(segment.slice(numStart, i), 10) : 1;
          counts[sym] = (counts[sym] || 0) + mult;
          continue;
        }

        // 解釈できない文字があれば化学式ではない
        return null;
      }
      if (closingChar) return null; // 閉じ括弧不足
      return counts;
    }

    const res = parseGroup(null);
    if (!res || i !== len || Object.keys(res).length === 0) return null;
    return res;
  }

  /**
   * 化学式・略称文字列から分子量を計算（例: "NaBH₄", "Pd(PPh₃)₄", "FeCl₃·6H₂O"）
   * 化学式として解釈できない場合は null を返す
   */
  function calculateFormulaMW(rawInput) {
    const normalized = toNormalScript(String(rawInput || "")).trim();
    if (!normalized) return null;
    // スペースや日本語・位置番号接頭辞 (例: "4-Bromobenzaldehyde") を含む場合は化学式パーサー対象外
    if (/[\s\u3000-\u9FFF]/.test(normalized)) return null;
    if (/^\d+-/.test(normalized)) return null;

    // 末尾の電荷記号 (2+, 2-, +, -) は原子量に無関係なので除去
    const cleaned = normalized.replace(/\^?[0-9]*[+-]$/, "");
    if (!cleaned) return null;

    // 付加物・水和物区切り (·, •, ・, ., *)
    const parts = cleaned.split(/[·•・.*]/);
    const totalCounts = {};

    for (let p = 0; p < parts.length; p++) {
      let part = parts[p].trim();
      if (!part) return null;
      let coef = 1;
      const coefMatch = part.match(/^(\d+)(.+)$/);
      if (coefMatch) {
        coef = parseInt(coefMatch[1], 10);
        part = coefMatch[2];
      }
      const segCounts = parseFormulaSegment(part);
      if (!segCounts) return null;
      mergeAtomCounts(totalCounts, segCounts, coef);
    }

    let mw = 0;
    Object.keys(totalCounts).forEach((el) => {
      mw += ATOMIC_WEIGHTS[el] * totalCounts[el];
    });
    if (!Number.isFinite(mw) || mw <= 0) return null;

    return {
      mw: Math.round(mw * 100) / 100,
      formula: formatHillFormula(totalCounts),
      counts: totalCounts,
    };
  }

  function lookupLocalReagent(rawInput) {
    const trimmed = String(rawInput || "").trim();
    if (!trimmed) return null;
    const normalized = toNormalScript(trimmed).trim();
    const keyLower = normalized.toLowerCase();

    if (COMMON_REAGENT_DICT[trimmed]) {
      return { ...COMMON_REAGENT_DICT[trimmed], source: "内蔵辞書" };
    }
    if (COMMON_REAGENT_DICT[keyLower]) {
      return { ...COMMON_REAGENT_DICT[keyLower], source: "内蔵辞書" };
    }

    const formulaRes = calculateFormulaMW(normalized);
    if (formulaRes) {
      return {
        mw: formulaRes.mw,
        formula: formulaRes.formula,
        source: "化学式計算",
      };
    }
    return null;
  }

  /**
   * 試薬行内の全構造式の MW 合計を算出
   */
  function sumStructuresMW(structures) {
    if (!Array.isArray(structures) || structures.length === 0) {
      return { totalMw: null, countWithMw: 0 };
    }
    let sum = 0;
    let countWithMw = 0;
    structures.forEach((st) => {
      const m = parsePositiveNumber(st && st.mw);
      if (m !== null) {
        sum += m;
        countWithMw += 1;
      }
    });
    return {
      totalMw: countWithMw > 0 ? Math.round(sum * 100) / 100 : null,
      countWithMw,
    };
  }

  // =========================================================================
  // 1.7 投げ縄選択・2D回転の幾何計算ユーティリティ
  // =========================================================================

  function pointInPolygon(px, py, polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersect =
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function rotatePoint2D(x, y, cx, cy, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = x - cx;
    const dy = y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  }

  function computePointsBounds(points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    return {
      minX,
      minY,
      maxX,
      maxY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * ページ一覧カード表示用：結果欄から目的物の構造・名称・収率サマリーを抽出
   */
  function extractTargetProductSummary(page) {
    const results = Array.isArray(page && page.results) ? page.results : [];
    let imageDataUrl = "";
    let imageCount = 0;
    let productName = "";
    let productFormula = "";
    let yieldPct = null;

    results.forEach((res) => {
      if (!res) return;
      if (!productName && res.name && res.name.trim()) {
        productName = res.name.trim();
      }
      const structs = Array.isArray(res.structures) ? res.structures : [];
      structs.forEach((st) => {
        if (st && st.imageDataUrl) {
          imageCount += 1;
          if (!imageDataUrl) imageDataUrl = st.imageDataUrl;
        }
        if (!productFormula && st && st.formula) {
          productFormula = st.formula;
        }
      });
      if (yieldPct === null) {
        const calc = calculateResultRow(page.scale, res);
        if (calc.yieldPct !== null) {
          yieldPct = calc.yieldPct;
        }
      }
    });

    const reagents = Array.isArray(page && page.reagents) ? page.reagents : [];
    const reagentCount = reagents.filter(
      (r) =>
        r &&
        ((r.name && r.name.trim() !== "") ||
          r.eq !== "" ||
          r.mw !== "" ||
          (Array.isArray(r.structures) && r.structures.length > 0))
    ).length;

    return {
      imageDataUrl,
      imageCount,
      productName: productName || productFormula,
      yieldPct,
      reagentCount,
    };
  }

  function filterPagesByQuery(pageList, rawQuery) {
    const q = String(rawQuery || "").trim().toLowerCase();
    if (!q) return pageList;
    return pageList.filter((page) => {
      const haystacks = [page.title || ""];
      (page.results || []).forEach((r) => {
        if (r && r.name) haystacks.push(r.name);
      });
      (page.reagents || []).forEach((r) => {
        if (r && r.name) haystacks.push(r.name);
      });
      (page.solvents || []).forEach((s) => {
        if (s && s.name) haystacks.push(s.name);
      });
      return haystacks.some((text) => text.toLowerCase().includes(q));
    });
  }

  // =========================================================================
  // 1.8 バックアップ書き出し・読み込み検証＆マージロジック
  // =========================================================================

  function buildBackupPayload(pageList) {
    return {
      format: "organic-eln-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      pages: Array.isArray(pageList) ? pageList : [],
    };
  }

  function normalizeImportedPage(raw, idx) {
    if (!raw || typeof raw !== "object") return null;
    const now = Date.now();
    return {
      id:
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id.trim()
          : `page_imp_${now}_${idx}`,
      title: typeof raw.title === "string" ? raw.title : `復元ページ-${idx + 1}`,
      notionUrl: typeof raw.notionUrl === "string" ? raw.notionUrl : "",
      scale: raw.scale !== undefined && raw.scale !== null ? String(raw.scale) : "",
      reagents: Array.isArray(raw.reagents) ? raw.reagents : [],
      solvents: Array.isArray(raw.solvents) ? raw.solvents : [],
      results: Array.isArray(raw.results) ? raw.results : [],
      createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : now,
      updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now,
    };
  }

  function parseAndValidateBackup(rawText) {
    let data = null;
    try {
      data = JSON.parse(String(rawText || ""));
    } catch (_) {
      return { ok: false, error: "JSONファイルの形式が正しくありません" };
    }
    if (!data || typeof data !== "object") {
      return { ok: false, error: "バックアップデータの形式が不正です" };
    }
    const rawPages = Array.isArray(data) ? data : data.pages;
    if (!Array.isArray(rawPages)) {
      return { ok: false, error: "このファイルには実験ページデータが含まれていません" };
    }
    const normalized = rawPages
      .map((p, idx) => normalizeImportedPage(p, idx))
      .filter(Boolean);
    if (normalized.length === 0) {
      return { ok: false, error: "読み込めるページが0件でした" };
    }
    return {
      ok: true,
      exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : null,
      pages: normalized,
    };
  }

  function mergeImportedPages(existingPages, importedPages, mode) {
    if (mode === "replace") {
      return importedPages.map((p) => JSON.parse(JSON.stringify(p)));
    }
    const byId = new Map();
    (existingPages || []).forEach((p) => {
      byId.set(p.id, JSON.parse(JSON.stringify(p)));
    });
    (importedPages || []).forEach((p) => {
      byId.set(p.id, JSON.parse(JSON.stringify(p)));
    });
    return Array.from(byId.values());
  }

  // 単体テスト用エクスポート
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parsePositiveNumber,
      format1,
      format2,
      calculateRow,
      calculateResultRow,
      buildNotionMarkdown,
      buildExcelTSV,
      isValidNotionLink,
      toNotionAppUrl,
      toNotionWebUrl,
      toSubscript,
      toSuperscript,
      toNormalScript,
      toggleScript,
      autoFormatChemicalFormula,
      calculateFormulaMW,
      lookupLocalReagent,
      sumStructuresMW,
      pointInPolygon,
      rotatePoint2D,
      computePointsBounds,
      extractTargetProductSummary,
      filterPagesByQuery,
      buildBackupPayload,
      parseAndValidateBackup,
      mergeImportedPages,
    };
  }

  if (typeof document === "undefined") return;

  // =========================================================================
  // 2. IndexedDB 永続化ストレージ
  // =========================================================================

  const DB_NAME = "OrganicSynthesisCalcDB";
  const DB_VERSION = 1;
  const STORE_PAGES = "pages";
  const STORE_META = "meta";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not supported"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_PAGES)) {
          db.createObjectStore(STORE_PAGES, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAllPages(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PAGES, "readonly");
      const store = tx.objectStore(STORE_PAGES);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPutPage(db, page) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PAGES, "readwrite");
      tx.objectStore(STORE_PAGES).put(page);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDeletePage(db, pageId) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PAGES, "readwrite");
      tx.objectStore(STORE_PAGES).delete(pageId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbReplaceAllPages(db, pageList) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PAGES, "readwrite");
      const store = tx.objectStore(STORE_PAGES);
      store.clear();
      (pageList || []).forEach((p) => store.put(p));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGetMeta(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readonly");
      const req = tx.objectStore(STORE_META).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbSetMeta(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // =========================================================================
  // 2.5 PubChem API 検索 & 画像ブラウザ検索ヘルパー
  // =========================================================================

  async function fetchPubChemEndpoint(endpointType, query) {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${endpointType}/${encodeURIComponent(query)}/property/MolecularWeight,MolecularFormula,Title/JSON`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const prop =
      data &&
      data.PropertyTable &&
      data.PropertyTable.Properties &&
      data.PropertyTable.Properties[0];
    if (!prop || !prop.MolecularWeight) return null;
    const mwNum = Number(prop.MolecularWeight);
    if (!Number.isFinite(mwNum) || mwNum <= 0) return null;
    return {
      mw: Math.round(mwNum * 100) / 100,
      formula: prop.MolecularFormula || "",
      title: prop.Title || "",
      source: endpointType === "smiles" ? "PubChem (SMILES)" : "PubChem",
    };
  }

  async function lookupPubChemMW(rawQuery) {
    const query = toNormalScript(String(rawQuery || "")).trim();
    if (!query) return null;

    const looksLikeSmiles = /[=#@\\/]/.test(query) || /c1/i.test(query);
    if (looksLikeSmiles) {
      const bySmiles = await fetchPubChemEndpoint("smiles", query);
      if (bySmiles) return bySmiles;
    }

    const byName = await fetchPubChemEndpoint("name", query);
    if (byName) return byName;

    if (!looksLikeSmiles) {
      const bySmilesFallback = await fetchPubChemEndpoint("smiles", query);
      if (bySmilesFallback) return bySmilesFallback;
    }
    return null;
  }

  function dataUrlToPngBlob(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("PNG変換に失敗しました"));
        }, "image/png");
      };
      img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      img.src = dataUrl;
    });
  }

  async function copyImageDataUrlToClipboard(dataUrl) {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      return false;
    }
    try {
      const pngBlob = await dataUrlToPngBlob(dataUrl);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      return true;
    } catch (_) {
      return false;
    }
  }

  // =========================================================================
  // 3. 画像読み込み（ファイル選択・ペースト・D&D対応、必要時のみリサイズ）
  // =========================================================================

  function readImageFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith("image/")) {
        reject(new Error("画像ファイルを選択してください"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const rawDataUrl = reader.result;
        const img = new Image();
        img.onload = () => {
          const MAX_DIM = 1200;
          if (img.width <= MAX_DIM && img.height <= MAX_DIM) {
            resolve(rawDataUrl);
            return;
          }
          const ratio = Math.min(MAX_DIM / img.width, MAX_DIM / img.height);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => resolve(rawDataUrl);
        img.src = rawDataUrl;
      };
      reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      reader.readAsDataURL(file);
    });
  }

  // =========================================================================
  // 4. モデル生成 & ユーティリティ
  // =========================================================================

  function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function formatDateShort(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}/${m}/${day} ${hh}:${mm}`;
  }

  function createStructureItem(overrides = {}) {
    return {
      id: overrides.id || generateId("st"),
      imageDataUrl: overrides.imageDataUrl || "",
      molfile: overrides.molfile || "",
      smiles: overrides.smiles || "",
      formula: overrides.formula || "",
      mw: overrides.mw || "",
      exactMass: overrides.exactMass || "",
    };
  }

  /**
   * 旧形式 (単一 imageDataUrl/molfile) の試薬データを複数構造式配列 (structures) へ自動移行
   */
  function ensureReagentStructures(reagent) {
    if (!Array.isArray(reagent.structures)) {
      reagent.structures = [];
      if (reagent.imageDataUrl || reagent.molfile || reagent.smiles) {
        reagent.structures.push(
          createStructureItem({
            imageDataUrl: reagent.imageDataUrl || "",
            molfile: reagent.molfile || "",
            smiles: reagent.smiles || "",
            mw: reagent.mw || "",
          })
        );
      }
      delete reagent.imageDataUrl;
      delete reagent.molfile;
      delete reagent.smiles;
    }
    return reagent.structures;
  }

  function createEmptyReagent() {
    return {
      id: generateId("r"),
      name: "",
      structures: [],
      mwMeta: "",
      state: "solid",
      eq: "",
      mw: "",
      density: "",
    };
  }

  function createEmptySolvent() {
    return {
      id: generateId("s"),
      name: "",
      volume: "",
    };
  }

  function createEmptyResult() {
    return {
      id: generateId("res"),
      name: "",
      structures: [],
      mwMeta: "",
      amount: "",
      unit: "mg", // 'mg' | 'mL'
      density: "",
      mw: "",
    };
  }

  function ensurePageResults(page) {
    if (!Array.isArray(page.results) || page.results.length === 0) {
      page.results = [createEmptyResult()];
    }
    return page.results;
  }

  function createNewPageModel(indexNumber) {
    const now = Date.now();
    const numStr = String(indexNumber).padStart(3, "0");
    return {
      id: generateId("page"),
      title: `EXP-${numStr}`,
      notionUrl: "",
      scale: "",
      reagents: [createEmptyReagent(), createEmptyReagent()],
      solvents: [createEmptySolvent()],
      results: [createEmptyResult()],
      createdAt: now,
      updatedAt: now,
    };
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // フォールバックへ
      }
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  // =========================================================================
  // 5. アプリ状態 & DOM コントローラ
  // =========================================================================

  let db = null;
  let pages = [];
  let activePageId = null;
  let pagePopupOpen = false;
  let pageSearchQuery = "";
  let saveTimer = null;
  let toastTimer = null;
  let cloudEnabled = false;
  let cloudSyncInFlight = false;

  const elPageList = document.getElementById("page-list");
  const elPageCount = document.getElementById("page-count");
  const elCloudStatusPill = document.getElementById("cloud-status-pill");
  const elBtnCloudSync = document.getElementById("btn-cloud-sync");
  const elPageSearchInput = document.getElementById("page-search-input");
  const elBtnExportBackup = document.getElementById("btn-export-backup");
  const elBtnImportBackup = document.getElementById("btn-import-backup");
  const elBackupFileInput = document.getElementById("backup-file-input");
  const elBackupModal = document.getElementById("backup-import-modal");
  const elBackupModalBackdrop = document.getElementById("backup-modal-backdrop");
  const elBackupModalClose = document.getElementById("backup-modal-close");
  const elBackupPreviewBox = document.getElementById("backup-preview-box");
  const elBtnBackupCancel = document.getElementById("btn-backup-cancel");
  const elBtnBackupConfirm = document.getElementById("btn-backup-confirm");
  const elBtnNewPage = document.getElementById("btn-new-page");

  let pendingBackupImport = null;
  const elPagePopupModal = document.getElementById("page-popup-modal");
  const elPagePopupBackdrop = document.getElementById("page-popup-backdrop");
  const elPagePopupBody = document.querySelector(".page-popup-body");
  const elBtnClosePagePopup = document.getElementById("btn-close-page-popup");
  const elPageTitleInput = document.getElementById("page-title-input");
  const elSaveStatus = document.getElementById("save-status");
  const elBtnSavePage = document.getElementById("btn-save-page");
  const elBtnDeletePage = document.getElementById("btn-delete-page");
  const elNotionUrlInput = document.getElementById("notion-url-input");
  const elBtnOpenNotionApp = document.getElementById("btn-open-notion-app");
  const elBtnOpenNotionWeb = document.getElementById("btn-open-notion-web");
  const elNotionUrlHint = document.getElementById("notion-url-hint");

  const elScaleInput = document.getElementById("scale-input");
  const elReagentTbody = document.getElementById("reagent-tbody");
  const elReagentTemplate = document.getElementById("reagent-row-template");
  const elBtnAddReagent = document.getElementById("btn-add-reagent");
  const elBtnOpenEditorStandalone = document.getElementById("btn-open-editor-standalone");
  const elBtnSubscript = document.getElementById("btn-subscript");
  const elBtnSuperscript = document.getElementById("btn-superscript");
  const elBtnAutoFormula = document.getElementById("btn-auto-formula");

  // 構造式エディタモーダル DOM
  const elEditorModal = document.getElementById("structure-editor-modal");
  const elEditorBackdrop = document.getElementById("editor-modal-backdrop");
  const elEditorClose = document.getElementById("editor-modal-close");
  const elEditorCancel = document.getElementById("btn-editor-cancel");
  const elEditorApply = document.getElementById("btn-editor-apply");
  const elEditorTargetNote = document.getElementById("editor-target-note");
  const elEditorMwModeWrap = document.getElementById("editor-mw-mode-wrap");
  const elEditorMwMode = document.getElementById("editor-mw-mode");
  const elJsmeLoading = document.getElementById("jsme-loading");
  const elJsmeContainer = document.getElementById("jsme-container");
  const elBtnChemLasso = document.getElementById("btn-chem-lasso");
  const elLassoOverlay = document.getElementById("lasso-overlay");
  const elLassoStatus = document.getElementById("lasso-status");
  const elBtnLassoSelectAll = document.getElementById("btn-lasso-select-all");
  const elBtnLassoDeselect = document.getElementById("btn-lasso-deselect");
  const elBtnLassoDelete = document.getElementById("btn-lasso-delete");
  const elBtnLassoDone = document.getElementById("btn-lasso-done");
  const elLassoCanvas = document.getElementById("lasso-canvas");
  const elBtnChemClean = document.getElementById("btn-chem-clean");
  const elBtnChemUndo = document.getElementById("btn-chem-undo");
  const elBtnChemRedo = document.getElementById("btn-chem-redo");
  const elBtnChemClear = document.getElementById("btn-chem-clear");
  const elSmilesLoadInput = document.getElementById("smiles-load-input");
  const elBtnLoadSmiles = document.getElementById("btn-load-smiles");
  const elPropFormula = document.getElementById("prop-formula");
  const elPropMw = document.getElementById("prop-mw");
  const elPropExactMass = document.getElementById("prop-exact-mass");
  const elPropSmiles = document.getElementById("prop-smiles");
  const elChemSvgPreview = document.getElementById("chem-svg-preview");
  const elChkPngTransparent = document.getElementById("chk-png-transparent");
  const elBtnCopyPng = document.getElementById("btn-copy-png");
  const elBtnDownloadPng = document.getElementById("btn-download-png");
  const elBtnDownloadSvg = document.getElementById("btn-download-svg");

  // 化学式 上付き・下付き入力モード ('none' | 'sub' | 'sup')
  let scriptInputMode = "none";
  let lastFocusedFormulaInput = null;

  const elSolventTbody = document.getElementById("solvent-tbody");
  const elSolventTemplate = document.getElementById("solvent-row-template");
  const elBtnAddSolvent = document.getElementById("btn-add-solvent");
  const elSolventTotal = document.getElementById("solvent-total");

  const elResultTbody = document.getElementById("result-tbody");
  const elResultTemplate = document.getElementById("result-row-template");
  const elBtnAddResult = document.getElementById("btn-add-result");

  const elBtnCopyNotion = document.getElementById("btn-copy-notion");
  const elBtnCopyExcel = document.getElementById("btn-copy-excel");

  const elModal = document.getElementById("image-modal");
  const elModalBackdrop = document.getElementById("modal-backdrop");
  const elModalClose = document.getElementById("modal-close");
  const elModalImage = document.getElementById("modal-image");
  const elModalCaption = document.getElementById("modal-caption");
  const elToast = document.getElementById("toast");

  function getActivePage() {
    return pages.find((p) => p.id === activePageId) || null;
  }

  function showToast(message) {
    elToast.textContent = message;
    elToast.classList.add("is-visible");
    elToast.setAttribute("aria-hidden", "false");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elToast.classList.remove("is-visible");
      elToast.setAttribute("aria-hidden", "true");
    }, 2400);
  }

  function setSaveStatus(text, isSaving = false) {
    elSaveStatus.textContent = text;
    elSaveStatus.classList.toggle("is-saving", isSaving);
  }

  function isFormulaTargetInput(el) {
    if (!el || el.tagName !== "INPUT" || el.type !== "text") return false;
    return (
      el.classList.contains("js-name") ||
      el.classList.contains("js-result-name") ||
      el.classList.contains("js-solvent-name") ||
      el.id === "page-title-input"
    );
  }

  function updateScriptModeUI() {
    elBtnSubscript.classList.toggle("is-active", scriptInputMode === "sub");
    elBtnSubscript.setAttribute("aria-pressed", String(scriptInputMode === "sub"));
    elBtnSuperscript.classList.toggle("is-active", scriptInputMode === "sup");
    elBtnSuperscript.setAttribute("aria-pressed", String(scriptInputMode === "sup"));

    document.querySelectorAll(".is-formula-mode").forEach((el) => {
      el.classList.remove("is-formula-mode");
    });
    if (scriptInputMode !== "none" && document.activeElement && isFormulaTargetInput(document.activeElement)) {
      document.activeElement.classList.add("is-formula-mode");
    }
  }

  function setScriptInputMode(mode) {
    scriptInputMode = mode;
    updateScriptModeUI();
  }

  function getActiveFormulaInput() {
    if (document.activeElement && isFormulaTargetInput(document.activeElement)) {
      return document.activeElement;
    }
    if (lastFocusedFormulaInput && document.body.contains(lastFocusedFormulaInput)) {
      return lastFocusedFormulaInput;
    }
    return null;
  }

  function replaceInputRange(inputEl, start, end, replacement) {
    const val = inputEl.value;
    inputEl.value = val.slice(0, start) + replacement + val.slice(end);
    const nextPos = start + replacement.length;
    inputEl.setSelectionRange(nextPos, nextPos);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function handleScriptButtonAction(mode) {
    const inputEl = getActiveFormulaInput();
    if (!inputEl) {
      // 入力欄未選択時はモード切替のみ
      const nextMode = scriptInputMode === mode ? "none" : mode;
      setScriptInputMode(nextMode);
      showToast(
        nextMode === "sub"
          ? "下付き入力モード ON（試薬名・溶媒名でそのまま入力できます）"
          : nextMode === "sup"
          ? "上付き入力モード ON（試薬名・溶媒名でそのまま入力できます）"
          : "通常入力モードに戻しました"
      );
      return;
    }

    inputEl.focus();
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end = inputEl.selectionEnd ?? inputEl.value.length;

    if (end > start) {
      // 選択範囲があれば即座に変換（トグル）
      const selected = inputEl.value.slice(start, end);
      const converted = toggleScript(selected, mode);
      replaceInputRange(inputEl, start, end, converted);
      inputEl.setSelectionRange(start, start + converted.length);
      return;
    }

    // 選択範囲がなければ入力モードをトグル
    const nextMode = scriptInputMode === mode ? "none" : mode;
    setScriptInputMode(nextMode);
    if (nextMode === "sub") {
      showToast("下付き入力モード ON（もう一度押すか Esc で解除）");
    } else if (nextMode === "sup") {
      showToast("上付き入力モード ON（もう一度押すか Esc で解除）");
    } else {
      showToast("通常入力モードに戻しました");
    }
  }

  function handleAutoFormatAction() {
    const inputEl = getActiveFormulaInput();
    if (!inputEl) {
      showToast("変換したい試薬名または溶媒名の入力欄を選択してください");
      return;
    }
    inputEl.focus();
    const before = inputEl.value;
    const after = autoFormatChemicalFormula(before);
    if (before === after) {
      showToast("変換対象の化学式はありませんでした");
      return;
    }
    inputEl.value = after;
    inputEl.setSelectionRange(after.length, after.length);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    showToast(`化学式を変換しました: ${after}`);
  }

  function setCloudStatusUI(mode, detailText = "") {
    if (!elCloudStatusPill) return;
    elCloudStatusPill.classList.remove("is-cloud", "is-auth");
    if (mode === "cloud") {
      elCloudStatusPill.textContent = detailText || "☁ Netlify クラウド同期中";
      elCloudStatusPill.classList.add("is-cloud");
      if (elBtnCloudSync) elBtnCloudSync.classList.remove("is-hidden");
    } else if (mode === "auth") {
      elCloudStatusPill.textContent = "🔒 Private設定・再ログインが必要です（クリックで再読込）";
      elCloudStatusPill.classList.add("is-auth");
      if (elBtnCloudSync) elBtnCloudSync.classList.add("is-hidden");
    } else {
      elCloudStatusPill.textContent = detailText || "ローカル保存 (IndexedDB)";
      if (elBtnCloudSync) elBtnCloudSync.classList.add("is-hidden");
    }
  }

  function canUseCloudApi() {
    return window.location.protocol === "http:" || window.location.protocol === "https:";
  }

  async function cloudFetch(url, options = {}) {
    const res = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const expiresIn = Number(res.headers.get("Netlify-Site-Protection-Expires-In"));
    if (Number.isFinite(expiresIn) && expiresIn > 0 && expiresIn < 60) {
      showToast("ログインセッションの有効期限が近いため再読み込みします...");
    }
    return res;
  }

  async function syncFromCloud({ showFeedback = false, migrateLocalIfEmpty = false } = {}) {
    if (!canUseCloudApi() || cloudSyncInFlight) return false;
    cloudSyncInFlight = true;
    if (elBtnCloudSync) {
      elBtnCloudSync.disabled = true;
      elBtnCloudSync.textContent = "同期中...";
    }
    try {
      const res = await cloudFetch("/api/pages", { method: "GET" });
      if (res.status === 401) {
        cloudEnabled = false;
        setCloudStatusUI("auth");
        if (showFeedback) {
          showToast("ログインセッションが切れています。ページを再読み込みしてください。");
        }
        return false;
      }
      if (!res.ok) {
        cloudEnabled = false;
        setCloudStatusUI("local");
        return false;
      }

      const data = await res.json();
      const remotePages = Array.isArray(data.pages) ? data.pages : [];
      cloudEnabled = true;
      setCloudStatusUI("cloud");

      if (remotePages.length === 0 && migrateLocalIfEmpty && pages.length > 0) {
        // 初回接続時：既存ローカルページをクラウドへ自動アップロード
        const pushRes = await cloudFetch("/api/pages", {
          method: "POST",
          body: JSON.stringify({ mode: "merge", pages }),
        });
        if (pushRes.ok && showFeedback) {
          showToast(`ローカルの ${pages.length} 件をクラウドへ保存しました`);
        }
        return true;
      }

      if (remotePages.length > 0) {
        pages = remotePages;
        if (db) {
          await dbReplaceAllPages(db, pages);
        }
        const stillExists = pages.some((p) => p.id === activePageId);
        if (!stillExists) {
          const sorted = [...pages].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          activePageId = sorted[0] ? sorted[0].id : null;
        }
        if (pagePopupOpen && activePageId) {
          renderActivePage();
        } else {
          renderSidebar();
        }
      }

      if (showFeedback) {
        showToast(`クラウドから最新データ（${pages.length} 件）を同期しました`);
      }
      return true;
    } catch (err) {
      console.warn("Cloud sync unavailable, staying in local mode:", err);
      if (!cloudEnabled) setCloudStatusUI("local");
      if (showFeedback) {
        showToast("クラウド同期に失敗しました（通信環境をご確認ください）");
      }
      return false;
    } finally {
      cloudSyncInFlight = false;
      if (elBtnCloudSync) {
        elBtnCloudSync.disabled = false;
        elBtnCloudSync.textContent = "↻ 再同期";
      }
    }
  }

  async function persistActivePageNow(showFeedback = false) {
    const page = getActivePage();
    if (!page) return;
    page.updatedAt = Date.now();
    setSaveStatus("保存中...", true);
    try {
      if (db) {
        await dbPutPage(db, page);
        await dbSetMeta(db, "activePageId", page.id);
      }

      let syncedCloud = false;
      if (cloudEnabled) {
        const res = await cloudFetch(`/api/pages/${encodeURIComponent(page.id)}`, {
          method: "PUT",
          body: JSON.stringify(page),
        });
        if (res.status === 401) {
          cloudEnabled = false;
          setCloudStatusUI("auth");
          showToast("ログインセッションが切れました。再読み込みして再ログインしてください");
        } else if (!res.ok) {
          throw new Error(`Cloud save failed (${res.status})`);
        } else {
          syncedCloud = true;
        }
      }

      const d = new Date(page.updatedAt);
      const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
      setSaveStatus(
        syncedCloud ? `☁ クラウド保存済み (${timeStr})` : `自動保存済み (${timeStr})`,
        false
      );
      renderSidebar();
      if (showFeedback) {
        showToast(syncedCloud ? "クラウドに保存しました" : "ページを保存しました");
      }
    } catch (err) {
      console.error("Failed to save page:", err);
      setSaveStatus("ローカル保存のみ（クラウド同期エラー）", true);
      if (showFeedback) {
        showToast("クラウド保存に失敗しました（ローカルには保存済みです）");
      }
    }
  }

  function scheduleSave() {
    setSaveStatus("編集あり...", true);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persistActivePageNow(false);
    }, 250);
  }

  function openImageModal(src, caption) {
    if (!src) return;
    elModalImage.src = src;
    elModalCaption.textContent = caption || "構造式";
    elModal.classList.remove("is-hidden");
  }

  function closeImageModal() {
    elModal.classList.add("is-hidden");
    elModalImage.src = "";
  }

  // 全画面ページ一覧ギャラリー描画（目的物の構造式・収率を表示）
  function renderSidebar() {
    const sorted = [...pages].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const filtered = filterPagesByQuery(sorted, pageSearchQuery);
    elPageCount.textContent = String(sorted.length);
    elPageList.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gallery-empty-state";
      empty.textContent = pageSearchQuery.trim()
        ? `「${pageSearchQuery.trim()}」に一致するページが見つかりませんでした`
        : "保存済みのページがありません。「＋ 新規ページ作成」から始めましょう。";
      elPageList.appendChild(empty);
      return;
    }

    filtered.forEach((page) => {
      const summary = extractTargetProductSummary(page);
      const card = document.createElement("article");
      card.className = "page-card";
      card.dataset.pageId = page.id;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");

      // 上部: 目的物の構造プレビューエリア
      const thumb = document.createElement("div");
      thumb.className = "page-card-thumb";

      if (summary.imageDataUrl) {
        const img = document.createElement("img");
        img.src = summary.imageDataUrl;
        img.alt = `${page.title || "実験ページ"} の目的物構造`;
        thumb.appendChild(img);

        if (summary.imageCount > 1) {
          const morePill = document.createElement("span");
          morePill.className = "page-card-more-pill";
          morePill.textContent = `+${summary.imageCount - 1}`;
          thumb.appendChild(morePill);
        }
      } else {
        const emptyThumb = document.createElement("div");
        emptyThumb.className = "page-card-thumb-empty";
        emptyThumb.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="12 2 20.66 7 20.66 17 12 22 3.34 17 3.34 7 12 2"></polygon>
          </svg>
          <span>目的物の構造未登録</span>
        `;
        thumb.appendChild(emptyThumb);
      }

      if (summary.yieldPct !== null) {
        const yieldPill = document.createElement("span");
        yieldPill.className =
          "page-card-yield-pill" + (summary.yieldPct > 100.05 ? " is-over" : "");
        yieldPill.textContent = `収率 ${format1(summary.yieldPct)}%`;
        thumb.appendChild(yieldPill);
      }

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "page-card-delete";
      delBtn.title = "このページを削除";
      delBtn.setAttribute("aria-label", `${(page.title || "").trim() || "無題のページ"}を削除`);
      delBtn.textContent = "×";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleDeletePage(page.id);
      });
      thumb.appendChild(delBtn);

      // 下部: ページ名・目的物名・メタ情報
      const body = document.createElement("div");
      body.className = "page-card-body";

      const title = document.createElement("div");
      title.className = "page-card-title";
      title.textContent = (page.title || "").trim() || "無題のページ";

      const productLine = document.createElement("div");
      productLine.className = "page-card-product";
      productLine.textContent = summary.productName ? `目的物: ${summary.productName}` : "目的物名未入力";

      const tags = document.createElement("div");
      tags.className = "page-card-tags";

      const scaleChip = document.createElement("span");
      scaleChip.className = "page-meta-chip";
      scaleChip.textContent =
        parsePositiveNumber(page.scale) !== null ? `Scale ${page.scale} mmol` : "Scale未設定";
      tags.appendChild(scaleChip);

      const reagentChip = document.createElement("span");
      reagentChip.className = "page-meta-chip";
      reagentChip.textContent = `試薬 ${summary.reagentCount}件`;
      tags.appendChild(reagentChip);

      if (isValidNotionLink(page.notionUrl)) {
        const notionChip = document.createElement("span");
        notionChip.className = "page-meta-chip is-notion";
        notionChip.textContent = "Notion";
        tags.appendChild(notionChip);
      }

      const dateEl = document.createElement("div");
      dateEl.className = "page-card-date";
      dateEl.textContent = `更新: ${formatDateShort(page.updatedAt || Date.now())}`;

      body.appendChild(title);
      body.appendChild(productLine);
      body.appendChild(tags);
      body.appendChild(dateEl);

      card.appendChild(thumb);
      card.appendChild(body);

      const openHandler = () => {
        openPagePopup(page.id);
      };
      card.addEventListener("click", openHandler);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openHandler();
        }
      });

      elPageList.appendChild(card);
    });
  }

  // 1行分の計算表示を更新
  function updateReagentRowDisplay(trEl, reagent, scaleVal) {
    const calc = calculateRow(scaleVal, reagent);
    const mmolEl = trEl.querySelector(".js-mmol");
    const densityWrap = trEl.querySelector(".js-density-wrap");
    const amountEl = trEl.querySelector(".js-amount");

    mmolEl.textContent = format2(calc.mmol);

    if (reagent.state === "liquid") {
      densityWrap.classList.remove("is-hidden");
    } else {
      densityWrap.classList.add("is-hidden");
    }

    if (calc.amount !== null) {
      amountEl.textContent = `${format2(calc.amount)} ${calc.unit}`;
      amountEl.classList.remove("is-empty");
    } else {
      amountEl.textContent = "-";
      amountEl.classList.add("is-empty");
    }
  }

  function updateAllReagentCalculations() {
    const page = getActivePage();
    if (!page) return;
    const rows = elReagentTbody.querySelectorAll(".reagent-row");
    page.reagents.forEach((reagent, idx) => {
      if (rows[idx]) {
        updateReagentRowDisplay(rows[idx], reagent, page.scale);
      }
    });
  }

  function updateImageZoneDOM(trEl, reagent, inputMw, rowKind = "reagent") {
    const structures = ensureReagentStructures(reagent);
    const gallery = trEl.querySelector(".js-structures-gallery");
    const placeholderText = trEl.querySelector(".js-placeholder-text");
    const drawLabel = trEl.querySelector(".js-open-chem-label");
    const metaBadge = trEl.querySelector(".js-mw-meta");

    gallery.innerHTML = "";
    if (structures.length > 0) {
      gallery.classList.remove("is-hidden");
      gallery.classList.toggle("is-single", structures.length === 1);

      structures.forEach((st, idx) => {
        const card = document.createElement("div");
        card.className = "structure-card";
        card.dataset.structureId = st.id;

        if (st.imageDataUrl) {
          const img = document.createElement("img");
          img.className = "structure-card-img";
          img.src = st.imageDataUrl;
          img.alt = `${reagent.name || "構造式"} #${idx + 1}`;
          img.title = "クリックで拡大表示";
          img.addEventListener("click", () => {
            const captionParts = [reagent.name || `構造式 #${idx + 1}`];
            if (st.formula) captionParts.push(st.formula);
            if (st.mw) captionParts.push(`MW ${st.mw}`);
            openImageModal(st.imageDataUrl, captionParts.join(" / "));
          });
          card.appendChild(img);
        }

        if (st.formula || st.mw) {
          const meta = document.createElement("div");
          meta.className = "structure-card-meta";
          const parts = [];
          if (st.formula) parts.push(st.formula);
          if (st.mw) parts.push(st.mw);
          meta.textContent = parts.join(" · ");
          meta.title = meta.textContent;
          card.appendChild(meta);
        }

        const actions = document.createElement("div");
        actions.className = "structure-card-actions";

        if (st.molfile || st.smiles) {
          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "btn-struct-act";
          editBtn.textContent = "編集";
          editBtn.title = "この構造式をエディタで編集";
          editBtn.addEventListener("click", () => {
            openStructureEditor({
              reagent,
              trEl,
              inputMw: inputMw || trEl.querySelector(".js-mw"),
              structureId: st.id,
              rowKind,
            });
          });
          actions.appendChild(editBtn);
        }

        if (st.imageDataUrl) {
          const searchBtn = document.createElement("button");
          searchBtn.type = "button";
          searchBtn.className = "btn-struct-act";
          searchBtn.textContent = "検索";
          searchBtn.title = "この画像をGoogle画像検索";
          searchBtn.addEventListener("click", async () => {
            const copied = await copyImageDataUrlToClipboard(st.imageDataUrl);
            window.open("https://www.google.com/imghp?hl=ja", "_blank", "noopener,noreferrer");
            if (copied) {
              showToast("画像をコピーしてGoogle画像検索を開きました（開いた画面で Cmd+V を押してください）");
            } else {
              showToast("Google画像検索を開きました（画像を右クリック→コピーして貼り付けてください）");
            }
          });
          actions.appendChild(searchBtn);
        }

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-struct-act is-danger";
        delBtn.textContent = "×";
        delBtn.title = "この構造式を削除";
        delBtn.setAttribute("aria-label", "この構造式を削除");
        delBtn.addEventListener("click", () => {
          const hadMw = parsePositiveNumber(st.mw) !== null;
          reagent.structures = reagent.structures.filter((item) => item.id !== st.id);

          const mwInputEl = inputMw || trEl.querySelector(".js-mw");
          if (hadMw) {
            const { totalMw, countWithMw } = sumStructuresMW(reagent.structures);
            if (totalMw !== null) {
              reagent.mw = format2(totalMw);
              if (mwInputEl) mwInputEl.value = reagent.mw;
              const formulas = reagent.structures.map((s) => s.formula).filter(Boolean);
              if (countWithMw === 1 && reagent.structures.length === 1) {
                const only = reagent.structures[0];
                reagent.mwMeta = only.formula
                  ? `分子式: ${only.formula}${only.exactMass ? ` / Exact: ${only.exactMass}` : ""}`
                  : "";
              } else {
                reagent.mwMeta =
                  formulas.length > 0
                    ? `合計MW: ${reagent.mw} (${formulas.join(" + ")})`
                    : `構造式 ${reagent.structures.length}件・合計MW: ${reagent.mw}`;
              }
            } else {
              reagent.mw = "";
              if (mwInputEl) mwInputEl.value = "";
              reagent.mwMeta = "";
            }
            const current = getActivePage();
            if (rowKind === "result") {
              updateResultRowDisplay(trEl, reagent, current ? current.scale : "");
            } else {
              updateReagentRowDisplay(trEl, reagent, current ? current.scale : "");
            }
          }

          updateImageZoneDOM(trEl, reagent, mwInputEl, rowKind);
          persistActivePageNow(false);
        });
        actions.appendChild(delBtn);

        card.appendChild(actions);
        gallery.appendChild(card);
      });

      if (placeholderText) {
        placeholderText.textContent = `さらに画像を追加（現在 ${structures.length} 件）`;
      }
      if (drawLabel) {
        drawLabel.textContent = "＋ 構造式を追加";
      }
    } else {
      gallery.classList.add("is-hidden");
      gallery.classList.remove("is-single");
      if (placeholderText) {
        placeholderText.textContent =
          rowKind === "result" ? "写真・構造式を貼付 / 追加" : "構造式画像を貼付 / 追加";
      }
      if (drawLabel) {
        drawLabel.textContent = "＋ 構造式を描く";
      }
    }

    const hasMeta = Boolean(reagent.mwMeta);
    if (hasMeta) {
      metaBadge.textContent = reagent.mwMeta;
      metaBadge.classList.remove("is-hidden");
    } else {
      metaBadge.textContent = "";
      metaBadge.classList.add("is-hidden");
    }
  }

  async function applyImageFileToReagent(file, reagent, trEl, rowKind = "reagent") {
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      const structures = ensureReagentStructures(reagent);
      structures.push(createStructureItem({ imageDataUrl: dataUrl }));
      updateImageZoneDOM(trEl, reagent, trEl.querySelector(".js-mw"), rowKind);
      await persistActivePageNow(false);
      showToast(`画像を追加しました（計 ${structures.length} 件）`);
    } catch (err) {
      showToast(err.message || "画像の読み込みに失敗しました");
    }
  }

  function createReagentRowElement(reagent) {
    const page = getActivePage();
    const frag = elReagentTemplate.content.cloneNode(true);
    const tr = frag.querySelector(".reagent-row");
    tr.dataset.reagentId = reagent.id;

    const cellReagent = tr.querySelector(".cell-reagent");
    const inputName = tr.querySelector(".js-name");
    const btnLookupMw = tr.querySelector(".js-lookup-mw");
    const imageZone = tr.querySelector(".js-image-zone");
    const fileInput = tr.querySelector(".js-file-input");
    const btnOpenChemEditor = tr.querySelector(".js-open-chem-editor");

    const selectState = tr.querySelector(".js-state");
    const inputEq = tr.querySelector(".js-eq");
    const inputMw = tr.querySelector(".js-mw");
    const inputDensity = tr.querySelector(".js-density");
    const btnDeleteRow = tr.querySelector(".js-delete-row");

    ensureReagentStructures(reagent);
    inputName.value = reagent.name || "";
    selectState.value = reagent.state === "liquid" ? "liquid" : "solid";
    inputEq.value = reagent.eq ?? "";
    inputMw.value = reagent.mw ?? "";
    inputDensity.value = reagent.density ?? "";

    updateImageZoneDOM(tr, reagent, inputMw);
    updateReagentRowDisplay(tr, reagent, page ? page.scale : "");

    // テキスト（化学式・略称・化合物名・CAS・SMILES）から MW 自動取得
    btnLookupMw.addEventListener("click", async () => {
      const query = inputName.value.trim();
      if (!query) {
        showToast("試薬名・化学式・CAS番号・SMILESを入力してください");
        inputName.focus();
        return;
      }

      // 1) まずはオフライン辞書＆化学式パーサーで即時計算
      const localResult = lookupLocalReagent(query);
      if (localResult) {
        reagent.mw = format2(localResult.mw);
        inputMw.value = reagent.mw;
        let densityNote = "";
        if (localResult.state === "liquid" && localResult.density && !reagent.density) {
          reagent.state = "liquid";
          selectState.value = "liquid";
          reagent.density = String(localResult.density);
          inputDensity.value = reagent.density;
          densityNote = ` / 密度 ${reagent.density}`;
        }
        const formulaLabel = localResult.formula ? autoFormatChemicalFormula(localResult.formula) : "";
        reagent.mwMeta = `${localResult.source}${formulaLabel ? `: ${formulaLabel}` : ""}${densityNote}`;
        updateImageZoneDOM(tr, reagent);
        const current = getActivePage();
        updateReagentRowDisplay(tr, reagent, current ? current.scale : "");
        persistActivePageNow(false);
        showToast(`MW ${reagent.mw} を取得しました（${localResult.source}）`);
        return;
      }

      // 2) PubChem API で化合物名・CAS・SMILES検索
      btnLookupMw.disabled = true;
      btnLookupMw.textContent = "検索中...";
      try {
        const pubchem = await lookupPubChemMW(query);
        if (!pubchem) {
          showToast("該当する化合物が見つかりませんでした（化学式・英語名・CAS・SMILESでお試しください）");
          return;
        }
        reagent.mw = format2(pubchem.mw);
        inputMw.value = reagent.mw;
        const formulaLabel = pubchem.formula ? autoFormatChemicalFormula(pubchem.formula) : "";
        reagent.mwMeta = `${pubchem.source}${formulaLabel ? `: ${formulaLabel}` : ""}`;
        updateImageZoneDOM(tr, reagent);
        const current = getActivePage();
        updateReagentRowDisplay(tr, reagent, current ? current.scale : "");
        persistActivePageNow(false);
        showToast(`MW ${reagent.mw} を取得しました（${pubchem.source}）`);
      } catch (err) {
        console.error("PubChem lookup error:", err);
        showToast("オンライン検索に失敗しました（通信環境をご確認ください）");
      } finally {
        btnLookupMw.disabled = false;
        btnLookupMw.textContent = "MW取得";
      }
    });

    // 構造式エディタを開く（この試薬行に新しい構造式を追加）
    btnOpenChemEditor.addEventListener("click", () => {
      openStructureEditor({ reagent, trEl: tr, inputMw, structureId: null });
    });

    // 画像ファイル選択（複数ファイル対応）
    imageZone.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", async () => {
      if (fileInput.files && fileInput.files.length > 0) {
        const files = Array.from(fileInput.files);
        for (const f of files) {
          await applyImageFileToReagent(f, reagent, tr);
        }
        fileInput.value = "";
      }
    });

    // ペースト対応（セル内の入力欄または画像ゾーンにフォーカス時）
    const handlePaste = (e) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData || !clipboardData.items) return;
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type && item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            applyImageFileToReagent(file, reagent, tr);
          }
          return;
        }
      }
    };
    cellReagent.addEventListener("paste", handlePaste);

    // ドラッグ＆ドロップ対応（複数ファイル対応）
    const handleDragOver = (e) => {
      e.preventDefault();
      imageZone.classList.add("is-dragover");
    };
    const handleDragLeave = () => {
      imageZone.classList.remove("is-dragover");
    };
    const handleDrop = async (e) => {
      e.preventDefault();
      imageZone.classList.remove("is-dragover");
      const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      for (const f of files) {
        if (f.type && f.type.startsWith("image/")) {
          await applyImageFileToReagent(f, reagent, tr);
        }
      }
    };
    cellReagent.addEventListener("dragover", handleDragOver);
    cellReagent.addEventListener("dragleave", handleDragLeave);
    cellReagent.addEventListener("drop", handleDrop);

    // 入力イベント
    inputName.addEventListener("input", () => {
      reagent.name = inputName.value;
      scheduleSave();
    });

    selectState.addEventListener("change", () => {
      reagent.state = selectState.value;
      const current = getActivePage();
      updateReagentRowDisplay(tr, reagent, current ? current.scale : "");
      scheduleSave();
    });

    inputEq.addEventListener("input", () => {
      reagent.eq = inputEq.value;
      const current = getActivePage();
      updateReagentRowDisplay(tr, reagent, current ? current.scale : "");
      scheduleSave();
    });

    inputMw.addEventListener("input", () => {
      reagent.mw = inputMw.value;
      const current = getActivePage();
      updateReagentRowDisplay(tr, reagent, current ? current.scale : "");
      scheduleSave();
    });

    inputDensity.addEventListener("input", () => {
      reagent.density = inputDensity.value;
      const current = getActivePage();
      updateReagentRowDisplay(tr, reagent, current ? current.scale : "");
      scheduleSave();
    });

    btnDeleteRow.addEventListener("click", () => {
      const current = getActivePage();
      if (!current) return;
      current.reagents = current.reagents.filter((r) => r.id !== reagent.id);
      if (current.reagents.length === 0) {
        current.reagents.push(createEmptyReagent());
      }
      renderReagentTable();
      persistActivePageNow(false);
    });

    return tr;
  }

  function renderReagentTable() {
    const page = getActivePage();
    elReagentTbody.innerHTML = "";
    if (!page) return;
    page.reagents.forEach((reagent) => {
      elReagentTbody.appendChild(createReagentRowElement(reagent));
    });
  }

  // 溶媒テーブル描画
  function updateSolventTotal() {
    const page = getActivePage();
    if (!page) return;
    let sum = 0;
    let count = 0;
    page.solvents.forEach((s) => {
      const v = parsePositiveNumber(s.volume);
      if (v !== null) {
        sum += v;
        count += 1;
      }
    });
    if (count > 0) {
      elSolventTotal.textContent = `合計: ${format2(sum)} mL`;
      elSolventTotal.classList.remove("is-hidden");
    } else {
      elSolventTotal.classList.add("is-hidden");
    }
  }

  function createSolventRowElement(solvent) {
    const frag = elSolventTemplate.content.cloneNode(true);
    const tr = frag.querySelector(".solvent-row");
    const inputName = tr.querySelector(".js-solvent-name");
    const inputVol = tr.querySelector(".js-solvent-vol");
    const btnDelete = tr.querySelector(".js-delete-solvent");

    inputName.value = solvent.name || "";
    inputVol.value = solvent.volume ?? "";

    inputName.addEventListener("input", () => {
      solvent.name = inputName.value;
      scheduleSave();
    });

    inputVol.addEventListener("input", () => {
      solvent.volume = inputVol.value;
      updateSolventTotal();
      scheduleSave();
    });

    btnDelete.addEventListener("click", () => {
      const page = getActivePage();
      if (!page) return;
      page.solvents = page.solvents.filter((s) => s.id !== solvent.id);
      if (page.solvents.length === 0) {
        page.solvents.push(createEmptySolvent());
      }
      renderSolventTable();
      persistActivePageNow(false);
    });

    return tr;
  }

  function renderSolventTable() {
    const page = getActivePage();
    elSolventTbody.innerHTML = "";
    if (!page) return;
    page.solvents.forEach((solvent) => {
      elSolventTbody.appendChild(createSolventRowElement(solvent));
    });
    updateSolventTotal();
  }

  // 結果テーブル描画 & 計算
  function updateResultRowDisplay(trEl, result, scaleVal) {
    const calc = calculateResultRow(scaleVal, result);
    const densityWrap = trEl.querySelector(".js-result-density-wrap");
    const mmolEl = trEl.querySelector(".js-result-mmol");
    const yieldEl = trEl.querySelector(".js-result-yield");

    if (result.unit === "mL") {
      densityWrap.classList.remove("is-hidden");
    } else {
      densityWrap.classList.add("is-hidden");
    }

    mmolEl.textContent = format2(calc.mmol);

    if (calc.yieldPct !== null) {
      yieldEl.textContent = `${format1(calc.yieldPct)} %`;
      yieldEl.classList.remove("is-empty");
      yieldEl.classList.toggle("is-over", calc.yieldPct > 100.05);
    } else {
      yieldEl.textContent = "-";
      yieldEl.classList.add("is-empty");
      yieldEl.classList.remove("is-over");
    }
  }

  function updateAllResultCalculations() {
    const page = getActivePage();
    if (!page) return;
    const results = ensurePageResults(page);
    const rows = elResultTbody.querySelectorAll(".result-row");
    results.forEach((res, idx) => {
      if (rows[idx]) {
        updateResultRowDisplay(rows[idx], res, page.scale);
      }
    });
  }

  function createResultRowElement(result) {
    const page = getActivePage();
    const frag = elResultTemplate.content.cloneNode(true);
    const tr = frag.querySelector(".result-row");
    tr.dataset.resultId = result.id;

    const cellProduct = tr.querySelector(".cell-reagent");
    const inputName = tr.querySelector(".js-result-name");
    const btnLookupMw = tr.querySelector(".js-lookup-mw");
    const imageZone = tr.querySelector(".js-image-zone");
    const fileInput = tr.querySelector(".js-file-input");
    const btnOpenChemEditor = tr.querySelector(".js-open-chem-editor");

    const inputAmount = tr.querySelector(".js-result-amount");
    const selectUnit = tr.querySelector(".js-result-unit");
    const inputDensity = tr.querySelector(".js-result-density");
    const inputMw = tr.querySelector(".js-mw");
    const btnDelete = tr.querySelector(".js-delete-result");

    ensureReagentStructures(result);
    inputName.value = result.name || "";
    inputAmount.value = result.amount ?? "";
    selectUnit.value = result.unit === "mL" ? "mL" : "mg";
    inputDensity.value = result.density ?? "";
    inputMw.value = result.mw ?? "";

    updateImageZoneDOM(tr, result, inputMw, "result");
    updateResultRowDisplay(tr, result, page ? page.scale : "");

    // テキストから MW 自動取得
    btnLookupMw.addEventListener("click", async () => {
      const query = inputName.value.trim();
      if (!query) {
        showToast("生成物名・化学式・CAS番号・SMILESを入力してください");
        inputName.focus();
        return;
      }

      const localResult = lookupLocalReagent(query);
      if (localResult) {
        result.mw = format2(localResult.mw);
        inputMw.value = result.mw;
        let densityNote = "";
        if (localResult.state === "liquid" && localResult.density && result.unit === "mL" && !result.density) {
          result.density = String(localResult.density);
          inputDensity.value = result.density;
          densityNote = ` / 密度 ${result.density}`;
        }
        const formulaLabel = localResult.formula ? autoFormatChemicalFormula(localResult.formula) : "";
        result.mwMeta = `${localResult.source}${formulaLabel ? `: ${formulaLabel}` : ""}${densityNote}`;
        updateImageZoneDOM(tr, result, inputMw, "result");
        const current = getActivePage();
        updateResultRowDisplay(tr, result, current ? current.scale : "");
        persistActivePageNow(false);
        showToast(`MW ${result.mw} を取得しました（${localResult.source}）`);
        return;
      }

      btnLookupMw.disabled = true;
      btnLookupMw.textContent = "検索中...";
      try {
        const pubchem = await lookupPubChemMW(query);
        if (!pubchem) {
          showToast("該当する化合物が見つかりませんでした（化学式・英語名・CAS・SMILESでお試しください）");
          return;
        }
        result.mw = format2(pubchem.mw);
        inputMw.value = result.mw;
        const formulaLabel = pubchem.formula ? autoFormatChemicalFormula(pubchem.formula) : "";
        result.mwMeta = `${pubchem.source}${formulaLabel ? `: ${formulaLabel}` : ""}`;
        updateImageZoneDOM(tr, result, inputMw, "result");
        const current = getActivePage();
        updateResultRowDisplay(tr, result, current ? current.scale : "");
        persistActivePageNow(false);
        showToast(`MW ${result.mw} を取得しました（${pubchem.source}）`);
      } catch (err) {
        console.error("PubChem lookup error:", err);
        showToast("オンライン検索に失敗しました（通信環境をご確認ください）");
      } finally {
        btnLookupMw.disabled = false;
        btnLookupMw.textContent = "MW取得";
      }
    });

    // 構造式エディタを開く（この結果行に新しい構造式を追加）
    btnOpenChemEditor.addEventListener("click", () => {
      openStructureEditor({
        reagent: result,
        trEl: tr,
        inputMw,
        structureId: null,
        rowKind: "result",
      });
    });

    // 写真・画像ファイル選択
    imageZone.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", async () => {
      if (fileInput.files && fileInput.files.length > 0) {
        const files = Array.from(fileInput.files);
        for (const f of files) {
          await applyImageFileToReagent(f, result, tr, "result");
        }
        fileInput.value = "";
      }
    });

    // ペースト対応
    cellProduct.addEventListener("paste", (e) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData || !clipboardData.items) return;
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type && item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            applyImageFileToReagent(file, result, tr, "result");
          }
          return;
        }
      }
    });

    // ドラッグ＆ドロップ対応
    cellProduct.addEventListener("dragover", (e) => {
      e.preventDefault();
      imageZone.classList.add("is-dragover");
    });
    cellProduct.addEventListener("dragleave", () => {
      imageZone.classList.remove("is-dragover");
    });
    cellProduct.addEventListener("drop", async (e) => {
      e.preventDefault();
      imageZone.classList.remove("is-dragover");
      const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      for (const f of files) {
        if (f.type && f.type.startsWith("image/")) {
          await applyImageFileToReagent(f, result, tr, "result");
        }
      }
    });

    // 各入力イベント
    inputName.addEventListener("input", () => {
      result.name = inputName.value;
      scheduleSave();
    });

    inputAmount.addEventListener("input", () => {
      result.amount = inputAmount.value;
      const current = getActivePage();
      updateResultRowDisplay(tr, result, current ? current.scale : "");
      scheduleSave();
    });

    selectUnit.addEventListener("change", () => {
      result.unit = selectUnit.value;
      const current = getActivePage();
      updateResultRowDisplay(tr, result, current ? current.scale : "");
      scheduleSave();
    });

    inputDensity.addEventListener("input", () => {
      result.density = inputDensity.value;
      const current = getActivePage();
      updateResultRowDisplay(tr, result, current ? current.scale : "");
      scheduleSave();
    });

    inputMw.addEventListener("input", () => {
      result.mw = inputMw.value;
      const current = getActivePage();
      updateResultRowDisplay(tr, result, current ? current.scale : "");
      scheduleSave();
    });

    btnDelete.addEventListener("click", () => {
      const current = getActivePage();
      if (!current) return;
      current.results = ensurePageResults(current).filter((item) => item.id !== result.id);
      if (current.results.length === 0) {
        current.results.push(createEmptyResult());
      }
      renderResultTable();
      persistActivePageNow(false);
    });

    return tr;
  }

  function renderResultTable() {
    const page = getActivePage();
    elResultTbody.innerHTML = "";
    if (!page) return;
    const results = ensurePageResults(page);
    results.forEach((result) => {
      elResultTbody.appendChild(createResultRowElement(result));
    });
  }

  function updateNotionLinkUI(urlValue) {
    const trimmed = String(urlValue || "").trim();
    const setButtonsDisabled = () => {
      [elBtnOpenNotionApp, elBtnOpenNotionWeb].forEach((btn) => {
        btn.href = "#";
        btn.classList.add("is-disabled");
        btn.setAttribute("aria-disabled", "true");
      });
    };

    if (!trimmed) {
      setButtonsDisabled();
      elNotionUrlHint.textContent = "";
      elNotionUrlHint.classList.add("is-hidden");
      return;
    }

    if (isValidNotionLink(trimmed)) {
      elBtnOpenNotionApp.href = toNotionAppUrl(trimmed);
      elBtnOpenNotionApp.classList.remove("is-disabled");
      elBtnOpenNotionApp.setAttribute("aria-disabled", "false");

      elBtnOpenNotionWeb.href = toNotionWebUrl(trimmed);
      elBtnOpenNotionWeb.classList.remove("is-disabled");
      elBtnOpenNotionWeb.setAttribute("aria-disabled", "false");

      elNotionUrlHint.textContent = "";
      elNotionUrlHint.classList.add("is-hidden");
    } else {
      setButtonsDisabled();
      elNotionUrlHint.textContent = "https:// または notion:// で始まるURLを入力してください。";
      elNotionUrlHint.classList.remove("is-hidden");
    }
  }

  // アクティブページの描画
  function renderActivePage() {
    const page = getActivePage();
    if (!page) return;
    elPageTitleInput.value = page.title || "";
    elNotionUrlInput.value = page.notionUrl || "";
    updateNotionLinkUI(page.notionUrl || "");
    elScaleInput.value = page.scale ?? "";
    renderReagentTable();
    renderSolventTable();
    renderResultTable();
    renderSidebar();
  }

  async function openPagePopup(pageId) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await persistActivePageNow(false);
    }
    activePageId = pageId;
    if (db) {
      await dbSetMeta(db, "activePageId", activePageId);
    }
    renderActivePage();
    pagePopupOpen = true;
    elPagePopupModal.classList.remove("is-hidden");
    document.body.style.overflow = "hidden";
    if (elPagePopupBody) elPagePopupBody.scrollTop = 0;
    setSaveStatus("読み込み済み", false);
  }

  async function closePagePopup() {
    if (!pagePopupOpen) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await persistActivePageNow(false);
    }
    pagePopupOpen = false;
    elPagePopupModal.classList.add("is-hidden");
    document.body.style.overflow = "";
    renderSidebar();
  }

  async function handleCreateNewPage() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await persistActivePageNow(false);
    }
    const newPage = createNewPageModel(pages.length + 1);
    pages.push(newPage);
    activePageId = newPage.id;
    await persistActivePageNow(false);
    await openPagePopup(newPage.id);
    elPageTitleInput.focus();
    elPageTitleInput.select();
    showToast(`「${newPage.title}」を作成しました`);
  }

  async function handleDeletePage(pageId) {
    const target = pages.find((p) => p.id === pageId);
    if (!target) return;
    const titleLabel = (target.title || "").trim() || "無題のページ";
    const confirmed = window.confirm(`ページ「${titleLabel}」を削除してもよろしいですか？`);
    if (!confirmed) return;

    const wasActive = activePageId === pageId;
    pages = pages.filter((p) => p.id !== pageId);
    if (db) {
      await dbDeletePage(db, pageId);
    }
    if (cloudEnabled) {
      try {
        const res = await cloudFetch(`/api/pages/${encodeURIComponent(pageId)}`, {
          method: "DELETE",
        });
        if (res.status === 401) {
          cloudEnabled = false;
          setCloudStatusUI("auth");
        }
      } catch (err) {
        console.error("Cloud delete failed:", err);
      }
    }

    if (wasActive && pagePopupOpen) {
      pagePopupOpen = false;
      elPagePopupModal.classList.add("is-hidden");
      document.body.style.overflow = "";
    }

    if (pages.length === 0) {
      activePageId = null;
    } else if (wasActive) {
      const sorted = [...pages].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      activePageId = sorted[0].id;
      if (db) {
        await dbSetMeta(db, "activePageId", activePageId);
      }
    }

    renderSidebar();
    showToast(`「${titleLabel}」を削除しました`);
  }

  // =========================================================================
  // 5.5 化学構造式エディタ (JSME + OpenChemLib) コントローラ
  // =========================================================================

  let jsmeScriptLoaded = Boolean(window.__jsmeReady || (window.JSApplet && window.JSApplet.JSME));
  let jsmeApplet = null;
  let editorModalOpen = false;
  let editorTarget = null; // { reagent, trEl, inputMw } | null
  let pendingLoadData = null; // { molfile, smiles } | null
  let isApplyingHistory = false;
  let chemHistory = [""];
  let chemHistoryIndex = 0;

  let currentChemState = {
    formulaRaw: "",
    formulaPretty: "",
    mw: "",
    exactMass: "",
    smiles: "",
    molfile: "",
    svg: "",
  };

  function getOCL() {
    const lib = window.OCL;
    if (!lib) return null;
    if (lib.Molecule) return lib;
    if (lib.default && lib.default.Molecule) return lib.default;
    return null;
  }

  function updateHistoryButtons() {
    elBtnChemUndo.disabled = chemHistoryIndex <= 0;
    elBtnChemRedo.disabled = chemHistoryIndex >= chemHistory.length - 1;
  }

  function resetChemHistory(initialMolfile) {
    chemHistory = [initialMolfile || ""];
    chemHistoryIndex = 0;
    updateHistoryButtons();
  }

  function pushChemHistory(molfile) {
    const val = molfile || "";
    if (chemHistory[chemHistoryIndex] === val) return;
    chemHistory = chemHistory.slice(0, chemHistoryIndex + 1);
    chemHistory.push(val);
    if (chemHistory.length > 50) {
      chemHistory.shift();
    }
    chemHistoryIndex = chemHistory.length - 1;
    updateHistoryButtons();
  }

  function clearChemPropsDisplay() {
    currentChemState = {
      formulaRaw: "",
      formulaPretty: "",
      mw: "",
      exactMass: "",
      smiles: "",
      molfile: "",
      svg: "",
    };
    elPropFormula.textContent = "-";
    elPropMw.textContent = "-";
    elPropExactMass.textContent = "-";
    elPropSmiles.textContent = "-";
    elChemSvgPreview.innerHTML =
      '<span class="chem-svg-empty">構造式を描画するとプレビューが表示されます</span>';
  }

  /**
   * Molfile（先頭空行を含むヘッダを壊さないよう trim しない）または SMILES から OCL.Molecule を生成
   */
  function parseOclMolecule(OCL, molfile, smiles) {
    if (!OCL) return { mol: null, usedMolfile: false };
    const hasMolfile = typeof molfile === "string" && molfile.trim().length > 0;
    const rawSmiles = String(smiles || "").trim();

    let mol = null;
    let usedMolfile = false;
    if (hasMolfile) {
      try {
        const candidate = OCL.Molecule.fromMolfile(molfile);
        if (candidate && candidate.getAllAtoms() > 0) {
          mol = candidate;
          usedMolfile = true;
        }
      } catch (err) {
        console.warn("OCL fromMolfile fallback to SMILES:", err);
      }
    }

    if ((!mol || mol.getAllAtoms() === 0) && rawSmiles) {
      try {
        const candidate = OCL.Molecule.fromSmiles(rawSmiles);
        if (candidate && candidate.getAllAtoms() > 0) {
          candidate.inventCoordinates();
          mol = candidate;
          usedMolfile = false;
        }
      } catch (err) {
        console.error("OCL fromSmiles parse error:", err);
      }
    }

    return { mol, usedMolfile };
  }

  function computeAndRenderChemProperties(molfile, fallbackSmiles) {
    const OCL = getOCL();
    const hasMolfile = typeof molfile === "string" && molfile.trim().length > 0;
    const rawSmiles = String(fallbackSmiles || "").trim();

    if (!hasMolfile && !rawSmiles) {
      clearChemPropsDisplay();
      return;
    }

    if (!OCL) {
      elPropSmiles.textContent = rawSmiles || "-";
      elPropFormula.textContent = "計算ライブラリ読込中...";
      return;
    }

    const { mol, usedMolfile } = parseOclMolecule(OCL, molfile, rawSmiles);

    if (!mol || mol.getAllAtoms() === 0) {
      clearChemPropsDisplay();
      return;
    }

    const mf = mol.getMolecularFormula();
    const formulaRaw = mf.formula || "";
    const formulaPretty = autoFormatChemicalFormula(formulaRaw);
    const mwStr = Number.isFinite(mf.relativeWeight) ? mf.relativeWeight.toFixed(2) : "-";
    const exactMassStr = Number.isFinite(mf.absoluteWeight) ? mf.absoluteWeight.toFixed(4) : "-";
    const smilesStr = mol.toSmiles() || rawSmiles;
    let svgStr = "";
    try {
      svgStr = mol.toSVG(560, 380, "ocl-mol", {
        autoCrop: true,
        autoCropMargin: 20,
      });
    } catch (err) {
      console.error("OpenChemLib toSVG error:", err);
    }

    currentChemState = {
      formulaRaw,
      formulaPretty,
      mw: mwStr,
      exactMass: exactMassStr,
      smiles: smilesStr,
      molfile: usedMolfile ? molfile : mol.toMolfile(),
      svg: svgStr,
    };

    elPropFormula.textContent = formulaPretty || "-";
    elPropMw.textContent = mwStr;
    elPropExactMass.textContent = exactMassStr;
    elPropSmiles.textContent = smilesStr || "-";

    if (svgStr) {
      elChemSvgPreview.innerHTML = svgStr;
    } else {
      elChemSvgPreview.innerHTML =
        '<span class="chem-svg-empty">プレビューを生成できませんでした</span>';
    }
  }

  function syncFromJsme(recordHistory = true) {
    if (!jsmeApplet) return;
    let molfile = "";
    let smiles = "";
    try {
      smiles = jsmeApplet.smiles() || "";
      molfile = jsmeApplet.molFile() || "";
    } catch (err) {
      console.error("JSME read error:", err);
    }
    if (!smiles.trim() && (!molfile.trim() || !/V2000|V3000/.test(molfile))) {
      molfile = "";
    }
    if (recordHistory && !isApplyingHistory) {
      pushChemHistory(molfile);
    }
    computeAndRenderChemProperties(molfile, smiles);
  }

  function loadMolfileIntoJsme(molfile, { resetHistory = false, recordHistory = false } = {}) {
    if (!jsmeApplet) return;
    isApplyingHistory = true;
    try {
      if (molfile && molfile.trim()) {
        jsmeApplet.readMolFile(molfile);
      } else {
        jsmeApplet.reset();
      }
    } catch (err) {
      console.error("JSME load error:", err);
    } finally {
      isApplyingHistory = false;
    }
    if (resetHistory) {
      resetChemHistory(molfile || "");
    } else if (recordHistory) {
      pushChemHistory(molfile || "");
    }
    syncFromJsme(false);
  }

  function loadSmilesIntoEditor(rawSmiles, { resetHistory = false } = {}) {
    const smiles = String(rawSmiles || "").trim();
    if (!smiles) {
      showToast("SMILES文字列を入力してください");
      return false;
    }
    if (!jsmeApplet) {
      showToast("エディタの読み込み完了をお待ちください");
      return false;
    }

    const OCL = getOCL();
    if (OCL) {
      try {
        const mol = OCL.Molecule.fromSmiles(smiles);
        if (!mol || mol.getAllAtoms() === 0) {
          showToast("有効なSMILESではありません");
          return false;
        }
        mol.inventCoordinates();
        const molfile = mol.toMolfile();
        loadMolfileIntoJsme(molfile, {
          resetHistory,
          recordHistory: !resetHistory,
        });
        return true;
      } catch (err) {
        console.error("OCL SMILES parse error:", err);
        showToast("SMILESの解析に失敗しました（記法を確認してください）");
        return false;
      }
    }

    // OCL未読込時のフォールバック
    try {
      jsmeApplet.readGenericMolecularInput(smiles);
      syncFromJsme(!resetHistory);
      if (resetHistory) resetChemHistory(currentChemState.molfile);
      return true;
    } catch (err) {
      showToast("SMILESの読み込みに失敗しました");
      return false;
    }
  }

  function mountJsmeEditor() {
    if (jsmeApplet || !jsmeScriptLoaded || !editorModalOpen) return;
    const width = Math.max(400, Math.floor(elJsmeContainer.clientWidth || 540));
    const height = 390;
    try {
      jsmeApplet = new window.JSApplet.JSME("jsme-container", `${width}px`, `${height}px`, {
        options: "newlook",
      });
      jsmeApplet.setCallBack("AfterStructureModified", () => {
        syncFromJsme(true);
      });
      elJsmeLoading.classList.add("is-hidden");

      if (pendingLoadData) {
        const data = pendingLoadData;
        pendingLoadData = null;
        if (data.molfile) {
          loadMolfileIntoJsme(data.molfile, { resetHistory: true });
        } else if (data.smiles) {
          loadSmilesIntoEditor(data.smiles, { resetHistory: true });
        } else {
          loadMolfileIntoJsme("", { resetHistory: true });
        }
      } else {
        resetChemHistory("");
        clearChemPropsDisplay();
      }
    } catch (err) {
      console.error("Failed to mount JSME:", err);
      elJsmeLoading.textContent = "構造式エディタの初期化に失敗しました（通信環境をご確認ください）";
    }
  }

  // JSME ロード完了イベント
  window.addEventListener("jsme-ready", () => {
    jsmeScriptLoaded = true;
    if (editorModalOpen && !jsmeApplet) {
      mountJsmeEditor();
    }
  });

  window.addEventListener("ocl-ready", () => {
    if (editorModalOpen && jsmeApplet) {
      syncFromJsme(false);
    }
  });

  function openStructureEditor(target = null) {
    editorTarget = target;
    editorModalOpen = true;
    elEditorModal.classList.remove("is-hidden");

    let initialData = { molfile: "", smiles: "" };
    const existingMw =
      target && target.reagent ? parsePositiveNumber(target.reagent.mw) : null;

    if (target && target.reagent) {
      const isResultRow = target.rowKind === "result";
      const rowNoun = isResultRow ? "結果欄" : "試薬欄";
      const structures = ensureReagentStructures(target.reagent);
      const editingItem = target.structureId
        ? structures.find((s) => s.id === target.structureId) || null
        : null;

      const labelBase = target.reagent.name
        ? `対象: ${target.reagent.name}`
        : `対象: 選択した${isResultRow ? "結果行" : "試薬行"}`;
      if (editingItem) {
        const idx = structures.indexOf(editingItem) + 1;
        elEditorTargetNote.textContent = `${labelBase}（構造式 #${idx} を編集中）`;
        elEditorApply.textContent = "この構造式を更新（合計MW反映）";
        initialData = {
          molfile: editingItem.molfile || "",
          smiles: editingItem.smiles || "",
        };
        elEditorMwModeWrap.classList.toggle("is-hidden", structures.length <= 1 && existingMw === null);
        elEditorMwMode.value = "sum";
      } else {
        elEditorTargetNote.textContent =
          structures.length > 0
            ? `${labelBase}（現在 ${structures.length} 件 → 追加してMWを合算）`
            : `${labelBase}（構造式を追加）`;
        elEditorApply.textContent =
          structures.length > 0 ? "構造式を追加（合計MW反映）" : `この${rowNoun}に反映（画像・MW）`;
        if (structures.length > 0 || existingMw !== null) {
          elEditorMwModeWrap.classList.remove("is-hidden");
          elEditorMwMode.value = "sum";
        } else {
          elEditorMwModeWrap.classList.add("is-hidden");
          elEditorMwMode.value = "sum";
        }
      }
    } else {
      elEditorTargetNote.textContent = "新しい試薬行として追加できます";
      elEditorApply.textContent = "新しい試薬行として追加";
      elEditorMwModeWrap.classList.add("is-hidden");
      elEditorMwMode.value = "replace";
    }

    elSmilesLoadInput.value = initialData.smiles || "";

    if (!jsmeApplet) {
      pendingLoadData = initialData;
      elJsmeLoading.classList.remove("is-hidden");
      requestAnimationFrame(() => {
        if (window.JSApplet && window.JSApplet.JSME) {
          jsmeScriptLoaded = true;
        }
        mountJsmeEditor();
      });
    } else {
      if (initialData.molfile) {
        loadMolfileIntoJsme(initialData.molfile, { resetHistory: true });
      } else if (initialData.smiles) {
        loadSmilesIntoEditor(initialData.smiles, { resetHistory: true });
      } else {
        loadMolfileIntoJsme("", { resetHistory: true });
      }
    }
  }

  function closeStructureEditor() {
    if (lassoModeActive) {
      setLassoMode(false);
    }
    editorModalOpen = false;
    elEditorModal.classList.add("is-hidden");
  }

  // =========================================================================
  // 5.6 投げ縄選択・自由回転・移動・削除モード (OpenChemLib 座標操作)
  // =========================================================================

  let lassoModeActive = false;
  let lassoMol = null;
  let lassoSelected = new Set();
  let lassoView = { scale: 40, offsetX: 250, offsetY: 170 };
  let lassoInteraction = null; // { mode: 'lasso'|'move'|'rotate', ... }
  let lassoLiveAngleDeg = null;

  const ATOM_COLORS = {
    O: "#dc2626",
    N: "#2563eb",
    S: "#b45309",
    P: "#ea580c",
    F: "#15803d",
    Cl: "#15803d",
    Br: "#9a3412",
    I: "#7e22ce",
    B: "#be185d",
    Si: "#0f766e",
  };

  function worldToScreen(wx, wy) {
    return {
      x: lassoView.offsetX + wx * lassoView.scale,
      y: lassoView.offsetY + wy * lassoView.scale,
    };
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - lassoView.offsetX) / lassoView.scale,
      y: (sy - lassoView.offsetY) / lassoView.scale,
    };
  }

  function fitLassoView(mol) {
    const rect = elLassoCanvas.getBoundingClientRect();
    const cw = Math.max(300, rect.width || 520);
    const ch = Math.max(240, rect.height || 340);
    if (!mol || mol.getAllAtoms() === 0) {
      lassoView = { scale: 40, offsetX: cw / 2, offsetY: ch / 2 };
      return;
    }
    const pts = [];
    const n = mol.getAllAtoms();
    for (let i = 0; i < n; i++) {
      pts.push({ x: mol.getAtomX(i), y: mol.getAtomY(i) });
    }
    const b = computePointsBounds(pts);
    const padX = 76;
    const padY = 76;
    const availW = Math.max(80, cw - padX * 2);
    const availH = Math.max(80, ch - padY * 2);
    let scale = 42;
    if (b.width > 0.01 || b.height > 0.01) {
      const sx = b.width > 0.01 ? availW / b.width : 80;
      const sy = b.height > 0.01 ? availH / b.height : 80;
      scale = Math.max(12, Math.min(72, Math.min(sx, sy)));
    }
    lassoView = {
      scale,
      offsetX: cw / 2 - b.cx * scale,
      offsetY: ch / 2 - b.cy * scale,
    };
  }

  function updateLassoSubbarUI() {
    const count = lassoSelected.size;
    elBtnLassoDeselect.disabled = count === 0;
    elBtnLassoDelete.disabled = count === 0;
    if (count > 0) {
      elLassoStatus.textContent = `選択中: ${count} 原子（枠内ドラッグで移動・上ハンドルで回転 / Shiftで15°刻み）`;
    } else {
      elLassoStatus.textContent = "ドラッグで囲んで投げ縄選択 ／ ダブルクリックで分子全体を選択";
    }
  }

  function getSelectionScreenGeometry() {
    if (!lassoMol || lassoSelected.size === 0) return null;
    const pts = [];
    lassoSelected.forEach((idx) => {
      if (idx < lassoMol.getAllAtoms()) {
        pts.push(worldToScreen(lassoMol.getAtomX(idx), lassoMol.getAtomY(idx)));
      }
    });
    if (pts.length === 0) return null;
    const b = computePointsBounds(pts);
    const pad = 18;
    const minX = b.minX - pad;
    const minY = b.minY - pad;
    const maxX = b.maxX + pad;
    const maxY = b.maxY + pad;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const handleX = cx;
    const handleY = Math.max(18, minY - 26);
    return { minX, minY, maxX, maxY, cx, cy, handleX, handleY };
  }

  function renderLassoCanvas() {
    if (!lassoModeActive) return;
    const rect = elLassoCanvas.getBoundingClientRect();
    const cw = Math.max(300, Math.floor(rect.width || 520));
    const ch = Math.max(240, Math.floor(rect.height || 340));
    const dpr = window.devicePixelRatio || 1;
    if (elLassoCanvas.width !== Math.round(cw * dpr) || elLassoCanvas.height !== Math.round(ch * dpr)) {
      elLassoCanvas.width = Math.round(cw * dpr);
      elLassoCanvas.height = Math.round(ch * dpr);
    }

    const ctx = elLassoCanvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);

    if (!lassoMol || lassoMol.getAllAtoms() === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("構造式が描かれていません（「描画に戻る」から作図してください）", cw / 2, ch / 2);
      ctx.restore();
      return;
    }

    const atomCount = lassoMol.getAllAtoms();
    const bondCount = lassoMol.getAllBonds();
    const screenAtoms = [];
    for (let i = 0; i < atomCount; i++) {
      screenAtoms.push(worldToScreen(lassoMol.getAtomX(i), lassoMol.getAtomY(i)));
    }

    // 1. 選択原子のソフトハイライト
    lassoSelected.forEach((i) => {
      if (i >= atomCount) return;
      const p = screenAtoms[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(37, 99, 235, 0.16)";
      ctx.fill();
      ctx.strokeStyle = "rgba(37, 99, 235, 0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });

    // 2. 結合描画（OpenChemLibの引数は getBondAtom(0|1, bondIndex)）
    const atomDegrees = new Array(atomCount).fill(0);
    ctx.lineCap = "round";
    for (let b = 0; b < bondCount; b++) {
      const a1 = lassoMol.getBondAtom(0, b);
      const a2 = lassoMol.getBondAtom(1, b);
      const p1 = screenAtoms[a1];
      const p2 = screenAtoms[a2];
      if (!p1 || !p2) continue;
      atomDegrees[a1] += 1;
      atomDegrees[a2] += 1;
      const order = lassoMol.getBondOrder(b);
      const isBothSel = lassoSelected.has(a1) && lassoSelected.has(a2);
      const strokeColor = isBothSel ? "#2563eb" : "#0f172a";

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist;
      const ny = dx / dist;

      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = strokeColor;

      if (order === 2) {
        const off = 2.8;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(p1.x + nx * off, p1.y + ny * off);
        ctx.lineTo(p2.x + nx * off, p2.y + ny * off);
        ctx.moveTo(p1.x - nx * off, p1.y - ny * off);
        ctx.lineTo(p2.x - nx * off, p2.y - ny * off);
        ctx.stroke();
      } else if (order === 3) {
        const off = 3.8;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.moveTo(p1.x + nx * off, p1.y + ny * off);
        ctx.lineTo(p2.x + nx * off, p2.y + ny * off);
        ctx.moveTo(p1.x - nx * off, p1.y - ny * off);
        ctx.lineTo(p2.x - nx * off, p2.y - ny * off);
        ctx.stroke();
      } else {
        const bType = typeof lassoMol.getBondType === "function" ? lassoMol.getBondType(b) : 1;
        // OCL stereo up (cBondTypeUp = 129) / down (cBondTypeDown = 257)
        if (bType === 129) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x + nx * 4.5, p2.y + ny * 4.5);
          ctx.lineTo(p2.x - nx * 4.5, p2.y - ny * 4.5);
          ctx.closePath();
          ctx.fill();
        } else if (bType === 257) {
          ctx.lineWidth = 1.5;
          const steps = 6;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const halfW = 4.5 * t;
            const bx = p1.x + dx * t;
            const by = p1.y + dy * t;
            ctx.beginPath();
            ctx.moveTo(bx + nx * halfW, by + ny * halfW);
            ctx.lineTo(bx - nx * halfW, by - ny * halfW);
            ctx.stroke();
          }
        } else {
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }

    // 3. ヘテロ原子・荷電原子・孤立炭素のラベル描画
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < atomCount; i++) {
      const label = lassoMol.getAtomLabel(i);
      const charge = typeof lassoMol.getAtomCharge === "function" ? lassoMol.getAtomCharge(i) : 0;
      const conn = atomDegrees[i];
      if (label === "C" && charge === 0 && conn > 0) continue;

      const p = screenAtoms[i];
      let text = label;
      if (charge !== 0) {
        const sign = charge > 0 ? "+" : "-";
        const absC = Math.abs(charge);
        text += toSuperscript(absC > 1 ? `${absC}${sign}` : sign);
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, 9.5, 0, Math.PI * 2);
      ctx.fillStyle = lassoSelected.has(i) ? "#eff6ff" : "#ffffff";
      ctx.fill();

      ctx.font = "700 13px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = lassoSelected.has(i) ? "#1d4ed8" : ATOM_COLORS[label] || "#0f172a";
      ctx.fillText(text, p.x, p.y + 0.5);
    }

    // 4. 選択範囲バウンディングボックス & 回転ハンドル
    const geom = getSelectionScreenGeometry();
    if (geom) {
      ctx.save();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.3;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(geom.minX, geom.minY, geom.maxX - geom.minX, geom.maxY - geom.minY);
      ctx.setLineDash([]);

      // 回転ハンドルへの接続線
      ctx.beginPath();
      ctx.moveTo(geom.cx, geom.minY);
      ctx.lineTo(geom.handleX, geom.handleY + 10);
      ctx.stroke();

      // 回転ハンドル円
      ctx.beginPath();
      ctx.arc(geom.handleX, geom.handleY, 10, 0, Math.PI * 2);
      ctx.fillStyle = lassoInteraction && lassoInteraction.mode === "rotate" ? "#2563eb" : "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = "#2563eb";
      ctx.stroke();

      // 回転アイコン (↻)
      ctx.fillStyle = lassoInteraction && lassoInteraction.mode === "rotate" ? "#ffffff" : "#2563eb";
      ctx.font = "700 13px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("↻", geom.handleX, geom.handleY + 0.5);

      // 回転中の角度バッジ
      if (lassoLiveAngleDeg !== null) {
        const rounded = Math.round(lassoLiveAngleDeg);
        const angleLabel = `${rounded >= 0 ? "+" : ""}${rounded}°`;
        const bx = geom.handleX + 18;
        const by = geom.handleY;
        ctx.font = "700 11px -apple-system, BlinkMacSystemFont, sans-serif";
        const tw = ctx.measureText(angleLabel).width + 12;
        ctx.fillStyle = "#0f172a";
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(bx, by - 10, tw, 20, 5);
        } else {
          ctx.rect(bx, by - 10, tw, 20);
        }
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.fillText(angleLabel, bx + 6, by + 0.5);
      }
      ctx.restore();
    }

    // 5. 投げ縄ドラッグ軌跡
    if (lassoInteraction && lassoInteraction.mode === "lasso" && lassoInteraction.points.length > 1) {
      const pts = lassoInteraction.points;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
      ctx.fill();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  function reloadLassoMoleculeFromCurrent(keepSelection = false, refit = true) {
    const OCL = getOCL();
    if (!OCL) {
      lassoMol = null;
      lassoSelected.clear();
      updateLassoSubbarUI();
      renderLassoCanvas();
      return;
    }
    const { mol } = parseOclMolecule(OCL, currentChemState.molfile, currentChemState.smiles);
    lassoMol = mol && mol.getAllAtoms() > 0 ? mol : null;
    if (!keepSelection || !lassoMol) {
      lassoSelected.clear();
    } else {
      const n = lassoMol.getAllAtoms();
      lassoSelected = new Set(Array.from(lassoSelected).filter((i) => i < n));
    }
    if (refit) {
      fitLassoView(lassoMol);
    }
    updateLassoSubbarUI();
    renderLassoCanvas();
  }

  function commitLassoMolToEditor(recordHistory = true) {
    if (!lassoMol) return;
    const updatedMolfile = lassoMol.getAllAtoms() > 0 ? lassoMol.toMolfile() : "";
    loadMolfileIntoJsme(updatedMolfile, { recordHistory });
    reloadLassoMoleculeFromCurrent(true, false);
  }

  function setLassoMode(active) {
    if (active) {
      const OCL = getOCL();
      if (!OCL) {
        showToast("計算ライブラリの読み込み完了をお待ちください");
        return;
      }
      syncFromJsme(false);
    }
    lassoModeActive = Boolean(active);
    elLassoOverlay.classList.toggle("is-hidden", !lassoModeActive);
    elBtnChemLasso.classList.toggle("is-active", lassoModeActive);
    elBtnChemLasso.setAttribute("aria-pressed", String(lassoModeActive));
    lassoInteraction = null;
    lassoLiveAngleDeg = null;

    if (lassoModeActive) {
      requestAnimationFrame(() => {
        reloadLassoMoleculeFromCurrent(false, true);
      });
    }
  }

  function rotateCurrentMolecule(angleDeg) {
    const OCL = getOCL();
    if (!OCL || !jsmeApplet) return;

    let mol = null;
    if (lassoModeActive && lassoMol && lassoMol.getAllAtoms() > 0) {
      mol = lassoMol;
    } else {
      syncFromJsme(false);
      mol = parseOclMolecule(OCL, currentChemState.molfile, currentChemState.smiles).mol;
    }

    if (!mol || mol.getAllAtoms() === 0) {
      showToast("回転する構造式が描かれていません");
      return;
    }

    const n = mol.getAllAtoms();
    const targetIndices =
      lassoModeActive && lassoSelected.size > 0
        ? Array.from(lassoSelected).filter((i) => i < n)
        : Array.from({ length: n }, (_, i) => i);

    if (targetIndices.length === 0) return;

    const pts = targetIndices.map((i) => ({ x: mol.getAtomX(i), y: mol.getAtomY(i) }));
    const b = computePointsBounds(pts);
    targetIndices.forEach((i) => {
      const rot = rotatePoint2D(mol.getAtomX(i), mol.getAtomY(i), b.cx, b.cy, angleDeg);
      mol.setAtomX(i, rot.x);
      mol.setAtomY(i, rot.y);
    });

    const updatedMolfile = mol.toMolfile();
    loadMolfileIntoJsme(updatedMolfile, { recordHistory: true });
    if (lassoModeActive) {
      reloadLassoMoleculeFromCurrent(true, false);
    }
  }

  function deleteLassoSelectedAtoms() {
    if (!lassoMol || lassoSelected.size === 0) return;
    const indices = Array.from(lassoSelected).sort((a, b) => b - a);
    if (
      typeof lassoMol.markAtomForDeletion === "function" &&
      typeof lassoMol.deleteMarkedAtomsAndBonds === "function"
    ) {
      indices.forEach((i) => lassoMol.markAtomForDeletion(i));
      lassoMol.deleteMarkedAtomsAndBonds();
    } else {
      indices.forEach((i) => lassoMol.deleteAtom(i));
    }
    lassoSelected.clear();
    commitLassoMolToEditor(true);
    showToast("選択した部分を削除しました");
  }

  function findConnectedFragment(mol, startAtom) {
    const visited = new Set([startAtom]);
    const queue = [startAtom];
    const bondCount = mol.getAllBonds();
    while (queue.length > 0) {
      const curr = queue.shift();
      for (let b = 0; b < bondCount; b++) {
        const a1 = mol.getBondAtom(0, b);
        const a2 = mol.getBondAtom(1, b);
        if (a1 === curr && !visited.has(a2)) {
          visited.add(a2);
          queue.push(a2);
        } else if (a2 === curr && !visited.has(a1)) {
          visited.add(a1);
          queue.push(a1);
        }
      }
    }
    return visited;
  }

  function findNearestAtomOnCanvas(sx, sy, maxDist = 16) {
    if (!lassoMol) return -1;
    const n = lassoMol.getAllAtoms();
    let bestIdx = -1;
    let bestDist = maxDist;
    for (let i = 0; i < n; i++) {
      const p = worldToScreen(lassoMol.getAtomX(i), lassoMol.getAtomY(i));
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d <= bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function getCanvasPointerPos(e) {
    const rect = elLassoCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  elLassoCanvas.addEventListener("pointerdown", (e) => {
    if (!lassoModeActive || !lassoMol || lassoMol.getAllAtoms() === 0) return;
    const pos = getCanvasPointerPos(e);
    elLassoCanvas.setPointerCapture(e.pointerId);

    const geom = getSelectionScreenGeometry();
    // 1. 回転ハンドルを掴んだか
    if (geom && Math.hypot(pos.x - geom.handleX, pos.y - geom.handleY) <= 15) {
      const selectedList = Array.from(lassoSelected);
      const worldPts = selectedList.map((i) => ({
        i,
        x: lassoMol.getAtomX(i),
        y: lassoMol.getAtomY(i),
      }));
      const wb = computePointsBounds(worldPts);
      const pivotScreen = worldToScreen(wb.cx, wb.cy);
      const startAngle = Math.atan2(pos.y - pivotScreen.y, pos.x - pivotScreen.x);
      lassoInteraction = {
        mode: "rotate",
        worldPts,
        pivotWorld: { x: wb.cx, y: wb.cy },
        pivotScreen,
        startAngle,
      };
      lassoLiveAngleDeg = 0;
      elLassoCanvas.style.cursor = "grabbing";
      renderLassoCanvas();
      return;
    }

    // 2. 選択枠内をドラッグ → 選択部分を移動
    if (
      geom &&
      !e.shiftKey &&
      pos.x >= geom.minX &&
      pos.x <= geom.maxX &&
      pos.y >= geom.minY &&
      pos.y <= geom.maxY
    ) {
      const selectedList = Array.from(lassoSelected);
      const worldPts = selectedList.map((i) => ({
        i,
        x: lassoMol.getAtomX(i),
        y: lassoMol.getAtomY(i),
      }));
      lassoInteraction = {
        mode: "move",
        startPos: pos,
        worldPts,
        moved: false,
      };
      elLassoCanvas.style.cursor = "move";
      return;
    }

    // 3. 空き領域ドラッグ → 投げ縄フリーハンド選択
    lassoInteraction = {
      mode: "lasso",
      points: [pos],
      additive: e.shiftKey,
    };
    elLassoCanvas.style.cursor = "crosshair";
    renderLassoCanvas();
  });

  elLassoCanvas.addEventListener("pointermove", (e) => {
    if (!lassoModeActive || !lassoMol) return;
    const pos = getCanvasPointerPos(e);

    if (!lassoInteraction) {
      const geom = getSelectionScreenGeometry();
      if (geom && Math.hypot(pos.x - geom.handleX, pos.y - geom.handleY) <= 15) {
        elLassoCanvas.style.cursor = "grab";
      } else if (
        geom &&
        pos.x >= geom.minX &&
        pos.x <= geom.maxX &&
        pos.y >= geom.minY &&
        pos.y <= geom.maxY
      ) {
        elLassoCanvas.style.cursor = "move";
      } else {
        elLassoCanvas.style.cursor = "crosshair";
      }
      return;
    }

    if (lassoInteraction.mode === "rotate") {
      const currAngle = Math.atan2(
        pos.y - lassoInteraction.pivotScreen.y,
        pos.x - lassoInteraction.pivotScreen.x
      );
      let deltaDeg = ((currAngle - lassoInteraction.startAngle) * 180) / Math.PI;
      if (deltaDeg > 180) deltaDeg -= 360;
      if (deltaDeg < -180) deltaDeg += 360;
      if (e.shiftKey) {
        deltaDeg = Math.round(deltaDeg / 15) * 15;
      }
      lassoLiveAngleDeg = deltaDeg;
      lassoInteraction.worldPts.forEach(({ i, x, y }) => {
        const rot = rotatePoint2D(
          x,
          y,
          lassoInteraction.pivotWorld.x,
          lassoInteraction.pivotWorld.y,
          deltaDeg
        );
        lassoMol.setAtomX(i, rot.x);
        lassoMol.setAtomY(i, rot.y);
      });
      renderLassoCanvas();
      return;
    }

    if (lassoInteraction.mode === "move") {
      const dxScreen = pos.x - lassoInteraction.startPos.x;
      const dyScreen = pos.y - lassoInteraction.startPos.y;
      if (Math.hypot(dxScreen, dyScreen) > 2) {
        lassoInteraction.moved = true;
      }
      const dxWorld = dxScreen / lassoView.scale;
      const dyWorld = dyScreen / lassoView.scale;
      lassoInteraction.worldPts.forEach(({ i, x, y }) => {
        lassoMol.setAtomX(i, x + dxWorld);
        lassoMol.setAtomY(i, y + dyWorld);
      });
      renderLassoCanvas();
      return;
    }

    if (lassoInteraction.mode === "lasso") {
      const last = lassoInteraction.points[lassoInteraction.points.length - 1];
      if (Math.hypot(pos.x - last.x, pos.y - last.y) >= 3) {
        lassoInteraction.points.push(pos);
        renderLassoCanvas();
      }
    }
  });

  function finishLassoPointer(e) {
    if (!lassoInteraction) return;
    const interaction = lassoInteraction;
    lassoInteraction = null;
    lassoLiveAngleDeg = null;
    elLassoCanvas.style.cursor = "crosshair";

    if (interaction.mode === "rotate") {
      commitLassoMolToEditor(true);
      return;
    }

    if (interaction.mode === "move") {
      if (interaction.moved) {
        commitLassoMolToEditor(true);
      } else {
        renderLassoCanvas();
      }
      return;
    }

    if (interaction.mode === "lasso" && lassoMol) {
      const pts = interaction.points;
      const polyBounds = computePointsBounds(pts);
      const isTinyClick =
        pts.length < 4 || (polyBounds && polyBounds.width < 8 && polyBounds.height < 8);

      if (isTinyClick) {
        const pos = getCanvasPointerPos(e);
        const hitAtom = findNearestAtomOnCanvas(pos.x, pos.y, 16);
        if (hitAtom !== -1) {
          if (interaction.additive) {
            if (lassoSelected.has(hitAtom)) lassoSelected.delete(hitAtom);
            else lassoSelected.add(hitAtom);
          } else {
            lassoSelected = new Set([hitAtom]);
          }
        } else if (!interaction.additive) {
          lassoSelected.clear();
        }
      } else {
        const nextSet = interaction.additive ? new Set(lassoSelected) : new Set();
        const n = lassoMol.getAllAtoms();
        for (let i = 0; i < n; i++) {
          const sp = worldToScreen(lassoMol.getAtomX(i), lassoMol.getAtomY(i));
          if (pointInPolygon(sp.x, sp.y, pts)) {
            nextSet.add(i);
          }
        }
        lassoSelected = nextSet;
      }
      updateLassoSubbarUI();
      renderLassoCanvas();
    }
  }

  elLassoCanvas.addEventListener("pointerup", finishLassoPointer);
  elLassoCanvas.addEventListener("pointercancel", finishLassoPointer);

  elLassoCanvas.addEventListener("dblclick", (e) => {
    if (!lassoModeActive || !lassoMol) return;
    const pos = getCanvasPointerPos(e);
    const hitAtom = findNearestAtomOnCanvas(pos.x, pos.y, 18);
    if (hitAtom !== -1) {
      lassoSelected = findConnectedFragment(lassoMol, hitAtom);
      updateLassoSubbarUI();
      renderLassoCanvas();
    }
  });

  elBtnChemLasso.addEventListener("click", () => {
    setLassoMode(!lassoModeActive);
  });
  elBtnLassoDone.addEventListener("click", () => setLassoMode(false));
  elBtnLassoSelectAll.addEventListener("click", () => {
    if (!lassoMol) return;
    lassoSelected = new Set(Array.from({ length: lassoMol.getAllAtoms() }, (_, i) => i));
    updateLassoSubbarUI();
    renderLassoCanvas();
  });
  elBtnLassoDeselect.addEventListener("click", () => {
    lassoSelected.clear();
    updateLassoSubbarUI();
    renderLassoCanvas();
  });
  elBtnLassoDelete.addEventListener("click", deleteLassoSelectedAtoms);

  document.querySelectorAll(".js-chem-rotate").forEach((btn) => {
    btn.addEventListener("click", () => {
      const angle = Number(btn.dataset.angle);
      if (Number.isFinite(angle)) {
        rotateCurrentMolecule(angle);
      }
    });
  });

  function svgToPngResult(svgStr, { transparent = false, scale = 2 } = {}) {
    return new Promise((resolve, reject) => {
      if (!svgStr) {
        reject(new Error("構造式が空です"));
        return;
      }
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgStr, "image/svg+xml");
      const svgEl = doc.documentElement;
      let w = parseFloat(svgEl.getAttribute("width")) || 560;
      let h = parseFloat(svgEl.getAttribute("height")) || 380;
      const viewBox = svgEl.getAttribute("viewBox");
      if (viewBox) {
        const vbParts = viewBox.trim().split(/[\s,]+/).map(Number);
        if (vbParts.length === 4 && vbParts[2] > 0 && vbParts[3] > 0) {
          w = vbParts[2];
          h = vbParts[3];
        }
      }
      svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svgEl.setAttribute("width", String(w));
      svgEl.setAttribute("height", String(h));

      const serialized = new XMLSerializer().serializeToString(svgEl);
      const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
      const blobUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        if (!transparent) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(blobUrl);
        const dataUrl = canvas.toDataURL("image/png");
        canvas.toBlob((pngBlob) => {
          resolve({ dataUrl, blob: pngBlob });
        }, "image/png");
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error("PNG画像への変換に失敗しました"));
      };
      img.src = blobUrl;
    });
  }

  function triggerDownloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getExportFileBaseName() {
    const base =
      (editorTarget && editorTarget.reagent && editorTarget.reagent.name.trim()) ||
      currentChemState.formulaRaw ||
      "structure";
    return base.replace(/[\\/:*?"<>|\s]+/g, "_");
  }

  // エディタ内操作イベント
  elBtnOpenEditorStandalone.addEventListener("click", () => openStructureEditor(null));
  elEditorBackdrop.addEventListener("click", closeStructureEditor);
  elEditorClose.addEventListener("click", closeStructureEditor);
  elEditorCancel.addEventListener("click", closeStructureEditor);

  elBtnChemClean.addEventListener("click", () => {
    const OCL = getOCL();
    if (!OCL || !jsmeApplet) return;
    if (!lassoModeActive) syncFromJsme(false);
    const { mol } = parseOclMolecule(OCL, currentChemState.molfile, currentChemState.smiles);
    if (!mol || mol.getAllAtoms() === 0) {
      showToast("整形する構造式が描かれていません");
      return;
    }
    try {
      mol.inventCoordinates();
      const cleaned = mol.toMolfile();
      loadMolfileIntoJsme(cleaned, { recordHistory: true });
      if (lassoModeActive) reloadLassoMoleculeFromCurrent(false, true);
      showToast("2D座標をきれいに整形しました");
    } catch (err) {
      console.error("Clean failed:", err);
      showToast("座標整形に失敗しました");
    }
  });

  elBtnChemUndo.addEventListener("click", () => {
    if (chemHistoryIndex <= 0) return;
    chemHistoryIndex -= 1;
    updateHistoryButtons();
    loadMolfileIntoJsme(chemHistory[chemHistoryIndex], { resetHistory: false, recordHistory: false });
    if (lassoModeActive) reloadLassoMoleculeFromCurrent(false, true);
  });

  elBtnChemRedo.addEventListener("click", () => {
    if (chemHistoryIndex >= chemHistory.length - 1) return;
    chemHistoryIndex += 1;
    updateHistoryButtons();
    loadMolfileIntoJsme(chemHistory[chemHistoryIndex], { resetHistory: false, recordHistory: false });
    if (lassoModeActive) reloadLassoMoleculeFromCurrent(false, true);
  });

  elBtnChemClear.addEventListener("click", () => {
    loadMolfileIntoJsme("", { recordHistory: true });
    elSmilesLoadInput.value = "";
    if (lassoModeActive) reloadLassoMoleculeFromCurrent(false, true);
    showToast("キャンバスを消去しました");
  });

  elBtnLoadSmiles.addEventListener("click", () => {
    if (loadSmilesIntoEditor(elSmilesLoadInput.value, { resetHistory: false })) {
      if (lassoModeActive) reloadLassoMoleculeFromCurrent(false, true);
      showToast("SMILESから構造式を読み込みました");
    }
  });

  elSmilesLoadInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      elBtnLoadSmiles.click();
    }
  });

  // 各物性値の個別コピーボタン
  document.querySelectorAll(".btn-copy-prop").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.copyProp;
      const valueMap = {
        formula: currentChemState.formulaPretty,
        mw: currentChemState.mw,
        exactMass: currentChemState.exactMass,
        smiles: currentChemState.smiles,
      };
      const labelMap = {
        formula: "分子式",
        mw: "分子量 (MW)",
        exactMass: "精密質量",
        smiles: "SMILES",
      };
      const val = valueMap[key];
      if (!val || val === "-") {
        showToast("コピーする値がありません");
        return;
      }
      window.__lastCopiedText = val;
      const ok = await copyToClipboard(val);
      showToast(ok ? `${labelMap[key]}をコピーしました` : "コピーに失敗しました");
    });
  });

  // SVG ダウンロード
  elBtnDownloadSvg.addEventListener("click", () => {
    if (!currentChemState.svg) {
      showToast("出力する構造式を描画してください");
      return;
    }
    const blob = new Blob([currentChemState.svg], { type: "image/svg+xml;charset=utf-8" });
    triggerDownloadBlob(blob, `${getExportFileBaseName()}.svg`);
    showToast("SVG画像をダウンロードしました");
  });

  // PNG ダウンロード
  elBtnDownloadPng.addEventListener("click", async () => {
    if (!currentChemState.svg) {
      showToast("出力する構造式を描画してください");
      return;
    }
    try {
      const { blob } = await svgToPngResult(currentChemState.svg, {
        transparent: elChkPngTransparent.checked,
        scale: 2,
      });
      if (!blob) throw new Error("PNG生成に失敗しました");
      triggerDownloadBlob(blob, `${getExportFileBaseName()}.png`);
      showToast("PNG画像をダウンロードしました");
    } catch (err) {
      showToast(err.message || "PNG出力に失敗しました");
    }
  });

  // PNG クリップボードコピー
  elBtnCopyPng.addEventListener("click", async () => {
    if (!currentChemState.svg) {
      showToast("コピーする構造式を描画してください");
      return;
    }
    try {
      const { blob } = await svgToPngResult(currentChemState.svg, {
        transparent: elChkPngTransparent.checked,
        scale: 2,
      });
      if (!blob || !navigator.clipboard || typeof ClipboardItem === "undefined") {
        showToast("このブラウザ環境ではPNGコピーに対応していません（PNGダウンロードをご利用ください）");
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("PNG画像をクリップボードにコピーしました");
    } catch (err) {
      console.error("Copy PNG failed:", err);
      showToast("画像のコピーに失敗しました（PNGダウンロードをご利用ください）");
    }
  });

  // 試薬欄に反映（複数構造式の追加・個別更新に対応）
  elEditorApply.addEventListener("click", async () => {
    if (!currentChemState.svg || !currentChemState.mw || currentChemState.mw === "-") {
      showToast("反映する構造式を描画してください");
      return;
    }
    try {
      const { dataUrl } = await svgToPngResult(currentChemState.svg, {
        transparent: false,
        scale: 2,
      });
      const newStructPayload = {
        imageDataUrl: dataUrl,
        molfile: currentChemState.molfile,
        smiles: currentChemState.smiles,
        formula: currentChemState.formulaPretty,
        mw: currentChemState.mw,
        exactMass: currentChemState.exactMass,
      };
      const page = getActivePage();
      if (!page) return;

      let toastMsg = `構造式と MW (${currentChemState.mw}) を反映しました`;

      if (editorTarget && editorTarget.reagent) {
        const r = editorTarget.reagent;
        const structures = ensureReagentStructures(r);
        const existingIdx = editorTarget.structureId
          ? structures.findIndex((s) => s.id === editorTarget.structureId)
          : -1;

        if (existingIdx !== -1) {
          structures[existingIdx] = createStructureItem({
            ...newStructPayload,
            id: structures[existingIdx].id,
          });
        } else {
          structures.push(createStructureItem(newStructPayload));
        }

        const mwMode = elEditorMwModeWrap.classList.contains("is-hidden")
          ? "sum"
          : elEditorMwMode.value;
        const { totalMw, countWithMw } = sumStructuresMW(structures);

        if (mwMode === "sum" && totalMw !== null) {
          r.mw = format2(totalMw);
          toastMsg =
            countWithMw > 1
              ? `構造式を反映し、合計 MW (${r.mw}) を分子量欄に反映しました（${countWithMw}件合算）`
              : `構造式と MW (${r.mw}) を分子量欄に反映しました`;
        } else if (mwMode === "replace") {
          r.mw = currentChemState.mw;
          toastMsg = `構造式を反映し MW (${r.mw}) で上書きしました`;
        } else {
          toastMsg =
            existingIdx !== -1
              ? "構造式を更新しました（MWは維持）"
              : `構造式を追加しました（計 ${structures.length} 件・MWは維持）`;
        }

        if (structures.length === 1) {
          r.mwMeta = `分子式: ${currentChemState.formulaPretty} / Exact: ${currentChemState.exactMass}`;
        } else {
          const formulas = structures.map((s) => s.formula).filter(Boolean);
          r.mwMeta =
            mwMode === "sum" && totalMw !== null
              ? `合計MW: ${format2(totalMw)}${formulas.length > 0 ? ` (${formulas.join(" + ")})` : ""}`
              : formulas.length > 0
              ? `構造式 ${structures.length}件 (${formulas.join(" + ")})`
              : `構造式 ${structures.length}件`;
        }

        if (editorTarget.inputMw) editorTarget.inputMw.value = r.mw;
        if (editorTarget.trEl) {
          const kind = editorTarget.rowKind === "result" ? "result" : "reagent";
          updateImageZoneDOM(editorTarget.trEl, r, editorTarget.inputMw, kind);
          if (kind === "result") {
            updateResultRowDisplay(editorTarget.trEl, r, page.scale);
          } else {
            updateReagentRowDisplay(editorTarget.trEl, r, page.scale);
          }
        }
      } else {
        const newRow = createEmptyReagent();
        newRow.structures.push(createStructureItem(newStructPayload));
        newRow.mw = currentChemState.mw;
        newRow.mwMeta = `分子式: ${currentChemState.formulaPretty} / Exact: ${currentChemState.exactMass}`;
        page.reagents.push(newRow);
        renderReagentTable();
      }

      await persistActivePageNow(false);
      closeStructureEditor();
      showToast(toastMsg);
    } catch (err) {
      console.error("Apply structure failed:", err);
      showToast("試薬欄への反映に失敗しました");
    }
  });

  // =========================================================================
  // 6. イベント登録 & 初期化
  // =========================================================================

  function closeBackupModal() {
    pendingBackupImport = null;
    elBackupModal.classList.add("is-hidden");
  }

  function openBackupModal(fileName, parsed) {
    pendingBackupImport = parsed;
    const sampleTitles = parsed.pages
      .slice(0, 4)
      .map((p) => p.title || "無題")
      .join("、");
    const moreLabel = parsed.pages.length > 4 ? ` ほか ${parsed.pages.length - 4} 件` : "";
    const exportedText = parsed.exportedAt
      ? formatDateShort(new Date(parsed.exportedAt).getTime())
      : "不明";

    elBackupPreviewBox.innerHTML = "";
    const line1 = document.createElement("div");
    line1.innerHTML = `ファイル: <strong></strong>`;
    line1.querySelector("strong").textContent = fileName;

    const line2 = document.createElement("div");
    line2.innerHTML = `含まれるページ数: <strong>${parsed.pages.length} 件</strong>（書き出し日時: ${exportedText}）`;

    const line3 = document.createElement("div");
    line3.textContent = `内容例: ${sampleTitles}${moreLabel}`;

    elBackupPreviewBox.appendChild(line1);
    elBackupPreviewBox.appendChild(line2);
    elBackupPreviewBox.appendChild(line3);

    const mergeRadio = elBackupModal.querySelector('input[name="backup-import-mode"][value="merge"]');
    if (mergeRadio) mergeRadio.checked = true;
    elBackupModal.classList.remove("is-hidden");
  }

  async function handleExportBackup() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await persistActivePageNow(false);
    }
    if (pages.length === 0) {
      showToast("書き出すページがありません");
      return;
    }
    const payload = buildBackupPayload(pages);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    triggerDownloadBlob(blob, `organic-eln-backup-${stamp}.json`);
    showToast(`${pages.length} 件のページをバックアップ書き出ししました`);
  }

  async function handleConfirmBackupImport() {
    if (!pendingBackupImport) return;
    const checked = elBackupModal.querySelector('input[name="backup-import-mode"]:checked');
    const mode = checked ? checked.value : "merge";

    if (mode === "replace" && pages.length > 0) {
      const ok = window.confirm(
        `現在の端末にある ${pages.length} 件のページをすべて置き換えます。よろしいですか？`
      );
      if (!ok) return;
    }

    const nextPages = mergeImportedPages(pages, pendingBackupImport.pages, mode);
    const importedCount = pendingBackupImport.pages.length;

    try {
      if (db) {
        await dbReplaceAllPages(db, nextPages);
      }
      if (cloudEnabled) {
        const res = await cloudFetch("/api/pages", {
          method: "POST",
          body: JSON.stringify({ mode, pages: nextPages }),
        });
        if (res.status === 401) {
          cloudEnabled = false;
          setCloudStatusUI("auth");
          showToast("ログインセッションが切れたため、クラウド反映には再読み込みが必要です");
        } else if (!res.ok) {
          throw new Error(`Cloud import failed (${res.status})`);
        }
      }
      pages = nextPages;
      if (pages.length > 0) {
        const sorted = [...pages].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        activePageId = sorted[0].id;
        if (db) {
          await dbSetMeta(db, "activePageId", activePageId);
        }
      }
      closeBackupModal();
      if (pagePopupOpen) {
        await closePagePopup();
      } else {
        renderSidebar();
      }
      showToast(
        mode === "replace"
          ? `バックアップから ${importedCount} 件のページを完全復元しました`
          : `バックアップから ${importedCount} 件のページを統合読み込みしました`
      );
    } catch (err) {
      console.error("Backup import failed:", err);
      showToast("バックアップの保存に失敗しました");
    }
  }

  elBtnExportBackup.addEventListener("click", handleExportBackup);
  elBtnImportBackup.addEventListener("click", () => {
    elBackupFileInput.click();
  });
  elBackupFileInput.addEventListener("change", () => {
    const file = elBackupFileInput.files && elBackupFileInput.files[0];
    elBackupFileInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseAndValidateBackup(reader.result);
      if (!parsed.ok) {
        showToast(parsed.error || "バックアップの読み込みに失敗しました");
        return;
      }
      openBackupModal(file.name, parsed);
    };
    reader.onerror = () => {
      showToast("ファイルの読み込みに失敗しました");
    };
    reader.readAsText(file, "utf-8");
  });

  elBackupModalBackdrop.addEventListener("click", closeBackupModal);
  elBackupModalClose.addEventListener("click", closeBackupModal);
  elBtnBackupCancel.addEventListener("click", closeBackupModal);
  elBtnBackupConfirm.addEventListener("click", handleConfirmBackupImport);

  if (elBtnCloudSync) {
    elBtnCloudSync.addEventListener("click", () => {
      syncFromCloud({ showFeedback: true, migrateLocalIfEmpty: false });
    });
  }
  if (elCloudStatusPill) {
    elCloudStatusPill.addEventListener("click", () => {
      if (elCloudStatusPill.classList.contains("is-auth")) {
        window.location.reload();
      }
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && cloudEnabled && !pagePopupOpen && !saveTimer) {
      syncFromCloud({ showFeedback: false, migrateLocalIfEmpty: false });
    }
  });

  elBtnNewPage.addEventListener("click", handleCreateNewPage);

  elPageSearchInput.addEventListener("input", () => {
    pageSearchQuery = elPageSearchInput.value;
    renderSidebar();
  });

  elBtnClosePagePopup.addEventListener("click", closePagePopup);
  elPagePopupBackdrop.addEventListener("click", closePagePopup);

  elBtnSavePage.addEventListener("click", () => {
    if (saveTimer) clearTimeout(saveTimer);
    persistActivePageNow(true);
  });

  elBtnDeletePage.addEventListener("click", () => {
    if (activePageId) handleDeletePage(activePageId);
  });

  elPageTitleInput.addEventListener("input", () => {
    const page = getActivePage();
    if (!page) return;
    page.title = elPageTitleInput.value;
    renderSidebar();
    scheduleSave();
  });

  elNotionUrlInput.addEventListener("input", () => {
    const page = getActivePage();
    if (!page) return;
    page.notionUrl = elNotionUrlInput.value.trim();
    updateNotionLinkUI(page.notionUrl);
    renderSidebar();
    scheduleSave();
  });

  [elBtnOpenNotionApp, elBtnOpenNotionWeb].forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (btn.classList.contains("is-disabled")) {
        e.preventDefault();
      }
    });
  });

  elScaleInput.addEventListener("input", () => {
    const page = getActivePage();
    if (!page) return;
    page.scale = elScaleInput.value;
    updateAllReagentCalculations();
    updateAllResultCalculations();
    renderSidebar();
    scheduleSave();
  });

  elBtnAddReagent.addEventListener("click", () => {
    const page = getActivePage();
    if (!page) return;
    const row = createEmptyReagent();
    page.reagents.push(row);
    const tr = createReagentRowElement(row);
    elReagentTbody.appendChild(tr);
    const nameInput = tr.querySelector(".js-name");
    if (nameInput) nameInput.focus();
    scheduleSave();
  });

  elBtnAddSolvent.addEventListener("click", () => {
    const page = getActivePage();
    if (!page) return;
    const s = createEmptySolvent();
    page.solvents.push(s);
    const tr = createSolventRowElement(s);
    elSolventTbody.appendChild(tr);
    const nameInput = tr.querySelector(".js-solvent-name");
    if (nameInput) nameInput.focus();
    scheduleSave();
  });

  elBtnAddResult.addEventListener("click", () => {
    const page = getActivePage();
    if (!page) return;
    const results = ensurePageResults(page);
    const res = createEmptyResult();
    results.push(res);
    const tr = createResultRowElement(res);
    elResultTbody.appendChild(tr);
    const nameInput = tr.querySelector(".js-result-name");
    if (nameInput) nameInput.focus();
    scheduleSave();
  });

  elBtnCopyNotion.addEventListener("click", async () => {
    const page = getActivePage();
    if (!page) return;
    const md = buildNotionMarkdown(page);
    window.__lastCopiedText = md;
    const ok = await copyToClipboard(md);
    if (ok) {
      showToast("コピーしました（Notion用 Markdown）");
    } else {
      showToast("コピーに失敗しました");
    }
  });

  elBtnCopyExcel.addEventListener("click", async () => {
    const page = getActivePage();
    if (!page) return;
    const tsv = buildExcelTSV(page);
    window.__lastCopiedText = tsv;
    const ok = await copyToClipboard(tsv);
    if (ok) {
      showToast("コピーしました（Excel用 TSV）");
    } else {
      showToast("コピーに失敗しました");
    }
  });

  elModalBackdrop.addEventListener("click", closeImageModal);
  elModalClose.addEventListener("click", closeImageModal);

  // 化学式ツールバー（mousedownでpreventDefaultして入力欄の選択範囲を維持）
  [elBtnSubscript, elBtnSuperscript, elBtnAutoFormula].forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
  });
  elBtnSubscript.addEventListener("click", () => handleScriptButtonAction("sub"));
  elBtnSuperscript.addEventListener("click", () => handleScriptButtonAction("sup"));
  elBtnAutoFormula.addEventListener("click", handleAutoFormatAction);

  // 数値入力欄でのホイール／トラックパッドスクロールによる意図しない値変更を防止
  // （blur することで値は変えず、ページ自体のスクロールは滑らかに継続する）
  document.addEventListener(
    "wheel",
    () => {
      const active = document.activeElement;
      if (active && active.tagName === "INPUT" && active.type === "number") {
        active.blur();
      }
    },
    { capture: true, passive: true }
  );

  document.addEventListener("focusin", (e) => {
    if (isFormulaTargetInput(e.target)) {
      lastFocusedFormulaInput = e.target;
      updateScriptModeUI();
    } else if (scriptInputMode !== "none") {
      updateScriptModeUI();
    }
  });

  document.addEventListener("keydown", (e) => {
    // 投げ縄モード中の Delete / Backspace で選択原子を削除
    if (
      lassoModeActive &&
      lassoSelected.size > 0 &&
      (e.key === "Delete" || e.key === "Backspace") &&
      !(e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"))
    ) {
      e.preventDefault();
      deleteLassoSelectedAtoms();
      return;
    }

    if (e.key === "Escape") {
      if (!elBackupModal.classList.contains("is-hidden")) {
        closeBackupModal();
        return;
      }
      if (lassoModeActive) {
        setLassoMode(false);
        return;
      }
      if (!elEditorModal.classList.contains("is-hidden")) {
        closeStructureEditor();
        return;
      }
      if (!elModal.classList.contains("is-hidden")) {
        closeImageModal();
        return;
      }
      if (scriptInputMode !== "none") {
        setScriptInputMode("none");
        showToast("通常入力モードに戻しました");
        return;
      }
      if (pagePopupOpen) {
        closePagePopup();
        return;
      }
    }

    if (!isFormulaTargetInput(e.target)) return;

    // ショートカット: Ctrl + , (下付き) / Ctrl + . (上付き)
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === ",") {
      e.preventDefault();
      handleScriptButtonAction("sub");
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === ".") {
      e.preventDefault();
      handleScriptButtonAction("sup");
      return;
    }

    // 上付き・下付き入力モード中のリアルタイム文字変換（IME変換中は干渉しない）
    if (
      scriptInputMode !== "none" &&
      !e.isComposing &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      e.key.length === 1
    ) {
      const map = scriptInputMode === "sub" ? SUB_MAP : SUP_MAP;
      const mapped = map[e.key];
      if (mapped) {
        e.preventDefault();
        const inputEl = e.target;
        const start = inputEl.selectionStart ?? inputEl.value.length;
        const end = inputEl.selectionEnd ?? inputEl.value.length;
        replaceInputRange(inputEl, start, end, mapped);
      }
    }
  });

  async function initApp() {
    try {
      db = await openDatabase();
      pages = await dbGetAllPages(db);
      const savedActiveId = await dbGetMeta(db, "activePageId");

      if (pages.length === 0) {
        const firstPage = createNewPageModel(1);
        firstPage.title = "YN-001";
        pages.push(firstPage);
        activePageId = firstPage.id;
        await dbPutPage(db, firstPage);
        await dbSetMeta(db, "activePageId", activePageId);
      } else {
        const exists = pages.some((p) => p.id === savedActiveId);
        if (exists) {
          activePageId = savedActiveId;
        } else {
          const sorted = [...pages].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          activePageId = sorted[0].id;
        }
      }
      renderSidebar();
      setSaveStatus("IndexedDB 接続済み", false);
    } catch (err) {
      console.error("IndexedDB init failed:", err);
      const fallback = createNewPageModel(1);
      fallback.title = "YN-001";
      pages = [fallback];
      activePageId = fallback.id;
      renderSidebar();
      setSaveStatus("一時モード（DB利用不可）", true);
    }

    // Netlify 上で開かれている場合は自動でクラウド同期を接続
    if (canUseCloudApi()) {
      await syncFromCloud({ showFeedback: false, migrateLocalIfEmpty: true });
    }
  }

  initApp();
})();
