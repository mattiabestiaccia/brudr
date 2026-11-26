// pannelli: brudr's tab bar for the brudr-pannelli layout, and the keeper of
// the side panels' terminals.
//
// The bar is a copy of Herdr's `tabs` mod (defaults/mods/tabs, not changed),
// with eight panel buttons in place of Files and Changes. Like `tabs`, it remembers
// the shown panel per space, including the native Browser and the Revisioni mod.
//
// Browser is a regular web block with no core terminal, Revisioni a mod block (mod
// revisioni, with its web view revisioni-web): neither needs the core. The other children of
// "panel-body" are terminal blocks by name, so a new address needs no layout change. This mod:
// - creates a panel's terminal the first time the panel is shown (D5), and again
//   after a restart, with `hc run --name brudr-<tipo>`; private panels carry the
//   core label brudr.private=1 from the start, which the agents' terminal reader refuses to read;
// - re-attaches the block: a block whose name did not exist yet stays dark and
//   never retries (src/terminal.rs attach), and only visible blocks get a view
//   (src/window.rs sync), so hiding and showing the panel makes a fresh one;
// - puts back a block whose terminal ended: brudr drops it from the layout in
//   memory and the next save writes the file without it (see blocchi.js), so
//   the mod writes the block back into the layout file, which brudr applies;
//   a click on a panel whose block is gone puts it back, then shows it;
// - refuses a terminal that took a panel's name without the panel's labels;
// - lets hunk follow the space like Changes did, through a folder file that
//   brudr-pannello watches. Superfile and Neovim stay where they are (D2, D3);
// - counts a view (blocchi.js VISTE: the Nushell table spf-apri shows in
//   Superfile's place) as its panel: the panel's button, the space's memory,
//   and a click on the button shows the view again while its terminal lives.
// Programs never exit on their own: brudr-pannello restarts them in a loop.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, terminals, layout, theme, run, hc, exec, home, appHome, readTextFile, writeTextFile, shared, notify, openOverlay, window, settings, nextCommand, setShared } from "herdr";
import { PANNELLI, VISTE, ORDINE, STACK, nomeDi, pannelloDi, terminale, trova, ripara } from "./blocchi.js";
import { SCHEDE, ELENCO, schedaDi, apriScheda } from "./schede.js";

const PANEL = "brudr.panel", PRIVATE = "brudr.private";
// Between two repairs nobody asked for: a panel whose terminal keeps ending
// must not make the mod rewrite the layout file in a loop.
const RIPRISTINO_MS = 10000;
const TENTATIVI = 3; // the layout file changed under the mod: read it again

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
  init(_props, cx) {
    this.creando = new Set();
    this.errori = {};
    this.ultima = null;
    this.ripristinato = 0;
    this.riparando = false;
    this.daMostrare = null; // a clicked panel whose block is being put back
    this.visti = null; // every child seen in the stack
    this.cartellaHunk = null;
    // tabs
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // New tabs with three panes (schede.js): the "+" menu and the keys send "pannelli.scheda-<id>".
    // The menu (mod nuova-scheda) reads the choices from here: one list, in schede.js.
    setShared(ELENCO, SCHEDE.map(({ id, nome, programma }) => ({ id, nome, programma })));
    cx.spawn(async (cx) => {
      for (;;) {
        let comando;
        try { comando = await nextCommand(); } catch { return; } // the app is shutting down
        const s = schedaDi(comando);
        if (!s) continue;
        const attivo = spaces().find((x) => x.active);
        const h = { run, panes, focused, space: attivo?.id, remoto: Boolean(attivo?.machine), sleep: (ms) => cx.sleep(ms) };
        try { await apriScheda(s, h); }
        catch (e) { notify({ title: "pannelli", body: `Nuova scheda ${s.nome}: ${e?.message ?? e}`, level: "error" }); }
      }
    });
  }

  // From tabs: the side panel is remembered per space: switching shows that
  // space's choice (closed if it never had one), and opening or closing it
  // records it. A panel whose block is gone is not asked for.
  syncPanel(space, panel, body) {
    if (!space || !panel) return;
    const presenti = (body?.children ?? []).map((c) => c.id);
    // A view counts as its panel: the space remembers the panel, not the view.
    const now = panel.hidden || !body?.active ? null : pannelloDi(body.active)?.child ?? body.active;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = presenti.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: STACK, child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // The panel's live terminal, or a new one. Resolves to true when one was created.
  async garantisci(p) {
    if (!terminale(p) || this.creando.has(p.tipo)) return false;
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
    const root = layout(), panel = trova(root, "panel"), body = trova(root, STACK);
    const p = pannelloDi(body?.active);
    return { p, visibile: Boolean(p && panel && !panel.hidden), body };
  }

  haBlocco(p) {
    return (this.attivo().body?.children ?? []).some((c) => c.id === p.child);
  }

  // A view of the panel still open (its terminal live, labels ours), or null.
  vistaAperta(p) {
    const v = VISTE.find((x) => x.di === p.child);
    if (!v || !terminale(v) || !this.haBlocco(v)) return null;
    const rec = record(v);
    return rec && nostro(rec, v) ? v : null;
  }

  // Shows the panel (or `child`, a view of it); `nuovo`: its block needs a fresh view.
  mostra(cx, p, nuovo, child = p.child) {
    run("layout.select", { stack: STACK, child });
    run("layout.show", { id: "panel" });
    if (nuovo) this.riaggancia(cx);
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

  // Puts back the blocks of `mancanti` that brudr dropped (see blocchi.js):
  // writes them into the layout file, which brudr then applies. `subito`: a
  // click asked for it, so the pause between repairs does not apply.
  ripristina(cx, mancanti, subito = false) {
    if (this.riparando) return;
    const ora = Date.now();
    if (!subito && ora - this.ripristinato < RIPRISTINO_MS) return;
    const nome = shared("layout");
    if (typeof nome !== "string" || !nome) return;
    this.ripristinato = ora;
    this.riparando = true;
    cx.spawn(async (cx) => {
      try {
        for (const p of mancanti) {
          if (!terminale(p)) continue;
          // A finished record of ours would keep the name and end the new block.
          const g = await hc(["get", "--json", nomeDi(p)]).catch(() => null);
          let rec = null;
          try { rec = g?.code === 0 ? JSON.parse(g.stdout) : null; } catch { rec = null; }
          if (rec && typeof rec.terminal === "object") rec = rec.terminal;
          if (rec && rec.state !== "live" && nostro(rec, p)) await hc(["rm", nomeDi(p)]).catch(() => null);
        }
        const file = `${appHome()}/layouts/${nome}.json`;
        for (let i = 1; ; i++) {
          const testo = await readTextFile(file);
          if (typeof testo !== "string") throw new Error(`layouts/${nome}.json not found`);
          const r = ripara(testo, mancanti.map((p) => p.child));
          if (r.errore) throw new Error(r.errore);
          try {
            await writeTextFile(file, r.testo, testo); // only over the text just read
            break;
          } catch (e) {
            if (i >= TENTATIVI) throw e;
          }
        }
        for (const p of mancanti) delete this.errori[p.tipo];
      } catch (e) {
        const motivo = String(e?.message ?? e).slice(0, 160);
        for (const p of mancanti) this.errori[p.tipo] = `${p.nome}: block not put back (${motivo})`;
        if (subito) notify({ title: "pannelli", body: this.errori[mancanti[0].tipo], level: "error" });
        if (mancanti.includes(this.daMostrare)) this.daMostrare = null;
      } finally {
        this.riparando = false;
        cx.notify();
      }
    });
  }

  // The keeper's part of a render: blocks to put back, a clicked panel to show,
  // the shown panel's terminal. Returns what render needs.
  custode(cx) {
    const stato = this.attivo();
    const { p: attuale, visibile, body } = stato;
    if (body) {
      const presenti = new Set((body.children ?? []).map((c) => c.id));
      if (!this.visti) this.visti = new Set(presenti);
      for (const id of presenti) this.visti.add(id);
      // Blocks seen in this layout and now gone: their terminal ended. A view's
      // block comes back too, for the next view (spf-apri selects it).
      const mancanti = ORDINE.filter((p) => this.visti.has(p.child) && !presenti.has(p.child));
      if (mancanti.length) this.ripristina(cx, mancanti);
      const p = this.daMostrare;
      if (p && presenti.has(p.child)) {
        this.daMostrare = null;
        cx.spawn(async (cx) => {
          this.mostra(cx, p, terminale(p));
          cx.notify();
        });
      }
    }
    // render runs on every data change: work only when the shown panel, its
    // terminal or (for hunk) the folder changes.
    if (visibile && terminale(attuale)) {
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
    return stato;
  }

  // A panel button: shows the panel (its terminal first), or hides it when shown.
  premi(cx, p) {
    cx.spawn(async (cx) => {
      const ora = this.attivo();
      if (ora.visibile && ora.p === p) {
        run("layout.hide", { id: "panel" });
        cx.notify();
        return;
      }
      // Created before it shows, so the block attaches to a terminal that exists.
      const creato = await this.garantisci(p);
      if (!this.haBlocco(p)) {
        // brudr dropped the block: put it back, render shows it once it is there.
        this.daMostrare = p;
        this.ripristina(cx, [p], true);
        cx.notify();
        return;
      }
      const prima = this.attivo();
      // A view left open under another panel takes the panel's place again.
      const vista = this.vistaAperta(p);
      this.mostra(cx, p, !vista && creato && prima.visibile && prima.p === p, vista?.child);
      cx.notify();
    });
  }

  render(cx) {
    const { p: attuale, visibile } = this.custode(cx);
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = trova(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = trova(root, "panel"), body = trova(root, STACK);
    this.syncPanel(space, panel, body);
    // The panel buttons, in place of Files and Changes; a dot marks the private ones.
    const pulsante = (p) => {
      const on = visibile && attuale === p;
      return h_flex().id(`pannello-${p.child}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => this.premi(cx, p))
        .child(p.nome)
        .when(Boolean(p.privato), el => el.child(div().size(5).rounded(3).bg(on ? t.foreground : t.dim)));
    };
    const msg = attuale ? this.errori[attuale.tipo] : Object.values(this.errori)[0];
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => spaces().find((x) => x.active)?.machine
        // A remote space keeps Herdr's menu: the rain and the profiles are this Mac's.
        ? openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })
        : openOverlay({ mod: "nuova-scheda", kind: "popup", width: 250, height: 340 })))
      .when(Boolean(msg), el => el.child(div().id("pannelli-errore").max_w(220).flex_none().text_size(11).text_color(t.blocked).truncate().child(msg)))
      .children(PANNELLI.map(pulsante))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
