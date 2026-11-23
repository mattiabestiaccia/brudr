---
type: personal-build
title: Pannelli laterali di brudr (Superfile, Neovim, hunk, Quota, Private)
status: da provare dal vivo
updated: 2026-11-23
description: Pannelli a terminale nella colonna destra di brudr; Superfile, Neovim e Private sono privati, il lettore dei terminali degli agenti non li legge.
---

# Pannelli laterali di brudr

Decisioni del 23 novembre 2026 (D1 blocchi del layout per nome, D2 Superfile non segue lo spazio, D3 Neovim non segue lo spazio, D5 terminali creati al primo clic e ricreati dopo un riavvio).

| Pannello | Programma | Privato | Segue lo spazio |
| --- | --- | --- | --- |
| Superfile | `spf` con la configurazione del pannello | sì | no (D2) |
| Neovim | `nvim` senza swap, undo, shada, backup | sì | no (D3) |
| hunk (al posto di Changes) | `hunk diff --watch` | no | sì, come Changes |
| Quota | `quota-brs --tui` (`quota-axi --tui` se manca) | no | no |
| Private | `fish --private`, fondo nero opaco | sì | no |

Privato vuol dire: il terminale porta l'etichetta di core `brudr.private=1` dalla nascita, e il lettore dei terminali degli agenti non lo elenca e non lo legge.

## File

| File | Cosa |
| --- | --- |
| `mods/pannelli/` | mod: intestazione dello stack `panel-body` (cinque pulsanti) e custode dei terminali |
| `brudr-pannello` | il programma di ogni pannello; non finisce mai da solo |
| `crea-layout` | fa `brudr-pannelli.json` da una copia di `herdr-transparent.json` |
| `test_pannelli.py` | prove senza Herdr: `python3 personal/pannelli/test_pannelli.py` |

## Come funziona

- **Layout.** `brudr-pannelli` è il layout trasparente con lo stack `panel-body` cambiato: cinque blocchi `{"terminal": "brudr-<tipo>"}`, per nome (il core accetta un nome al posto dell'indirizzo, quindi il layout non cambia quando cambia l'indirizzo). Gli id `files` e `changes` restano: i pulsanti Files e Changes della barra delle schede aprono Superfile e hunk. Il blocco `privato` ha `"background": "#000000"`: in modalità trasparente il terminale non dipinge il suo fondo, sotto il testo c'è il nero del nodo. `herdr-transparent` resta com'è.
- **Mod `pannelli`.** Quando un pannello si mostra senza il suo terminale, lo crea:
  `hc run --bg --json --no-parent --rm --name brudr-<tipo> --label brudr.panel=<tipo> [--label brudr.private=1] --cwd <cartella> -- ~/bin/brudr-pannello <tipo>`.
  Poi nasconde e rimostra il pannello: un blocco agganciato a un nome che non esisteva resta spento e non riprova. Se un terminale finisce, brudr toglie il blocco dal layout in memoria: la mod ricarica il layout dal file (`layout.switch` sullo stesso nome), al massimo ogni 10 secondi. Un terminale che ha il nome di un pannello senza le sue etichette non viene mostrato (avviso e pannello nascosto).
- **`brudr-pannello`.** Ciclo: se il programma esce (q, :q, exit) riparte. Ctrl-C fra due avvii non chiude il pannello. Nei pannelli privati: `TMPDIR` proprio in `~/.config/brudr-pannelli/tmp/<tipo>.*` (0700), tolto alla fine; schermo e cronologia del terminale puliti a ogni uscita del programma e alla fine del pannello (lo schermo finale è quello che il core salva); storie di less, node, python, sqlite, psql, mysql, redis-cli spente; `EDITOR=nvim`, e `~/.config/brudr-pannelli/bin/nvim` (collegamento a `brudr-pannello`) primo nel PATH: anche l'editor aperto da spf o scritto nella shell privata è il Neovim senza tracce.
- **Neovim senza tracce.** `-n -i NONE`, `noundofile noswapfile nobackup nowritebackup` prima e dopo la configurazione dell'utente (LazyVim accende undofile), più un autocmd per ogni buffer; `persistence.nvim` fermato (non salva la sessione). Niente `--listen`: il socket RPC darebbe i buffer a chi lo raggiunge.
- **Superfile.** La configurazione dell'utente (`~/Library/Application Support/superfile/config.toml`) con queste chiavi al posto delle sue, scritta a ogni avvio nel `TMPDIR` privato: `sidebar_width = 0`, anteprima chiusa all'avvio, anteprima d'immagini spenta (miniature su disco), niente controllo aggiornamenti, niente zoxide, editor = `$EDITOR`.
- **hunk segue lo spazio.** La mod scrive la cartella dello spazio (o del pane focalizzato) in `~/.config/herdr-app/data/pannelli/hunk.dir`; `brudr-pannello` la controlla ogni secondo e riavvia hunk lì. Mai la cartella di un blocco del layout, quindi mai quella di un pannello privato.

## Installazione

Con un passo di installazione locale (la home di Herdr e `~/bin` sono chiuse agli agenti). I file si copiano, non si collegano: il checkout è scrivibile dagli agenti, le copie installate no.

| Dove | Cosa |
| --- | --- |
| `~/bin/brudr-pannello` | copia |
| `~/.config/brudr-pannelli/bin/nvim` | collegamento a `~/bin/brudr-pannello` |
| `~/.config/brudr-pannelli/tmp/` | cartella 0700 |
| `~/.config/herdr-app/mods/pannelli/` | copia della mod |
| `~/.config/herdr-app/layouts/brudr-pannelli.json` | `crea-layout` sul `herdr-transparent.json` vivo |

Si sceglie con il cambio layout (`ctrl-shift-l`).

## Limiti noti

- **Barra delle schede.** La mod `tabs` ricorda il pannello per spazio, ma solo `files` e `changes`: con Neovim, Quota o Private aperti, cambiando spazio e tornando il pannello si chiude. Rimedio, se serve: un clone di `tabs` con i cinque pannelli.
- **Prove dal vivo da fare** (la sandbox degli agenti non apre terminali): aggancio per nome, riaggancio dopo il riavvio, programmi stretti (368 px), fondo nero, file `.snap` dopo `hc rm`. Elenco da fare a mano.
- **Cosa resta fuori dal pannello privato.** Il contenuto dello schermo non esce dal lettore dei terminali degli agenti, ma restano le vie che questo lavoro non chiude: lo stato del core su disco (`~/.local/state/herdr-core`), `registro.fish` nella shell privata, gli undo e gli swap già scritti da Neovim fuori dal pannello, il socket dell'app e la home di Herdr per Pi. Le chiude il lavoro a parte sulle chiusure (D4, D6).
