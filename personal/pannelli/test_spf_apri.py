#!/usr/bin/env python3
"""Tests of the detached Superfile opener, without showing any GUI window.

The brudr part runs against fake hc, herdr-app, less, open and lsappinfo (no
core, no window, no terminal): the fakes log what they are asked; `hc run`,
`herdr-app do pane.split` and `open -a Terminal` start the real view
(`spf-apri --vista`) in the background, which reads the named pipe, makes the
table with the real Nushell and gives it to the fake less. Fake data only.
"""
import json
import os
from pathlib import Path
import runpy
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

QUI = Path(__file__).resolve().parent
OPENER = runpy.run_path(str(QUI / "spf-apri"))

# One program for hc, herdr-app, less, open, lsappinfo and xattr, told apart by its name.
FINTO = r'''#!/usr/bin/env python3
import json, os, subprocess, sys
nome = os.path.basename(sys.argv[0]); args = sys.argv[1:]
conf = json.load(open(os.environ["FINTO_CONF"]))
def log(**voce):
    with open(os.environ["FINTO_LOG"], "a") as f:
        f.write(json.dumps({"prog": nome, **voce}) + "\n")
def vista(argv):  # what the core or the window does with argv: runs it, detached
    subprocess.Popen(argv, start_new_session=True, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if nome == "less":
    testo = sys.stdin.buffer.read().decode("utf-8", "replace")
    log(argv=args, testo=testo, env={k: os.environ.get(k) for k in ("LESS", "LESSSECURE", "LESSHISTFILE")})
    sys.exit(0)
if nome == "open":
    if args[:2] == ["-a", "Terminal"]:
        log(argv=args, script=open(args[2]).read(), modo=oct(os.stat(args[2]).st_mode & 0o777))
        if conf.get("open_fallisce"):
            sys.exit(1)
        vista([args[2]])  # what Terminal does with the script: runs it
    else:
        log(argv=args)
    sys.exit(0)
log(argv=args)
if nome == "lsappinfo":
    bundle = args[1].split("=", 1)[1]
    if bundle in conf.get("app", []):
        print(f'ASN:0x0-0x1-"{bundle}":')
    sys.exit(0)
if nome == "hc":
    verbo = args[0]
    if verbo == "get":
        rec = conf.get("record", {}).get(args[-1])
        if rec is None:
            sys.exit(3)
        print(json.dumps(rec))
    elif verbo == "run":
        if conf.get("run_fallisce"):
            sys.exit(1)
        vista(args[args.index("--") + 1:])
        print(json.dumps({"terminal": "t8"}))
    sys.exit(0)
if nome == "herdr-app":
    if args[0] == "ls":
        print(json.dumps(conf.get("ls", {"spaces": []})))
        sys.exit(0)
    comando, argomenti = args[1], json.loads(args[2])
    if comando in conf.get("falliscono", []):
        print(json.dumps({"error": "no"}))
        sys.exit(1)
    if comando == "pane.split":
        vista(argomenti["argv"])
        print(json.dumps({"pane": "p9", "terminal": "t9"}))
    sys.exit(0)
'''

PANNELLO = {"terminal": "t5", "name": "brudr-spf", "state": "live",
            "labels": {"brudr.panel": "spf", "brudr.private": "1"}}
SCHEDA = {"terminal": "t5", "state": "live", "labels": {"herdr.space": "sp1", "herdr.tab": "tb1"}}
LS = {"spaces": [{"id": "sp1", "tabs": [{"id": "tb1", "terminals": [
    {"terminal": "t4", "pane": "p1"}, {"terminal": "t5", "pane": "p3"}]}]}]}


class Opener(unittest.TestCase):
    @patch("subprocess.run")
    def test_markdown_opens_in_obsidian_by_path_also_outside_a_vault(self, run):
        for name in ("/cartella con spazi/È $() #?&.MD", "/tmp/fuori-vault/nota.md", "/tmp/-trattino.markdown"):
            with self.subTest(name=name):
                OPENER["main"]([name])
                command, = run.call_args.args
                # One argv item, no URI: obsidian://open?path= answers "Vault not found" outside a vault.
                self.assertEqual(command, ["/usr/bin/open", "-a", "Obsidian", name])
                self.assertNotIn("obsidian://", " ".join(command))

    @patch("subprocess.run")
    def test_code_and_unknown_files_are_never_shell_code(self, run):
        for ext in ("py", "TS", "js", "css", "rs", "conf", "pdf"):
            with self.subTest(ext=ext):
                name = f"/tmp/-demo $(echo not-a-command).{ext}"
                OPENER["main"]([name])
                expected = ["/usr/bin/open"]
                if ext != "pdf":
                    expected += ["-a", "Zed"]
                run.assert_called_with([*expected, name])
        OPENER["main"](["/tmp/.env"])
        run.assert_called_with(["/usr/bin/open", "-a", "Zed", "/tmp/.env"])

    def test_previewer_does_not_block_on_a_named_pipe(self):
        with tempfile.TemporaryDirectory() as folder:
            fifo = Path(folder) / "pipe.json"
            os.mkfifo(fifo)
            self.assertIn(b"file regolari", OPENER["table"](fifo, "json"))

    def test_data_is_passed_to_viewer_on_stdin(self):
        with patch.dict(OPENER["main"].__globals__, {"table": lambda *_: b"tabella privata"}), \
                patch.dict(os.environ, {"HC_TERMINAL_ID": ""}):
            with patch("subprocess.run") as run:
                OPENER["main"](["/tmp/file.toml"])
        command, = run.call_args.args
        self.assertEqual(command[:4], ["/usr/bin/osascript", "-l", "JavaScript", "-e"])
        self.assertNotIn("tabella privata", command)
        self.assertEqual(run.call_args.kwargs, {"input": b"tabella privata"})

    @unittest.skipUnless(shutil.which("nu"), "Nushell not installed")
    def test_formats_with_real_nushell(self):
        samples = {"json": '{"answer": 42}', "jsonc": '{//comment\n"answer": 42}',
                   "toml": "answer = 42", "yaml": "answer: 42", "xml": "<answer>42</answer>"}
        with tempfile.TemporaryDirectory() as folder:
            for ext, text in samples.items():
                with self.subTest(ext=ext):
                    path = Path(folder) / f"test [name].{ext}"
                    path.write_text(text)
                    table = OPENER["table"](path, OPENER["DATA"][ext])
                    self.assertIn(b"answer", table)
                    self.assertIn(b"42", table)
                    self.assertNotIn(b"\x1b", table)
                    colori = OPENER["tabella"](path.read_bytes(), OPENER["DATA"][ext], colori=True, larghezza=40)
                    self.assertIn(b"\x1b[", colori, "the brudr view keeps Nushell's colors")
                    self.assertIn(b"answer", colori)

    def test_only_known_formats_reach_the_nushell_source(self):
        with patch("subprocess.run") as run:
            self.assertIn(b"Nushell non riesce", OPENER["tabella"](b"{}", "json; rm -rf ~"))
        run.assert_not_called()

    @patch("subprocess.run", side_effect=subprocess.TimeoutExpired("nu", 10))
    def test_timeout_does_not_leak_data(self, _run):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.json"
            path.write_text('"never included in an error"')
            self.assertIn(b"non disponibile", OPENER["table"](path, "json"))


@unittest.skipUnless(shutil.which("nu"), "Nushell not installed")
class Brudr(unittest.TestCase):
    """spf-apri in brudr, against fake hc, herdr-app and less."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="spf-apri-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.casa = self.tmp / "casa"
        bin_ = self.casa / "bin"
        bin_.mkdir(parents=True)
        finto = self.tmp / "finto"
        finto.write_text(FINTO)
        finto.chmod(0o755)
        for nome in ("hc", "herdr-app", "less", "open", "lsappinfo", "xattr"):
            (bin_ / nome).symlink_to(finto)
        self.bin = bin_
        self.log = self.tmp / "log.jsonl"
        self.conf = self.tmp / "conf.json"
        self.tmpdir = self.tmp / "privato"
        self.tmpdir.mkdir(mode=0o700)
        self.file = self.tmp / "dati segreti $(x).json"
        self.file.write_text('{"answer": 42, "lista": [1, 2, {"x": "FINTO_0000"}]}')
        self.finestre = []

    def apri(self, terminale, conf, file=None):
        self.conf.write_text(json.dumps(conf))
        env = {"HOME": str(self.casa), "HC_TERMINAL_ID": terminale, "TMPDIR": str(self.tmpdir),
               "FINTO_LOG": str(self.log), "FINTO_CONF": str(self.conf),
               "HERDR_APP_HOME": str(self.tmp / "app")}
        finestra = lambda path, fmt: self.finestre.append((path, fmt)) or 0
        finti = {"finestra": finestra, **{k: str(self.bin / k.lower()) for k in ("OPEN", "LSAPPINFO", "XATTR")}}
        with patch.dict(os.environ, env), patch.dict(OPENER["main"].__globals__, finti):
            return OPENER["main"]([str(file or self.file)])

    def terminale_mac(self, voci):
        """The open -a Terminal calls of the fakes' log."""
        return [v for v in voci if v["prog"] == "open" and v["argv"][:2] == ["-a", "Terminal"]]

    def ascolta_finestra(self):
        """A fake window socket at HERDR_APP_HOME; returns the lines it got."""
        cartella = self.tmp / "app"
        cartella.mkdir()
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(str(cartella / "herdr-app.sock"))
        server.listen()
        self.addCleanup(server.close)
        righe = []

        def servi():
            try:
                conn, _ = server.accept()
            except OSError:
                return
            with conn:
                righe.append(json.loads(conn.makefile().readline()))
                conn.sendall(b'{"ok":true}\n')
        threading.Thread(target=servi, daemon=True).start()
        return righe

    def voci(self, attendi=None, entro=15):
        """The fakes' log; with attendi, waits until a line matches it."""
        fine = time.monotonic() + entro
        while True:
            voci = [json.loads(r) for r in self.log.read_text().splitlines()] if self.log.exists() else []
            if attendi is None or any(attendi(v) for v in voci) or time.monotonic() > fine:
                return voci
            time.sleep(0.05)

    def comandi(self, voci, prog="herdr-app"):
        return [v["argv"] for v in voci if v["prog"] == prog]

    def test_nel_pannello_la_vista_prende_il_posto_di_superfile(self):
        self.assertEqual(self.apri("t5", {"record": {"t5": PANNELLO}}), 0)
        voci = self.voci(lambda v: v["prog"] == "herdr-app" and "pane.focus" in v["argv"]
                         and "brudr-spf" in v["argv"][2] and "vista" not in v["argv"][2])
        self.assertEqual(self.finestre, [], "no window in brudr")
        run, = [a for a in self.comandi(voci, "hc") if a[0] == "run"]
        self.assertEqual(run[:run.index("--")], ["run", "--bg", "--json", "--no-parent", "--no-notify", "--rm",
                                                  "--name", "brudr-spf-vista", "--label", "brudr.panel=spf-vista",
                                                  "--label", "brudr.private=1", "--cwd", str(self.casa)])
        argv = run[run.index("--") + 1:]
        self.assertEqual(argv[1:2] + argv[3:], ["--vista", "pannello"])
        self.assertTrue(argv[2].startswith(str(self.tmpdir) + "/spf-vista."), "the pipe is in the panel's TMPDIR")
        tutto = json.dumps([v["argv"] for v in voci if v["prog"] != "less"])
        self.assertNotIn("segreti", tutto, "the file's name and path never reach an argument")
        self.assertNotIn("FINTO_0000", tutto)
        finestra = [(a[1], json.loads(a[2])) for a in self.comandi(voci) if a[0] == "do"]
        self.assertEqual(finestra, [
            ("layout.select", {"stack": "panel-body", "child": "spf-vista"}),
            ("layout.show", {"id": "panel"}),
            ("pane.focus", {"terminal": "brudr-spf-vista"}),
            # q in less: Superfile again, with the keyboard.
            ("layout.select", {"stack": "panel-body", "child": "files"}),
            ("pane.focus", {"terminal": "brudr-spf"}),
        ])
        less, = [v for v in voci if v["prog"] == "less"]
        self.assertIn("Nushell · dati segreti $(x).json", less["testo"])
        self.assertIn("q torna a Superfile", less["testo"])
        self.assertIn("FINTO_0000", less["testo"])
        self.assertIn("\x1b[1;32m", less["testo"], "Nushell's colors reach less")
        self.assertIn("-R", less["argv"])
        self.assertEqual(less["env"], {"LESS": "", "LESSSECURE": "1", "LESSHISTFILE": "-"})
        self.assertEqual(list(self.tmpdir.iterdir()), [], "pipe and folder gone")

    def test_una_vista_rimasta_sotto_un_altro_pannello_lascia_il_posto(self):
        vecchia = {"name": "brudr-spf-vista", "state": "live",
                   "labels": {"brudr.panel": "spf-vista", "brudr.private": "1"}}
        self.assertEqual(self.apri("t5", {"record": {"t5": PANNELLO, "brudr-spf-vista": vecchia}}), 0)
        voci = self.voci(lambda v: v["prog"] == "less")
        hc = self.comandi(voci, "hc")
        self.assertLess(hc.index(["kill", "brudr-spf-vista"]), [a[0] for a in hc].index("run"))

    def test_un_terminale_altrui_col_nome_della_vista_non_si_tocca(self):
        altrui = {"name": "brudr-spf-vista", "state": "live", "labels": {}}
        self.apri("t5", {"record": {"t5": PANNELLO, "brudr-spf-vista": altrui}, "open_fallisce": True})
        self.assertEqual(len(self.finestre), 1)
        self.assertNotIn("kill", json.dumps(self.comandi(self.voci(), "hc")))

    def test_senza_blocco_della_vista_terminale_mac_e_vista_chiusa(self):
        """Another layout shown (no spf-vista block): the view ends, Terminal shows the table."""
        self.assertEqual(self.apri("t5", {"record": {"t5": PANNELLO}, "falliscono": ["layout.select"]}), 0)
        voci = self.voci(lambda v: v["prog"] == "less")
        self.assertEqual(self.finestre, [])
        self.assertIn(["kill", "brudr-spf-vista"], self.comandi(voci, "hc"))
        self.assertEqual(len(self.terminale_mac(voci)), 1)
        self.assertEqual([a for a in self.comandi(voci) if a[:2] == ["do", "pane.split"]], [],
                         "the panel's table never goes to an unlabeled terminal of the core")

    def test_hc_che_non_parte_terminale_mac_poi_finestra(self):
        self.apri("t5", {"record": {"t5": PANNELLO}, "run_fallisce": True})
        self.assertEqual(len(self.terminale_mac(self.voci(lambda v: v["prog"] == "less"))), 1)
        self.assertEqual(self.finestre, [])
        self.assertNotIn("do", [a[0] for a in self.comandi(self.voci())])
        self.log.unlink()
        self.apri("t5", {"record": {"t5": PANNELLO}, "run_fallisce": True, "open_fallisce": True})
        self.assertEqual(len(self.finestre), 1, "Terminal failing too: the plain window")
        self.assertEqual(list(self.tmpdir.iterdir()), [], "script, pipe and folder gone")

    def test_in_una_scheda_la_vista_apre_un_terminale_accanto(self):
        self.assertEqual(self.apri("t5", {"record": {"t5": SCHEDA}, "ls": LS}), 0)
        voci = self.voci(lambda v: v["prog"] == "less")
        time.sleep(0.3)  # the view ends after less: nothing more should come
        voci = self.voci()
        self.assertEqual(self.finestre, [])
        self.assertEqual(self.comandi(voci, "hc"), [["get", "--json", "t5"]], "no hc run: the window starts it")
        split = [json.loads(a[2]) for a in self.comandi(voci) if a[:2] == ["do", "pane.split"]]
        self.assertEqual(len(split), 1)
        self.assertEqual((split[0]["direction"], split[0]["pane"]), ("right", "p3"))
        self.assertEqual(split[0]["argv"][1::2], ["--vista", "accanto"])
        self.assertNotIn("segreti", json.dumps(split))
        less, = [v for v in voci if v["prog"] == "less"]
        self.assertIn("q chiude", less["testo"])
        self.assertIn("FINTO_0000", less["testo"])
        self.assertEqual([a for a in self.comandi(voci) if a[:2] == ["do", "layout.select"]], [],
                         "q closes the new terminal, nothing to select")

    def test_un_altro_terminale_privato_tiene_la_finestra(self):
        """The Private shell: the plain window as before, nothing through the core or Terminal."""
        privato = {"terminal": "t6", "labels": {"brudr.panel": "privato", "brudr.private": "1"}}
        self.apri("t6", {"record": {"t6": privato}, "ls": LS, "app": ["personal.herdr.app"]})
        self.assertEqual(len(self.finestre), 1)
        self.assertEqual([(v["prog"], v["argv"][0]) for v in self.voci()], [("hc", "get")])

    def test_fuori_da_brudr_con_brudr_aperto_un_terminale_di_brudr(self):
        """Superfile in Terminal or iTerm, brudr open: a new pane in brudr's shown tab, brudr in front."""
        alzata = self.ascolta_finestra()
        self.assertEqual(self.apri("", {"app": ["personal.herdr.app"]}), 0)
        voci = self.voci(lambda v: v["prog"] == "less")
        self.assertEqual(self.finestre, [])
        self.assertEqual(self.comandi(voci, "hc"), [], "no hc: the window starts it")
        split = [json.loads(a[2]) for a in self.comandi(voci) if a[:2] == ["do", "pane.split"]]
        self.assertEqual(len(split), 1)
        self.assertNotIn("pane", split[0], "the focused pane of the shown tab")
        self.assertEqual(split[0]["direction"], "right")
        self.assertEqual(split[0]["argv"][1::2], ["--vista", "accanto"])
        self.assertNotIn("segreti", json.dumps(split))
        self.assertEqual(alzata, [{"raise": True}], "what a second launch asks: the window to the front")
        self.assertIn(["-b", "personal.herdr.app"], self.comandi(voci, "open"))
        self.assertEqual(self.terminale_mac(voci), [])
        less, = [v for v in voci if v["prog"] == "less"]
        self.assertIn("q chiude", less["testo"])
        self.assertIn("FINTO_0000", less["testo"])
        self.assertEqual(list(self.tmpdir.iterdir()), [], "pipe and folder gone")

    def test_porta_davanti_non_avvia_app_ferme(self):
        """open -b only for an app that runs: open would start a stopped one."""
        self.apri("", {"app": ["dev.herdr.app"]})
        voci = self.voci(lambda v: v["prog"] == "less")
        self.assertEqual(self.comandi(voci, "open"), [["-b", "dev.herdr.app"]])
        self.log.unlink()
        self.apri("", {"app": []})
        voci = self.voci(lambda v: v["prog"] == "less")
        self.assertEqual(self.comandi(voci, "open"), [])

    def test_fuori_da_brudr_senza_brudr_una_finestra_di_terminale(self):
        """brudr closed: a new window of macOS Terminal runs the view; q closes it."""
        self.assertEqual(self.apri("", {"falliscono": ["pane.split"]}), 0)
        voci = self.voci(lambda v: v["prog"] == "less")
        self.assertEqual(self.finestre, [])
        aperta, = self.terminale_mac(voci)
        script = aperta["script"]
        self.assertTrue(aperta["argv"][2].startswith(str(self.tmpdir) + "/spf-vista."))
        self.assertTrue(aperta["argv"][2].endswith("/vista.command"))
        self.assertEqual(aperta["modo"], "0o700")
        self.assertTrue(script.startswith("#!/bin/sh\nexec "))
        self.assertIn("--vista", script)
        self.assertTrue(script.rstrip().endswith(" finestra"))
        tutto = json.dumps([v for v in voci if v["prog"] != "less"])
        self.assertNotIn("segreti", tutto, "neither the script nor an argument names the file")
        self.assertNotIn("FINTO_0000", tutto)
        self.assertIn(["-d", "com.apple.quarantine", aperta["argv"][2]], self.comandi(voci, "xattr"))
        less, = [v for v in voci if v["prog"] == "less"]
        self.assertIn("q chiude", less["testo"])
        self.assertIn("FINTO_0000", less["testo"])
        self.assertIn("\x1b[1;32m", less["testo"])
        self.assertEqual(list(self.tmpdir.iterdir()), [], "script, pipe and folder gone")

    def test_core_che_non_risponde_terminale_mac_senza_brudr(self):
        """HC_TERMINAL_ID the core does not know: nothing through the core or the window."""
        self.assertEqual(self.apri("t5", {"record": {}, "app": ["personal.herdr.app"]}), 0)
        voci = self.voci(lambda v: v["prog"] == "less")
        self.assertEqual(len(self.terminale_mac(voci)), 1)
        self.assertEqual(self.comandi(voci), [])

    def test_tutto_fallisce_la_finestra(self):
        self.apri("", {"falliscono": ["pane.split"], "open_fallisce": True})
        self.assertEqual(len(self.finestre), 1)
        self.assertEqual(list(self.tmpdir.iterdir()), [])

    def test_terminale_senza_pane_un_terminale_di_brudr(self):
        """A core terminal brudr shows in no tab: the focused pane of the shown tab."""
        self.assertEqual(self.apri("t7", {"record": {"t7": SCHEDA | {"terminal": "t7"}}, "ls": LS}), 0)
        voci = self.voci(lambda v: v["prog"] == "less")
        split, = [json.loads(a[2]) for a in self.comandi(voci) if a[:2] == ["do", "pane.split"]]
        self.assertNotIn("pane", split)
        self.assertEqual(self.finestre, [])

    def test_file_troppo_grande_il_messaggio_nella_vista(self):
        grande = self.tmp / "grande.json"
        grande.write_bytes(b"[" + b"1," * (600 * 1024) + b"1]")
        self.apri("t5", {"record": {"t5": PANNELLO}}, file=grande)
        less, = [v for v in self.voci(lambda v: v["prog"] == "less") if v["prog"] == "less"]
        self.assertIn("supera 1 MiB", less["testo"])
        self.assertEqual(self.finestre, [])

    def test_la_finestra_di_terminale_si_chiude_dopo_q(self):
        """Only the view's tty, as an argument of the AppleScript, never inside it."""
        chiudi = OPENER["chiudi_finestra"]
        with patch("subprocess.Popen") as popen, patch("os.ttyname", return_value="/dev/ttys012"):
            chiudi()
        argv, = popen.call_args.args
        self.assertEqual(argv[:2], ["/usr/bin/osascript", "-e"])
        self.assertEqual(argv[3:], ["/dev/ttys012"])
        self.assertNotIn("ttys012", argv[2])
        self.assertIn('tell application "Terminal"', argv[2])
        self.assertIn("not busy", argv[2])
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        for strano in ('/dev/ttys1" & do shell script "x', "/dev/null"):
            with self.subTest(tty=strano), patch("subprocess.Popen") as popen, \
                    patch("os.ttyname", return_value=strano):
                chiudi()
                popen.assert_not_called()
        with patch("subprocess.Popen") as popen, patch("os.ttyname", side_effect=OSError):
            chiudi()
        popen.assert_not_called()

    def test_vista_senza_dati_dice_perche(self):
        """A pipe nobody writes: after the wait, a message, and back to Superfile on q."""
        fifo = self.tmpdir / "dati"
        os.mkfifo(fifo)
        self.conf.write_text("{}")
        env = {**os.environ, "HOME": str(self.casa), "FINTO_LOG": str(self.log), "FINTO_CONF": str(self.conf)}
        # The wait is a constant of the program: run the view with a short one.
        codice = subprocess.run([sys.executable, "-c", "import runpy, sys; g = runpy.run_path(sys.argv[1]);"
                                 "g['vista'].__globals__['ATTESA'] = 1;"
                                 "sys.exit(g['vista'](sys.argv[2], 'pannello'))", str(QUI / "spf-apri"), str(fifo)],
                                env=env, capture_output=True, timeout=30).returncode
        self.assertEqual(codice, 0)
        less, = [v for v in self.voci() if v["prog"] == "less"]
        self.assertIn("non ha ricevuto il file", less["testo"])
        self.assertFalse(fifo.exists())


if __name__ == "__main__":
    unittest.main()
