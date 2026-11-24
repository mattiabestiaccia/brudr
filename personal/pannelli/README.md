---
type: personal-build
title: Pannelli laterali di brudr (Superfile, Neovim, Hunk, Quota, Tasti, Private, Browser)
status: da provare dal vivo
updated: 2026-11-24
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
| Tasti | `brudr-tasti`: i tasti dell'utente in tutti i programmi, cercati con fzf | no | no |
| Private | `fish --private` | sì | no |
| Browser | WebKit nativo (macOS 14+) | no | no |

Privato vuol dire: il terminale porta l'etichetta di core `brudr.private=1` dalla nascita, e il lettore dei terminali degli agenti non lo elenca e non lo legge.

## File

| File | Cosa |
| --- | --- |
| `mods/pannelli/` | mod: barra in alto (copia di `tabs`, con sette pulsanti al posto di Files e Changes) e custode dei terminali; `blocchi.js` ha i pannelli e la riparazione del layout |
| `brudr-pannello` | il programma di ogni pannello; non finisce mai da solo |
| `spf-apri` | apertura in Obsidian, Zed o nella vista Nushell per i tipi configurati; la vista colorata in brudr, anche fuori da brudr |
| `brudr-tasti` | il programma del pannello Tasti: indice dei tasti (`genera`), ricerca con fzf e anteprima con bat |
| `tasti/` | liste a mano dalle pagine ufficiali, una per programma, con indirizzo, copia in KB e data; `tasti/estrai-kb` le riscrive dalle pagine salvate |
| `test_tasti.py` | prove del pannello Tasti con una casa finta: `python3 -B personal/pannelli/test_tasti.py` |
| `crea-layout` | fa `brudr-pannelli.json` da una copia di `herdr-transparent.json` |
| `test_pannelli.py` | prove senza Herdr: `python3 personal/pannelli/test_pannelli.py` |
| `test_spf_apri.py` | prove di `spf-apri` con `hc`, `herdr-app`, `less`, `open` e `lsappinfo` finti: `python3 -B personal/pannelli/test_spf_apri.py` |
| `prova_mod.mjs` | la mod vera in node, contro un brudr e un core finti (usata dalle prove) |

## Come funziona

- **Layout.** `brudr-pannelli` è il layout trasparente con due cambi: lo stack `panel-body` ha un blocco web, sei blocchi `{"terminal": "brudr-<tipo>"}` e, prima di Superfile, il blocco `spf-vista` (`{"terminal": "brudr-spf-vista"}`, senza pulsante) della vista Nushell, per nome (il core accetta un nome al posto dell'indirizzo, quindi il layout non cambia quando cambia l'indirizzo), senza intestazione e senza fondo proprio (Private ha il grigio degli altri); il blocco `tabs` usa la mod `pannelli` al posto di `tabs`. Gli id `files` e `changes` restano. `herdr-transparent` resta com'è.
- **Mod `pannelli`.** È la barra in alto: le schede come la mod `tabs` di Herdr (copiata, `defaults/` non cambia) e, al posto di Files e Changes, i pulsanti Superfile, Neovim, Hunk, Quota, Tasti, Private e Browser (un puntino segna i privati). Un clic mostra il pannello, un secondo clic lo nasconde. Come `tabs`, ricorda per ogni spazio il pannello aperto. Quando mostra un pannello a terminale senza il suo terminale, lo crea:
  `hc run --bg --json --no-parent --rm --name brudr-<tipo> --label brudr.panel=<tipo> [--label brudr.private=1] --cwd <cartella> -- ~/bin/brudr-pannello <tipo>`.
  Poi nasconde e rimostra il pannello: un blocco agganciato a un nome che non esisteva resta spento e non riprova. Un terminale che ha il nome di un pannello senza le sue etichette non viene mostrato (avviso e pannello nascosto).
- **Browser.** Si apre su `https://www.google.com/`. Scrivi il sito nella barra del pannello e premi Invio. In alto la barra delle schede: **+** apre una scheda su Google, **×** chiude quella mostrata, un clic sul titolo la mostra; un link che chiede una finestra nuova apre una scheda (al massimo 12). Tutte le schede usano lo stesso profilo dati. **☆** salva la pagina nei preferiti (diventa **★**; un altro clic la toglie), **▾** apre il menu dei preferiti e «Edit bookmarks file…». I preferiti stanno in `~/.config/herdr-app/data/brudr-browser/preferiti.txt`: una riga per preferito, `indirizzo titolo`; righe vuote e righe con `#` non contano. Si può modificare a mano: il pannello rilegge il file a ogni apertura del menu e a ogni pagina. Le schede non tornano dopo il riavvio. Passare a un altro pannello o chiuderlo con il pulsante non interrompe la pagina; lasciare il layout la chiude. Non crea terminali, non ha pallino, non è una finestra privata e conserva cookie e dati in un profilo brudr, non Safari. Il WebKit nativo può coprire i popup di Herdr che cadono nella sua area.
- **Un pannello che si chiude torna.** Quando il terminale di un pannello finisce (`hc kill`, un guasto), brudr toglie il suo blocco dal layout in memoria (`src/window.rs`, `terminal_ended`) e il salvataggio successivo scrive il file senza il blocco (`layout_sync::without_clicks` tiene l'albero com'è). Ricaricare il layout non basta: `layout.switch` salva prima di caricare. La mod rimette il blocco nel file del layout (`blocchi.js`, `ripara`), scrivendo solo sul testo appena letto; brudr applica il file da solo (`check_layout_file`) e tiene i clic. Lo fa da sola per un blocco che ha visto sparire (al massimo ogni 10 secondi) e subito per un clic su un pannello senza blocco, che poi mostra.
- **`brudr-pannello`.** Ciclo: se il programma esce (q, :q, exit) riparte. Ctrl-C fra due avvii non chiude il pannello. Un programma che esce subito aspetta un tasto: prima l'attesa rimette il terminale (mouse, tastiera kitty, schermo alternativo, cursore) e svuota l'ingresso; le risposte del terminale e i movimenti del mouse non contano come tasti. Nei pannelli privati: `TMPDIR` proprio in `~/.config/brudr-pannelli/tmp/<tipo>.*` (0700), tolto alla fine; schermo e cronologia del terminale puliti a ogni uscita del programma e alla fine del pannello (lo schermo finale è quello che il core salva); storie di less, node, python, sqlite, psql, mysql, redis-cli spente; `EDITOR=nvim`, e `~/.config/brudr-pannelli/bin/nvim` (collegamento a `brudr-pannello`) primo nel PATH: anche l'editor aperto da spf o scritto nella shell privata è il Neovim senza tracce.
- **Neovim senza tracce.** `-n -i NONE`, `noundofile noswapfile nobackup nowritebackup` prima e dopo la configurazione dell'utente (LazyVim accende undofile), più un autocmd per ogni buffer; `persistence.nvim` fermato (non salva la sessione). Niente `--listen`: il socket RPC darebbe i buffer a chi lo raggiunge.
- **Superfile.** La configurazione dell'utente (`~/Library/Application Support/superfile/config.toml`) copiata nel `TMPDIR` privato a ogni avvio; il pannello mantiene la larghezza della sidebar e l'impostazione di zoxide configurate dall'utente, chiude l'anteprima dei file all'avvio, spegne l'anteprima d'immagini (miniature su disco) e il controllo aggiornamenti, e usa `$EDITOR`.
- **Tasti di Superfile.** `E` ed `e` aprono il file in Neovim; `alt+d` apre la cartella con l'editor per cartelle. Il pannello legge gli stessi tasti del Superfile da terminale ma usa il collegamento privato a Neovim. Se manca quel collegamento, il pannello non avvia Superfile. `l`, `L` e Invio entrano nelle cartelle e aprono i file. Le estensioni configurate aprono Obsidian (ogni Markdown, anche fuori da un vault: `open -a Obsidian <file>`, da Obsidian 1.14.4), Zed (codice), o una tabella Nushell in sola lettura (JSON, JSONC, TOML, YAML e XML, fino a 1 MiB; vista Nushell, sotto). I tipi non elencati seguono la loro app predefinita di macOS. L'apertura di un file in Zed o Obsidian può lasciare tracce in quelle app.
- **Vista Nushell.** Invio, `l` o `L` su un file di dati mostrano la tabella di Nushell con i suoi colori, espansa alla larghezza del terminale, in `less` (`-R`, rotella del mouse, `q` per uscire). `spf-apri` legge il file (al massimo 1 MiB) e passa i byte alla vista per una pipe con nome in una cartella sua (0700; nel pannello dentro il `TMPDIR` privato), tolta subito dopo: nessun file con il contenuto e nessun argomento con il nome o il percorso del file.
  - **Nel pannello Superfile** (terminale con `brudr.panel=spf`): `hc run --bg --no-parent --no-notify --rm --name brudr-spf-vista --label brudr.panel=spf-vista --label brudr.private=1 --cwd ~`, poi `herdr-app do layout.select` sul blocco `spf-vista` e `pane.focus`. La vista prende il posto di Superfile; `q` riseleziona `files` e dà la tastiera a Superfile, che non si è mai fermato. Una vista rimasta aperta sotto un altro pannello torna con il pulsante Superfile e lascia il posto alla vista nuova al prossimo Invio. Il blocco della vista sta prima di quello di Superfile: se brudr lo toglie (vista uccisa mentre si vede), Superfile prende il suo posto e la mod lo rimette nel file del layout.
  - **In un terminale di una scheda di brudr**: `herdr-app do pane.split` a destra del terminale di Superfile; `q` chiude il terminale nuovo.
  - **Fuori da brudr, con la finestra di brudr aperta** (Superfile in Terminale, iTerm, l'app desktop di Claude, o in un terminale del core che nessuna scheda mostra): `herdr-app do pane.split` a destra del pane con il fuoco della scheda mostrata, poi brudr in primo piano (la richiesta `raise` sul socket dell'app, come un secondo avvio, e `open -b` solo per l'app che gira davvero, mai per una ferma). `q` chiude il terminale nuovo.
  - **Senza una finestra di brudr che risponde** (brudr chiuso, core che non conosce il terminale, o la vista del pannello che non parte: per esempio un layout senza il blocco `spf-vista`): una finestra nuova di Terminale di macOS, aperta con `open -a Terminal` (Launch Services, nessun Apple Event dall'app di partenza). Esegue uno script `vista.command` nella stessa cartella 0700 della pipe, con il solo percorso della pipe; script, pipe e cartella si tolgono dopo la consegna. `q` chiude la finestra: dopo l'uscita un `osascript` staccato chiude la finestra di quel tty, se il profilo di Terminale la tiene aperta («[Processo completato]»). La tabella del pannello non va mai in un terminale del core senza etichette: dal pannello si passa solo a Terminale.
  - **Ripiego**: da un altro terminale privato (la shell Private), e quando anche Terminale non parte, resta la finestra macOS in solo testo di prima. Dalla shell Private la tabella non passa né dal core né da Terminale.
  - La vista riparte la tabella quando cambia la larghezza del terminale (all'aggancio del blocco, o se si allarga il pannello): torna in cima. `less` gira con `LESSSECURE=1` (niente shell, editor, pipe o file di log) e senza file di storia; Nushell senza file di configurazione (quello dell'utente non cambia i colori). Lo schermo si pulisce all'uscita.
- **Footer di Superfile.** Il pannello usa la configurazione privata e imposta `show_panel_footer_info = true` senza cambiare il file dell'utente. Lo stato del footer dell'interfaccia, alternato da Superfile con `alt+f` e salvato in `toggleFooter`, non è un'opzione di `config.toml`: il pannello non lo forza e conserva lo stato condiviso salvato da Superfile.
- **Tasti.** `brudr-tasti` mostra in fzf una riga per tasto: programma, tasto, azione. Il campo di ricerca prende tasto, programma o azione (parole intere, `--exact`); Tab e Maiusc+Tab scorrono il filtro per programma; Invio mostra o nasconde la scheda (fonte, origine, conflitti, chi riceve il tasto mandato dalla Kyria), colorata da bat. I tasti si scrivono in un modo solo: modificatori nell'ordine del Mac `ctrl+alt+shift+cmd`, poi il tasto (`ctrl+alt+h`, `alt+shift+cmd+left`); una sequenza ha gli accordi separati da uno spazio. `*` segna un tasto dell'utente, `!` un conflitto. L'indice è `~/.config/herdr-app/data/pannelli/tasti.json`: solo tasti, azioni e percorsi o indirizzi delle fonti. All'apertura il programma confronta data e misura dei file di ogni fonte e rilegge solo quelle cambiate (Neovim in modalità headless, senza stato su disco, circa 5 secondi); Esc chiude fzf e `brudr-pannello` lo riapre, quindi un tasto cambiato compare alla riapertura. `brudr-tasti controlla` elenca conflitti e avvisi.
  - Fonti lette (D): Herdr (`keys.json` e i predefiniti), Claude Code (`~/.claude-brus/keybindings.json`), Pi (`keybindings.json` sopra la sua documentazione locale), Codex (`tui.keymap` in `~/.codex/config.toml`), Claude Desktop (solo `quickEntryShortcut`), Neovim, Superfile (`hotkeys.toml`), Fish, Nushell, Obsidian (`hotkeys.json` dei vault personali; i vault in `~/Work` non si aprono), Zed, macOS (scorciatoie di sistema attive), Kyria (la pagina `layer/tastiera-layer.html`, fatta dal `.vil` attuale), Hammerspoon, Rectangle.
  - Liste a mano (M, `tasti/`): Chrome, YouTube e macOS complete; Claude Code, Hunk, Codex, Codex desktop, Obsidian (modifica del testo), Claude Desktop, Lavish (la mappa approvata il 10 novembre 2026, mostrata come attiva). Una lista più vecchia di 90 giorni dà un avviso.
  - Work: se c'è, `~/.config/herdr-app/data/pannelli/tasti-work.json`, scritto da un'altra sessione: `{"versione": 1, "scritto": "AAAA-MM-GG", "voci": [{"programma", "tasto", "azione", "fonte"}]}`, solo testo, al massimo 5000 voci e 300 caratteri per campo.
  - Conflitti: un tasto globale (macOS, Hammerspoon, Rectangle, quick entry di Claude Desktop) lo prende prima di ogni altro programma; i tasti globali di Herdr non arrivano ai programmi nei suoi terminali. I tasti della Kyria non sono conflitti: la scheda dice chi li riceve.
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
| `~/bin/brudr-tasti` | copia |
| `~/.config/herdr-app/data/pannelli/tasti/` | le liste a mano (`tasti/*.json`) e `herdr-predefiniti.json` (copia di `defaults/keys.macos.json`) |

Si sceglie con il cambio layout: `cmd-shift-l` sul Mac, `ctrl-shift-l` su Linux.

## Limiti noti

- **Prove dal vivo** (la sandbox degli agenti non apre terminali): da fare a mano.
- **Tasti che mancano.** Senza una lista ufficiale leggibile: i tasti predefiniti di Zed (`default-macos.json`), di Rectangle (solo un'immagine nel README; il pannello ha le due scorciatoie che l'utente ha salvato), dei comandi di Obsidian (pagina Hotkeys, HTTP 503), del TUI di Codex e dell'app Claude Desktop (oltre a quick entry). Le azioni delle liste ufficiali restano in inglese.
- **Vista Nushell provata senza brudr.** La sandbox degli agenti non apre terminali né la finestra: la vista è provata con `hc`, `herdr-app`, `less`, `open` e `lsappinfo` finti e con il lettore vero dei layout; colori, tastiera, ritorno a Superfile, brudr in primo piano e chiusura della finestra di Terminale sono da provare dal vivo.
- **Un pannello tolto apposta dal layout torna.** La mod rimette ogni blocco di pannello che ha visto sparire nella sessione: per toglierne uno si cambia anche la mod.
- **Cosa resta fuori dal pannello privato.** Il contenuto dello schermo non esce dal lettore dei terminali degli agenti, ma restano le vie che questo lavoro non chiude: lo stato del core su disco (`~/.local/state/herdr-core`), `registro.fish` nella shell privata, gli undo e gli swap già scritti da Neovim fuori dal pannello, il socket dell'app e la home di Herdr per Pi. Le chiude il lavoro a parte sulle chiusure (D4, D6).
