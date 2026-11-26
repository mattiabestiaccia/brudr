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
    this.cadenze = []; // timer.every callbacks: the scenarios run them by hand
    this.eventi = [];
    this.condivisi = new Map(); // the mods' shared keys
    this.elencoRevisioni = []; // what pr-revisione-ai elenco answers
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
  // `vicino`: also as remove_inner (src/layout.rs) does with a stack's active
  // child: the neighbor that slides into its place (or the last one) becomes
  // active. The Neovim scenarios below were written without it and keep the
  // removed id as active; the view scenario uses it.
  terminaleFinito(nome, vicino = false) {
    for (const n of nodi(this.chrome)) {
      const i = (n.children ?? []).findIndex((c) => c.content?.terminal === nome);
      if (i < 0) continue;
      const [via] = n.children.splice(i, 1);
      if (vicino && n.active === via.id) n.active = (n.children[i] ?? n.children[n.children.length - 1])?.id;
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

  // exec: the fake pr-revisione-ai answers the list set in elencoRevisioni (null: it fails); mkdir does nothing.
  exec(comando) {
    if (comando.endsWith("/pr-revisione-ai")) {
      return this.elencoRevisioni === null ? { code: 1, stdout: "", stderr: "boom" }
        : { code: 0, stdout: JSON.stringify({ mostrate: this.elencoRevisioni.length, totale: this.elencoRevisioni.length, revisioni: this.elencoRevisioni }), stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
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
  uccidi(nome, vicino = false) {
    this.core.delete(nome);
    this.terminaleFinito(nome, vicino);
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
export const exec = async (c, a) => b().exec(c, a);
export const home = () => "/casa";
export const appHome = () => "${APP}";
export const readTextFile = async (p) => b().file.get(p) ?? null;
export const writeTextFile = async (p, testo, atteso) => {
  if ((b().file.get(p) ?? null) !== atteso) throw new Error("stale snapshot");
  b().file.set(p, testo);
  b().eventi.push(p);
  return null;
};
export const watchFolder = () => Promise.reject(new Error("no watch in the fake brudr")); // the mod falls back to its timer
export const shared = (k) => (k === "layout" ? "${NOME}" : b().condivisi.get(k) ?? null);
export const notify = (n) => { b().avvisi.push(n.body); return null; };
export const openOverlay = () => null;
export const window = () => ({ platform: "macos", titlebar: "none", buttons: false, maximized: false, fullscreen: false, active: true });
export const settings = () => ({ zoom: 1 });
// No mod command arrives in these scenarios: nextCommand rejects, as when the app shuts down.
export const nextCommand = () => Promise.reject(new Error("herdr-app is shutting down"));
export const setShared = (k, v) => { b().condivisi.set(k, clone(v)); return null; };`);
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
    timer: { after: (_ms, f) => b.timer.push(() => f(c)), every: (_ms, f) => b.cadenze.push(() => f(c)) },
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
  v.init(null, cx(b));
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
  v.init(null, cx(b));
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
  v.init(null, cx(b));
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

// Scenario: Superfile's Nushell view (spf-apri starts brudr-spf-vista and
// selects its block; q selects Superfile again and the view's terminal ends).
async function vista() {
  globalThis.MEMORIA = new Map();
  const b = new Brudr(fs.readFileSync(layoutFile, "utf8"));
  globalThis.BRUDR = b;
  const v = new Pannelli();
  v.init(null, cx(b));
  await quieto(b, v);
  const apri = async () => { // what spf-apri does in the panel
    b.core.set("brudr-spf-vista", { address: `t${++b.n}`, name: "brudr-spf-vista", state: "live",
      labels: { "brudr.panel": "spf-vista", "brudr.private": "1" } });
    b.run("layout.select", { stack: "panel-body", child: "spf-vista" });
    await quieto(b, v);
  };
  const stato = () => ({ ...esito(b), pannello: v.attivo().p?.child ?? null });
  await clic(b, v, "files");
  const superfile = stato();
  const scrittePrima = [...b.file.values()].join();
  await apri();
  const aperta = stato();
  // q: spf-apri's view selects Superfile, then ends; its block was hidden: no view, no drop.
  b.run("layout.select", { stack: "panel-body", child: "files" });
  b.core.delete("brudr-spf-vista");
  await quieto(b, v);
  const chiusa = { ...stato(), fileUguale: [...b.file.values()].join() === scrittePrima };
  // The view's terminal killed while shown: brudr drops its block, Superfile slides in.
  await apri();
  b.uccidi("brudr-spf-vista", true);
  await quieto(b, v);
  b.salva();
  const uccisa = stato();
  // A view left under Neovim comes back with the Superfile button.
  await apri();
  await clic(b, v, "neovim");
  const sottoNeovim = stato();
  await clic(b, v, "files");
  const ritorno = stato();
  // Superfile's button while the view is shown hides the panel, like Superfile's.
  await clic(b, v, "files");
  const nascosta = stato();
  return { superfile, aperta, chiusa, uccisa, sottoNeovim, ritorno, nascosta,
    memorizzato: JSON.parse(MEMORIA.get("panels") ?? "{}") };
}

// Scenario: the Revisioni panel (a mod block) and its web view revisioni-web (the V1
// prototype, selected by the revisioni mod): no core, the button stays lit on the view,
// a click hides the panel, the next one shows the mod again.
async function revisioni() {
  globalThis.MEMORIA = new Map();
  const b = new Brudr(fs.readFileSync(layoutFile, "utf8"));
  globalThis.BRUDR = b;
  const v = new Pannelli();
  v.init(null, cx(b));
  await quieto(b, v);
  const stato = () => ({ ...esito(b), pannello: v.attivo().p?.child ?? null });
  await clic(b, v, "revisioni");
  const aperto = stato();
  b.run("layout.select", { stack: "panel-body", child: "revisioni-web" });
  await quieto(b, v);
  const web = stato();
  await clic(b, v, "revisioni");
  const nascosto = stato();
  await clic(b, v, "revisioni");
  return { aperto, web, nascosto, ritorno: stato(), chiamate: b.chiamateCore, memorizzato: JSON.parse(MEMORIA.get("panels") ?? "{}") };
}

// Scenario: the purple dot on Revisioni (nuove.js): a review of an open PR nobody opened in
// the panel lights it; opening it (the revisioni mod asks through the shared key) puts it out;
// the executor redoing the page for the same head does not relight it, a new head does; a
// merged or closed PR, a review with no page, and a failing executor change nothing; a
// restart keeps what was seen.
async function pallino() {
  globalThis.MEMORIA = new Map();
  const b = new Brudr(fs.readFileSync(layoutFile, "utf8"));
  globalThis.BRUDR = b;
  const CART = "/casa/.local/state/pr-revisione", VISTE = `${APP}/data/pannelli/revisioni-viste.json`;
  const pagina = (testa) => JSON.stringify({ header: { facts: [{ label: "PR", text: "#1" }, { label: "Head", text: "`" + testa + "`" }] }, sections: [] });
  const rev = (nome, stato, generata, extra = {}) => ({ nome, stato, generata, titolo: nome, repo: "o/r", numero: 1,
    cartella: `${CART}/${nome}`, pagina_json: `${CART}/${nome}/pagina.json`, ...extra });
  const metti = (nome, testa) => b.file.set(`${CART}/${nome}/pagina.json`, pagina(testa));
  metti("o-r-1", "aaaaaaa"); metti("o-r-2", "ccccccc"); metti("o-r-3", "ddddddd");
  b.elencoRevisioni = [rev("o-r-1", "aperta", 1), rev("o-r-2", "unita", 1), rev("o-r-3", "bozza", 1, { pagina_json: null })];
  let v = new Pannelli();
  v.init(null, cx(b));
  await quieto(b, v);
  const punto = () => {
    const e = trovaElemento(b.albero, "pallino-revisioni");
    return { acceso: Boolean(e) };
  };
  const stato = () => ({ ...punto(), nuove: b.condivisi.get("revisioni.nuove"), viste: JSON.parse(b.file.get(VISTE) ?? "{}"),
    falliti: b.falliti, avvisi: b.avvisi });
  const rileggi = async () => { b.cadenze.forEach((f) => f()); await quieto(b, v); };
  const apertaDa = async (nome, n) => { b.condivisi.set("revisioni.aperta", { nome, n }); await quieto(b, v); };
  const out = {};
  out.nuova = stato(); // o-r-1 open with a page and never seen; o-r-2 merged, o-r-3 without a page: only o-r-1
  out.soloRevisioni = ["files", "neovim", "changes", "quota", "tasti", "privato", "browser"]
    .every((c) => !JSON.stringify(trovaElemento(b.albero, `pannello-${c}`).figli.map((f) => f?._e?.id ?? null)).includes("pallino-revisioni"));
  await apertaDa("o-r-1", 1);
  out.vista = stato(); // opened in the panel: out
  b.elencoRevisioni = [rev("o-r-1", "aperta", 2), rev("o-r-2", "unita", 1), rev("o-r-3", "bozza", 1, { pagina_json: null })];
  await rileggi();
  out.stessaTesta = stato(); // the executor redid the page, same head: still out
  metti("o-r-1", "bbbbbbb");
  b.elencoRevisioni = [rev("o-r-1", "aperta", 3), rev("o-r-2", "unita", 1)];
  await rileggi();
  out.testaNuova = stato(); // a new head: on again
  await apertaDa("o-r-1", 2);
  out.dopoLaTestaNuova = stato();
  metti("o-r-4", "eeeeeee");
  b.elencoRevisioni = [rev("o-r-4", "bozza", 1), rev("o-r-1", "aperta", 3)];
  await rileggi();
  out.bozza = stato(); // a draft PR counts
  b.elencoRevisioni = null; // the executor fails: nothing changes
  await rileggi();
  out.esecutoreGuasto = stato();
  b.elencoRevisioni = [rev("o-r-4", "unita", 2), rev("o-r-1", "aperta", 3)];
  await rileggi();
  out.unita = stato(); // merged: out
  b.elencoRevisioni = [rev("o-r-4", "bozza", 2), rev("o-r-1", "aperta", 3)];
  await rileggi();
  const prima = b.file.get(VISTE);
  b.condivisi.set("revisioni.nuove", ["vecchio"]);
  globalThis.MEMORIA = new Map();
  v = new Pannelli(); // a restart: the seen state is in the file, the persisted shared key is replaced
  v.init(null, cx(b));
  await quieto(b, v);
  out.riavvio = { ...stato(), fileUguale: b.file.get(VISTE) === prima };
  await apertaDa("../x", 3); // a name that is not a review's: nothing written
  out.nomeStorto = { viste: Object.keys(JSON.parse(b.file.get(VISTE))), falliti: b.falliti };
  return out;
}

const out = { salvaPrima: await scenario(true), senzaSalvare: await scenario(false), fileSenzaNeovim: await fileSenzaNeovim(),
  browser: await browser(), vista: await vista(), revisioni: await revisioni(), pallino: await pallino() };
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 1));
