// nuova-scheda: brudr's "+" menu, opened by the pannelli mod's tab bar.
//
// A copy of Herdr's `new-menu` (defaults/mods/new-menu, not changed) with the user's
// choices of 24 November 2026: Terminal and the profiles CCB, PIB, GPB, CCF, PIF in
// place of the detected agents (no OpenCode, no Cursor). A choice opens a tab with
// three panes (rain, the program, rain): the pannelli mod does it (schede.js), so
// this menu only sends "pannelli.scheda-<id>". The choices come from the pannelli
// mod too, through shared state, so the list lives in one place.
// New space and the worktree rows are as in new-menu.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";

// Written by the pannelli mod (schede.js ELENCO).
const ELENCO = "pannelli.schede";
// new-menu's cache of the agents each machine reported: here only for the icons.
const KNOWN = "new-menu.agents";

function shortcut(action) {
  const k = keys().find(b => b.section === "global" && b.action === action);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

const apri = (s) => run(`pannelli.scheda-${s.id}`);

export default class NuovaScheda extends View {
  init(_props, cx) {
    const machine = spaces().find(s => s.active)?.machine;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { /* icons fall back to the shipped files */ }
      cx.notify();
    });
  }
  icona(programma) {
    const t = theme();
    const a = this.agents.find(x => x.key === programma);
    if (a?.icon) return a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14);
    return svg(`icons/${programma}.svg`).size(14).text_color(t.foreground);
  }
  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }
  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const elenco = shared(ELENCO) ?? [];
    const terminale = elenco.find(s => s.id === "terminale");
    const profili = elenco.filter(s => s.id !== "terminale");
    return v_flex().min_h(0).w_full().bg(t.popover).p(5).text_size(12.8)
      .id("nuova-scheda").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const s = /^[1-9]$/.test(e.key) ? profili[Number(e.key) - 1] : null;
        if (!s) return;
        closeOverlay(props().overlay);
        apri(s);
      })
      .when(Boolean(terminale), el => el.child(this.row("terminale", svg("icons/shell.svg").size(14), terminale.nome, () => apri(terminale), shortcut("pannelli.scheda-terminale"))))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .children(profili.map((s, i) => this.row(s.id, this.icona(s.programma), s.nome, () => apri(s), i < 9 ? String(i + 1) : "")))
      .when(elenco.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child("The pannelli mod is not running: no choices")))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
