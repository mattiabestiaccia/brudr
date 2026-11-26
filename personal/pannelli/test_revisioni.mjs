// Tests of the revisioni mod (the PR reviews panel of brudr) without brudr: the logic in
// dati.js, then the real main.js against the fake brudr of prova_revisioni.mjs, then (when
// agenti-comune is there) the whole way to a real executor with a fake GitHub (banco-revisioni).
//
//   node --test personal/pannelli/test_revisioni.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as D from "./mods/revisioni/dati.js";
import { Banco, metodi, MOD, APP, NOME_LAYOUT } from "./prova_revisioni.mjs";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const PAGINA = fs.readFileSync(path.join(QUI, "test-dati/postit-6-pagina.json"), "utf8");
const NOME = "mattiabestiaccia-postit-6";
const CART = `/casa/.local/state/pr-revisione/${NOME}`;
const VISTA = JSON.parse(PAGINA).actions.view;

const voce = (x) => ({ repo: "mattiabestiaccia/postit", numero: 6, titolo: "feat", note_non_lette: 0, eventi_non_letti: 0,
  pagina_chiusa: false, cartella: CART, pagina_json: `${CART}/pagina.json`, ...x });
const ELENCO = { mostrate: 3, totale: 3, revisioni: [
  voce({ nome: "x-y-1", stato: "unita", cartella: "/casa/a", pagina_json: null, titolo: "unita prima" }),
  voce({ nome: NOME, stato: "aperta", note_non_lette: 2 }),
  voce({ nome: "x-y-2", stato: "bozza", cartella: "/casa/b", pagina_json: null, titolo: "bozza" }),
] };
const ok = (d) => ({ code: 0, stdout: JSON.stringify(d), stderr: "" });

async function banco({ clic = () => ok({ ok: true, tipo: "operazione", esito: { operazione: "unisci", esito: "fatto" }, testo: "✓ Fatto" }), altro } = {}) {
  const file = new Map([[`${CART}/pagina.json`, PAGINA]]);
  const b = await Banco.crea({
    file,
    exec: (cmd, args) => {
      if (cmd === "/casa/bin/pr-revisione-ai") return ok(ELENCO);
      if (cmd === "/casa/bin/pr-revisione-clic") return clic(args);
      return altro ? altro(cmd, args) : { code: 0, stdout: "", stderr: "" };
    },
  });
  await b.avvia();
  return b;
}

// ---- dati.js

test("sha256 as node's, for the Lavish session key", () => {
  for (const s of ["", "abc", "/home/u/.local/state/pr-revisione/a-b-1/pagina.html", "è€😀".repeat(40)]) {
    assert.equal(D.sha256(s), createHash("sha256").update(s).digest("hex"));
  }
  const url = D.urlLavish("/x/y/", "4388");
  assert.equal(url, `http://127.0.0.1:4388/session/${createHash("sha256").update("/x/y/pagina.html").digest("hex").slice(0, 16)}`);
  assert.equal(D.portaLavish('export const DEFAULT_PORT = "4390";'), "4390");
  assert.equal(D.portaLavish(null), "4388");
});

test("the list: open PRs first, each part in elenco's order", () => {
  const e = D.leggiElenco(ok(ELENCO));
  assert.deepEqual(e.revisioni.map((r) => r.nome), [NOME, "x-y-2", "x-y-1"]);
  assert.match(D.leggiElenco({ code: 1, stdout: "", stderr: "boom\n" }).errore, /boom/);
  assert.ok(D.leggiElenco({ code: 0, stdout: "nope" }).errore);
});

test("tree: groups take the place of their first section", () => {
  const a = D.albero(JSON.parse(PAGINA));
  assert.deepEqual(a.map((v) => v.figli ? `${v.titolo}[${v.figli.map((f) => f.id).join(",")}]` : v.id),
    ["sintesi", "Verifiche[passi,revisione,prove,ci]", "Modifiche[file,commit]", "Storia[conversazione,cronologia,diagnostica]"]);
});

test("text blocks and marks", () => {
  assert.deepEqual(D.paragrafi(["Una ==frase==.", ["a", { text: "b", highlight: true }]]), ["Una **frase**.", "a **b**"]);
  assert.deepEqual(D.paragrafi(undefined), []);
  assert.equal(D.piano("**a** `b` ==c=="), "a b c");
  assert.equal(D.titoloSenzaNumero("feat: x #6"), "feat: x");
});

test("state after an answer", () => {
  assert.equal(D.statoDopo("unisci", "fatto", "aperta"), "unita");
  assert.equal(D.statoDopo("pronta-unisci", "parziale", "bozza"), "aperta");
  assert.equal(D.statoDopo("unisci", "rifiutato", "aperta"), "aperta");
  assert.equal(D.statoDopo("chiudi", "fatto", "aperta"), "chiusa");
  assert.equal(D.statoDopo("commento", "fatto", "aperta"), "aperta");
});

test("pr-revisione-clic arguments", () => {
  assert.deepEqual(D.argomentiClic({ tipo: "operazione", nome: "a-b-1", operazione: "commento-riga", vista: "v", testo: "t", file: "f.js", riga: 3 }),
    ["operazione", "a-b-1", "commento-riga", "--vista", "v", "--testo", "t", "--file", "f.js", "--riga", "3", "--json", "--attesa", "300"]);
  assert.deepEqual(D.argomentiClic({ tipo: "nota", nome: "a-b-1", testo: "n", elemento: "S › C", immagini: ["/i.png"] }),
    ["nota", "a-b-1", "--testo", "n", "--elemento", "S › C", "--immagine", "/i.png", "--json", "--attesa", "300"]);
  assert.throws(() => D.argomentiClic({ tipo: "altro" }));
});

test("answers of pr-revisione-clic", () => {
  assert.equal(D.leggiRisposta({ code: 1, stdout: "", stderr: "pr-revisione-clic: il socket del pannello è negato\n" }).ok, false);
  assert.match(D.rigaEsito(D.leggiRisposta({ code: 1, stdout: "", stderr: "socket negato" })).testo, /socket negato/);
  const r = D.rigaEsito({ ok: true, tipo: "operazione", esito: { esito: "rifiutato", motivo: "CI rossa" }, testo: "✗ Rifiutato: **CI rossa**" });
  assert.deepEqual(r, { testo: "✗ Rifiutato: CI rossa", tono: "rosso" });
  assert.equal(D.rigaEsito({ ok: true, tipo: "nota", immagini_perse: ["x"] }).tono, "giallo");
});

test("diff as Bruvish reads it, with new-side numbers", () => {
  const f = D.parseDiff(JSON.parse(PAGINA).sections.find((s) => s.id === "file").cards[0].diff.text);
  assert.ok(f.length >= 1);
  const add = f[0].lines.find((l) => l.type === "add");
  assert.ok(Number.isInteger(add.new) && add.old === null);
  const q = D.parseDiff('diff --git "a/\\303\\250.txt" "b/\\303\\250.txt"\nnew file mode 100644\n--- /dev/null\n+++ "b/\\303\\250.txt"\n@@ -0,0 +1 @@\n+x\n');
  assert.deepEqual([q[0].name, q[0].status, q[0].added], ["è.txt", "added", 1]);
});

test("layout URL rewrite only on the web block", () => {
  const l = JSON.stringify({ id: "root", children: [{ id: "revisioni-web", content: { web: { url: "http://a/" } } }] });
  assert.equal(JSON.parse(D.conUrl(l, "revisioni-web", "http://b/").testo).children[0].content.web.url, "http://b/");
  assert.ok(D.conUrl(l, "revisioni-web", "http://a/").uguale);
  assert.ok(D.conUrl(l, "altro", "http://b/").errore);
});

// ---- the mod in the fake brudr

test("list, then a review widens the panel and going back restores it", async () => {
  const b = await banco();
  assert.deepEqual(b.chiamate[0], { cmd: "/casa/bin/pr-revisione-ai", args: ["elenco", "--json", "--limit", "50"], timeout: 30000 });
  const t = b.testi();
  assert.ok(t.indexOf("feat") < t.indexOf("unita prima"), "open PRs first");
  assert.ok(t.includes("2 note"));
  await b.clic(`rev-${NOME}`);
  assert.deepEqual(b.comandi.at(-1), ["layout.resize", { id: "panel", weight: 3 }]);
  const r = b.testi();
  assert.ok(r.includes("feat: fa stampare l'aiuto anche a -h"), "title without the PR number");
  for (const x of ["Aperta", "Repository", "`mattiabestiaccia/postit`", "Sintesi", "Verifiche", "Modifiche", "Storia"]) assert.ok(r.includes(x), x);
  await b.clic("nav-file");
  assert.ok(b.testi().some((x) => /^src\//.test(x) || x.includes(".")), "the diff's files");
  await b.clic("indietro");
  assert.deepEqual(b.comandi.at(-1), ["layout.resize", { id: "panel", px: 368 }]);
  assert.deepEqual(b.errori, []);
});

test("an operation runs only on Confirm, and the state follows the answer at once", async () => {
  const b = await banco();
  await b.clic(`rev-${NOME}`);
  await b.clic("op-primary-unisci");
  assert.ok(b.testi().includes("Conferma"));
  assert.equal(b.clicFatti().length, 0, "the dropdown alone sends nothing");
  await b.clic("annulla-testata");
  assert.ok(!b.testi().includes("Conferma"));
  await b.clic("op-primary-unisci");
  await b.clic("conferma-testata");
  assert.deepEqual(b.clicFatti().map((c) => c.args), [["operazione", NOME, "unisci", "--vista", VISTA, "--json", "--attesa", "300"]]);
  assert.equal(b.clicFatti()[0].timeout, 310000);
  assert.equal(b.v.statoMostrato(), "unita");
  assert.ok(b.testi().includes("Unita"));
  assert.ok(b.testi().includes("✓ Fatto"));
  // The view is used: until pagina.json brings a new one, operations are off.
  await b.clic("op-primary-unisci");
  assert.equal(b.v.conferma, null, "the used view's buttons are off");
  assert.equal(b.clicFatti().length, 1);
  assert.deepEqual(b.errori, []);
});

test("a refused request leaves the view usable", async () => {
  const b = await banco({ clic: () => ({ code: 1, stdout: "", stderr: "pr-revisione-clic: l'esecutore non ascolta" }) });
  await b.clic(`rev-${NOME}`);
  await b.clic("op-primary-unisci");
  await b.clic("conferma-testata");
  assert.equal(b.v.statoMostrato(), "aperta");
  assert.ok(b.testi().some((x) => x.includes("l'esecutore non ascolta")));
  assert.equal(b.v.usata, null);
});

test("no key, script or agent reaches an operation: nothing answers nextCommand", async () => {
  const sorgente = fs.readFileSync(path.join(MOD, "main.js"), "utf8");
  const codice = sorgente.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(codice, /nextCommand/);
  // pr-revisione-clic is started only by the two click handlers.
  const lanci = [...sorgente.matchAll(/bin\("pr-revisione-clic"\)/g)].length;
  assert.equal(lanci, 2);
  for (const f of ["conferma_clic", "invia_nota"]) {
    // Every call is a button's click handler: this.bottone(id, label, (_e, cx) => this.f(cx), ...).
    const tutti = [...sorgente.matchAll(new RegExp(`this\\.${f}\\(`, "g"))].length;
    const daClic = [...sorgente.matchAll(new RegExp(`\\(_e, cx\\) => this\\.${f}\\(cx\\)`, "g"))].length;
    assert.ok(tutti > 0 && tutti === daClic, `${f}: ${daClic} of ${tutti} calls from a click`);
  }
  const b = await banco();
  await b.clic(`rev-${NOME}`);
  for (let i = 0; i < 3; i++) await b.scatta();
  b.tocca(CART + "/pagina.json");
  await b.quieto();
  assert.equal(b.comandiChiesti, 0);
  assert.equal(b.clicFatti().length, 0);
});

test("a card note with a dragged image and a capture", async () => {
  const b = await banco({
    clic: () => ok({ ok: true, tipo: "nota", immagini: ["/n/a.png"], immagini_perse: [], testo: "Nota in coda per l'agente." }),
    altro: (cmd) => ({ code: cmd === "/bin/test" ? 0 : 0, stdout: "", stderr: "" }),
  });
  await b.clic(`rev-${NOME}`);
  await b.clic("carta-sintesi-6-nota");
  assert.ok(b.testi().includes("Nota su Sintesi › Rischi"));
  await b.trascina("nota-carta-sintesi-6", ["/x/a.png", "/x/b.txt", "/x/c.JPG"]);
  await b.clic("nota-cattura");
  const cattura = b.chiamate.find((c) => c.cmd === "/usr/sbin/screencapture");
  assert.equal(cattura.args[0], "-i");
  assert.match(cattura.args[1], new RegExp(`^${CART}/note/cattura-\\d+\\.png$`));
  b.v.testoNota.set_value("Il rischio non mi torna");
  await b.clic("nota-invia");
  const [n] = b.clicFatti();
  assert.deepEqual(n.args.slice(0, 6), ["nota", NOME, "--testo", "Il rischio non mi torna", "--elemento", "Sintesi › Rischi"]);
  assert.deepEqual(n.args.filter((_x, i) => n.args[i - 1] === "--immagine"), ["/x/a.png", "/x/c.JPG", cattura.args[1]]);
  assert.equal(b.v.nota, null);
  assert.ok(b.testi().includes("Nota in coda per l'agente."));
});

test("a diff line: note to the agent, or a line comment on GitHub after Confirm", async () => {
  const b = await banco({ clic: (a) => ok(a[0] === "nota" ? { ok: true, tipo: "nota", immagini: [], immagini_perse: [] }
    : { ok: true, tipo: "operazione", esito: { operazione: "commento-riga", esito: "fatto" }, testo: "✓ Fatto" }) });
  await b.clic(`rev-${NOME}`);
  await b.clic("nav-file");
  const id = (function cerca(e) {
    const t = e?._e;
    if (!t) return null;
    if (t.id?.endsWith("-commenta")) return t.id;
    for (const f of t.figli) { const x = cerca(f); if (x) return x; }
    return null;
  })(b.albero);
  assert.ok(id, "a comment button on a line");
  await b.clic(id);
  const { file, riga } = b.v.nota;
  assert.ok(file && Number.isInteger(riga));
  b.v.testoNota.set_value("qui no");
  await b.clic("nota-github");
  assert.equal(b.clicFatti().length, 0, "the line comment waits for Confirm");
  await b.clic(`conferma-${b.v.conferma.dove}`);
  assert.deepEqual(b.clicFatti()[0].args, ["operazione", NOME, "commento-riga", "--vista", VISTA, "--testo", "qui no", "--file", file, "--riga", String(riga), "--json", "--attesa", "300"]);
});

test("a card operation with choices: «La tua revisione»", async () => {
  const b = await banco();
  await b.clic(`rev-${NOME}`);
  await b.clic("nav-revisione");
  await b.clic("operazione-revisione-azione");
  await b.clic("scelta-modifiche");
  await b.clic("conferma-operazione-revisione");
  assert.equal(b.clicFatti().length, 0, "the reason is required");
  b.v.testo.set_value("manca una prova");
  await b.clic("conferma-operazione-revisione");
  assert.deepEqual(b.clicFatti()[0].args.slice(0, 7), ["operazione", NOME, "modifiche", "--vista", VISTA, "--testo", "manca una prova"]);
});

test("pagina.json rewritten by the executor: read again, operations back", async () => {
  const b = await banco();
  await b.clic(`rev-${NOME}`);
  await b.clic("op-primary-unisci");
  await b.clic("conferma-testata");
  const nuova = JSON.parse(PAGINA);
  nuova.actions = { view: "nuova" };
  nuova.header.state = "unita";
  b.file.set(`${CART}/pagina.json`, JSON.stringify(nuova));
  b.tocca(`${CART}/pagina.json`);
  await b.quieto();
  assert.equal(b.v.pagina.actions.view, "nuova");
  assert.equal(b.v.usata, null);
  assert.equal(b.v.statoEsito, null);
  assert.equal(b.v.statoMostrato(), "unita");
});

test("V1: the same review's Lavish session in the web block", async () => {
  const b = await banco();
  await b.clic(`rev-lavish-${NOME}`);
  const l = JSON.parse(b.file.get(`${APP}/layouts/${NOME_LAYOUT}.json`));
  const web = l.children[1].children[0].children[1];
  assert.equal(web.content.web.url, `http://127.0.0.1:4388/session/${createHash("sha256").update(`${CART}/pagina.html`).digest("hex").slice(0, 16)}`);
  assert.deepEqual(b.comandi.filter((c) => c[0] !== "layout.resize").slice(-2), [["layout.select", { stack: "panel-body", child: "revisioni-web" }], ["layout.show", { id: "panel" }]]);
  await b.quieto();
  assert.deepEqual(b.comandi.at(-1), ["layout.resize", { id: "panel", weight: 3 }], "the web view widens the panel too");
});

test("the panel goes back to its width when another panel is shown", async () => {
  const b = await banco();
  await b.clic(`rev-${NOME}`);
  b.run("layout.select", { stack: "panel-body", child: "files" });
  await b.scatta();
  assert.deepEqual(b.comandi.at(-1), ["layout.resize", { id: "panel", px: 368 }]);
});

test("every method the mod calls is in gpui-kit.d.ts", { skip: !fs.existsSync(`${os.homedir()}/.config/herdr-app/gpui-kit.d.ts`) }, async () => {
  const dts = fs.readFileSync(`${os.homedir()}/.config/herdr-app/gpui-kit.d.ts`, "utf8");
  const b = await banco();
  const usati = new Set(metodi(b.albero));
  await b.clic(`rev-${NOME}`);
  for (const s of ["sintesi", "revisione", "file", "cronologia", "diagnostica", "conversazione"]) {
    await b.clic(`nav-${s}`);
    for (const m of metodi(b.albero)) usati.add(m);
  }
  await b.clic("nav-sintesi");
  await b.clic("carta-sintesi-2-aiuto");
  await b.clic("carta-sintesi-2-nota");
  await b.clic("op-primary-unisci");
  for (const m of metodi(b.albero)) usati.add(m);
  const mancano = [...usati].filter((m) => !new RegExp(`^\\s+${m}(<|\\()`, "m").test(dts));
  assert.deepEqual(mancano, []);
});

// ---- the whole way: mod, pr-revisione-clic, the executor's socket, a fake GitHub

const AC = process.env.AGENTI_COMUNE || path.join(os.homedir(), "agenti-comune");
const bancoPronto = fs.existsSync(path.join(AC, "tests/pr_revisione_esecutore_test.py"))
  && fs.existsSync(process.env.BRUVISH_BIN || path.join(os.homedir(), "tools/bruvish/current/bruvish/bin/bruvish.mjs"));

test("with the real executor and the fake GitHub: Unisci, then «Unita» before the page is redone", { skip: !bancoPronto, timeout: 300000 }, async () => {
  const home = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "banco-"));
  fs.rmdirSync(home);
  const p = spawn("python3", ["-B", path.join(QUI, "banco-revisioni"), home], { stdio: ["ignore", "pipe", "pipe"] });
  let errore = "";
  p.stderr.on("data", (x) => { errore += x; });
  const riga = await new Promise((ok, no) => {
    let out = "";
    p.stdout.on("data", (x) => { out += x; if (out.includes("\n")) ok(out.split("\n")[0]); });
    p.on("exit", () => no(new Error(`banco-revisioni: ${errore}`)));
  });
  const info = JSON.parse(riga);
  try {
    const env = { ...process.env, ...info.env };
    const reale = (cmd, args, opts) => new Promise((ok) => execFile(cmd, args, { env, timeout: opts?.timeout ?? 30000 },
      (e, stdout, stderr) => ok({ code: e ? (e.code ?? 1) : 0, stdout, stderr })));
    const b = await Banco.crea({ home: info.home, file: "disco", exec: reale });
    await b.avvia();
    await b.clic(`rev-${info.nome}`);
    assert.equal(b.v.statoMostrato(), "aperta");
    // As `herdr-app do revisioni.unisci`: a command for the mod. Nothing takes it.
    await b.scatta();
    const merge = () => (fs.existsSync(info.gh_log) ? fs.readFileSync(info.gh_log, "utf8") : "").split("\n").filter((l) => l.includes('"merge"')).length;
    assert.equal(merge(), 0);
    const vista = b.v.pagina.actions.view;
    await b.clic("op-primary-unisci");
    const t0 = Date.now();
    await b.clic("conferma-testata");
    const esito = Date.now() - t0;
    assert.equal(b.v.statoMostrato(), "unita", JSON.stringify(b.v.esito));
    assert.equal(merge(), 1);
    const pj = JSON.parse(fs.readFileSync(path.join(info.cartella, "pagina.json"), "utf8"));
    // The executor answers before it redoes the page (its fix A): the page still has the view of the click.
    assert.equal(pj.actions?.view, vista, "esito prima della pagina rifatta");
    for (let i = 0; i < 300 && JSON.parse(fs.readFileSync(path.join(info.cartella, "pagina.json"), "utf8")).header.state !== "unita"; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
    }
    b.tocca(path.join(info.cartella, "pagina.json"));
    await b.quieto();
    assert.equal(b.v.pagina.header.state, "unita");
    assert.ok(esito > 5000, `GitHub's merge takes its 5.4 s (${esito} ms)`);
    fs.writeFileSync(path.join(home, "tempi.json"), JSON.stringify({ esito_ms: esito }));
    assert.deepEqual(b.errori, []);
  } finally {
    p.kill("SIGTERM");
    await new Promise((ok) => p.on("exit", ok));
    fs.rmSync(home, { recursive: true, force: true });
  }
});
