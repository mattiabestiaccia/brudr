// prova_mod.mjs: runs the pannelli mod against a fake brudr and a fake core.
//
// Usage: node personal/pannelli/prova_mod.mjs <mod folder> <brudr-pannelli.json>
// Prints one JSON object: for each scenario, what the window shows at the end.
//
// The fake brudr does what src/window.rs does with a layout, in the parts the
// mod meets: terminal_ended drops an ended block from the layout in memory;
// save() writes layout_sync::without_clicks (the tree as it is now, clicks put
// back as the file has them) unless the file changed meanwhile; layout.switch
// saves, then loads; an edited layout file is applied (check_layout_file) with
// the clicks (hidden, active) kept; layout.select fails on a missing child.
// The fake core keeps named terminals with labels (hc run/get/rm).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [modDir, layoutFile] = process.argv.slice(2);
if (!modDir || !layoutFile) {
  console.error("usage: node prova_mod.mjs <mod folder> <brudr-pannelli.json>");
  process.exit(64);
}

const APP = "/app", NOME = "brudr-pannelli", LAYOUT = `${APP}/layouts/${NOME}.json`;
const clone = (x) => JSON.parse(JSON.stringify(x));
function trova(n, id) {
  if (!n || typeof n !== "object") return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) {
    const f = trova(c, id);
    if (f) return f;
  }
  return null;
}
const nodi = (n) => [n, ...(n.children ?? []).flatMap(nodi)];

class Brudr {
  constructor(testo) {
    this.file = new Map([[LAYOUT, testo]]);
    this.core = new Map();
    this.chiamateCore = [];
    this.n = 0;
    this.falliti = [];
    this.avvisi = [];
    this.attese = new Set();
    this.timer = [];
    this.eventi = [];
    this.fileChrome = null;
    this.chrome = null;
    this.scritto = "";
    this.carica();
  }

  // ---- layout, as src/window.rs and src/layout_sync.rs
  static tra(file, ora) {
    const s = {};
    for (const n of nodi(ora)) {
      const f = trova(file, n.id);
      if (!f) continue;
      const c = {};
      if (Boolean(n.hidden) !== Boolean(f.hidden)) c.hidden = Boolean(n.hidden);
      if (n.active !== f.active) c.active = n.active;
      if (Object.keys(c).length) s[n.id] = c;
    }
    return s;
  }
  static applica(s, radice) {
    for (const [id, c] of Object.entries(s)) {
      const n = trova(radice, id);
      if (!n) continue;
      if ("hidden" in c) n.hidden = c.hidden;
      if ("active" in c && (n.children ?? []).some((x) => x.id === c.active)) n.active = c.active;
    }
  }
  static senzaClic(file, ora) {
    const out = clone(ora);
    for (const n of nodi(out)) {
      const f = trova(file, n.id);
      if (!f) continue;
      if ("hidden" in f) n.hidden = f.hidden; else delete n.hidden;
      if ("active" in f) n.active = f.active; else delete n.active;
    }
    return out;
  }
  carica() {
    const testo = this.file.get(LAYOUT);
    const n = JSON.parse(testo);
    const clic = this.chrome ? Brudr.tra(this.fileChrome, this.chrome) : {};
    this.scritto = testo;
    this.fileChrome = n;
    this.chrome = clone(n);
    Brudr.applica(clic, this.chrome);
  }
  salva() {
    const modificato = Brudr.senzaClic(this.fileChrome, this.chrome);
    if (JSON.stringify(modificato) === JSON.stringify(this.fileChrome)) return;
    if (this.scritto && this.file.get(LAYOUT) !== this.scritto) return; // theirs wins
    const testo = JSON.stringify(modificato, null, 2) + "\n";
    this.file.set(LAYOUT, testo);
    this.scritto = testo;
    this.fileChrome = modificato;
  }
  controllaFile() {
    const testo = this.file.get(LAYOUT);
    if (testo === this.scritto) return;
    const n = JSON.parse(testo);
    const clic = Brudr.tra(this.fileChrome, this.chrome);
    this.scritto = testo;
    this.fileChrome = n;
    this.chrome = clone(n);
    Brudr.applica(clic, this.chrome);
  }
  // terminal_ended: the shown block of an ended terminal leaves the layout in memory.
  terminaleFinito(nome) {
    for (const n of nodi(this.chrome)) {
      const i = (n.children ?? []).findIndex((c) => c.content?.terminal === nome);
      if (i >= 0) n.children.splice(i, 1);
    }
  }
  run(nome, a = {}) {
    if (nome === "layout.select") {
      const s = trova(this.chrome, a.stack);
      if (!s || !(s.children ?? []).some((c) => c.id === a.child)) {
        this.falliti.push(`layout.select failed: no stack ${JSON.stringify(a.stack)} with a child ${JSON.stringify(a.child)}`);
      } else s.active = a.child;
    } else if (nome === "layout.show" || nome === "layout.hide") {
      const n = trova(this.chrome, a.id);
      if (n) n.hidden = nome === "layout.hide";
    } else if (nome === "layout.switch") {
      this.salva();
      this.carica();
    }
    return null;
  }

  // ---- core
  hc(args) {
    this.chiamateCore.push(args);
    const [verbo, ...resto] = args;
    const nome = resto[resto.length - 1];
    if (verbo === "get") {
      const r = this.core.get(nome);
      return r ? { code: 0, stdout: JSON.stringify(r), stderr: "" } : { code: 3, stdout: "", stderr: "not_found" };
    }
    if (verbo === "rm") {
      const r = this.core.get(nome);
      if (r && r.state !== "live") this.core.delete(nome);
      return { code: r ? 0 : 3, stdout: "", stderr: "" };
    }
    if (verbo === "run") {
      const n = resto[resto.indexOf("--name") + 1];
      if (this.core.get(n)?.state === "live") return { code: 1, stdout: "", stderr: "name_taken" };
      const labels = {};
      resto.forEach((x, i) => {
        if (x === "--label") {
          const [k, v] = resto[i + 1].split("=");
          labels[k] = v;
        }
      });
      const r = { address: `t${++this.n}`, name: n, state: "live", labels };
      this.core.set(n, r);
      return { code: 0, stdout: JSON.stringify(r), stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "not in the fake core" };
  }
  // hc kill on a terminal made with --rm: the record goes, the block's stream ends.
  uccidi(nome) {
    this.core.delete(nome);
    this.terminaleFinito(nome);
  }
}

// ---- the modules the mod imports
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prova-mod-"));
const scrivi = (rel, testo) => {
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), testo);
};
for (const f of fs.readdirSync(modDir)) if (f.endsWith(".js")) scrivi(`mod/${f}`, fs.readFileSync(path.join(modDir, f)));
scrivi("mod/package.json", '{"type":"module"}');
const pacchetto = (nome, corpo) => {
  scrivi(`node_modules/${nome}/package.json`, JSON.stringify({ name: nome, type: "module", main: "index.js" }));
  scrivi(`node_modules/${nome}/index.js`, corpo);
};
pacchetto("gpui-kit", `
export class View {}
export const div = () => globalThis.ELEMENTO();
export const svg = () => globalThis.ELEMENTO();
export const image = () => globalThis.ELEMENTO();`);
pacchetto("gpui-base", `
export const h_flex = () => globalThis.ELEMENTO();
export const ScrollHandle = { new: () => ({ scroll_to_item() {} }) };`);
pacchetto("herdr", `
const b = () => globalThis.BRUDR;
const clone = (x) => JSON.parse(JSON.stringify(x));
export const spaces = () => [{ id: "sp1", active: true, folder: "/progetto", machine: null, tabs: [{ id: "tb1", name: "tb1", active: true }] }];
export const panes = () => [];
export const focused = () => null;
export const terminals = () => clone([...b().core.values()]);
export const layout = () => clone(b().chrome);
export const theme = () => new Proxy({}, { get: (_t, k) => String(k) });
export const run = (n, a) => b().run(n, a);
export const hc = async (args) => b().hc(args);
export const exec = async () => ({ code: 0, stdout: "", stderr: "" });
export const home = () => "/casa";
export const appHome = () => "${APP}";
export const readTextFile = async (p) => b().file.get(p) ?? null;
export const writeTextFile = async (p, testo, atteso) => {
  if ((b().file.get(p) ?? null) !== atteso) throw new Error("stale snapshot");
  b().file.set(p, testo);
  b().eventi.push(p);
  return null;
};
export const shared = (k) => (k === "layout" ? "${NOME}" : null);
export const notify = (n) => { b().avvisi.push(n.body); return null; };
export const openOverlay = () => null;
export const window = () => ({ platform: "macos", titlebar: "none", buttons: false, maximized: false, fullscreen: false, active: true });
export const settings = () => ({ zoom: 1 });`);
globalThis.MEMORIA = new Map(); // localStorage, new for each scenario
globalThis.localStorage = { getItem: (k) => MEMORIA.get(k) ?? null, setItem: (k, v) => MEMORIA.set(k, String(v)) };

globalThis.ELEMENTO = () => {
  const e = { id: null, click: null, figli: [] };
  const p = new Proxy(e, {
    get(t, k) {
      if (k === "_e") return t;
      if (k === "id") return (x) => ((t.id = x), p);
      if (k === "on_click") return (f) => ((t.click = f), p);
      if (k === "child") return (c) => (t.figli.push(c), p);
      if (k === "children") return (cs) => (t.figli.push(...cs), p);
      if (k === "when") return (c, f) => (c ? f(p) : p);
      return () => p;
    },
  });
  return p;
};
const { default: Pannelli } = await import(pathToFileURL(path.join(tmp, "mod", "main.js")).href);

function cx(b) {
  const c = {
    spawn(f) {
      const pr = Promise.resolve().then(() => f(c));
      b.attese.add(pr);
      pr.catch((e) => b.falliti.push(`mod error: ${e?.stack ?? e}`)).finally(() => b.attese.delete(pr));
    },
    notify() {},
    timer: { after: (_ms, f) => b.timer.push(() => f(c)) },
  };
  return c;
}

function trovaElemento(e, id) {
  const t = e?._e;
  if (!t) return null;
  if (t.id === id) return t;
  for (const f of t.figli) {
    const x = trovaElemento(f, id);
    if (x) return x;
  }
  return null;
}

async function quieto(b, v) {
  for (let i = 0; i < 100; i++) {
    b.albero = v.render(cx(b));
    if (b.attese.size) {
      await Promise.allSettled([...b.attese]);
      continue;
    }
    if (b.timer.length) {
      b.timer.splice(0).forEach((f) => f());
      continue;
    }
    if (b.eventi.length) {
      b.eventi.splice(0);
      b.controllaFile();
      continue;
    }
    return;
  }
  b.falliti.push("never quiet");
}

async function clic(b, v, child) {
  const e = trovaElemento(b.albero, `pannello-${child}`);
  if (!e?.click) {
    b.falliti.push(`no button for ${child}`);
    return;
  }
  e.click(null, cx(b));
  await quieto(b, v);
}

function esito(b) {
  const body = trova(b.chrome, "panel-body"), panel = trova(b.chrome, "panel");
  const suDisco = trova(JSON.parse(b.file.get(LAYOUT)), "panel-body");
  return {
    falliti: b.falliti,
    avvisi: b.avvisi,
    blocchi: (body?.children ?? []).map((c) => c.id),
    blocchiSuDisco: (suDisco?.children ?? []).map((c) => c.id),
    neovimSuDisco: (suDisco?.children ?? []).find((c) => c.id === "neovim") ?? null,
    attivo: body?.active ?? null,
    visibile: Boolean(panel && !panel.hidden),
    nvim: b.core.get("brudr-nvim") ?? null,
  };
}

// Scenario: Neovim shown, its terminal killed, brudr saves (or not yet) before
// the mod looks; then two clicks on the Neovim button (hide, show).
async function scenario(salvaPrima) {
  globalThis.MEMORIA = new Map();
  const b = new Brudr(fs.readFileSync(layoutFile, "utf8"));
  globalThis.BRUDR = b;
  const v = new Pannelli();
  v.init();
  await quieto(b, v);
  await clic(b, v, "neovim");
  const prima = esito(b);
  const primo = prima.nvim?.address ?? null;
  b.uccidi("brudr-nvim");
  if (salvaPrima) b.salva();
  await quieto(b, v);
  const dopoChiusura = esito(b);
  await clic(b, v, "neovim");
  const nascosto = esito(b);
  await clic(b, v, "neovim");
  b.salva(); // a later save keeps what the file says now
  const nuovo = b.core.get("brudr-nvim");
  return { prima, dopoChiusura, nascosto, dopo: { ...esito(b), nuovoTerminale: Boolean(nuovo) && nuovo.address !== primo } };
}

// Scenario: the layout file already lost the Neovim block (an earlier session
// saved it so, as on the author's Mac on 23 November); the panel is closed; one click.
async function fileSenzaNeovim() {
  const d = JSON.parse(fs.readFileSync(layoutFile, "utf8"));
  const body = trova(d, "panel-body");
  body.children = body.children.filter((c) => c.id !== "neovim");
  globalThis.MEMORIA = new Map();
  const b = new Brudr(JSON.stringify(d, null, 2) + "\n");
  globalThis.BRUDR = b;
  const v = new Pannelli();
  v.init();
  await quieto(b, v);
  const prima = esito(b);
  await clic(b, v, "neovim");
  b.salva();
  return { prima, dopo: { ...esito(b), nuovoTerminale: Boolean(b.core.get("brudr-nvim")) } };
}

async function browser() {
  globalThis.MEMORIA = new Map();
  const b = new Brudr(fs.readFileSync(layoutFile, "utf8"));
  globalThis.BRUDR = b;
  const v = new Pannelli();
  v.init();
  await quieto(b, v);
  const pulsante = trovaElemento(b.albero, "pannello-browser").figli;
  await clic(b, v, "browser");
  const aperto = esito(b);
  await clic(b, v, "browser");
  const chiuso = esito(b);
  const chiamatePrimaDiNeovim = b.chiamateCore.length;
  await clic(b, v, "neovim");
  await clic(b, v, "browser");
  return { pulsante, aperto, chiuso, ritorno: esito(b), chiamatePrimaDiNeovim, chiamate: b.chiamateCore,
    memorizzato: JSON.parse(MEMORIA.get("panels")) };
}

const out = { salvaPrima: await scenario(true), senzaSalvare: await scenario(false), fileSenzaNeovim: await fileSenzaNeovim(), browser: await browser() };
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 1));
