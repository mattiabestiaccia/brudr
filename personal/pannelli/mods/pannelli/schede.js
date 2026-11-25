// schede.js: a new tab laid out as asked on 24 November 2026:
// three panes side by side, drift's rain on both sides, the program in the middle,
// and the two sides the same width.
//
// Both the "+" menu (mod nuova-scheda) and the keys (cmd-t) reach this through
// the pannelli mod's nextCommand(): "scheda-<id>", one id of SCHEDE.
//
// run() only queues a command (src/mods.rs, Request::Run): the pane appears in
// panes() later, so every step waits for it before the next one.
//
// The steps. tab.new starts the middle program as Herdr starts any agent (a login
// shell that stays when the program ends). A split can only go right or down, so
// the rain goes right twice and then the left one swaps with the middle:
//   tab.new          [C]
//   split C right    [C 1, R 1]        (src/layout.rs Node::split wraps a lone pane)
//   split C right    [C .5, L .5, R 1] (a split halves the target's weight)
//   swap C and L     [L .5, C .5, R 1]
// pane.resize gives the target its share and splits the rest among the others by
// their weights (resize_plan): R at 1/3 leaves L and C equal, so all three weigh
// the same; then C at 1 - 2*LATO leaves L and R equal again, at LATO each.

/** Share of the tab's width for each side pane. */
export const LATO = 0.125;

const FISH = "/opt/homebrew/bin/fish";
/** The side panes: the rain, then fish stays (as src/window.rs unix_agent_argv does for agents). */
export const PIOGGIA = [FISH, "-lic", "command $argv[2..]; exec $argv[1] -li", FISH, "drift", "--scene", "rain", "--duration", "0"];

/** What a new tab can hold in the middle. `programma`: the key of Herdr's program table, for the icon. */
export const SCHEDE = [
  { id: "terminale", nome: "Terminal", argv: null, programma: "shell" },
  // Each profile runs as the user types it in a terminal, with no options: the launcher
  // picks its own role folder,
  // whatever the folder of the tab that was open (25 November 2026).
  { id: "ccb", nome: "CCB", argv: ["ccb"], programma: "claude" },
  { id: "pib", nome: "PIB", argv: ["pib"], programma: "pi" },
  { id: "gpb", nome: "GPB", argv: ["gpb"], programma: "codex" },
  { id: "ccf", nome: "CCF", argv: ["ccf"], programma: "claude" },
  { id: "pif", nome: "PIF", argv: ["pif"], programma: "pi" },
];

export const COMANDO = "scheda-";

/** Shared state key: the choices as the menu shows them (id, nome, programma). */
export const ELENCO = "pannelli.schede";

/** How long a step may take to show its pane, and how often to look. */
export const ATTESA_MS = 3000, PASSO_MS = 40;

/** The scheda a nextCommand() string asks for, or null. */
export function schedaDi(comando) {
  if (typeof comando !== "string" || !comando.startsWith(COMANDO)) return null;
  return SCHEDE.find((s) => s.id === comando.slice(COMANDO.length)) ?? null;
}

/**
 * Opens the tab. `h`: { run, panes, focused, sleep, space }, the mod's host functions.
 * Resolves to the three panes [left, middle, right], or throws with the step that failed.
 * A remote space gets Herdr's plain tab: the rain and the profiles are this Mac's.
 */
export async function apriScheda(s, h) {
  if (h.remoto) {
    h.run("tab.new", h.space ? { space: h.space } : {});
    return null;
  }
  const visti = new Set(h.panes().map((p) => p.pane));
  const schede = new Set(h.panes().map((p) => p.tab));
  // The one pane that was not there before, once it appears: for tab.new in a tab
  // that was not there either, for a split in our tab. A pane another action makes
  // elsewhere meanwhile is not ours.
  const nuovo = async (passo, dove) => {
    for (let t = 0; t <= ATTESA_MS; t += PASSO_MS) {
      const nuovi = h.panes().filter((p) => !visti.has(p.pane) && (dove ? p.tab === dove : !schede.has(p.tab)));
      if (nuovi.length === 1) {
        visti.add(nuovi[0].pane);
        return nuovi[0];
      }
      if (nuovi.length > 1) throw new Error(`${passo}: more than one new pane`);
      await h.sleep(PASSO_MS);
    }
    throw new Error(`${passo}: no new pane after ${ATTESA_MS} ms`);
  };

  const tab = {};
  if (h.space) tab.space = h.space;
  if (s.argv) { tab.name = s.nome; tab.argv = s.argv; }
  h.run("tab.new", tab);
  const centro = await nuovo("tab.new");

  h.run("pane.split", { direction: "right", pane: centro.pane, argv: PIOGGIA });
  const destra = await nuovo("right pane", centro.tab);
  h.run("pane.split", { direction: "right", pane: centro.pane, argv: PIOGGIA });
  const sinistra = await nuovo("left pane", centro.tab);
  h.run("pane.swap", { pane: centro.pane, target: sinistra.pane });

  // pane.resize measures the shown tab on screen. If the user went to another tab
  // meanwhile, the sizes stay as they are and the focus is not taken back.
  await h.sleep(200);
  if (h.focused()?.tab !== centro.tab) return [sinistra.pane, centro.pane, destra.pane];
  h.run("pane.resize", { pane: destra.pane, width: 1 / 3 });
  h.run("pane.resize", { pane: centro.pane, width: 1 - 2 * LATO });
  h.run("pane.focus", { pane: centro.pane });
  return [sinistra.pane, centro.pane, destra.pane];
}
