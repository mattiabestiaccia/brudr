// prova_revisioni.mjs: runs the real revisioni mod in node, against a fake brudr.
//
// The fake brudr draws nothing: gpui-kit and gpui-base elements record their id, their
// handlers (on_click, on_drop), the methods called on them and their text, so a test
// finds a button by id and clicks it as a person would. herdr's functions come from the
// scenario: exec answers from a handler (or runs the real program, for the bench),
// layout() is a small brudr-pannelli tree that run() changes (layout.resize, select,
// show, hide), files come from a Map or from disk, watchFolder resolves when the test
// says a folder changed. nextCommand is there and records any call: the mod never makes one.
//
// import { Banco } from "./prova_revisioni.mjs";
// const b = await Banco.crea({ exec, file, home }); await b.avvia(); await b.clic("rev-x");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
export const MOD = path.join(QUI, "mods/revisioni");
export const APP = "/app", NOME_LAYOUT = "brudr-pannelli";

export function layoutIniziale() {
  return {
    id: "root", type: "row", children: [
      { id: "work", type: "column", children: [] },
      { id: "panel", type: "column", size: { px: 368 }, min: 280, max: 4000, hidden: false, children: [
        { id: "panel-body", type: "stack", active: "revisioni", children: [
          { id: "revisioni", type: "block", content: { mod: "revisioni" } },
          { id: "revisioni-web", type: "block", content: { web: { url: "http://127.0.0.1:4388/" } } },
        ] },
      ] },
    ],
  };
}

const trova = (n, id) => {
  if (!n || typeof n !== "object") return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) {
    const f = trova(c, id);
    if (f) return f;
  }
  return null;
};

// ---- the modules the mod imports, written once into a temp folder
let cartellaModuli = null;
function moduli() {
  if (cartellaModuli) return cartellaModuli;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prova-revisioni-"));
  const scrivi = (rel, testo) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), testo);
  };
  for (const f of fs.readdirSync(MOD)) if (f.endsWith(".js")) scrivi(`mod/${f}`, fs.readFileSync(path.join(MOD, f)));
  scrivi("mod/package.json", '{"type":"module"}');
  const pacchetto = (nome, corpo) => {
    scrivi(`node_modules/${nome}/package.json`, JSON.stringify({ name: nome, type: "module", main: "index.js" }));
    scrivi(`node_modules/${nome}/index.js`, corpo);
  };
  pacchetto("gpui-kit", `
export class View {}
export const div = () => globalThis.ELEMENTO("div");
export const svg = (p) => globalThis.ELEMENTO("svg", p);
export const image = (p) => globalThis.ELEMENTO("image", p);`);
  pacchetto("gpui-base", `
export const h_flex = () => globalThis.ELEMENTO("h_flex");
export const v_flex = () => globalThis.ELEMENTO("v_flex");
const stato = (o) => ({ v: o?.value ?? "", value() { return this.v; }, set_value(x) { this.v = x; }, focus() {}, on() { return true; },
  set_auto_grow() {}, set_rows() {}, set_soft_wrap() {}, set_selected_range() {} });
export const InputState = { new: (o) => stato(o) };
export const TextareaState = { new: (o) => stato(o) };
export const Input = { new: (s) => globalThis.ELEMENTO("input", s) };
export const Textarea = { new: (s) => globalThis.ELEMENTO("textarea", s) };
export const TextView = { markdown: (id, t) => globalThis.ELEMENTO("markdown", t).id(id), html: (id, t) => globalThis.ELEMENTO("html", t).id(id) };`);
  pacchetto("herdr", `
const b = () => globalThis.BRUDR;
const clone = (x) => JSON.parse(JSON.stringify(x));
export const exec = (c, a, o) => b().exec(c, a, o);
export const home = () => b().home;
export const appHome = () => "${APP}";
export const readTextFile = async (p) => b().leggi(p);
export const writeTextFile = async (p, testo, atteso) => b().scrivi(p, testo, atteso);
export const watchFolder = (d) => b().guarda(d);
export const layout = () => clone(b().layout);
export const run = (n, a) => { b().run(n, a); return null; };
export const shared = (k) => (k === "layout" ? "${NOME_LAYOUT}" : null);
export const theme = () => new Proxy({}, { get: (_t, k) => String(k) });
export const settings = () => ({ zoom: 1, font_family: "JetBrains Mono" });
export const notify = (n) => { b().avvisi.push(n); return null; };
export const nextCommand = () => { b().comandiChiesti++; return new Promise(() => {}); };`);
  cartellaModuli = tmp;
  return tmp;
}

globalThis.ELEMENTO = (tipo, valore) => {
  const e = { tipo, valore, id: null, click: null, drop: null, figli: [], metodi: [] };
  const p = new Proxy(e, {
    get(t, k) {
      if (k === "_e") return t;
      if (k === "then") return undefined;
      if (k === "id") return (x) => ((t.id = x), p);
      if (k === "on_click") return (f) => ((t.click = f), p);
      if (k === "on_drop") return (f) => ((t.drop = f), p);
      if (k === "child") return (c) => (t.figli.push(c), p);
      if (k === "children") return (cs) => (t.figli.push(...cs), p);
      if (k === "when") return (c, f) => (c ? f(p) : p);
      return (...a) => (t.metodi.push(String(k)), k === "tooltip" && (t.tooltip = a[0]), p);
    },
  });
  return p;
};

export function trovaElemento(e, id) {
  const t = e?._e;
  if (!t) return null;
  if (t.id === id) return t;
  for (const f of t.figli) {
    const x = trovaElemento(f, id);
    if (x) return x;
  }
  return null;
}

/** Every text of the tree, in drawing order: a text capture of the panel. */
export function testi(e, out = []) {
  if (typeof e === "string") { out.push(e); return out; }
  const t = e?._e;
  if (!t) return out;
  if (t.tipo === "markdown") out.push(String(t.valore));
  if (t.tipo === "svg") out.push(`[${path.basename(String(t.valore), ".svg")}]`);
  for (const f of t.figli) testi(f, out);
  return out;
}

/** Every method called on an element of the tree (to compare with gpui-kit.d.ts). */
export function metodi(e, out = new Set()) {
  const t = e?._e;
  if (!t) return out;
  for (const m of t.metodi) out.add(m);
  for (const f of t.figli) metodi(f, out);
  return out;
}

export class Banco {
  /**
   * opzioni: { exec(cmd, args, opts) -> {code, stdout, stderr} (may be async),
   * file: Map(path -> text) or "disco" (read the real files), home, attesaReale: cx.sleep waits for real }.
   */
  static async crea(opzioni = {}) {
    const dir = moduli();
    const { default: Revisioni } = await import(pathToFileURL(path.join(dir, "mod", "main.js")).href);
    return new Banco(Revisioni, opzioni);
  }

  constructor(Revisioni, o) {
    this.Revisioni = Revisioni;
    this.home = o.home ?? "/casa";
    this.execFn = o.exec ?? (() => ({ code: 0, stdout: "", stderr: "" }));
    this.file = o.file ?? new Map();
    this.layout = o.layout ?? layoutIniziale();
    this.file.set?.(`${APP}/layouts/${NOME_LAYOUT}.json`, JSON.stringify(this.layout, null, 2) + "\n");
    this.chiamate = []; this.comandi = []; this.avvisi = []; this.errori = [];
    this.comandiChiesti = 0;
    this.pendenti = new Set(); this.attese = []; this.timer = [];
    globalThis.BRUDR = this;
  }

  // ---- herdr
  async exec(cmd, args = [], opts = {}) {
    this.chiamate.push({ cmd, args: [...args], timeout: opts.timeout });
    return await this.execFn(cmd, args, opts);
  }
  leggi(p) {
    if (this.file === "disco") {
      try { return fs.readFileSync(p, "utf8"); } catch { return null; }
    }
    return this.file.get(p) ?? null;
  }
  scrivi(p, testo, atteso) {
    if (this.file === "disco") throw new Error("not in the test");
    if ((this.file.get(p) ?? null) !== atteso) throw new Error("stale snapshot");
    this.file.set(p, testo);
    return null;
  }
  guarda(dir) {
    return new Promise((ok) => this.attese.push({ dir, ok }));
  }
  /** A change under a watched folder: wakes every watchFolder waiting on a parent of it. */
  tocca(p) {
    const via = this.attese.filter((a) => p === a.dir || p.startsWith(`${a.dir}/`));
    this.attese = this.attese.filter((a) => !via.includes(a));
    via.forEach((a) => a.ok([p]));
  }
  run(nome, a = {}) {
    this.comandi.push([nome, a]);
    const n = trova(this.layout, a.id ?? a.stack);
    if (nome === "layout.resize" && n) n.size = a.weight ? { weight: a.weight } : { px: a.px };
    else if (nome === "layout.select" && n) n.active = a.child;
    else if (nome === "layout.show" && n) n.hidden = false;
    else if (nome === "layout.hide" && n) n.hidden = true;
  }

  // ---- the mod
  cx() {
    const b = this;
    const c = {
      spawn(f) {
        const pr = Promise.resolve().then(() => f(c));
        b.pendenti.add(pr);
        pr.catch((e) => b.errori.push(`mod error: ${e?.stack ?? e}`)).finally(() => b.pendenti.delete(pr));
      },
      notify() {},
      sleep: (ms) => new Promise((ok) => setTimeout(ok, Math.min(ms, 50))),
      timer: {
        every: (ms, f) => b.timer.push({ ms, f, ripeti: true }),
        after: (ms, f) => b.timer.push({ ms, f, ripeti: false }),
      },
      focus_handle: () => ({ focus() {} }),
      stop_propagation() {},
    };
    return c;
  }

  async avvia() {
    this.v = new this.Revisioni();
    this.v.init({}, this.cx());
    await this.quieto();
  }

  /** Renders until no task of the mod is running (tasks waiting on watchFolder do not count). */
  async quieto(massimo = 400000) {
    const fine = Date.now() + massimo;
    for (;;) {
      try {
        this.albero = this.v.render(this.cx());
      } catch (e) {
        this.errori.push(`render error: ${e?.stack ?? e}`);
        return;
      }
      await new Promise((ok) => setTimeout(ok, 5));
      if (this.pendenti.size <= this.attese.length) {
        this.albero = this.v.render(this.cx());
        return;
      }
      if (Date.now() > fine) { this.errori.push("never quiet"); return; }
    }
  }

  /** Runs the mod's timers once, as brudr would after their period. */
  async scatta() {
    for (const t of [...this.timer]) {
      t.f(this.cx());
      if (!t.ripeti) this.timer.splice(this.timer.indexOf(t), 1);
    }
    await this.quieto();
  }

  elemento(id) {
    return trovaElemento(this.albero, id);
  }

  async clic(id) {
    const e = this.elemento(id);
    if (!e?.click) throw new Error(`nessun elemento cliccabile ${id}`);
    e.click({}, this.cx());
    await this.quieto();
  }

  async trascina(id, paths) {
    const e = this.elemento(id);
    if (!e?.drop) throw new Error(`nessuna zona di rilascio ${id}`);
    e.drop({ paths }, this.cx());
    await this.quieto();
  }

  testi() {
    return testi(this.albero);
  }

  /** The calls of pr-revisione-clic, the only way to the executor. */
  clicFatti() {
    return this.chiamate.filter((c) => c.cmd.endsWith("/pr-revisione-clic"));
  }
}
