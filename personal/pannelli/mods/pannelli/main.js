// pannelli: the header of the "panel-body" stack in the brudr-pannelli layout,
// and the keeper of its terminals.
//
// Each child of the stack is a layout block { terminal: "brudr-<tipo>" }, by name,
// so the layout never changes when a terminal gets a new address. This mod:
// - creates a panel's terminal the first time the panel is shown (D5), and again
//   after a restart, with `hc run --name brudr-<tipo>`; private panels carry the
//   core label brudr.private=1 from the start, which the agents' terminal reader refuses to read;
// - re-attaches the block: a block whose name did not exist yet stays dark and
//   never retries (src/terminal.rs attach), and only visible blocks get a view
//   (src/window.rs sync), so hiding and showing the panel makes a fresh one;
// - puts back a child whose terminal ended: brudr drops an ended block from the
//   layout in memory (src/window.rs terminal_ended), and layout.switch to the
//   same layout reloads it from its file;
// - refuses a terminal that took a panel's name without the panel's labels;
// - lets hunk follow the space like Changes did, through a folder file that
//   brudr-pannello watches. Superfile and Neovim stay where they are (D2, D3).
// Programs never exit on their own: brudr-pannello restarts them in a loop.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, terminals, layout, theme, run, hc, exec, home, appHome, readTextFile, writeTextFile, shared, notify } from "herdr";

const PANNELLI = [
  { child: "files", tipo: "spf", nome: "Superfile", privato: true },
  { child: "neovim", tipo: "nvim", nome: "Neovim", privato: true },
  { child: "changes", tipo: "hunk", nome: "hunk", privato: false, segue: true },
  { child: "quota", tipo: "quota", nome: "Quota", privato: false },
  { child: "privato", tipo: "privato", nome: "Private", privato: true },
];
const PANEL = "brudr.panel", PRIVATE = "brudr.private";
const RIPRISTINO_MS = 10000;

const nomeDi = (p) => `brudr-${p.tipo}`;

function trova(n, id) {
  if (!n) return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) {
    const f = trova(c, id);
    if (f) return f;
  }
  return null;
}

// The space's folder, or its focused pane's: never a layout block's own folder,
// so a private panel's folder never reaches the hunk folder file.
function cartella() {
  const space = spaces().find((s) => s.active);
  if (!space || space.machine) return null; // panels stay on this Mac
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return pane?.cwd || space.folder || null;
}

const record = (p) => terminals().find((t) => t.name === nomeDi(p) && t.state === "live");

// A terminal is the panel's only with the labels the panel gave it.
function nostro(rec, p) {
  const l = rec?.labels ?? {};
  return l[PANEL] === p.tipo && (!p.privato || Boolean(l[PRIVATE]));
}

function errore(r) {
  const testo = (r?.stderr || r?.stdout || String(r ?? "")).trim();
  return testo.slice(0, 200) || "hc failed";
}

export default class Pannelli extends View {
  init() {
    this.creando = new Set();
    this.errori = {};
    this.ultima = null;
    this.ripristinato = 0;
    this.visti = null; // the stack's children as the layout file had them
    this.cartellaHunk = null;
  }

  // The panel's live terminal, or a new one. Resolves to true when one was created.
  async garantisci(p) {
    if (this.creando.has(p.tipo)) return false;
    const presente = record(p);
    if (presente) return this.controlla(presente, p);
    this.creando.add(p.tipo);
    try {
      const nome = nomeDi(p);
      // terminals() can lag behind the core: ask it, and clear a finished record
      // of ours, which would keep the name and end the block on attach.
      const g = await hc(["get", "--json", nome]).catch(() => null);
      if (g?.code === 0) {
        let rec = null;
        try { rec = JSON.parse(g.stdout); } catch { rec = null; }
        if (rec && typeof rec.terminal === "object") rec = rec.terminal;
        if (rec?.state === "live") return this.controlla(rec, p);
        if (rec && nostro(rec, p)) await hc(["rm", nome]).catch(() => null);
      }
      const dir = cartella() || home();
      if (p.segue) await this.scriviCartella(p, dir);
      const args = ["run", "--bg", "--json", "--no-parent", "--rm", "--name", nome, "--label", `${PANEL}=${p.tipo}`];
      if (p.privato) args.push("--label", `${PRIVATE}=1`);
      args.push("--cwd", dir, "--", `${home()}/bin/brudr-pannello`, p.tipo);
      const r = await hc(args).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) {
        this.errori[p.tipo] = errore(r);
        return false;
      }
      delete this.errori[p.tipo];
      return true;
    } finally {
      this.creando.delete(p.tipo);
    }
  }

  controlla(rec, p) {
    if (nostro(rec, p)) {
      delete this.errori[p.tipo];
      return false;
    }
    // Someone else's terminal under the panel's name: never show it as the panel.
    const msg = `${nomeDi(p)} is not this panel's terminal (missing labels): not shown`;
    if (this.errori[p.tipo] !== msg) {
      this.errori[p.tipo] = msg;
      notify({ title: "pannelli", body: msg, level: "error" });
    }
    run("layout.hide", { id: "panel" });
    return false;
  }

  attivo() {
    const root = layout(), panel = trova(root, "panel"), body = trova(root, "panel-body");
    const p = PANNELLI.find((x) => x.child === body?.active) ?? null;
    return { p, visibile: Boolean(p && panel && !panel.hidden), body };
  }

  // A fresh view for the shown block (see the top of the file).
  riaggancia(cx) {
    run("layout.hide", { id: "panel" });
    cx.timer.after(150, () => run("layout.show", { id: "panel" }));
  }

  async scriviCartella(p, dir) {
    const cartelle = `${appHome()}/data/pannelli`, file = `${cartelle}/${p.tipo}.dir`;
    if (this.cartellaHunk === dir) return;
    try {
      await exec("mkdir", ["-p", cartelle]);
      const prima = await readTextFile(file);
      if (prima !== dir) await writeTextFile(file, dir, prima);
      this.cartellaHunk = dir;
    } catch (e) {
      this.errori[p.tipo] = String(e).slice(0, 200);
    }
  }

  // Called after an ended terminal took its block away: reload the layout file.
  ripristina(cx, mancanti) {
    const ora = Date.now();
    if (ora - this.ripristinato < RIPRISTINO_MS) return;
    this.ripristinato = ora;
    const nome = shared("layout");
    if (typeof nome !== "string" || !nome) return;
    cx.spawn(async (cx) => {
      for (const p of mancanti) {
        const g = await hc(["get", "--json", nomeDi(p)]).catch(() => null);
        let rec = null;
        try { rec = g?.code === 0 ? JSON.parse(g.stdout) : null; } catch { rec = null; }
        if (rec && typeof rec.terminal === "object") rec = rec.terminal;
        if (rec && rec.state !== "live" && nostro(rec, p)) await hc(["rm", nomeDi(p)]).catch(() => null);
      }
      run("layout.switch", { name: nome });
      // What the reloaded file has is the new truth: a child the file itself
      // lacks is not asked for again.
      this.visti = null;
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    const { p: attuale, visibile, body } = this.attivo();
    if (body) {
      const presenti = new Set((body.children ?? []).map((c) => c.id));
      if (!this.visti) this.visti = presenti;
      const mancanti = PANNELLI.filter((p) => this.visti.has(p.child) && !presenti.has(p.child));
      if (mancanti.length) this.ripristina(cx, mancanti);
    }
    // render runs on every data change: work only when the shown panel, its
    // terminal or (for hunk) the folder changes.
    if (visibile) {
      const rec = record(attuale);
      const chiave = `${attuale.child}|${rec?.address ?? "-"}|${attuale.segue ? cartella() ?? "" : ""}`;
      if (chiave !== this.ultima) {
        this.ultima = chiave;
        cx.spawn(async (cx) => {
          const creato = await this.garantisci(attuale);
          if (attuale.segue && !creato) {
            const dir = cartella();
            if (dir) await this.scriviCartella(attuale, dir);
          }
          const ora = this.attivo();
          if (creato && ora.visibile && ora.p === attuale) this.riaggancia(cx);
          cx.notify();
        });
      }
    } else {
      this.ultima = null;
    }
    const pulsante = (p) => {
      const on = visibile && attuale === p;
      return h_flex().id(`pannello-${p.child}`).h(24).px(7).gap(4).flex_none().items_center().rounded(6)
        .bg(on ? t.selected : t.chrome).hover((s) => s.bg(t.hover))
        .text_size(12).text_color(on ? t.foreground : t.muted)
        .child(p.nome)
        .when(p.privato, (el) => el.child(div().size(5).rounded(3).bg(on ? t.foreground : t.dim)))
        .on_click((_e, cx) => cx.spawn(async (cx) => {
          // Created before it shows, so the block attaches to a terminal that exists.
          const creato = await this.garantisci(p);
          const prima = this.attivo();
          run("layout.select", { stack: "panel-body", child: p.child });
          run("layout.show", { id: "panel" });
          if (creato && prima.visibile && prima.p === p) this.riaggancia(cx);
          cx.notify();
        }));
    };
    const msg = attuale ? this.errori[attuale.tipo] : null;
    return h_flex().id("pannelli").size_full().min_w(0).px(6).gap(2).items_center().bg(t.chrome)
      .child(h_flex().id("pannelli-scroll").flex_1().min_w(0).h_full().items_center().gap(2).overflow_x_scrollbar()
        .children(PANNELLI.map(pulsante)))
      .when(Boolean(msg), (el) => el.child(div().id("pannelli-errore").max_w(160).flex_none().text_size(11).text_color(t.blocked).truncate().child(msg)));
  }
}
