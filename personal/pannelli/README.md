---
type: personal-build
title: Pannelli laterali di brudr (Superfile, Neovim, Hunk, Quota, Private)
status: da provare dal vivo
updated: 2026-11-23
description: Pannelli a terminale nella colonna destra di brudr; Superfile, Neovim e Private sono privati, il lettore dei terminali degli agenti non li legge.
---

# Pannelli laterali di brudr

Decisioni del 23 novembre 2026 (D1 blocchi del layout per nome, D2 Superfile non segue lo spazio, D3 Neovim non segue lo spazio, D5 terminali creati al primo clic e ricreati dopo un riavvio). Dopo le prove dal vivo dello stesso giorno: pulsanti nella barra in alto, Private con il grigio degli altri pannelli.

| Pannello | Programma | Privato | Segue lo spazio |
| --- | --- | --- | --- |
| Superfile | `spf` con la configurazione del pannello | sì | no (D2) |
| Neovim | `nvim` senza swap, undo, shada, backup | sì | no (D3) |
| Hunk (al posto di Changes) | `hunk diff --watch` | no | sì, come Changes |
| Quota | `quota-brs --tui` (`quota-axi --tui` se manca) | no | no |
| Private | `fish --private` | sì | no |

Privato vuol dire: il terminale porta l'etichetta di core `brudr.private=1` dalla nascita, e il lettore dei terminali degli agenti non lo elenca e non lo legge.

## File

| File | Cosa |
| --- | --- |
| `mods/pannelli/` | mod: barra in alto (copia di `tabs`, con i cinque pulsanti al posto di Files e Changes) e custode dei terminali; `blocchi.js` ha i pannelli e la riparazione del layout |
| `brudr-pannello` | il programma di ogni pannello; non finisce mai da solo |
| `spf-apri` | apertura in Obsidian, Zed o nella vista Nushell per i tipi configurati |
| `crea-layout` | fa `brudr-pannelli.json` da una copia di `herdr-transparent.json` |
| `test_pannelli.py` | prove senza Herdr: `python3 personal/pannelli/test_pannelli.py` |
| `prova_mod.mjs` | la mod vera in node, contro un brudr e un core finti (usata dalle prove) |

## Come funziona

- **Layout.** `brudr-pannelli` è il layout trasparente con due cambi: lo stack `panel-body` ha cinque blocchi `{"terminal": "brudr-<tipo>"}`, per nome (il core accetta un nome al posto dell'indirizzo, quindi il layout non cambia quando cambia l'indirizzo), senza intestazione e senza fondo proprio (Private ha il grigio degli altri); il blocco `tabs` usa la mod `pannelli` al posto di `tabs`. Gli id `files` e `changes` restano. `herdr-transparent` resta com'è.
- **Mod `pannelli`.** È la barra in alto: le schede come la mod `tabs` di Herdr (copiata, `defaults/` non cambia) e, al posto di Files e Changes, i pulsanti Superfile, Neovim, Hunk, Quota, Private (un puntino segna i privati). Un clic mostra il pannello, un secondo clic lo nasconde. Come `tabs`, ricorda per ogni spazio il pannello aperto, ora per tutti e cinque. Quando un pannello si mostra senza il suo terminale, lo crea:
  `hc run --bg --json --no-parent --rm --name brudr-<tipo> --label brudr.panel=<tipo> [--label brudr.private=1] --cwd <cartella> -- ~/bin/brudr-pannello <tipo>`.
  Poi nasconde e rimostra il pannello: un blocco agganciato a un nome che non esisteva resta spento e non riprova. Un terminale che ha il nome di un pannello senza le sue etichette non viene mostrato (avviso e pannello nascosto).
- **Un pannello che si chiude torna.** Quando il terminale di un pannello finisce (`hc kill`, un guasto), brudr toglie il suo blocco dal layout in memoria (`src/window.rs`, `terminal_ended`) e il salvataggio successivo scrive il file senza il blocco (`layout_sync::without_clicks` tiene l'albero com'è). Ricaricare il layout non basta: `layout.switch` salva prima di caricare. La mod rimette il blocco nel file del layout (`blocchi.js`, `ripara`), scrivendo solo sul testo appena letto; brudr applica il file da solo (`check_layout_file`) e tiene i clic. Lo fa da sola per un blocco che ha visto sparire (al massimo ogni 10 secondi) e subito per un clic su un pannello senza blocco, che poi mostra.
- **`brudr-pannello`.** Ciclo: se il programma esce (q, :q, exit) riparte. Ctrl-C fra due avvii non chiude il pannello. Un programma che esce subito aspetta un tasto: prima l'attesa rimette il terminale (mouse, tastiera kitty, schermo alternativo, cursore) e svuota l'ingresso; le risposte del terminale e i movimenti del mouse non contano come tasti. Nei pannelli privati: `TMPDIR` proprio in `~/.config/brudr-pannelli/tmp/<tipo>.*` (0700), tolto alla fine; schermo e cronologia del terminale puliti a ogni uscita del programma e alla fine del pannello (lo schermo finale è quello che il core salva); storie di less, node, python, sqlite, psql, mysql, redis-cli spente; `EDITOR=nvim`, e `~/.config/brudr-pannelli/bin/nvim` (collegamento a `brudr-pannello`) primo nel PATH: anche l'editor aperto da spf o scritto nella shell privata è il Neovim senza tracce.
- **Neovim senza tracce.** `-n -i NONE`, `noundofile noswapfile nobackup nowritebackup` prima e dopo la configurazione dell'utente (LazyVim accende undofile), più un autocmd per ogni buffer; `persistence.nvim` fermato (non salva la sessione). Niente `--listen`: il socket RPC darebbe i buffer a chi lo raggiunge.
- **Superfile.** La configurazione dell'utente (`~/Library/Application Support/superfile/config.toml`) copiata nel `TMPDIR` privato a ogni avvio; il pannello mantiene la larghezza della sidebar e l'impostazione di zoxide configurate dall'utente, chiude l'anteprima dei file all'avvio, spegne l'anteprima d'immagini (miniature su disco) e il controllo aggiornamenti, e usa `$EDITOR`.
- **Tasti di Superfile.** `E` ed `e` aprono il file in Neovim; `alt+d` apre la cartella con l'editor per cartelle. Il pannello legge gli stessi tasti del Superfile da terminale ma usa il collegamento privato a Neovim. Se manca quel collegamento, il pannello non avvia Superfile. `l`, `L` e Invio entrano nelle cartelle e aprono i file. Le estensioni configurate aprono Obsidian (note dentro un vault), Zed (codice), o una tabella Nushell in una finestra separata, in sola lettura (JSON, JSONC, TOML, YAML e XML, fino a 1 MiB). I tipi non elencati seguono la loro app predefinita di macOS. L'apertura di un file in Zed o Obsidian può lasciare tracce in quelle app.
- **Footer di Superfile.** Il pannello usa la configurazione privata e imposta `show_panel_footer_info = true` senza cambiare il file dell'utente. Lo stato del footer dell'interfaccia, alternato da Superfile con `alt+f` e salvato in `toggleFooter`, non è un'opzione di `config.toml`: il pannello non lo forza e conserva lo stato condiviso salvato da Superfile.
- **Hunk segue lo spazio.** La mod scrive la cartella dello spazio (o del pane focalizzato) in `~/.config/herdr-app/data/pannelli/hunk.dir`; `brudr-pannello` la controlla ogni secondo e riavvia hunk lì. Mai la cartella di un blocco del layout, quindi mai quella di un pannello privato. Fuori da un repository Git hunk non parte: il pannello scrive «Nessun repository Git in <cartella>» una volta e aspetta che lo spazio passi a un repository.

## Installazione

Con un passo di installazione locale (la home di Herdr e `~/bin` sono chiuse agli agenti). I file si copiano, non si collegano: il checkout è scrivibile dagli agenti, le copie installate no.

| Dove | Cosa |
| --- | --- |
| `~/bin/brudr-pannello` | copia |
| `~/.config/brudr-pannelli/bin/nvim` | collegamento a `~/bin/brudr-pannello` |
| `~/.config/brudr-pannelli/tmp/` | cartella 0700 |
| `~/.config/herdr-app/mods/pannelli/` | copia della mod |
| `~/.config/herdr-app/layouts/brudr-pannelli.json` | `crea-layout` sul `herdr-transparent.json` vivo |

Si sceglie con il cambio layout: `cmd-shift-l` sul Mac, `ctrl-shift-l` su Linux.

## Limiti noti

- **Prove dal vivo** (la sandbox degli agenti non apre terminali): da fare a mano.
- **Un pannello tolto apposta dal layout torna.** La mod rimette ogni blocco di pannello che ha visto sparire nella sessione: per toglierne uno si cambia anche la mod.
- **Cosa resta fuori dal pannello privato.** Il contenuto dello schermo non esce dal lettore dei terminali degli agenti, ma restano le vie che questo lavoro non chiude: lo stato del core su disco (`~/.local/state/herdr-core`), `registro.fish` nella shell privata, gli undo e gli swap già scritti da Neovim fuori dal pannello, il socket dell'app e la home di Herdr per Pi. Le chiude il lavoro a parte sulle chiusure (D4, D6).
