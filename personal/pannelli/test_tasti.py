#!/usr/bin/env python3
"""Tests of brudr-tasti, the Tasti panel: key spelling, sources, index, Work list, conflicts, hand lists.

Usage: python3 -B personal/pannelli/test_tasti.py
A fake home with small copies of the sources; Neovim, Fish and Nushell are not run
(BRUDR_TASTI_SALTA) except in the test that asks for fish when it is installed. Fake secrets only.
"""
import datetime
import importlib.machinery
import importlib.util
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True
QUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(QUI, "..", ".."))
TASTI = os.path.join(QUI, "brudr-tasti")
MANO = os.path.join(QUI, "tasti")
PREDEFINITI = os.path.join(REPO, "defaults", "keys.macos.json")
SEGRETO = "FINTO_TOKEN_0000_non_vero"
_l = importlib.machinery.SourceFileLoader("brudr_tasti_prova", TASTI)
_s = importlib.util.spec_from_loader("brudr_tasti_prova", _l)
T = importlib.util.module_from_spec(_s)
_l.exec_module(T)

KYRIA_PAGINA = """<html><script>
const D = {"layers": [
 {"id": "base", "name": "Base", "keys": {"q": {"cmd": "Q", "eff": "Q"}, "u": {"cmd": "U", "eff": "U"},
   "up1": {"cmd": "tocco: Cmd+C · 2×: Option+Cmd+C", "eff": "Copia · 2× percorso",
           "td": {"tocco": {"eff": "Copia", "cmd": "Cmd+C"}, "doppio": {"eff": "Copia il percorso", "cmd": "Option+Cmd+C"}}}}},
 {"id": "dev", "name": "DEV", "keys": {"u": {"cmd": "Ctrl+Option+H", "eff": "pannello ←", "tm": "herdr: pannello a sinistra", "nv": "—"},
   "q": {"cmd": "Ctrl+S", "eff": "salva", "nv": "Salva", "tm": "—"}, "x": {"free": true, "cmd": "—"}}}
], "fonte": "layout-v13t.vil"};
</script></html>
"""
HAMMERSPOON = """hs.hotkey.bind({ "cmd", "alt" }, "T", toggleSystemAppearance)
local hyper = { "ctrl", "alt", "cmd", "shift" }
local emoji = {
  Y = "✅", -- ACC+M tocco
}
local devInClaude = {
  { "P", { "alt" }, "left" },  -- DEV J: sessione indietro
  { "U", { "ctrl" }, 33 },     -- DEV I: pannello precedente
}
local CODICI = {
  [54] = { nome = "cmdDx", flag = "cmd", azione = screenshotArea },     -- Cmd destro
}
"""


class Casa(unittest.TestCase):
    def setUp(self):
        self.casa = os.path.realpath(tempfile.mkdtemp(prefix="tasti-"))
        self.dati = os.path.join(self.casa, ".config/herdr-app/data/pannelli")
        self.mano = os.path.join(self.dati, "tasti")
        shutil.copytree(MANO, self.mano, ignore=shutil.ignore_patterns("estrai-kb", "__pycache__"))
        self.scrivi(".config/herdr-app/keys.json", json.dumps({
            "global": {"ctrl-alt-h": "pane.go:left", "cmd-q": "app.quit", "ctrl-alt-n": "tab.next"},
            "terminal": {"alt-left": "send:\u001bb"}}))
        self.scrivi(".claude-brus/keybindings.json", json.dumps({"bindings": [
            {"context": "Chat", "bindings": {"meta+1": "command:cp1", "ctrl+alt+h": "chat:submit"}}]}))
        self.scrivi(".pi/agent/keybindings.json", json.dumps({"tui.editor.cursorWordLeft": ["alt+left"],
                                                              "tui.editor.yankPop": []}))
        self.scrivi("pi-doc.md", "## Cursor\n| Keybinding id | Default | Description |\n|---|---|---|\n"
                    "| `tui.editor.cursorUp` | `up` | Move cursor up |\n"
                    "| `tui.editor.cursorWordLeft` | `alt+left`, `ctrl+left` | Move word left |\n")
        self.scrivi("Library/Application Support/superfile/hotkeys.toml", "confirm = ['enter', 'l', 'L']\nquit = ['q', '']\n")
        self.scrivi("personal/personalizzazioni/kyria/layer/tastiera-layer.html", KYRIA_PAGINA)
        self.scrivi(".hammerspoon/init.lua", HAMMERSPOON)
        self.scrivi("Library/Application Support/Claude/claude_desktop_config.json", json.dumps(
            {"preferences": {"quickEntryShortcut": {"accelerator": "Alt+Space"}, "token": SEGRETO},
             "mcpServers": {"x": {"env": {"API_KEY": SEGRETO}}}}))
        self.scrivi(".codex/config.toml", '[tui]\nvim_mode_default = true\napi_key = "%s"\n' % SEGRETO)
        self.plist("Library/Preferences/com.knollsoft.Rectangle.plist",
                   {"reflowTodo": {"keyCode": 45, "modifierFlags": 786432}, "alternateDefaultShortcuts": True,
                    "SUFeedSecret": SEGRETO})
        self.plist("Library/Preferences/com.apple.symbolichotkeys.plist", {"AppleSymbolicHotKeys": {
            "79": {"enabled": True, "value": {"parameters": [65535.0, 123.0, 8650752.0], "type": "standard"}},
            "64": {"enabled": False, "value": {"parameters": [32, 49, 1048576], "type": "standard"}}}})
        # A personal vault and a vault in ~/Work: the second is never opened.
        self.scrivi("personal/vault/.obsidian/hotkeys.json", json.dumps(
            {"graph:open-local": [{"modifiers": ["Mod", "Shift"], "key": "G"}]}))
        self.scrivi("Work/cliente/.obsidian/hotkeys.json", json.dumps(
            {"segreto-di-work:" + SEGRETO: [{"modifiers": ["Mod"], "key": "J"}]}))
        self.scrivi("Library/Application Support/obsidian/obsidian.json", json.dumps({"vaults": {
            "a": {"path": os.path.join(self.casa, "personal/vault")}, "b": {"path": os.path.join(self.casa, "Work/cliente")}}}))

    def tearDown(self):
        shutil.rmtree(self.casa, ignore_errors=True)

    def scrivi(self, rel, testo):
        p = os.path.join(self.casa, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(testo)
        return p

    def plist(self, rel, dati):
        p = os.path.join(self.casa, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            plistlib.dump(dati, f, fmt=plistlib.FMT_BINARY)

    def env(self, **extra):
        e = {k: v for k, v in os.environ.items() if not k.startswith("BRUDR_")}
        e.update(BRUDR_TASTI_CASA=self.casa, BRUDR_TASTI_SALTA="Neovim,Fish,Nushell",
                 BRUDR_TASTI_HERDR_PREDEFINITI=PREDEFINITI, BRUDR_TASTI_PI_DOC=os.path.join(self.casa, "pi-doc.md"),
                 BRUDR_TASTI_SENZA_COLORI="1")
        e.update(extra)
        return e

    def tasti(self, *args, **extra):
        r = subprocess.run([sys.executable, "-B", TASTI, *args], env=self.env(**extra), capture_output=True,
                           text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def indice(self):
        with open(os.path.join(self.dati, "tasti.json"), encoding="utf-8") as f:
            return json.load(f)

    def voci(self, programma=None):
        return [v for p in self.indice()["programmi"].values() for v in p["voci"]
                if programma is None or v["programma"] == programma]

    @staticmethod
    def senza_colori(t):
        return re.sub(r"\x1b\[[0-9;]*m", "", t)


class Grafia(unittest.TestCase):
    def test_un_solo_modo_di_scrivere_i_tasti(self):
        casi = {"ctrl-alt-h": "ctrl+alt+h", "Ctrl+Option+H": "ctrl+alt+h", "⌃⌥H": "ctrl+alt+h", "ctrl+alt+h": "ctrl+alt+h",
                "cmd-alt-shift-left": "alt+shift+cmd+left", "⌘+⇧+P": "shift+cmd+p", "⌘ + Shift + n": "shift+cmd+n",
                "meta+1": "alt+1", "Mod+Shift+G": "shift+cmd+g", "cmd--": "cmd+-", "cmd-+": "cmd++", "⌘++": "cmd++",
                "Ctrl+X Ctrl+K": "ctrl+x ctrl+k", "Command–Space bar": "cmd+space", "Shift+Tab": "shift+tab",
                "Hyper+Y": "ctrl+alt+shift+cmd+y", "Option-Command-Esc": "alt+cmd+esc", "L": "L", "?": "?",
                "Left arrow": "left", "Escape": "esc", "Ctrl+_": "ctrl+_", "f2": "f2", "shift-f2": "shift+f2"}
        for dentro, atteso in casi.items():
            with self.subTest(dentro=dentro):
                testo = dentro.replace("–", "-") if "Command" in dentro else dentro
                self.assertEqual(T.norma(testo), atteso)

    def test_tasti_di_neovim(self):
        casi = {"<C-H>": "ctrl+h", "<M-v>": "alt+v", " ff": "<leader> ff", "<C-w>v": "ctrl+w v", "gg": "gg",
                "]h": "]h", "<Esc>": "esc", "<leader>e": "<leader> e", "<S-Tab>": "shift+tab"}
        for dentro, atteso in casi.items():
            with self.subTest(dentro=dentro):
                self.assertEqual(T.tasto_vim(dentro), atteso)

    def test_codici_dei_tasti_del_mac(self):
        self.assertEqual(T.tasto_mac(45, 786432), "ctrl+alt+n")  # Rectangle
        self.assertEqual(T.tasto_mac(123, 8650752), "ctrl+left")  # fn set by the system on arrows
        self.assertEqual(T.tasto_mac(49, 1048576), "cmd+space")


class Indice(Casa):
    def test_ricerca_ctrl_alt_h_mostra_herdr_e_kyria(self):
        self.tasti("genera")
        righe = [self.senza_colori(r) for r in self.tasti("righe").splitlines() if "ctrl+alt+h" in r]
        programmi = {r.split("\t")[1].split()[0] for r in righe}
        self.assertIn("Herdr", programmi)
        self.assertIn("Kyria", programmi)
        kyria = next(v for v in self.voci("Kyria") if v["tasto"] == "DEV U")
        self.assertEqual(kyria["nota"], "manda ctrl+alt+h")
        scheda = self.tasti("scheda", str(next(i for i, r in enumerate(self.tasti("righe").splitlines())
                                                if "DEV U" in r)))
        self.assertIn("lo ricevono:", scheda)
        self.assertIn("Herdr: pane.go:left", scheda)

    @unittest.skipUnless(shutil.which("fzf"), "fzf not installed")
    def test_fzf_del_pannello_trova_herdr_e_kyria(self):
        out = self.senza_colori(self.tasti(BRUDR_TASTI_FILTRO="ctrl+alt+h"))
        righe = [r for r in out.splitlines() if "\t" in r]
        self.assertEqual(sorted(r.split("\t")[1].split()[0] for r in righe), ["Claude", "Herdr", "Kyria"])

    def test_un_tasto_cambiato_compare_alla_riapertura(self):
        self.tasti("genera")
        prima = os.stat(os.path.join(self.dati, "tasti.json")).st_mtime_ns
        self.assertIn("nessuna fonte cambiata", self.tasti("genera"))
        self.assertEqual(os.stat(os.path.join(self.dati, "tasti.json")).st_mtime_ns, prima)
        time.sleep(0.05)
        self.scrivi(".config/herdr-app/keys.json", json.dumps({"global": {"ctrl-alt-y": "pane.zoom"}}))
        self.tasti("genera")
        herdr = {v["tasto"]: v["azione"] for v in self.voci("Herdr")}
        self.assertEqual(herdr, {"ctrl+alt+y": "pane.zoom"})

    def test_origine_utente_e_predefinito_di_herdr(self):
        self.tasti("genera")
        herdr = {v["tasto"]: v for v in self.voci("Herdr")}
        self.assertEqual(herdr["cmd+q"]["origine"], "predefinito")
        self.assertEqual(herdr["ctrl+alt+h"]["origine"], "utente")
        self.assertEqual(herdr["alt+left"]["azione"], "manda \\u001bb")

    def test_fonti_lette(self):
        self.tasti("genera")
        tutte = {(v["programma"], v["tasto"]) for v in self.voci()}
        attese = {("Claude Code", "alt+1"), ("Pi", "up"), ("Pi", "alt+left"), ("Superfile", "L"),
                  ("Hammerspoon", "alt+cmd+t"), ("Hammerspoon", "ctrl+alt+shift+cmd+y"), ("Hammerspoon", "ctrl+alt+p"),
                  ("Hammerspoon", "2× cmd destro"), ("Rectangle", "ctrl+alt+n"), ("macOS", "ctrl+left"),
                  ("Claude Desktop", "alt+space"), ("Obsidian", "shift+cmd+g"), ("Codex", "esc"),
                  ("Kyria", "Base Copia tocco"), ("Kyria", "DEV Q")}
        self.assertEqual(attese - tutte, set())
        self.assertNotIn(("Kyria", "Base Q"), tutte, "plain letters of the Base layer are left out")
        self.assertNotIn(("Pi", "ctrl+left"), tutte, "the user's keys replace Pi's defaults for that action")
        self.assertIn("tolto dall'utente", " ".join(v["azione"] for v in self.voci("Pi")))
        self.assertNotIn(("macOS", "cmd+space"), {(v["programma"], v["tasto"]) for v in self.voci()
                                                  if v["origine"] == "configurato"}, "disabled hotkeys are left out")

    def test_niente_segreti_e_niente_work_nell_indice(self):
        self.tasti("genera")
        testo = open(os.path.join(self.dati, "tasti.json"), encoding="utf-8").read()
        self.assertNotIn(SEGRETO, testo)
        self.assertNotIn("Work/cliente", testo)
        self.assertNotIn("segreto-di-work", testo)

    def test_lista_di_work_scritta_da_ccv(self):
        self.tasti("genera")
        self.scrivi(".config/herdr-app/data/pannelli/tasti-work.json", json.dumps({"versione": 1, "voci": [
            {"programma": "Obsidian", "tasto": "Mod+Shift+K", "azione": "Apri il quaderno", "fonte": "vault di Work: note"},
            {"programma": "Obsidian", "tasto": "Mod+J"},
            "non una voce",
            {"programma": "Obsidian", "tasto": "Mod+L", "azione": "riga\x1b[31mrossa", "fonte": "vault di Work: note"}]}))
        out = self.tasti("genera")
        work = [v for v in self.voci() if v["origine"] == "work"]
        self.assertEqual([(v["tasto"], v["azione"]) for v in work],
                         [("shift+cmd+k", "Apri il quaderno"), ("cmd+l", "riga [31mrossa")])
        self.assertIn("2 voci scartate", out)

    def test_conflitti(self):
        self.tasti("genera")
        out = self.tasti("controlla")
        self.assertIn("conflitto: Herdr ctrl+alt+n (tab.next): Rectangle lo prende prima", out)
        self.assertIn("conflitto: Claude Code ctrl+alt+h (chat:submit): Herdr lo prende prima (pane.go:left)", out)
        self.assertNotIn("conflitto: Kyria", out, "the Kyria sends keys, it does not compete for them")

    def test_filtro_per_programma(self):
        self.tasti("genera")
        azione = self.tasti("filtro", "+1", FZF_PROMPT="Tutti › ")
        self.assertTrue(azione.startswith("change-prompt(Herdr › )+reload("), azione)
        azione = self.tasti("filtro", "-1", FZF_PROMPT="Tutti › ")
        self.assertTrue(azione.startswith("change-prompt(") and "Tutti ›" not in azione, azione)
        righe = self.tasti("righe", "Hammerspoon").splitlines()
        self.assertTrue(righe and all("Hammerspoon" in r for r in righe))

    def test_fonte_rotta_non_ferma_il_pannello(self):
        self.scrivi("Library/Application Support/superfile/hotkeys.toml", "confirm = [")
        out = self.tasti("genera")
        self.assertIn("Superfile: non letto", out)
        self.assertTrue(self.voci("Herdr"))

    def test_lista_a_mano_vecchia_segnalata(self):
        p = os.path.join(self.mano, "youtube.json")
        d = json.load(open(p, encoding="utf-8"))
        d["data"] = (datetime.date.today() - datetime.timedelta(days=120)).isoformat()
        json.dump(d, open(p, "w", encoding="utf-8"))
        self.assertIn("YouTube: lista a mano del", self.tasti("genera"))

    @unittest.skipUnless(shutil.which("fish"), "fish not installed")
    def test_fish_vero(self):
        self.scrivi(".config/fish/config.fish", "if status is-interactive\n    fish_vi_key_bindings\n"
                    "    bind -M default U redo\nend\n")
        self.tasti("genera", BRUDR_TASTI_SALTA="Neovim,Nushell")
        fish = self.voci("Fish")
        self.assertIn(("U", "redo", "utente"), {(v["tasto"], v["azione"], v["origine"]) for v in fish})
        self.assertGreater(len(fish), 100)


class ListeAMano(unittest.TestCase):
    def test_ogni_lista_ha_fonte_data_e_tasti(self):
        attesi = {"chrome", "youtube", "macos", "claude-code", "hunk", "codex-desktop", "codex", "superfile",
                  "obsidian", "lavish", "claude-desktop"}
        nomi = {n[:-5] for n in os.listdir(MANO) if n.endswith(".json")}
        self.assertEqual(nomi, attesi)
        for n in sorted(nomi):
            with self.subTest(lista=n):
                d = json.load(open(os.path.join(MANO, n + ".json"), encoding="utf-8"))
                self.assertTrue(d["programma"] and d["fonte"] and d["copia"].startswith("~/KB/keybindings/"))
                datetime.date.fromisoformat(d["data"])
                self.assertGreater(len(d["voci"]), 5)
                self.assertTrue(all(v["tasto"] and "azione" in v for v in d["voci"]))

    def test_liste_complete_di_chrome_youtube_e_macos(self):
        conta = {n: len(json.load(open(os.path.join(MANO, n + ".json")))["voci"]) for n in ("chrome", "youtube", "macos")}
        self.assertGreaterEqual(conta["chrome"], 80)
        self.assertGreaterEqual(conta["youtube"], 25)
        self.assertGreaterEqual(conta["macos"], 200)

    def test_lavish_mostrata_come_attiva_e_marcata_proposta(self):
        d = json.load(open(os.path.join(MANO, "lavish.json")))
        self.assertEqual(d["origine"], "proposta")
        self.assertIn("ctrl+h / ctrl+j / ctrl+k / ctrl+l", [v["tasto"] for v in d["voci"]])

    def test_superfile_solo_nomi(self):
        self.assertTrue(json.load(open(os.path.join(MANO, "superfile.json")))["solo_nomi"])


class Pannello(unittest.TestCase):
    def test_brudr_pannello_tasti_pubblico(self):
        r = subprocess.run([os.path.join(QUI, "brudr-pannello"), "tasti"], capture_output=True, text=True,
                           env=dict(os.environ, BRUDR_PANNELLO_PROVA="1"), timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("privato: 0", r.stdout)
        self.assertIn("esegue: brudr-tasti", r.stdout)

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_voce_della_mod_pubblica(self):
        r = subprocess.run(["node", "--input-type=module", "-e",
                            "import { PANNELLI, blocco } from %s; const p = PANNELLI.find(x => x.tipo === 'tasti');"
                            "console.log(JSON.stringify({ p, b: blocco(p), i: PANNELLI.indexOf(p) }))"
                            % json.dumps("file://" + os.path.join(QUI, "mods/pannelli/blocchi.js"))],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.loads(r.stdout)
        self.assertEqual(d["p"], {"child": "tasti", "tipo": "tasti", "nome": "Tasti", "privato": False})
        self.assertEqual(d["b"], {"id": "tasti", "type": "block", "content": {"terminal": "brudr-tasti"}})


if __name__ == "__main__":
    unittest.main(verbosity=1)
