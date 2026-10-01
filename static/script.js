/* ==========================================================================
   ChurnGuard: front-end logic
   - builds the form, keeps one `state` object in sync with it
   - calls POST /api/predict (debounced, live) and renders the result
   ========================================================================== */
(() => {
    "use strict";

    // Same origin as the FastAPI server. Only change this if you host the page elsewhere.
    const API_BASE = "";
    const GAUGE_LENGTH = 251.33; // length of the half-circle arc (pi * 80)
    const ADDONS = ["OnlineSecurity", "OnlineBackup", "DeviceProtection", "TechSupport", "StreamingTV", "StreamingMovies"];

    /* ------------------------------------------------------------------------
       Field configuration
       ------------------------------------------------------------------------ */
    const LABELS = {
        gender: "Gender", SeniorCitizen: "Senior citizen", Partner: "Partner", Dependents: "Dependents",
        tenure: "Tenure", PhoneService: "Phone service", MultipleLines: "Multiple lines",
        InternetService: "Internet service", OnlineSecurity: "Online security", OnlineBackup: "Online backup",
        DeviceProtection: "Device protection", TechSupport: "Tech support", StreamingTV: "Streaming TV",
        StreamingMovies: "Streaming movies", Contract: "Contract", PaperlessBilling: "Paperless billing",
        PaymentMethod: "Payment method", MonthlyCharges: "Monthly charges",
    };

    const opts = (...values) => values.map((v) => ({ value: v, label: v }));
    const YES_NO = opts("No", "Yes");

    const ICONS = {
        user: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
        wifi: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0"/><circle cx="12" cy="19.5" r="1"/></svg>',
        card: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>',
    };

    const GROUPS = [
        {
            title: "Customer profile", icon: ICONS.user,
            fields: [
                { name: "gender", type: "seg", options: opts("Female", "Male") },
                { name: "SeniorCitizen", type: "seg", numeric: true, options: [{ value: 0, label: "No" }, { value: 1, label: "Yes" }] },
                { name: "Partner", type: "seg", options: YES_NO },
                { name: "Dependents", type: "seg", options: YES_NO },
                { name: "tenure", type: "range", min: 0, max: 72, step: 1, hardMin: 0, hardMax: 72, unit: "months", wide: true },
            ],
        },
        {
            title: "Services", icon: ICONS.wifi,
            fields: [
                { name: "PhoneService", type: "seg", options: YES_NO },
                { name: "MultipleLines", type: "seg", options: YES_NO, dependent: true },
                { name: "InternetService", type: "seg", options: opts("DSL", "Fiber optic", "No"), wide: true },
                ...ADDONS.map((name) => ({ name, type: "seg", options: YES_NO, dependent: true })),
            ],
        },
        {
            title: "Contract & billing", icon: ICONS.card,
            fields: [
                { name: "Contract", type: "seg", options: opts("Month-to-month", "One year", "Two year"), wide: true },
                { name: "PaperlessBilling", type: "seg", options: YES_NO },
                { name: "PaymentMethod", type: "select", options: opts("Electronic check", "Mailed check", "Bank transfer (automatic)", "Credit card (automatic)") },
                { name: "MonthlyCharges", type: "range", min: 15, max: 125, step: 0.5, hardMin: 0, hardMax: 200, unit: "USD", prefix: "$", wide: true },
            ],
        },
    ];

    const NO_INTERNET = Object.fromEntries(ADDONS.map((a) => [a, "No internet service"]));

    /* ------------------------------------------------------------------------
       Example customers
       ------------------------------------------------------------------------ */
    const PRESETS = [
        {
            id: "loyal", name: "Loyal family",
            data: { gender: "Female", SeniorCitizen: 0, Partner: "Yes", Dependents: "Yes", tenure: 60, PhoneService: "Yes", MultipleLines: "Yes", InternetService: "DSL", OnlineSecurity: "Yes", OnlineBackup: "Yes", DeviceProtection: "Yes", TechSupport: "Yes", StreamingTV: "No", StreamingMovies: "No", Contract: "Two year", PaperlessBilling: "No", PaymentMethod: "Credit card (automatic)", MonthlyCharges: 70 },
        },
        {
            id: "steady", name: "Steady DSL customer",
            data: { gender: "Male", SeniorCitizen: 0, Partner: "No", Dependents: "No", tenure: 10, PhoneService: "Yes", MultipleLines: "No", InternetService: "DSL", OnlineSecurity: "Yes", OnlineBackup: "No", DeviceProtection: "No", TechSupport: "Yes", StreamingTV: "No", StreamingMovies: "No", Contract: "One year", PaperlessBilling: "No", PaymentMethod: "Mailed check", MonthlyCharges: 55 },
        },
        {
            id: "phone", name: "Phone-only saver",
            data: { gender: "Male", SeniorCitizen: 0, Partner: "No", Dependents: "No", tenure: 30, PhoneService: "Yes", MultipleLines: "No", InternetService: "No", ...NO_INTERNET, Contract: "One year", PaperlessBilling: "No", PaymentMethod: "Mailed check", MonthlyCharges: 20 },
        },
        {
            id: "senior", name: "Senior, monthly plan",
            data: { gender: "Female", SeniorCitizen: 1, Partner: "No", Dependents: "No", tenure: 14, PhoneService: "Yes", MultipleLines: "Yes", InternetService: "Fiber optic", OnlineSecurity: "No", OnlineBackup: "Yes", DeviceProtection: "No", TechSupport: "No", StreamingTV: "No", StreamingMovies: "No", Contract: "Month-to-month", PaperlessBilling: "Yes", PaymentMethod: "Electronic check", MonthlyCharges: 85 },
        },
        {
            id: "fiber", name: "New fiber customer",
            data: { gender: "Male", SeniorCitizen: 0, Partner: "No", Dependents: "No", tenure: 2, PhoneService: "Yes", MultipleLines: "No", InternetService: "Fiber optic", OnlineSecurity: "No", OnlineBackup: "No", DeviceProtection: "No", TechSupport: "No", StreamingTV: "Yes", StreamingMovies: "Yes", Contract: "Month-to-month", PaperlessBilling: "Yes", PaymentMethod: "Electronic check", MonthlyCharges: 95 },
        },
    ];

    const DEFAULT_CUSTOMER = PRESETS.find((p) => p.id === "steady").data;

    /* ------------------------------------------------------------------------
       DOM helpers + app state
       ------------------------------------------------------------------------ */
    const $ = (id) => document.getElementById(id);
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function h(tag, props = {}, ...children) {
        const el = document.createElement(tag);
        for (const [key, val] of Object.entries(props)) {
            if (val == null || val === false) continue;
            if (key === "class") el.className = val;
            else if (key === "dataset") Object.assign(el.dataset, val);
            else el.setAttribute(key, val === true ? "" : val);
        }
        for (const child of children.flat()) {
            if (child == null) continue;
            el.append(child.nodeType ? child : document.createTextNode(child));
        }
        return el;
    }

    const state = clone(DEFAULT_CUSTOMER);
    const controls = {}; // name -> { type, field, inputs / select / range+num }
    let activePresetId = "steady";
    let tunedThreshold = 0.29;   // from the API
    let threshold = 0.29;        // current (user-adjustable) value
    let lastResult = null;
    let displayedScore = 0;
    let requestId = 0;
    let debounceTimer = null;
    let abortController = null;

    /* ------------------------------------------------------------------------
       Form building
       ------------------------------------------------------------------------ */
    function labelEl(f, forId) {
        const tag = f.dependent ? h("span", { class: "na-tag" }, "Not applicable") : null;
        return h("span", { class: "field-label", id: `${forId}-label` }, LABELS[f.name], tag);
    }

    function buildSeg(f) {
        const id = `f-${f.name}`;
        const seg = h("div", { class: "seg", role: "radiogroup", "aria-labelledby": `${id}-label` });
        const inputs = [];
        f.options.forEach((o, i) => {
            const input = h("input", { type: "radio", name: f.name, id: `${id}-${i}`, value: String(o.value) });
            inputs.push(input);
            seg.append(input, h("label", { for: `${id}-${i}` }, o.label));
        });
        seg.addEventListener("change", (e) => {
            if (e.target.name === f.name) setValue(f.name, f.numeric ? Number(e.target.value) : e.target.value);
        });
        const field = h("div", { class: `field${f.wide ? " span-2" : ""}`, dataset: { field: f.name } }, labelEl(f, id), seg);
        controls[f.name] = { type: "seg", field, inputs };
        return field;
    }

    function buildSelect(f) {
        const id = `f-${f.name}`;
        const select = h("select", { id, name: f.name, "aria-labelledby": `${id}-label` },
            f.options.map((o) => h("option", { value: o.value }, o.label)));
        select.addEventListener("change", () => setValue(f.name, select.value));
        const field = h("div", { class: `field${f.wide ? " span-2" : ""}`, dataset: { field: f.name } },
            labelEl(f, id), h("div", { class: "select-wrap" }, select));
        controls[f.name] = { type: "select", field, select };
        return field;
    }

    function buildRange(f) {
        const id = `f-${f.name}`;
        const range = h("input", { type: "range", id, min: f.min, max: f.max, step: f.step });
        const num = h("input", { type: "number", id: `${id}-num`, min: f.hardMin, max: f.hardMax, step: f.step === 1 ? 1 : 0.01, inputmode: "decimal", "aria-label": `${LABELS[f.name]} value` });

        range.addEventListener("input", () => setValue(f.name, Number(range.value)));
        num.addEventListener("input", () => {
            if (num.value === "" || !Number.isFinite(Number(num.value))) return;
            // Update state + slider without rewriting the box the user is typing in.
            setValue(f.name, clamp(Number(num.value), f.hardMin, f.hardMax), { keepNumber: true });
        });
        num.addEventListener("change", () => { if (num.value === "") num.value = state[f.name]; syncForm(); });

        const head = h("div", { class: "range-head" },
            h("label", { for: id }, LABELS[f.name]),
            h("span", { class: "num-wrap" }, f.prefix ? h("span", { class: "num-unit", style: "min-width:0" }, f.prefix) : null, num,
                f.prefix ? null : h("span", { class: "num-unit" }, f.unit)));
        const field = h("div", { class: `field span-2`, dataset: { field: f.name } }, head, range);
        controls[f.name] = { type: "range", field, range, num, cfg: f };
        return field;
    }

    function buildForm() {
        const root = $("form-fields");
        GROUPS.forEach((g) => {
            const grid = h("div", { class: "group-grid" });
            g.fields.forEach((f) => grid.append(f.type === "seg" ? buildSeg(f) : f.type === "select" ? buildSelect(f) : buildRange(f)));
            const title = h("div", { class: "group-title" });
            const icon = h("span"); icon.innerHTML = g.icon; // static, trusted markup
            title.append(icon, g.title);
            root.append(h("section", { class: "group" }, title, grid));
        });
    }

    function buildPresets() {
        const wrap = $("presets");
        PRESETS.forEach((p) => {
            const chip = h("button", { type: "button", class: "preset-chip", dataset: { preset: p.id }, "aria-pressed": "false" },
                h("span", { class: "chip-dot", "aria-hidden": "true" }), p.name);
            chip.addEventListener("click", () => applyPreset(p.id));
            wrap.append(chip);
        });
    }

    /* ------------------------------------------------------------------------
       State <-> form sync
       ------------------------------------------------------------------------ */
    function isLocked(name) {
        if (name === "MultipleLines") return state.PhoneService === "No";
        if (ADDONS.includes(name)) return state.InternetService === "No";
        return false;
    }

    // Keeps the form consistent with how the training data was built.
    function applyDependencies() {
        if (state.PhoneService === "No") state.MultipleLines = "No phone service";
        else if (state.MultipleLines === "No phone service") state.MultipleLines = "No";

        if (state.InternetService === "No") ADDONS.forEach((a) => { state[a] = "No internet service"; });
        else ADDONS.forEach((a) => { if (state[a] === "No internet service") state[a] = "No"; });
    }

    function syncForm(skipNumberFor = null) {
        for (const [name, c] of Object.entries(controls)) {
            const value = state[name];
            if (c.type === "seg") {
                const locked = isLocked(name);
                c.field.classList.toggle("locked", locked);
                c.inputs.forEach((input) => {
                    input.checked = String(value) === input.value;
                    input.disabled = locked;
                });
            } else if (c.type === "select") {
                c.select.value = value;
            } else if (c.type === "range") {
                c.range.value = value;
                const pct = ((clamp(value, c.cfg.min, c.cfg.max) - c.cfg.min) / (c.cfg.max - c.cfg.min)) * 100;
                c.range.style.setProperty("--pct", `${pct}%`);
                if (skipNumberFor !== name) c.num.value = Number.isInteger(value) ? value : Number(value.toFixed(2));
            }
        }
    }

    function setValue(name, value, { keepNumber = false } = {}) {
        state[name] = value;
        applyDependencies();
        syncForm(keepNumber ? name : null);
        setActivePreset(null);
        schedulePredict();
    }

    function setActivePreset(id) {
        activePresetId = id;
        document.querySelectorAll(".preset-chip").forEach((chip) => {
            const on = chip.dataset.preset === id;
            chip.classList.toggle("active", on);
            chip.setAttribute("aria-pressed", String(on));
        });
    }

    function applyPreset(id) {
        const preset = PRESETS.find((p) => p.id === id);
        Object.assign(state, clone(preset.data));
        syncForm();
        setActivePreset(id);
        predict();
    }

    /* ------------------------------------------------------------------------
       API
       ------------------------------------------------------------------------ */
    async function api(path, options) {
        const res = await fetch(API_BASE + path, options);
        if (!res.ok) {
            let message = `Request failed (${res.status})`;
            try {
                const body = await res.json();
                if (Array.isArray(body.detail)) {
                    message = body.detail.map((d) => (d.field ? `${LABELS[d.field] || d.field}: ${d.message}` : d.message)).join(" · ");
                } else if (typeof body.detail === "string") message = body.detail;
            } catch (_) { /* keep default message */ }
            throw new Error(message);
        }
        return res.json();
    }

    const postPredict = (payload, signal) =>
        api("/api/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });

    function schedulePredict() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(predict, 280);
    }

    async function predict() {
        clearTimeout(debounceTimer);
        const myId = ++requestId;
        if (abortController) abortController.abort();
        abortController = new AbortController();

        const payload = { ...state, tenure: Math.round(state.tenure), MonthlyCharges: Math.round(state.MonthlyCharges * 100) / 100 };
        const panel = $("result-panel");
        if (!lastResult) showState("loading"); else panel.dataset.busy = "true";

        try {
            const data = await postPredict(payload, abortController.signal);
            if (myId !== requestId) return;
            lastResult = data;
            tunedThreshold = data.threshold;
            renderResult();
            showState("ready");
        } catch (err) {
            if (err.name === "AbortError" || myId !== requestId) return;
            const offline = err instanceof TypeError;
            $("error-message").textContent = offline ? "Can't reach the API. Make sure the server is running (uvicorn main:app --reload)." : err.message;
            showState("error");
            setStatus(offline ? "error" : "ok", offline ? "API offline" : null);
        } finally {
            if (myId === requestId) panel.dataset.busy = "false";
        }
    }

    function showState(s) {
        $("result-loading").hidden = s !== "loading";
        $("result-error").hidden = s !== "error";
        $("result-body").hidden = s !== "ready";
        $("mini-score").hidden = s !== "ready";
    }

    /* ------------------------------------------------------------------------
       Rendering the result
       ------------------------------------------------------------------------ */
    const levelOf = (p, t) => (p >= t ? "high" : p >= 0.6 * t ? "medium" : "low");
    const pct = (p) => `${Math.round(p * 100)}%`;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const VERDICTS = {
        high: { badge: "High churn risk", text: (p, t) => `Score ${pct(p)} is above the ${t.toFixed(2)} threshold. This customer is worth a retention offer.` },
        medium: { badge: "Worth watching", text: (p, t) => `Score ${pct(p)} is below the ${t.toFixed(2)} threshold, but close. Keep an eye on this customer.` },
        low: { badge: "Likely to stay", text: (p, t) => `Score ${pct(p)} is well below the ${t.toFixed(2)} threshold. No action needed.` },
    };

    function formatValue(feature, value) {
        if (feature === "tenure") return `${value} month${value === 1 ? "" : "s"}`;
        if (feature === "MonthlyCharges") return `$${Number(value).toFixed(2)}`;
        if (feature === "SeniorCitizen") return value ? "Yes" : "No";
        return String(value);
    }

    function animateScore(to) {
        const el = $("score");
        const from = displayedScore;
        displayedScore = to;
        if (reduceMotion || from === to) { el.textContent = pct(to); return; }
        const start = performance.now(), duration = 650;
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = pct(from + (to - from) * eased);
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    function placeThresholdMarker() {
        const a = threshold * Math.PI, cos = Math.cos(a), sin = Math.sin(a);
        const at = (r) => [100 - r * cos, 100 - r * sin];
        const [x1, y1] = at(68), [x2, y2] = at(93), [lx, ly] = at(106);
        const line = $("gauge-threshold");
        line.setAttribute("x1", x1); line.setAttribute("y1", y1);
        line.setAttribute("x2", x2); line.setAttribute("y2", y2);
        const label = $("gauge-threshold-label");
        label.setAttribute("x", lx); label.setAttribute("y", ly + 3);
        label.textContent = `cut-off ${threshold.toFixed(2)}`;
    }

    function renderVerdict() {
        if (!lastResult) return;
        const p = lastResult.churn_probability;
        const level = levelOf(p, threshold);
        const v = VERDICTS[level];
        $("verdict").dataset.level = level;
        $("verdict-badge").textContent = v.badge;
        $("verdict-text").textContent = v.text(p, threshold);

        const mini = $("mini-score");
        mini.dataset.level = level;
        $("mini-text").textContent = `${pct(p)} · ${v.badge}`;
    }

    function renderDrivers(drivers) {
        const list = $("drivers");
        list.replaceChildren();
        const shown = drivers.filter((d) => Math.abs(d.impact) >= 0.05).slice(0, 6);
        if (!shown.length) {
            list.append(h("li", { class: "muted small" }, "No single feature stands out for this customer."));
            return;
        }
        const maxAbs = Math.max(...shown.map((d) => Math.abs(d.impact)));
        list.append(h("li", { class: "driver-legend", "aria-hidden": "true" },
            h("span", { class: "l" }, "← lowers risk"), h("span", { class: "r" }, "raises risk →")));

        shown.forEach((d) => {
            const width = Math.max(4, (Math.abs(d.impact) / maxAbs) * 50);
            const up = d.impact > 0;
            const fill = h("div", { class: `bar-fill ${up ? "up" : "down"}` });
            fill.style.width = "0%";
            requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${width}%`; }));
            list.append(h("li", { class: "driver" },
                h("div", { class: "driver-name" }, h("strong", {}, LABELS[d.feature] || d.feature), h("span", {}, formatValue(d.feature, d.value))),
                h("div", {},
                    h("div", { class: "bar-track", role: "img", "aria-label": `${LABELS[d.feature] || d.feature} ${up ? "raises" : "lowers"} churn risk` }, fill),
                    h("div", { class: "driver-impact" }, `${up ? "+" : "−"}${Math.abs(d.impact).toFixed(2)} log-odds`))));
        });
    }

    function buildIdeas() {
        const ideas = [];
        const internet = state.InternetService !== "No";
        if (state.Contract === "Month-to-month") ideas.push("Offer an incentive to move to a 1- or 2-year contract. Month-to-month customers churn far more.");
        if (state.InternetService === "Fiber optic") ideas.push("Review fiber service quality and pricing for this segment. Fiber customers churn the most in this dataset.");
        if (internet && state.TechSupport === "No") ideas.push("Offer a free trial of tech support. Customers with it churn noticeably less.");
        if (internet && state.OnlineSecurity === "No") ideas.push("Bundle online security at a discount.");
        if (state.PaymentMethod === "Electronic check") ideas.push("Nudge towards automatic payment with a small discount. Electronic-check payers churn more.");
        if (state.tenure < 12) ideas.push("Schedule an early-life check-in. Churn is highest in the first year.");
        return ideas.slice(0, 4);
    }

    function renderIdeas() {
        const level = lastResult ? levelOf(lastResult.churn_probability, threshold) : "low";
        const ideas = level === "low" ? [] : buildIdeas();
        $("ideas-block").hidden = ideas.length === 0;
        $("ideas").replaceChildren(...ideas.map((t) => h("li", {}, t)));
    }

    function renderResult() {
        const p = lastResult.churn_probability;
        $("gauge-value").style.strokeDashoffset = GAUGE_LENGTH * (1 - clamp(p, 0, 1));
        animateScore(p);
        placeThresholdMarker();
        renderVerdict();
        renderDrivers(lastResult.drivers);
        renderIdeas();
    }

    /* ------------------------------------------------------------------------
       Threshold slider (client-side only)
       ------------------------------------------------------------------------ */
    function setupThreshold() {
        const slider = $("threshold-slider");
        const paint = () => {
            const pctFill = ((Number(slider.value) - slider.min) / (slider.max - slider.min)) * 100;
            slider.style.setProperty("--pct", `${pctFill}%`);
            $("threshold-value").textContent = Number(slider.value).toFixed(2);
        };
        slider.addEventListener("input", () => {
            threshold = Number(slider.value);
            paint();
            if (lastResult) { placeThresholdMarker(); renderVerdict(); renderIdeas(); }
        });
        $("threshold-reset").addEventListener("click", () => {
            slider.value = tunedThreshold; threshold = tunedThreshold; paint();
            if (lastResult) { placeThresholdMarker(); renderVerdict(); renderIdeas(); }
        });
        return { slider, paint };
    }

    /* ------------------------------------------------------------------------
       Status, stats, theme, mini score
       ------------------------------------------------------------------------ */
    function setStatus(stateName, text) {
        $("status-pill").dataset.state = stateName;
        if (text) $("status-text").textContent = text;
    }

    async function loadModelInfo(thresholdUI) {
        try {
            const info = await api("/api/model-info");
            const m = info.metrics;
            $("stat-auc").textContent = m.test_roc_auc.toFixed(3);
            $("stat-recall").textContent = `${Math.round(m.recall_at_threshold * 100)}%`;
            $("stat-precision").textContent = `${Math.round(m.precision_at_threshold * 100)}%`;
            $("stat-threshold").textContent = info.threshold.toFixed(2);
            $("about-threshold").textContent = info.threshold.toFixed(2);
            setStatus("ok", `${info.model_name} · online`);

            tunedThreshold = threshold = info.threshold;
            thresholdUI.slider.value = threshold;
            thresholdUI.paint();
            return true;
        } catch (_) {
            setStatus("error", "API offline");
            return false;
        }
    }

    // Colour each example chip by its predicted risk level.
    function paintPresetDots() {
        PRESETS.forEach(async (p) => {
            try {
                const d = await postPredict(p.data);
                const chip = document.querySelector(`.preset-chip[data-preset="${p.id}"] .chip-dot`);
                if (chip) chip.dataset.level = levelOf(d.churn_probability, d.threshold);
            } catch (_) { /* dots are optional */ }
        });
    }

    function setupTheme() {
        const root = document.documentElement;
        let saved = null;
        try { saved = localStorage.getItem("churnguard-theme"); } catch (_) { /* storage may be blocked */ }
        root.dataset.theme = saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
        $("theme-toggle").addEventListener("click", () => {
            const next = root.dataset.theme === "dark" ? "light" : "dark";
            root.dataset.theme = next;
            try { localStorage.setItem("churnguard-theme", next); } catch (_) { /* ignore */ }
        });
    }

    // On small screens the result sits below the form: show a floating score until it is in view.
    function setupMiniScore() {
        const mini = $("mini-score");
        const panel = $("result-panel");
        mini.addEventListener("click", () => panel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }));
        if ("IntersectionObserver" in window) {
            new IntersectionObserver(([entry]) => mini.classList.toggle("is-hidden", entry.isIntersecting), { threshold: 0.25 }).observe(panel);
        }
    }

    /* ------------------------------------------------------------------------
       Init
       ------------------------------------------------------------------------ */
    async function init() {
        setupTheme();
        buildForm();
        buildPresets();
        applyDependencies();
        syncForm();
        setActivePreset(activePresetId);
        setupMiniScore();
        const thresholdUI = setupThreshold();

        $("churn-form").addEventListener("submit", (e) => {
            e.preventDefault();
            predict();
            if (window.matchMedia("(max-width: 980px)").matches) $("result-panel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        $("reset-btn").addEventListener("click", () => applyPreset("steady"));
        $("retry-btn").addEventListener("click", async () => {
            showState("loading");
            if (await loadModelInfo(thresholdUI)) { paintPresetDots(); predict(); } else showState("error");
        });

        showState("loading");
        if (await loadModelInfo(thresholdUI)) {
            paintPresetDots();
            predict();
        } else {
            $("error-message").textContent = "Can't reach the API. Make sure the server is running (uvicorn main:app --reload).";
            showState("error");
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();