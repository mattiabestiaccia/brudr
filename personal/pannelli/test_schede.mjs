// test_schede.mjs: the three-pane tab (mods/pannelli/schede.js) against a fake brudr.
//
// Usage: node --test personal/pannelli/test_schede.mjs
//
// The fake keeps one row of panes per tab and does what src/layout.rs does with
// it: Node::split (wrap a lone pane in a row with both sizes unset, or halve the
// target's weight in its row) and resize_plan (the target gets its share, the
// others split the rest by their weights). Widths on screen come from the weights.
import test from "node:test";
import assert from "node:assert/strict";
import { SCHEDE, LATO, PIOGGIA, schedaDi, apriScheda } from "./mods/pannelli/schede.js";

const LARGHEZZA = 1000;

class Brudr {
  constructor() {
    this.tabs = [{ id: "tb0", name: "", argv: null, row: [{ pane: "p0", w: null, argv: null }] }];
    this.n = 1;
    this.chiamate = [];
    this.fuoco = "p0";
    this.disegnato = true; // a new tab is measured only after it is drawn (sleep)
  }
  panes() {
    return this.tabs.flatMap((t) => t.row.map((p) => ({ pane: p.pane, tab: t.id, focused: p.pane === this.fuoco })));
  }
  riga(pane) {
    return this.tabs.find((t) => t.row.some((p) => p.pane === pane))?.row ?? null;
  }
  px(riga) {
    const peso = (p) => p.w ?? 1;
    const tot = riga.reduce((s, p) => s + peso(p), 0);
    return riga.map((p) => (peso(p) / tot) * LARGHEZZA);
  }
  run(nome, a = {}) {
    this.chiamate.push([nome, structuredClone(a)]);
    if (nome === "tab.new") {
      const p = { pane: `p${this.n++}`, w: null, argv: a.argv ?? null };
      this.tabs.push({ id: `tb${this.n++}`, name: a.name ?? "", space: a.space, row: [p] });
      this.fuoco = p.pane;
      this.disegnato = false;
    } else if (nome === "pane.split") {
      assert.equal(a.direction, "right");
      const riga = this.riga(a.pane);
      const i = riga.findIndex((p) => p.pane === a.pane);
      const nuovo = { pane: `p${this.n++}`, w: null, argv: a.argv ?? null };
      if (riga.length === 1) {
        riga.push(nuovo); // wrapped: both sizes unset
      } else {
        const quota = riga[i].w ?? 1;
        riga[i].w = quota / 2;
        nuovo.w = quota / 2;
        riga.splice(i + 1, 0, nuovo);
      }
      this.fuoco = nuovo.pane;
    } else if (nome === "pane.resize") {
      if (!this.disegnato) throw new Error("pane.resize before the tab was drawn");
      const riga = this.riga(a.pane);
      const px = this.px(riga);
      const t = riga.findIndex((p) => p.pane === a.pane);
      const pesi = riga.map((p) => p.w ?? 1);
      const pool = px.reduce((s, x) => s + x, 0);
      const nuovi = px.slice();
      nuovi[t] = a.width * pool;
      const resto = pool - nuovi[t];
      const altri = riga.map((_, i) => i).filter((i) => i !== t);
      const somma = altri.reduce((s, i) => s + pesi[i], 0);
      for (const i of altri) nuovi[i] = (resto * pesi[i]) / somma;
      const scala = pesi.reduce((s, x) => s + x, 0) / pool;
      riga.forEach((p, i) => { p.w = nuovi[i] * scala; });
    } else if (nome === "pane.focus") {
      this.fuoco = a.pane;
    } else {
      throw new Error(`unexpected command ${nome}`);
    }
    return null;
  }
  host() {
    return {
      run: (n, a) => this.run(n, a),
      panes: () => this.panes(),
      sleep: async () => { this.disegnato = true; },
      space: "sp1",
    };
  }
}

for (const s of SCHEDE) {
  test(`${s.id}: rain, ${s.nome}, rain, with equal sides`, async () => {
    const b = new Brudr();
    const [sx, centro, dx] = await apriScheda(s, b.host());
    const tab = b.tabs.at(-1);
    assert.deepEqual(tab.row.map((p) => p.pane), [sx, centro, dx]);
    assert.deepEqual(tab.row[0].argv, PIOGGIA);
    assert.deepEqual(tab.row[1].argv, s.argv);
    assert.deepEqual(tab.row[2].argv, PIOGGIA);
    const quote = b.px(tab.row).map((x) => x / LARGHEZZA);
    assert.ok(Math.abs(quote[0] - LATO) < 1e-9, `left ${quote[0]}`);
    assert.ok(Math.abs(quote[1] - (1 - 2 * LATO)) < 1e-9, `middle ${quote[1]}`);
    assert.ok(Math.abs(quote[2] - LATO) < 1e-9, `right ${quote[2]}`);
    assert.equal(b.fuoco, centro);
    assert.equal(tab.space, "sp1");
    assert.equal(tab.name, s.argv ? s.nome : "");
    // The tab before is untouched.
    assert.deepEqual(b.tabs[0].row.map((p) => p.pane), ["p0"]);
  });
}

test("the menu's choices: Terminal and the five profiles, no OpenCode or Cursor", () => {
  assert.deepEqual(SCHEDE.map((s) => s.nome), ["Terminal", "CCB", "PIB", "GPB", "CCF", "PIF"]);
  assert.deepEqual(SCHEDE.find((s) => s.id === "ccb").argv, ["ccb", "--here"]);
  assert.deepEqual(SCHEDE.find((s) => s.id === "ccf").argv, ["ccf"]);
});

test("schedaDi reads only scheda-<known id>", () => {
  assert.equal(schedaDi("scheda-pib").nome, "PIB");
  assert.equal(schedaDi("scheda-opencode"), null);
  assert.equal(schedaDi("refresh"), null);
  assert.equal(schedaDi(undefined), null);
});

test("a step that makes no pane stops before the next one", async () => {
  const b = new Brudr();
  const h = b.host();
  h.run = (n, a) => (n === "pane.split" ? null : b.run(n, a));
  await assert.rejects(apriScheda(SCHEDE[1], h), /middle pane/);
  assert.deepEqual(b.chiamate.map(([n]) => n), ["tab.new"]);
});
