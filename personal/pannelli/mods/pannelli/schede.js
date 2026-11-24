// schede.js: a new tab laid out as asked on 24 November 2026:
// three panes side by side, drift's rain on both sides, the program in the middle,
// and the two sides the same width.
//
// Both the "+" menu (mod nuova-scheda) and the keys (cmd-t) reach this through
// the pannelli mod's nextCommand(): "scheda-<id>", one id of SCHEDE.
//
// How the sizes come out exactly symmetric (src/layout.rs, Node::split and
// resize_plan): tab.new gives the left pane; splitting it wraps it in a row
// [L 1, C 1]; splitting C halves its weight: [L 1, C .5, R .5]. pane.resize gives
// the target its share and splits the rest among the others by their weights:
// L at 1/3 leaves C and R equal, so all three weigh the same; then C at
// 1 - 2*LATO leaves L and R equal again, at LATO each.

/** Share of the tab's width for each side pane. */
export const LATO = 0.125;

/** The side panes: fish that starts with the rain; a key ends the rain and leaves fish. */
export const PIOGGIA = ["/opt/homebrew/bin/fish", "-C", "drift --scene rain --duration 0"];

/** What a new tab can hold in the middle. `programma`: the key of Herdr's program table, for the icon. */
export const SCHEDE = [
  { id: "terminale", nome: "Terminal", argv: null, programma: "shell" },
  { id: "ccb", nome: "CCB", argv: ["ccb", "--here"], programma: "claude" },
  { id: "pib", nome: "PIB", argv: ["pib", "--here"], programma: "pi" },
  { id: "gpb", nome: "GPB", argv: ["gpb", "--here"], programma: "codex" },
  // Some launchers start in their own home: they have no --here.
  { id: "ccf", nome: "CCF", argv: ["ccf"], programma: "claude" },
  { id: "pif", nome: "PIF", argv: ["pif"], programma: "pi" },
];

export const COMANDO = "scheda-";

/** Shared state key: the choices as the menu shows them (id, nome, programma). */
export const ELENCO = "pannelli.schede";

/** The scheda a nextCommand() string asks for, or null. */
export function schedaDi(comando) {
  if (typeof comando !== "string" || !comando.startsWith(COMANDO)) return null;
  return SCHEDE.find((s) => s.id === comando.slice(COMANDO.length)) ?? null;
}

/**
 * Opens the tab. `h`: { run, panes, sleep, space }, the mod's host functions.
 * Resolves to the three panes [left, middle, right], or throws with the step that failed.
 */
export async function apriScheda(s, h) {
  const nuovo = () => {
    const prima = new Set(visti);
    const nuovi = h.panes().map((p) => p.pane).filter((p) => !prima.has(p));
    for (const p of nuovi) visti.add(p);
    return nuovi.length === 1 ? nuovi[0] : null;
  };
  const visti = new Set(h.panes().map((p) => p.pane));

  const tab = { argv: PIOGGIA };
  if (h.space) tab.space = h.space;
  if (s.argv) tab.name = s.nome;
  h.run("tab.new", tab);
  const sinistra = nuovo();
  if (!sinistra) throw new Error("tab.new did not make one pane");

  const mezzo = { direction: "right", pane: sinistra };
  if (s.argv) mezzo.argv = s.argv;
  h.run("pane.split", mezzo);
  const centro = nuovo();
  if (!centro) throw new Error("the middle pane did not appear");

  h.run("pane.split", { direction: "right", pane: centro, argv: PIOGGIA });
  const destra = nuovo();
  if (!destra) throw new Error("the right pane did not appear");

  // pane.resize measures the panes on screen: the new tab must be drawn first.
  await h.sleep(250);
  h.run("pane.resize", { pane: sinistra, width: 1 / 3 });
  h.run("pane.resize", { pane: centro, width: 1 - 2 * LATO });
  h.run("pane.focus", { pane: centro });
  return [sinistra, centro, destra];
}
