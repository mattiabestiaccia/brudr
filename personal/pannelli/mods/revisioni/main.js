// revisioni: the PR reviews of pr-revisione-ai, inside brudr (the owner's choice of
// 25 November 2026: a native mod with a private channel to the executor).
//
// - The Revisioni button of the pannelli bar shows this block: the list of the reviews
//   the executor has registered (`pr-revisione-ai elenco --json`), open PRs first.
// - A review opens in place, widening the panel: header D, tree sidebar and cards are
//   drawn here from the review's pagina.json, the JSON Bruvish gets for pagina.html.
//   The review brings only content; one review feeds both this panel and Lavish.
// - An operation opens a confirmation dropdown; only its Confirm click runs
//   `pr-revisione-clic operazione ... --json`. The executor answers as soon as GitHub
//   does: the header takes the new state from that answer, then pagina.json is read
//   again when the executor has redone the page.
// - Notes on a card or on a line of the diff, with dragged images or a capture, go to
//   the executor as `pr-revisione-clic nota`: they wait in the review's events for an agent.
// - Nothing here answers nextCommand(): `herdr-app do revisioni.<anything>` reaches no
//   code, so no key, script or agent can start an operation; only a click can.
// - V1 prototype for comparison: «Lavish» shows the same review's Lavish session in the
//   web block `revisioni-web` of the panel stack, by rewriting that block's URL in the
//   layout file (a web block has no API: a new URL recreates the view).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, home, appHome, readTextFile, writeTextFile, watchFolder, layout, run, shared, setShared, theme, settings, notify } from "herdr";
import {
  STATI, coloreTono, IMMAGINE, MAX_IMMAGINI, ATTESA_S, leggiElenco, leggiPagina, albero, sezioneScelta,
  elementoCarta, paragrafi, cella, piano, operazioni, offerte, statoDopo, argomentiClic, leggiRisposta, rigaEsito,
  parseDiff, statoFile, titoloSenzaNumero, senzaTab, portaLavish, urlLavish, conUrl, trova, testoErrore,
  parole, paletteRevisione, tinta, conAlfa, mescola, tonoCarta, tabellaSenzaTesta, larghezzaCarta, colonneTabella, paroleLarga, ETICHETTA,
} from "./dati.js";

const STACK = "panel-body", PANEL = "panel", BLOCCO = "revisioni", WEB = "revisioni-web";
const LARGHEZZA_MAX = 4000; // the panel column's max when the layout does not say (crea-layout writes this one)
const LARGHEZZA = 368; // the panel column's width in the layout, put back when nothing was saved
// Widened by weight, not px: a px column doesn't shrink with the window, so on a window
// narrower than sidebar + 900 px the panel ran past its right edge and hid the header's
// operations (seen in the VM, 1024 pt screen). A weight takes 3/4 of the row, whatever the
// window: the layout's max is high enough (4000) to leave no empty strip on its right, which a
// 900 px max did on a wide window.
const PESO = 3;
const RIGHE_PER_FILE = 600; // a diff file longer than this: the rest is in Lavish
const icona = (nome) => `mods/revisioni/icone/${nome}.svg`;
const bin = (nome) => `${home()}/bin/${nome}`;
const OPEN = "/usr/bin/open";
// The purple dot (decision of 26 November 2026: a PR review is not opened in Bruvish by the
// agent, brudr marks it): the pannelli mod works out the new reviews and publishes their names
// in NUOVE; this mod tells it, in APERTA, which review the panel shows, so it counts as seen.
const NUOVE = "revisioni.nuove", APERTA = "revisioni.aperta";

export default class Revisioni extends View {
  init(_props, cx) {
    this.modo = "elenco"; this.annunci = 0;
    this.elenco = null; this.erroreElenco = null; this.caricando = false;
    this.r = null; this.pagina = null; this.testoPagina = null; this.errorePagina = null;
    this.sezione = null; this.aiuto = new Set(); this.aperti = new Set(); this.chiusi = new Set();
    this.conferma = null; this.inCorso = null; this.esito = null; this.statoEsito = null; this.usata = null;
    this.nota = null; this.immagini = []; this.mandaNota = false; this.menu = false;
    this.allargato = false; this.prima = null; this.mostrato = false;
    this.linea = InputState.new({ placeholder: "" });
    this.testo = TextareaState.new({ placeholder: "", rows: 3 });
    this.testoNota = TextareaState.new({ placeholder: "La nota per l'agente", rows: 3 });
    this.testo.set_auto_grow(3, 8);
    this.testoNota.set_auto_grow(3, 8);
    this.caricaElenco(cx);
    this.guarda(cx);
    // Only while the panel is widened: puts the width back once the review is not shown.
    cx.timer.every(2000, () => { if (this.allargato) this.adegua(); });
  }

  // ---- data

  caricaElenco(cx) {
    if (this.caricando) return;
    this.caricando = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(bin("pr-revisione-ai"), ["elenco", "--json", "--limit", "50"], { timeout: 30000 });
        const e = leggiElenco(r);
        if (e.errore) this.erroreElenco = e.errore;
        else { this.elenco = e; this.erroreElenco = null; }
      } catch (e) {
        this.erroreElenco = testoErrore(e, "pr-revisione-ai elenco non è partito");
      } finally {
        this.caricando = false;
        cx.notify();
      }
    });
  }

  // The executor rewrites pagina.json after every operation (from here or from Lavish):
  // one watch on the reviews' folder reloads the open review, or the list.
  guarda(cx) {
    const dir = `${home()}/.local/state/pr-revisione`;
    cx.spawn(async (cx) => {
      for (;;) {
        let cambiati;
        try { cambiati = await watchFolder(dir); } catch { await cx.sleep(10000); continue; }
        if (this.modo === "revisione" && this.r?.cartella
          && cambiati.some((p) => p === dir || p.startsWith(`${this.r.cartella}/pagina.json`) || p === this.r.cartella)) {
          await this.rileggi(cx);
        } else if (this.modo === "elenco") {
          this.caricaElenco(cx);
        }
        cx.notify();
      }
    });
  }

  async rileggi(cx) {
    const r = this.r;
    if (!r) return;
    const file = r.pagina_json || `${r.cartella}/pagina.json`;
    const testo = await readTextFile(file).catch(() => null);
    if (this.r !== r || testo === this.testoPagina) return;
    const p = leggiPagina(testo);
    const prima = this.testoPagina;
    this.testoPagina = testo;
    if (prima !== null && this.modo === "revisione") this.annuncia(); // the page redone while shown: a new head is seen too
    if (p.errore) { this.errorePagina = p.errore; return; }
    this.pagina = p.pagina; this.errorePagina = null;
    // A new view: operations come back; the page's own state wins over the answer's.
    if (this.pagina.actions?.view !== this.usata) this.usata = null;
    if (this.statoEsito && (this.pagina.actions?.view !== this.statoEsito.vista || this.pagina.header?.state === this.statoEsito.stato)) this.statoEsito = null;
    if (!sezioneScelta(this.pagina, this.sezione) || this.sezione === null) this.sezione = sezioneScelta(this.pagina, this.sezione)?.id ?? null;
    cx.notify();
  }

  // Tells the pannelli mod which review the panel shows (it marks it seen, and the dot goes out).
  annuncia() {
    if (this.r?.nome) setShared(APERTA, { nome: this.r.nome, n: `${Date.now()}-${++this.annunci}` }); // n: a new value each time, so the bar sees every ask
  }

  apri(r, cx) {
    this.modo = "revisione"; this.r = r; this.pagina = null; this.testoPagina = null; this.errorePagina = null;
    this.sezione = null; this.aiuto = new Set(); this.aperti = new Set(); this.chiusi = new Set();
    this.conferma = null; this.esito = null; this.statoEsito = null; this.usata = null; this.nota = null; this.menu = false;
    this.annuncia();
    this.adegua();
    cx.spawn(async (cx) => {
      if (!r.pagina_json) this.errorePagina = "Questa revisione non ha ancora pagina.json: un agente la rifà con pr-revisione-ai genera.";
      else await this.rileggi(cx);
      cx.notify();
    });
    cx.notify();
  }

  torna(cx) {
    this.modo = "elenco"; this.r = null; this.pagina = null; this.conferma = null; this.nota = null;
    this.adegua();
    this.caricaElenco(cx);
    cx.notify();
  }

  // ---- width: the panel widens while a review is shown, and goes back after

  mostratoOra() {
    const root = layout(), panel = trova(root, PANEL), body = trova(root, STACK);
    return Boolean(panel && !panel.hidden && (body?.active === BLOCCO || body?.active === WEB));
  }

  adegua() {
    const body = trova(layout(), STACK);
    const vuole = this.mostratoOra() && (this.modo === "revisione" || body?.active === WEB);
    if (vuole === this.allargato) return;
    const panel = trova(layout(), PANEL);
    if (vuole) {
      this.prima = panel?.size?.px ?? null;
      const max = Number(panel?.max) || LARGHEZZA_MAX;
      if (!this.prima || this.prima < max) run("layout.resize", { id: PANEL, weight: PESO });
    } else {
      run("layout.resize", { id: PANEL, px: this.prima || LARGHEZZA });
    }
    this.allargato = vuole;
  }

  // ---- operations: the dropdown, then the Confirm click

  chiedi(op, cx, dove = "testata", extra = {}) {
    if (this.inCorso) return;
    this.conferma = { ...op, dove, ...extra };
    this.menu = false;
    this.linea.set_value("");
    this.testo.set_value("");
    this.esito = null;
    if (op.field === "line") this.linea.focus();
    else if (op.field === "text" || op.choices) this.testo.focus();
    cx.notify();
  }

  // The only place an operation starts: a click on Confirm.
  conferma_clic(cx) {
    const c = this.conferma, r = this.r, view = this.pagina?.actions?.view;
    if (!c || !r || this.inCorso) return;
    const scelta = c.choices ? (c.choices.find((x) => x.operation === c.scelta) ?? c.choices.find((x) => !x.disabled)) : null;
    const operazione = scelta?.operation ?? c.operation;
    const testo = (c.field === "line" ? this.linea.value() : this.testo.value()).trim();
    const serve = scelta ? scelta.required : c.required;
    if (serve && !testo) { this.esito = { testo: "Scrivi il testo prima di confermare.", tono: "giallo" }; cx.notify(); return; }
    if (!view) { this.esito = { testo: "Questa pagina non ha operazioni (è in sola lettura).", tono: "giallo" }; cx.notify(); return; }
    if (this.usata === view) { this.esito = { testo: "La pagina si sta rifacendo dopo l'ultima operazione: un attimo.", tono: "giallo" }; cx.notify(); return; }
    const args = argomentiClic({ tipo: "operazione", nome: r.nome, operazione, vista: view, testo, file: c.file, riga: c.riga });
    this.inCorso = { operazione, label: scelta?.label ?? c.label };
    this.usata = view;
    this.conferma = null;
    const prima = this.statoMostrato();
    cx.spawn(async (cx) => {
      let d;
      try {
        d = leggiRisposta(await exec(bin("pr-revisione-clic"), args, { timeout: (ATTESA_S + 10) * 1000 }));
      } catch (e) {
        d = { ok: false, errore: testoErrore(e, "pr-revisione-clic non è partito") };
      }
      this.inCorso = null;
      this.esito = rigaEsito(d);
      if (d.ok && d.esito) {
        const stato = statoDopo(operazione, d.esito.esito, prima);
        if (stato !== prima) this.statoEsito = { stato, vista: view };
      }
      // A refused request did not use the view (README: «Richiesta respinta», no effects).
      if (!d.ok) this.usata = null;
      cx.notify();
      await this.rileggi(cx);
    });
    cx.notify();
  }

  statoMostrato() {
    return this.statoEsito?.stato ?? this.pagina?.header?.state ?? this.r?.stato ?? null;
  }

  // ---- notes

  scriviNota(dove, quale, cx) {
    this.nota = { dove, ...quale };
    this.immagini = [];
    this.testoNota.set_value("");
    this.testoNota.focus();
    this.conferma = null;
    this.esito = null;
    cx.notify();
  }

  aggiungi(percorsi) {
    for (const p of percorsi ?? []) {
      if (!IMMAGINE.test(p) || this.immagini.includes(p) || this.immagini.length >= MAX_IMMAGINI) continue;
      this.immagini.push(p);
    }
  }

  cattura(cx) {
    const r = this.r;
    if (!r?.cartella) return;
    const dir = `${r.cartella}/note`, file = `${dir}/cattura-${Date.now()}.png`;
    cx.spawn(async (cx) => {
      try {
        await exec("/bin/mkdir", ["-p", dir]);
        await exec("/usr/sbin/screencapture", ["-i", file], { timeout: 300000 });
        const c = await exec("/bin/test", ["-s", file]);
        if (c.code === 0) this.aggiungi([file]);
      } catch (e) {
        this.esito = { testo: `Cattura non riuscita: ${testoErrore(e, "screencapture")}`, tono: "rosso" };
      }
      cx.notify();
    });
  }

  // A click on «Invia all'agente»: the note goes to the executor's socket.
  invia_nota(cx) {
    const n = this.nota, r = this.r, testo = this.testoNota.value().trim();
    if (!n || !r || this.mandaNota) return;
    if (!testo && !this.immagini.length) { this.esito = { testo: "Scrivi la nota o aggiungi un'immagine.", tono: "giallo" }; cx.notify(); return; }
    const args = argomentiClic({ tipo: "nota", nome: r.nome, testo, elemento: n.elemento, file: n.file, riga: n.riga, immagini: this.immagini });
    this.mandaNota = true;
    cx.spawn(async (cx) => {
      let d;
      try { d = leggiRisposta(await exec(bin("pr-revisione-clic"), args, { timeout: 60000 })); }
      catch (e) { d = { ok: false, errore: testoErrore(e, "pr-revisione-clic non è partito") }; }
      this.mandaNota = false;
      this.esito = rigaEsito(d);
      if (d.ok) { this.nota = null; this.immagini = []; }
      cx.notify();
    });
    cx.notify();
  }

  // ---- V1: the same review in the panel's web block, on its Lavish session

  lavish(r, cx) {
    const nome = shared("layout");
    cx.spawn(async (cx) => {
      try {
        if (typeof nome !== "string" || !nome) throw new Error("layout non noto");
        const env = await readTextFile(`${home()}/tools/bruvish/current/bruvish/lib/env.mjs`).catch(() => null);
        const url = urlLavish(r.cartella, portaLavish(env));
        const file = `${appHome()}/layouts/${nome}.json`;
        for (let i = 1; ; i++) {
          const testo = await readTextFile(file);
          const c = conUrl(testo, WEB, url);
          if (c.errore) throw new Error(c.errore);
          if (c.uguale) break;
          try { await writeTextFile(file, c.testo, testo); break; } catch (e) { if (i >= 3) throw e; }
        }
        run("layout.select", { stack: STACK, child: WEB });
        run("layout.show", { id: PANEL });
      } catch (e) {
        notify({ title: "Revisioni", body: `Lavish nel pannello: ${String(e?.message ?? e).slice(0, 200)}`, level: "error" });
      }
      cx.notify();
    });
  }

  // ---- drawing

  render(cx) {
    const ora = this.mostratoOra();
    if (ora !== this.mostrato) {
      this.mostrato = ora;
      if (ora && this.modo === "elenco") this.caricaElenco(cx);
    }
    this.adegua();
    const t = theme();
    const corpo = this.modo === "revisione" ? this.revisione(cx, t) : this.lista(cx, t);
    return v_flex().id("revisioni").size_full().min_h(0).min_w(0).bg(t.chrome).text_color(t.foreground).text_size(12.5).child(corpo);
  }

  // The color of a tone as the review page has it (blue, green, yellow, red, violet, orange; dim for «vuoto»).
  tono(tono, t) {
    return tinta(tono, t) ?? t.dim;
  }

  bottone(id, testo, azione, t, { primario = false, pericolo = false, icona: ic = null, aiuto = null, spento = false } = {}) {
    const colore = spento ? t.dim : primario ? t.solid_foreground : pericolo ? t.ansi1 : t.foreground;
    return h_flex().id(id).h(26).px(ic && !testo ? 0 : 9).when(Boolean(ic && !testo), (e) => e.w(26).justify_center()).gap(5)
      .flex_none().items_center().rounded(6).border(1)
      .border_color(primario ? t.solid : t.border).bg(primario && !spento ? t.solid : t.raised).text_color(colore).text_size(12)
      .when(!spento, (e) => e.cursor_pointer().hover((s) => s.bg(primario ? t.solid : t.hover).opacity(primario ? 0.9 : 1)))
      .when(Boolean(aiuto), (e) => e.tooltip(aiuto))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      // A button inside a clickable row (the list) must not also open the row.
      .on_click((e, cx) => { cx.stop_propagation(); if (!spento) azione(e, cx); })
      .when(Boolean(ic), (e) => e.child(svg(icona(ic)).size(14).text_color(colore)))
      .when(Boolean(testo), (e) => e.child(testo));
  }

  // Text with the review page's marks (Bruvish theme «revisione»): bold, italic, code and
  // highlight each in its own color, so they stand apart as on the page. TextView draws marks
  // in the text color only, so the text is laid out here: one element per word in a wrapping
  // row, a word made of its runs («`pr merge`,» is code, then a plain comma).
  md(id, testo, t, { colore = null, size = 13 } = {}) {
    const p = paletteRevisione(t), mono = settings().font_family ?? "JetBrains Mono";
    const pezzo = (x, k) => {
      const e = div().id(`${id}-${k}`).child(x.testo);
      if (x.stile === "grassetto") return e.font_weight(700).text_color(p.grassetto);
      if (x.stile === "corsivo") return e.italic().text_color(p.corsivo);
      if (x.stile === "codice") return e.font_family(mono).text_size(size * 0.92).text_color(p.codice);
      // Highlight: half the word gap of padding on each side, pulled back by the same margin,
      // so the highlighted words of a run touch and read as one band, as on the page.
      if (x.stile === "evidenza") return e.bg(p.evidenza).px(size * 0.135).mx(-size * 0.135);
      return e;
    };
    return h_flex().id(id).min_w(0).flex_wrap().items_baseline().gap_x(size * 0.27).gap_y(1)
      .text_size(size).line_height(1.5).text_color(colore ?? t.foreground)
      .children(parole(testo).map((w, i) => (w.length === 1 ? pezzo(w[0], i) : h_flex().items_baseline().children(w.map((x, j) => pezzo(x, `${i}-${j}`))))));
  }

  // ---- the list

  lista(cx, t) {
    const e = this.elenco, righe = e?.revisioni ?? [];
    const testa = h_flex().h(38).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().text_size(13).child("Revisioni"))
      .when(Boolean(e), (x) => x.child(div().text_size(11).text_color(t.dim).child(`${e.mostrate} di ${e.totale}`)))
      .child(div().flex_1())
      .child(this.bottone("elenco-aggiorna", null, (_e, cx) => this.caricaElenco(cx), t, { icona: "aggiorna", aiuto: "Rileggi l'elenco" }));
    const vuoto = (testo, colore = t.dim) => div().p(14).text_size(12).text_color(colore).child(testo);
    let contenuto;
    if (this.erroreElenco && !righe.length) contenuto = vuoto(this.erroreElenco, t.ansi1);
    else if (!e) contenuto = vuoto("Lettura delle revisioni…");
    else if (!righe.length) contenuto = vuoto("Nessuna revisione preparata. Un agente la prepara con pr-revisione-ai prepara, poi genera.");
    else contenuto = v_flex().p(6).gap(2).children(righe.map((r, i) => this.rigaElenco(r, i, righe, t)));
    return v_flex().size_full().min_h(0)
      .child(testa)
      .when(Boolean(this.erroreElenco && righe.length), (x) => x.child(div().px(12).py(4).text_size(11).text_color(t.ansi1).child(this.erroreElenco)))
      .child(div().id("elenco-scorri").flex_1().min_h(0).overflow_y_scrollbar().child(contenuto));
  }

  rigaElenco(r, i, righe, t) {
    const aperta = r.stato === "aperta" || r.stato === "bozza";
    const nuova = Array.isArray(shared(NUOVE)) && shared(NUOVE).includes(r.nome);
    const separa = i > 0 && aperta !== (righe[i - 1].stato === "aperta" || righe[i - 1].stato === "bozza");
    return v_flex().when(separa, (x) => x.mt(8).pt(8).border_t(1).border_color(t.border))
      .child(h_flex().id(`rev-${r.nome}`).min_h(44).px(10).py(6).gap(10).items_center().rounded(7).cursor_pointer()
        .hover((x) => x.bg(t.hover)).on_click((_e, cx) => this.apri(r, cx))
        .when(nuova, (x) => x.child(div().id(`nuova-${r.nome}`).size(7).rounded(4).flex_none().bg(t.ansi5).tooltip("Revisione nuova: non l'hai ancora aperta qui")))
        .child(this.badge(r.stato, t))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_size(12.5).text_color(aperta ? t.foreground : t.muted).child(r.titolo || r.nome))
          .child(h_flex().gap(6).text_size(11).text_color(t.dim)
            .child(div().truncate().child(`${r.repo ?? ""}#${r.numero ?? ""}`))
            .when(Boolean(r.pagina_chiusa), (x) => x.child(div().child("pagina chiusa")))))
        .when(r.note_non_lette > 0, (x) => x.child(div().px(6).h(18).flex().items_center().rounded(9).bg(t.raised).border(1).border_color(t.border)
          .text_size(11).text_color(t.ansi3).tooltip("Note non ancora lette da un agente")
          .child(`${r.note_non_lette} ${r.note_non_lette === 1 ? "nota" : "note"}`)))
        .child(this.bottone(`rev-lavish-${r.nome}`, null, (_e, cx) => this.lavish(r, cx), t,
          { icona: "lavish", aiuto: "La stessa revisione nella pagina Lavish (prototipo V1)" })));
  }

  badge(stato, t) {
    const s = STATI[stato] ?? { testo: stato ?? "?", colore: "dim" };
    const c = t[s.colore] ?? t.dim;
    return h_flex().h(20).px(7).gap(5).flex_none().items_center().rounded(10).border(1).border_color(c).text_size(11).text_color(c)
      .child(div().size(6).rounded(3).bg(c)).child(s.testo);
  }

  // ---- a review

  revisione(cx, t) {
    const r = this.r;
    const barra = h_flex().h(34).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border)
      .child(this.bottone("indietro", "Revisioni", (_e, cx) => this.torna(cx), t, { icona: "indietro" }))
      .child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(r?.nome ?? ""))
      .child(this.bottone("lavish", "Lavish", (_e, cx) => this.lavish(r, cx), t, { icona: "lavish", aiuto: "La stessa revisione nella pagina Lavish (prototipo V1)" }));
    if (!this.pagina) {
      return v_flex().size_full().min_h(0).child(barra)
        .child(div().p(14).text_color(this.errorePagina ? t.ansi1 : t.dim).child(this.errorePagina ?? "Lettura della revisione…"));
    }
    const sez = sezioneScelta(this.pagina, this.sezione);
    return v_flex().size_full().min_h(0).child(barra)
      .child(this.testata(cx, t))
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(div().id("albero").w(196).h_full().flex_none().border_r(1).border_color(t.border).overflow_y_scrollbar()
          .child(this.alberoVista(t, sez)))
        .child(div().id("carte").flex_1().min_w(0).h_full().overflow_y_scrollbar()
          .child(this.sezioneVista(sez, t))));
  }

  testata(cx, t) {
    const p = this.pagina, h = p.header ?? {}, ops = operazioni(p);
    const stato = this.statoMostrato();
    const spente = Boolean(this.inCorso) || !ops.view || this.usata === ops.view;
    const pulsante = (o, i, tipo) => this.bottone(`op-${tipo}-${o.operation}`, o.icon ? null : piano(o.label),
      (_e, cx) => this.chiedi(o, cx), t, {
        icona: o.icon ?? null, aiuto: piano(o.hint ? `${o.label} ${o.hint}` : o.label), spento: spente,
        primario: tipo === "primary" && i === 0, pericolo: Boolean(o.danger),
      });
    const azioni = h_flex().gap(4).flex_none().items_center()
      .children(ops.principali.map((o, i) => pulsante(o, i, "primary")))
      .children(ops.fisse.map((o, i) => pulsante(o, i, "fixed")))
      .children(ops.accanto.map((o, i) => pulsante(o, i, "menu")))
      .when(ops.menu.length > 0, (e) => e.child(this.bottone("op-altre", null, (_e, cx) => { this.menu = !this.menu; cx.notify(); }, t,
        { icona: "altre", aiuto: "Altre operazioni", spento: spente })));
    const fatti = h_flex().flex_wrap().gap_x(18).gap_y(6).items_start()
      .children((h.facts ?? []).map((f, i) => v_flex().gap(1).min_w(0)
        .child(div().text_size(10.5).text_color(t.dim).child(f.label))
        .child(this.valoreFatto(f, i, t))));
    return v_flex().flex_none().px(14).pt(12).pb(10).gap(8).border_b(1).border_color(t.border)
      .child(h_flex().gap(12).items_start()
        .child(div().flex_1().min_w(0).text_size(15).font_semibold().text_color(paletteRevisione(t).titolo).child(titoloSenzaNumero(p.title)))
        .child(azioni)
        .child(this.badge(stato, t)))
      .when(this.menu && ops.menu.length > 0, (e) => e.child(h_flex().flex_wrap().gap(4).justify_end()
        .children(ops.menu.map((o) => this.bottone(`op-menu-${o.operation}`, piano(o.label), (_e, cx) => this.chiedi(o, cx), t,
          { aiuto: o.hint ? piano(o.hint) : null, pericolo: Boolean(o.danger), spento: spente })))))
      .child(fatti)
      .when(Boolean(h.notice), (e) => e.child(this.md("avviso", h.notice, t, { colore: t.muted, size: 11.5 })))
      .when((p.pills ?? []).length > 0, (e) => e.child(h_flex().flex_wrap().gap(5).children(p.pills.map((x, i) => this.chip(`pill-${i}`, x.text, x.tone, t)))))
      .when(Boolean(this.inCorso), (e) => e.child(h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
        .child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90))
        .child(`${piano(this.inCorso.label)}: in corso su GitHub…`)))
      .when(Boolean(this.esito) && !this.nota, (e) => e.child(this.rigaEsitoVista(t)))
      .when(this.conferma?.dove === "testata", (e) => e.child(this.tendina(t)));
  }

  valoreFatto(f, i, t) {
    if (f.type === "link" && /^https:\/\//.test(f.href ?? "")) {
      return div().id(`fatto-${i}`).text_size(12).text_color(t.accent).cursor_pointer().hover((s) => s.opacity(0.8))
        .tooltip(f.href).on_click(() => { exec(OPEN, [f.href]); }).child(piano(f.text));
    }
    if (f.type === "delta") {
      return h_flex().gap(6).text_size(12).child(div().child(piano(f.text)))
        .child(div().text_color(t.ansi2).child(`+${f.added ?? 0}`)).child(div().text_color(t.ansi1).child(`−${f.removed ?? 0}`));
    }
    return this.md(`fatto-${i}`, f.text ?? "", t, { size: 12 });
  }

  chip(id, testo, tono, t) {
    const c = this.tono(tono, t);
    return h_flex().id(id).h(20).px(7).gap(5).items_center().rounded(10).bg(t.raised).border(1).border_color(t.border).text_size(11)
      .child(div().size(6).rounded(3).bg(c)).child(this.md(`${id}-t`, testo, t, { size: 11 }));
  }

  rigaEsitoVista(t) {
    const c = this.tono(this.esito.tono, t);
    return h_flex().id("esito").gap(7).items_start().px(10).py(6).rounded(7).bg(t.raised).border(1).border_color(t.border)
      .child(div().mt(4).size(7).rounded(4).flex_none().bg(c))
      .child(div().flex_1().min_w(0).child(this.md("esito-testo", this.esito.testo, t, { size: 12 })))
      .child(div().id("esito-chiudi").text_size(11).text_color(t.dim).cursor_pointer().on_click((_e, cx) => { this.esito = null; cx.notify(); }).child("chiudi"));
  }

  // The confirmation dropdown: what happens, a field when the operation needs one, Confirm.
  tendina(t) {
    const c = this.conferma;
    const scelta = c.choices ? (c.choices.find((x) => x.operation === c.scelta) ?? c.choices.find((x) => !x.disabled)) : null;
    const testoConferma = c.confirm ?? (c.file ? `Pubblica su GitHub un commento alla riga ${c.riga} di ${c.file}, sulla testa che vedi.` : null);
    const serveTesto = c.field === "text" || Boolean(c.choices);
    return v_flex().id(`tendina-${c.dove}`).gap(8).p(10).rounded(8).bg(t.popover).border(1).border_color(c.danger ? t.ansi1 : t.accent)
      .child(div().font_semibold().text_size(12.5).child(piano(scelta?.label ?? c.label ?? c.submit ?? c.operation)))
      .when(Boolean(testoConferma), (e) => e.child(this.md(`tendina-${c.dove}-testo`, testoConferma, t, { colore: t.muted, size: 12 })))
      .when(Boolean(c.choices), (e) => e.child(h_flex().flex_wrap().gap(4).children(c.choices.map((x) => {
        const su = scelta?.operation === x.operation;
        return h_flex().id(`scelta-${x.operation}`).h(24).px(8).items_center().rounded(6).border(1).border_color(su ? t.accent : t.border)
          .bg(su ? t.selected : t.raised).text_size(12).text_color(x.disabled ? t.dim : t.foreground)
          .when(!x.disabled, (y) => y.cursor_pointer().on_click((_e, cx) => { c.scelta = x.operation; cx.notify(); }))
          .when(Boolean(x.hint), (y) => y.tooltip(piano(x.hint))).child(piano(x.label));
      }))))
      .when(c.field === "line", (e) => e.child(div().h(30).px(8).flex().items_center().rounded(6).border(1).border_color(t.input).bg(t.background)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.linea).h_full().w_full().text_size(12).text_color(t.foreground))))
      .when(serveTesto, (e) => e.child(div().px(8).py(6).rounded(6).border(1).border_color(t.input).bg(t.background)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Textarea.new(this.testo).w_full().text_size(12).text_color(t.foreground))))
      .child(h_flex().gap(6).justify_end()
        .child(this.bottone(`annulla-${c.dove}`, "Annulla", (_e, cx) => { this.conferma = null; cx.notify(); }, t))
        .child(this.bottone(`conferma-${c.dove}`, c.submit && c.dove !== "testata" ? piano(c.submit) : "Conferma",
          (_e, cx) => this.conferma_clic(cx), t, { primario: !c.danger, pericolo: Boolean(c.danger) })));
  }

  alberoVista(t, sez) {
    const voce = (v, rientro) => {
      const su = sez?.id === v.id;
      return h_flex().id(`nav-${v.id}`).h(26).pl(8 + rientro).pr(8).gap(6).items_center().rounded(6).cursor_pointer()
        .bg(su ? t.selected : t.chrome).text_color(su ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.sezione = v.id; this.conferma = null; this.nota = null; cx.notify(); })
        .child(div().size(6).rounded(3).flex_none().bg(v.dot ? this.tono(v.dot, t) : t.chrome))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(v.titolo))
        .when(Boolean(v.count), (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(v.count))));
    };
    return v_flex().p(6).gap(1).children(albero(this.pagina).map((v) => {
      if (!v.figli) return voce(v, 0);
      const chiuso = this.chiusi.has(v.id);
      return v_flex().mt(6).gap(1)
        .child(h_flex().id(`nav-${v.id}`).h(24).px(8).gap(6).items_center().cursor_pointer().text_size(11).text_color(t.dim).font_semibold()
          .on_click((_e, cx) => { chiuso ? this.chiusi.delete(v.id) : this.chiusi.add(v.id); cx.notify(); })
          .child(div().flex_none().child(chiuso ? "▸" : "▾"))
          .child(div().flex_1().truncate().child(v.titolo))
          .when(Boolean(v.dot), (e) => e.child(div().size(6).rounded(3).bg(this.tono(v.dot, t))))
          .when(Boolean(v.count), (e) => e.child(div().child(String(v.count)))))
        .when(!chiuso, (e) => e.children(v.figli.map((f) => voce(f, 10))));
    }));
  }

  sezioneVista(sez, t) {
    if (!sez) return div().p(14).text_color(t.dim).child("La pagina non ha sezioni.");
    // min_w(0): the column is a flex item of the scroll area and would grow to its widest content
    // (a long word, a wide table) instead of leaving that to the card, which scrolls sideways.
    return v_flex().w_full().min_w(0).p(12).gap(10)
      .child(div().text_size(14).font_semibold().text_color(paletteRevisione(t).titolo).child(sez.title ?? sez.id))
      .children((sez.cards ?? []).map((c) => this.carta(sez, c, t)));
  }

  carta(sez, c, t) {
    const id = c.id ?? `${sez.id}-${(sez.cards ?? []).indexOf(c)}`;
    const aiuto = this.aiuto.has(id);
    const { tono: nomeTono, forte } = tonoCarta(c);
    const tono = this.tono(nomeTono, t);
    const elemento = elementoCarta(sez, c);
    const testa = h_flex().gap(6).items_center()
      .child(div().size(7).rounded(4).flex_none().bg(tono))
      .child(div().flex_1().min_w(0).font_semibold().text_size(13).text_color(paletteRevisione(t).titolo).child(piano(c.title ?? "")))
      .children((c.labels ?? []).map((l, i) => this.chip(`${id}-l${i}`, l.text, l.tone, t)))
      .when(Boolean(c.voice), (e) => e.child(this.bottone(`${id}-voce`, null, () => { exec("/usr/bin/say", [piano(c.voice)]); }, t, { icona: "voce", aiuto: "Leggi la carta ad alta voce" })))
      .when(c.help !== undefined || c.summary !== undefined, (e) => e.child(this.bottone(`${id}-aiuto`, "?", (_e, cx) => {
        aiuto ? this.aiuto.delete(id) : this.aiuto.add(id); cx.notify();
      }, t, { aiuto: "A cosa serve questa carta" })))
      .child(this.bottone(`${id}-nota`, null, (_e, cx) => this.scriviNota(id, { elemento }, cx), t, { icona: "nota", aiuto: "Nota per l'agente su questa carta" }));
    // The body of the card is at least as wide as its longest unbreakable word or table needs, and sits in a
    // sideways scroll area: a card that does not fit the panel scrolls by itself, the title row stays put.
    const corpo = v_flex().w_full().min_w(larghezzaCarta(c)).gap(8)
      .when(aiuto, (e) => e.child(v_flex().gap(4).p(8).rounded(6).bg(t.chrome)
        .when(c.help !== undefined, (x) => x.child(div().text_size(11).text_color(t.dim).font_semibold().child("A cosa ti serve"))
          .children(paragrafi(c.help).map((p, i) => this.md(`${id}-h${i}`, p, t, { colore: t.muted, size: 12 }))))
        .when(c.summary !== undefined, (x) => x.child(div().mt(4).text_size(11).text_color(t.dim).font_semibold().child("Cosa notare qui"))
          .children(paragrafi(c.summary).map((p, i) => this.md(`${id}-s${i}`, p, t, { colore: t.muted, size: 12 }))))))
      .children(paragrafi(c.paragraphs).map((p, i) => this.md(`${id}-p${i}`, p, t)))
      .when(Array.isArray(c.fields), (e) => e.child(v_flex().gap(6).children(c.fields.map((f, i) => h_flex().gap(10).items_start()
        .child(div().w(ETICHETTA).flex_none().text_size(11.5).text_color(t.dim).child(piano(f.label)))
        .child(v_flex().flex_1().min_w(Math.max(0, ...paragrafi(f.paragraphs).map((p) => paroleLarga(p, 13)))).gap(4).children(paragrafi(f.paragraphs).map((p, j) => this.md(`${id}-f${i}-${j}`, p, t))))))))
      .when(Boolean(c.table?.headers), (e) => e.child(this.tabella(id, c.table, t)))
      .when(Boolean(tabellaSenzaTesta(c.table)), (e) => e.child(this.tabellaEtichette(id, tabellaSenzaTesta(c.table), t)))
      .when(Array.isArray(c.images), (e) => e.child(v_flex().gap(4).children(c.images.map((im, i) => h_flex().id(`${id}-im${i}`).gap(6).items_center()
        .cursor_pointer().hover((s) => s.opacity(0.8)).tooltip("Apri l'immagine")
        .on_click(() => { if (this.r?.cartella && /^[A-Za-z0-9][\w.-]*$/.test(im.file)) exec(OPEN, [`${this.r.cartella}/${im.file}`]); })
        .child(svg(icona("immagine")).size(14).text_color(t.accent))
        .child(div().text_size(12).text_color(t.accent).child(piano(im.caption ?? im.file)))))))
      .when(Array.isArray(c.events), (e) => e.child(v_flex().gap(4).children(c.events.map((ev, i) => h_flex().gap(7).items_start()
        .child(div().mt(5).size(6).rounded(3).flex_none().bg(this.tono(ev.tone, t)))
        .child(div().flex_1().min_w(0).child(this.md(`${id}-e${i}`, ev.text, t, { size: 12 })))))))
      .when(Boolean(c.transcript), (e) => e.child(this.trascrizione(id, c.transcript, t)))
      .when(Boolean(c.figura), (e) => e.child(div().text_size(11.5).text_color(t.dim).child("La figura di questa carta si vede nella pagina Lavish.")))
      .when(Boolean(c.diff?.text), (e) => e.child(this.diff(id, c.diff, t)))
      .when(Boolean(c.action), (e) => e.child(this.azioneCarta(id, c, t)))
      .when(this.conferma?.dove === id, (e) => e.child(this.tendina(t)))
      .when(Array.isArray(c.notes) && c.notes.length > 0, (e) => e.child(v_flex().gap(3).pt(6).border_t(1).border_color(t.border)
        .children(c.notes.map((n, i) => this.md(`${id}-n${i}`, n, t, { colore: t.dim, size: 11.5 })))))
      .when(this.nota?.dove === id, (e) => e.child(this.compositore(t)))
    // The card as the page draws it: the border and a light tint in the color of its state or tone, stronger for yellow.
    return v_flex().id(`carta-${id}`).w_full().min_w(0).gap(8).p(12).rounded(8).bg(mescola(t.raised, tono, forte ? 0.09 : 0.07)).border(1).border_color(conAlfa(tono, forte ? 0.8 : 0.55))
      .child(testa)
      .child(div().id(`${id}-scorri`).w_full().overflow_x_scroll().child(corpo));
  }

  tabella(id, tab, t) {
    const righe = tab.rows ?? [], colonne = colonneTabella(tab);
    const riga = (celle, i, testa) => h_flex().gap(8).items_start().py(4).px(6).when(!testa, (e) => e.border_t(1).border_color(t.border))
      .children(celle.map((x, j) => {
        const c = testa ? { testo: piano(x), tono: null } : cella(x);
        return div().flex_1().min_w(colonne[j] ?? 0).text_size(testa ? 11 : 12).text_color(testa ? t.dim : t.foreground)
          .when(Boolean(c.tono), (e) => e.child(h_flex().gap(5).items_center().child(div().size(6).rounded(3).flex_none().bg(this.tono(c.tono, t)))
            .child(div().min_w(0).child(this.md(`${id}-t${i}-${j}`, c.testo, t, { size: 12 })))))
          .when(!c.tono, (e) => e.child(testa ? c.testo : this.md(`${id}-t${i}-${j}`, c.testo, t, { size: 12 })));
      }));
    return v_flex().rounded(6).border(1).border_color(t.border).bg(t.chrome)
      .child(riga(tab.headers, "h", true))
      .children(righe.map((r, i) => riga(r, i, false)));
  }

  // A table with no headers: a label and its text on each row (the fact that makes a change safe, how it
  // was proved), as the review page draws it.
  tabellaEtichette(id, righe, t) {
    return v_flex().rounded(6).border(1).border_color(t.border).bg(t.chrome)
      .children(righe.map((riga, i) => {
        const [etichetta, ...resto] = Array.isArray(riga) ? riga : [riga];
        return h_flex().gap(10).items_start().py(5).px(8).when(i > 0, (e) => e.border_t(1).border_color(t.border))
          .child(div().w(ETICHETTA).flex_none().text_size(11.5).text_color(t.dim).child(piano(cella(etichetta).testo)))
          .child(v_flex().flex_1().min_w(Math.max(0, ...resto.map((x) => paroleLarga(cella(x).testo, 12)))).gap(3).children(resto.map((x, j) => {
            const c = cella(x);
            return c.tono
              ? h_flex().gap(5).items_center().child(div().size(6).rounded(3).flex_none().bg(this.tono(c.tono, t)))
                .child(div().min_w(0).child(this.md(`${id}-q${i}-${j}`, c.testo, t, { size: 12 })))
              : this.md(`${id}-q${i}-${j}`, c.testo, t, { size: 12 });
          })));
      }));
  }

  trascrizione(id, tr, t) {
    const aperto = this.aperti.has(`${id}-tr`);
    return v_flex().gap(4)
      .child(h_flex().id(`${id}-tr`).gap(6).cursor_pointer().text_size(12).text_color(t.muted)
        .on_click((_e, cx) => { aperto ? this.aperti.delete(`${id}-tr`) : this.aperti.add(`${id}-tr`); cx.notify(); })
        .child(aperto ? "▾" : "▸").child(piano(tr.summary)))
      .when(aperto, (e) => e.child(div().p(8).rounded(6).bg(t.background).font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(senzaTab(tr.text))));
  }

  azioneCarta(id, c, t) {
    const a = c.action;
    const spento = Boolean(this.inCorso) || !this.pagina?.actions?.view || this.usata === this.pagina?.actions?.view;
    const op = a.choices ? { label: c.title, submit: a.submit, choices: a.choices, placeholder: a.placeholder }
      : { operation: a.operation, label: piano(a.submit), submit: a.submit, field: a.field, required: a.required, placeholder: a.placeholder };
    return h_flex().gap(6).items_center()
      .child(this.bottone(`${id}-azione`, piano(a.submit), (_e, cx) => this.chiedi(op, cx, id), t, { spento }))
      .when(Boolean(a.placeholder), (e) => e.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(piano(a.placeholder))));
  }

  compositore(t) {
    const n = this.nota;
    const dove = n.file ? `riga ${n.riga} di ${n.file}` : n.elemento;
    const puoGithub = Boolean(n.file) && offerte(this.pagina).includes("commento-riga");
    return v_flex().id(`nota-${n.dove}`).gap(8).p(10).rounded(8).bg(t.popover).border(1).border_color(t.accent)
      .on_drop((e, cx) => { this.aggiungi(e.paths); cx.notify(); })
      .child(h_flex().gap(6).items_center().child(svg(icona("nota")).size(14).text_color(t.accent))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(12.5).child(`Nota su ${dove}`)))
      .child(div().px(8).py(6).rounded(6).border(1).border_color(t.input).bg(t.background)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Textarea.new(this.testoNota).w_full().text_size(12).text_color(t.foreground)))
      .child(div().text_size(11).text_color(t.dim).child(this.immagini.length
        ? `${this.immagini.length} ${this.immagini.length === 1 ? "immagine" : "immagini"} (png, jpg, webp; al massimo ${MAX_IMMAGINI})`
        : "Trascina qui le immagini (png, jpg, webp), o premi Cattura."))
      .children(this.immagini.map((p, i) => h_flex().gap(6).items_center().text_size(11.5)
        .child(svg(icona("immagine")).size(13).text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(p.split("/").pop()))
        .child(div().id(`nota-togli-${i}`).text_color(t.dim).cursor_pointer().on_click((_e, cx) => { this.immagini.splice(i, 1); cx.notify(); }).child("togli"))))
      .when(Boolean(this.esito) && this.nota, (e) => e.child(this.rigaEsitoVista(t)))
      .child(h_flex().gap(6).items_center()
        .child(this.bottone("nota-cattura", "Cattura", (_e, cx) => this.cattura(cx), t, { icona: "cattura", aiuto: "Una parte dello schermo, come immagine della nota" }))
        .child(div().flex_1())
        .child(this.bottone("nota-annulla", "Annulla", (_e, cx) => { this.nota = null; this.esito = null; cx.notify(); }, t))
        .when(puoGithub, (e) => e.child(this.bottone("nota-github", "Commenta su GitHub", (_e, cx) => {
          const testo = this.testoNota.value();
          this.nota = null;
          this.chiedi({ operation: "commento-riga", label: "Commenta la riga su GitHub", field: "text", required: true }, cx, n.dove, { file: n.file, riga: n.riga });
          this.testo.set_value(testo);
        }, t, { aiuto: "Diventa un commento di revisione alla riga, su GitHub, dopo la conferma" })))
        .child(this.bottone("nota-invia", this.mandaNota ? "Invio…" : "Invia all'agente", (_e, cx) => this.invia_nota(cx), t, { primario: true, spento: this.mandaNota })));
  }

  diff(id, d, t) {
    const files = parseDiff(d.text), note = d.notes ?? {};
    const mono = settings().font_family ?? "JetBrains Mono";
    const pochi = files.length <= 3;
    return v_flex().gap(6).children(files.map((f, k) => {
      const chiave = `${id}-file-${k}`;
      const aperto = pochi ? !this.chiusi.has(chiave) : this.aperti.has(chiave);
      const testa = h_flex().id(chiave).h(28).px(8).gap(8).items_center().cursor_pointer().rounded(6).bg(t.chrome).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          const insieme = pochi ? this.chiusi : this.aperti;
          insieme.has(chiave) ? insieme.delete(chiave) : insieme.add(chiave);
          cx.notify();
        })
        .child(div().flex_none().text_color(t.dim).child(aperto ? "▾" : "▸"))
        .child(div().flex_1().min_w(0).truncate().font_family(mono).text_size(11.5).child(f.name ?? ""))
        .child(div().text_size(11).text_color(t.dim).child(statoFile(f.status)))
        .when(f.added > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.added}`)))
        .when(f.removed > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.removed}`)));
      if (!aperto) return testa;
      const righe = f.lines.slice(0, RIGHE_PER_FILE);
      return v_flex().gap(0).child(testa)
        .child(v_flex().mt(2).rounded(6).border(1).border_color(t.border).bg(t.background).text_size(11)
          .children(righe.flatMap((l, i) => this.rigaDiff(id, f, l, `${k}-${i}`, note, t)))
          .when(f.lines.length > RIGHE_PER_FILE, (e) => e.child(div().p(8).text_color(t.dim)
            .child(`Altre ${f.lines.length - RIGHE_PER_FILE} righe: si vedono nella pagina Lavish.`))));
    }));
  }

  rigaDiff(id, f, l, k, note, t) {
    const mono = settings().font_family ?? "JetBrains Mono";
    if (l.type === "hunk" || l.type === "meta") {
      return [div().px(8).py(2).bg(t.raised).text_color(t.dim).truncate().font_family(mono).child(l.text)];
    }
    const chiave = l.new === null ? null : `${f.name}:${l.new}`;
    const dove = `${id}-riga-${k}`;
    const fondo = l.type === "add" ? `${t.ansi2}1c` : l.type === "del" ? `${t.ansi1}1c` : null;
    const segno = { add: "+", del: "−", context: " " }[l.type];
    const out = [h_flex().id(dove).min_h(18).gap(0).items_start().font_family(mono).when(Boolean(fondo), (e) => e.bg(fondo))
      .child(div().w(36).flex_none().pr(4).text_right().text_color(t.dim).child(l.old === null ? "" : String(l.old)))
      .child(div().w(36).flex_none().pr(4).text_right().text_color(t.dim).child(l.new === null ? "" : String(l.new)))
      .child(div().w(12).flex_none().text_color(l.type === "add" ? t.ansi2 : l.type === "del" ? t.ansi1 : t.dim).child(segno))
      .child(div().flex_1().min_w(0).child(senzaTab(l.text) || " "))
      .when(Boolean(chiave), (e) => e.child(div().id(`${dove}-commenta`).w(24).h(18).flex_none().flex().items_center().justify_center()
        .cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.accent)).tooltip(`Commenta la riga ${l.new} di ${f.name}`)
        .on_click((_e, cx) => this.scriviNota(dove, { file: f.name, riga: l.new, elemento: `${f.name}:${l.new}` }, cx))
        .child(svg(icona("commenta")).size(12))))];
    if (chiave && Object.hasOwn(note, chiave)) {
      out.push(div().mx(8).my(4).p(8).rounded(6).bg(t.raised).border(1).border_color(t.border)
        .child(this.md(`${dove}-nota`, note[chiave], t, { size: 12 })));
    }
    if (this.nota?.dove === dove) out.push(div().p(8).child(this.compositore(t)));
    if (this.conferma?.dove === dove) out.push(div().p(8).child(this.tendina(t)));
    return out;
  }
}

