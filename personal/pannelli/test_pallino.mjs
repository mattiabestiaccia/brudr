// Tests of the purple dot of the reviews (decision of 26 November 2026: a PR review is not
// opened in Bruvish, brudr shows a purple dot on «Revisioni»): the logic in nuove.js, and the
// panel's side of the channel with the pannelli mod. The bar's side (the dot on the button, the
// seen state in the file) is in test_pannelli.py (test_pallino_viola_delle_revisioni_nuove).
//
//   node --test personal/pannelli/test_pallino.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as N from "./mods/pannelli/nuove.js";
import { Banco } from "./prova_revisioni.mjs";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const PAGINA = fs.readFileSync(path.join(QUI, "test-dati/postit-6-pagina.json"), "utf8");
const NOME = "mattiabestiaccia-postit-6";
const CART = `/casa/.local/state/pr-revisione/${NOME}`;
const rev = (nome, stato, extra = {}) => ({ nome, stato, generata: 1, pagina_json: `/p/${nome}/pagina.json`, ...extra });

test("the head is the «Head» fact of the page, without backticks", () => {
  assert.equal(N.testaDi(PAGINA), "aaaaaaa");
  assert.equal(N.testaDi("non json"), null);
  assert.equal(N.testaDi(null), null);
  assert.equal(N.testaDi(JSON.stringify({ header: { facts: [{ label: "PR", text: "#1" }] } })), null);
});

test("a candidate: open or draft PR, with a page and a name that is a folder name", () => {
  assert.ok(N.candidata(rev("a-b-1", "aperta")));
  assert.ok(N.candidata(rev("a-b-1", "bozza")));
  assert.ok(!N.candidata(rev("a-b-1", "unita")));
  assert.ok(!N.candidata(rev("a-b-1", "chiusa")));
  assert.ok(!N.candidata(rev("a-b-1", "aperta", { pagina_json: null })));
  assert.ok(!N.candidata(rev("../x", "aperta")));
  assert.ok(!N.candidata(null));
});

test("new: never seen, or seen with another head; an unknown head never relights", () => {
  const r = rev("a-b-1", "aperta");
  assert.ok(N.eNuova(r, {}, "aaa"));
  assert.ok(!N.eNuova(r, { "a-b-1": { testa: "aaa", visto: 1 } }, "aaa"));
  assert.ok(N.eNuova(r, { "a-b-1": { testa: "aaa", visto: 1 } }, "bbb"));
  assert.ok(!N.eNuova(r, { "a-b-1": { testa: "aaa", visto: 1 } }, null));
  assert.ok(!N.eNuova(r, { "a-b-1": { testa: null, visto: 1 } }, "bbb"));
  assert.ok(!N.eNuova(rev("a-b-1", "unita"), {}, "aaa"));
});

test("the new ones, in the list's order", () => {
  const lista = [rev("a-b-3", "bozza"), rev("a-b-2", "unita"), rev("a-b-1", "aperta")];
  assert.deepEqual(N.nuove(lista, { "a-b-3": { testa: "x", visto: 1 } }, { "a-b-3": { testa: "x" } }), ["a-b-1"]);
  assert.deepEqual(N.nuove(null, {}, {}), []);
});

test("the seen file: read leniently, written with the head, the oldest dropped past the limit", () => {
  assert.deepEqual(N.leggiViste(null), {});
  assert.deepEqual(N.leggiViste("{"), {});
  assert.deepEqual(N.leggiViste("[1]"), {});
  assert.deepEqual(N.leggiViste(JSON.stringify({ "a-b-1": { testa: "x", visto: 5 }, "../x": { testa: "y" }, "a-b-2": 3 })),
    { "a-b-1": { testa: "x", visto: 5 } });
  const v = N.conVista({ "a-b-1": { testa: "x", visto: 1 } }, "a-b-1", null, 9);
  assert.deepEqual(v, { "a-b-1": { testa: "x", visto: 9 } }, "an unknown head keeps the old one");
  let grandi = {};
  for (let i = 0; i < N.MAX_VISTE + 5; i++) grandi = N.conVista(grandi, `r-${i}`, "h", i);
  assert.equal(Object.keys(grandi).length, N.MAX_VISTE);
  assert.ok(!("r-0" in grandi) && `r-${N.MAX_VISTE + 4}` in grandi);
  assert.deepEqual(N.leggiViste(N.testoViste(grandi)), grandi);
});

// ---- the revisioni mod: the list's dot, and the announcement that a review is open

const ok = (d) => ({ code: 0, stdout: JSON.stringify(d), stderr: "" });
const voce = (x) => ({ repo: "mattiabestiaccia/postit", numero: 6, titolo: "feat", note_non_lette: 0, eventi_non_letti: 0,
  pagina_chiusa: false, cartella: CART, pagina_json: `${CART}/pagina.json`, ...x });
const ELENCO = { mostrate: 2, totale: 2, revisioni: [
  voce({ nome: NOME, stato: "aperta" }),
  voce({ nome: "x-y-1", stato: "aperta", cartella: "/casa/a", pagina_json: null, titolo: "senza pagina" }),
] };

async function banco() {
  const b = await Banco.crea({
    file: new Map([[`${CART}/pagina.json`, PAGINA]]),
    exec: (cmd) => (cmd === "/casa/bin/pr-revisione-ai" ? ok(ELENCO) : { code: 0, stdout: "", stderr: "" }),
  });
  await b.avvia();
  return b;
}

test("the list draws a purple dot only on the reviews the pannelli mod says are new", async () => {
  const b = await banco();
  assert.equal(b.elemento(`nuova-${NOME}`), null, "no dot until the bar publishes");
  b.condivisi.set("revisioni.nuove", [NOME]);
  await b.quieto();
  const punto = b.elemento(`nuova-${NOME}`);
  assert.ok(punto, "the new review has the dot");
  assert.ok(punto.metodi.includes("bg") && punto.metodi.includes("tooltip"));
  assert.equal(b.elemento("nuova-x-y-1"), null, "another review has none");
  b.condivisi.set("revisioni.nuove", []);
  await b.quieto();
  assert.equal(b.elemento(`nuova-${NOME}`), null, "out once the bar says it was seen");
  assert.deepEqual(b.errori, []);
});

test("opening a review tells the pannelli mod; the executor redoing the open page tells it again", async () => {
  const b = await banco();
  assert.equal(b.condivisi.get("revisioni.aperta") ?? null, null, "listing opens nothing");
  await b.clic(`rev-${NOME}`);
  const prima = b.condivisi.get("revisioni.aperta");
  assert.equal(prima.nome, NOME);
  assert.ok(prima.n != null);
  // The executor redoes the page while it is shown (a new head): the panel asks again.
  const pagina = JSON.parse(PAGINA);
  pagina.header.facts.find((f) => f.label === "Head").text = "`bbbbbbb`";
  b.file.set(`${CART}/pagina.json`, JSON.stringify(pagina));
  b.tocca(CART);
  await b.quieto();
  const dopo = b.condivisi.get("revisioni.aperta");
  assert.equal(dopo.nome, NOME);
  assert.notEqual(dopo.n, prima.n, "asked again, with a new value");
  assert.deepEqual(b.errori, []);
});

test("the mods' shared keys are the ones the bar uses", () => {
  const barra = fs.readFileSync(path.join(QUI, "mods/pannelli/main.js"), "utf8");
  const mod = fs.readFileSync(path.join(QUI, "mods/revisioni/main.js"), "utf8");
  for (const chiave of ['"revisioni.nuove"', '"revisioni.aperta"']) {
    assert.ok(barra.includes(chiave) && mod.includes(chiave), chiave);
  }
});
