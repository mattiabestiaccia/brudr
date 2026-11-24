// blocchi: the side panels and their blocks in the brudr-pannelli layout.
// No herdr import here, so the tests load it with plain node.
//
// Why the mod writes the layout file: when a panel's terminal ends (hc kill,
// a crash), brudr drops its block from the layout in memory (src/window.rs,
// terminal_ended), and the next save() writes the layout without it
// (layout_sync::without_clicks keeps the tree as it is now). layout.switch
// saves before it loads, so reloading the same layout brings back a file that
// already lost the block. The mod puts the block back in the file instead:
// brudr applies an edited layout file at once (check_layout_file).

export const PANNELLI = [
  { child: "files", tipo: "spf", nome: "Superfile", privato: true },
  { child: "neovim", tipo: "nvim", nome: "Neovim", privato: true },
  { child: "changes", tipo: "hunk", nome: "Hunk", privato: false, segue: true },
  { child: "quota", tipo: "quota", nome: "Quota", privato: false },
  { child: "tasti", tipo: "tasti", nome: "Tasti", privato: false },
  { child: "privato", tipo: "privato", nome: "Private", privato: true },
  { child: "browser", tipo: "web", nome: "Browser", privato: false, web: { url: "https://example.com/" } },
];

// Views that take a panel's place for a while, without a button of their own.
// spf-apri starts the view's terminal (brudr-spf-vista, private like Superfile)
// and selects its block; q in the view selects the panel again. The block sits
// just before the panel's: if brudr drops it while it is shown (its terminal
// ended), the panel's block slides into its place and becomes the shown one
// (src/layout.rs, remove_inner).
export const VISTE = [
  { child: "spf-vista", tipo: "spf-vista", nome: "Superfile", privato: true, di: "files" },
];

// Every block of the stack in its order: each view just before its panel.
export const ORDINE = PANNELLI.flatMap((p) => [...VISTE.filter((v) => v.di === p.child), p]);

export const STACK = "panel-body";

export const nomeDi = (p) => `brudr-${p.tipo}`;

// The panel a shown child belongs to: itself, or the panel a view stands for.
export function pannelloDi(child) {
  const v = VISTE.find((x) => x.child === child);
  return PANNELLI.find((p) => p.child === (v ? v.di : child)) ?? null;
}

// The block as crea-layout writes it (same keys, same order).
export function blocco(p) {
  const content = p.web ? { web: p.web } : { terminal: nomeDi(p) };
  return { id: p.child, type: "block", content };
}

export function trova(n, id) {
  if (!n || typeof n !== "object") return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) {
    const f = trova(c, id);
    if (f) return f;
  }
  return null;
}

// The layout file's text with the blocks `figli` (child ids of panels and views)
// put back in the panel-body stack, each after the blocks that come before it.
// { testo, aggiunti }: aggiunti lists the blocks the file lacked. When the file
// already has them all (brudr lost the block in memory but did not save yet),
// testo differs from the file by one final newline only: writing it still
// makes brudr read the file again. { errore } when the file cannot be mended.
export function ripara(testo, figli) {
  let d;
  try {
    d = JSON.parse(testo);
  } catch {
    return { errore: "layout file not readable" };
  }
  const body = trova(d, STACK);
  if (!body || body.type !== "stack" || !Array.isArray(body.children)) {
    return { errore: `no stack "${STACK}" in the layout file` };
  }
  const aggiunti = [];
  ORDINE.forEach((p, i) => {
    if (!figli.includes(p.child) || body.children.some((c) => c?.id === p.child)) return;
    const prima = new Set(ORDINE.slice(0, i).map((x) => x.child));
    let dove = 0;
    body.children.forEach((c, j) => {
      if (prima.has(c?.id)) dove = j + 1;
    });
    body.children.splice(dove, 0, blocco(p));
    aggiunti.push(p.child);
  });
  if (aggiunti.length) return { testo: JSON.stringify(d, null, 2) + "\n", aggiunti };
  return { testo: testo.endsWith("\n\n") ? testo.slice(0, -1) : testo + "\n", aggiunti };
}
