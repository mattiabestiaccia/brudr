#!/usr/bin/env python3
"""Tests of the brudr side panels: brudr-pannello, crea-layout and the pannelli mod.

Usage: python3 personal/pannelli/test_pannelli.py
No Herdr, no core, no terminal: brudr-pannello runs in its test mode
(BRUDR_PANNELLO_PROVA=1), Neovim runs headless with a fake config and fake
state folders, the layout goes through brudr's real layout reader (src/layout.rs,
built offline with the repository's Cargo.lock), the mod runs in node against a
fake brudr and a fake core (prova_mod.mjs). Fake secrets only.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

QUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(QUI, "..", ".."))
PANNELLO = os.path.join(QUI, "brudr-pannello")
CREA = os.path.join(QUI, "crea-layout")
MODS = os.path.join(QUI, "mods", "pannelli")
MOD = os.path.join(MODS, "main.js")
BLOCCHI = os.path.join(MODS, "blocchi.js")
PROVA_MOD = os.path.join(QUI, "prova_mod.mjs")
TRASPARENTE = os.path.join(REPO, "personal", "transparency", "herdr-transparent.json")
SEGRETO = "FINTO_TOKEN_0000_non_vero"
PRIVATI = {"spf", "nvim", "privato"}
TIPI = ["spf", "nvim", "hunk", "quota", "privato"]


class Cartella(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="pannelli-"))
        self.bin = os.path.join(self.tmp, "bin")
        self.dati = os.path.join(self.tmp, "dati")
        self.ptmp = os.path.join(self.tmp, "ptmp")
        os.makedirs(self.bin)
        os.makedirs(self.dati)
        os.symlink(PANNELLO, os.path.join(self.bin, "nvim"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def env(self, **extra):
        e = {k: v for k, v in os.environ.items() if not k.startswith("BRUDR_")}
        e.update(BRUDR_PANNELLO_PROVA="1", BRUDR_PANNELLI_BIN=self.bin, BRUDR_PANNELLI_TMP=self.ptmp,
                 BRUDR_PANNELLI_DATI=self.dati, BRUDR_SPF_BASE=os.path.join(self.tmp, "spf-base.toml"))
        e.update(extra)
        return e

    def pannello(self, *args, cwd=None, **extra):
        r = subprocess.run([PANNELLO, *args], env=self.env(**extra), cwd=cwd or self.tmp,
                           capture_output=True, text=True, timeout=30)
        return r.returncode, r.stdout, r.stderr

    @staticmethod
    def campo(out, nome):
        m = re.search(r"^%s: (.*)$" % re.escape(nome), out, re.M)
        return m.group(1) if m else ""


def repository(d):
    subprocess.run(["git", "init", "-q", d], check=True, capture_output=True)


class BrudrPannello(Cartella):
    def test_ogni_tipo_parte(self):
        repository(self.tmp)
        attesi = {"spf": "esegue: spf -c ", "nvim": "esegue: %s/nvim" % self.bin, "hunk": "esegue: hunk diff --watch",
                  "quota": "--tui", "privato": "esegue: fish --private -C "}
        for tipo in TIPI:
            c, out, err = self.pannello(tipo)
            self.assertEqual(c, 0, (tipo, err))
            self.assertIn(attesi[tipo], out, tipo)
            self.assertEqual(self.campo(out, "privato"), "1" if tipo in PRIVATI else "0", tipo)

    def test_privati_hanno_tmp_proprio_editor_privato_e_path(self):
        for tipo in sorted(PRIVATI):
            c, out, _ = self.pannello(tipo)
            self.assertEqual(c, 0)
            tmpdir = self.campo(out, "TMPDIR")
            self.assertTrue(tmpdir.startswith(self.ptmp + "/%s." % tipo), (tipo, tmpdir))
            self.assertFalse(os.path.exists(tmpdir), "the private TMPDIR must go when the panel ends")
            self.assertEqual(self.campo(out, "EDITOR"), "nvim")
            self.assertEqual(self.campo(out, "PATH").split(":")[0], self.bin, tipo)
        self.assertEqual(oct(os.stat(self.ptmp).st_mode & 0o777), "0o700")

    def test_non_privati_senza_tmp_ne_path_privato(self):
        for tipo in ("hunk", "quota"):
            _, out, _ = self.pannello(tipo)
            self.assertEqual(self.campo(out, "TMPDIR"), "")
            self.assertNotIn(self.bin, self.campo(out, "PATH"))

    def test_shell_privata_rimette_il_nvim_privato_dopo_config_fish(self):
        _, out, _ = self.pannello("privato")
        self.assertIn("fish --private -C set -gx PATH $BRUDR_PANNELLI_BIN $PATH", out)

    def test_tipo_sconosciuto(self):
        c, _, err = self.pannello("boh")
        self.assertEqual(c, 64)
        self.assertIn("usage", err)

    def test_hunk_segue_il_file_della_cartella(self):
        repository(self.tmp)
        _, out, _ = self.pannello("hunk")
        self.assertEqual(self.campo(out, "cartella"), self.tmp)
        altra = os.path.join(self.tmp, "repo")
        os.makedirs(altra)
        with open(os.path.join(self.dati, "hunk.dir"), "w") as f:
            f.write(altra)
        _, out, _ = self.pannello("hunk")
        self.assertEqual(self.campo(out, "cartella"), altra)
        with open(os.path.join(self.dati, "hunk.dir"), "w") as f:
            f.write(os.path.join(self.tmp, "non-esiste"))
        _, out, _ = self.pannello("hunk")
        self.assertEqual(self.campo(out, "cartella"), self.tmp)

    def test_hunk_fuori_da_git_una_riga_e_niente_hunk(self):
        _, out, _ = self.pannello("hunk")
        self.assertIn("Nessun repository Git in %s." % self.tmp, out)
        self.assertNotIn("esegue: hunk", out)

    def test_hunk_fuori_da_git_non_riparte_a_vuoto(self):
        """The real loop (not the test mode): outside Git, hunk never starts and the line shows once;
        when the space moves to a repository, hunk starts there."""
        chiamate = os.path.join(self.tmp, "chiamate")
        # ~/bin comes first in the program's PATH: a fake hunk there.
        casa = os.path.join(self.tmp, "casa")
        os.makedirs(os.path.join(casa, "bin"))
        with open(os.path.join(casa, "bin", "hunk"), "w") as f:
            f.write('#!/bin/sh\necho "$PWD" >> %s\nsleep 30\n' % chiamate)
        os.chmod(os.path.join(casa, "bin", "hunk"), 0o755)
        fuori = os.path.join(self.tmp, "fuori")
        os.makedirs(fuori)
        env = self.env(BRUDR_PANNELLO_PROVA="", BRUDR_PANNELLO_TTY="/dev/null", HOME=casa)
        uscita = os.path.join(self.tmp, "uscita")
        with open(uscita, "w") as out:
            pr = subprocess.Popen([PANNELLO, "hunk"], env=env, cwd=fuori, stdout=out, stderr=subprocess.STDOUT,
                                  stdin=subprocess.DEVNULL, start_new_session=True)
        try:
            import time
            time.sleep(5)
            self.assertFalse(os.path.exists(chiamate), "hunk must not start outside a Git repository")
            self.assertEqual(open(uscita).read().count("Nessun repository Git in %s." % fuori), 1)
            self.assertNotIn("ended right away", open(uscita).read())
            repo = os.path.join(self.tmp, "repo")
            repository(repo)
            with open(os.path.join(self.dati, "hunk.dir"), "w") as f:
                f.write(repo)
            for _ in range(20):
                if os.path.exists(chiamate):
                    break
                time.sleep(0.5)
            self.assertEqual(open(chiamate).read().split(), [repo])
            self.assertNotIn("ended right away", open(uscita).read())
        finally:
            os.killpg(pr.pid, 9)
            pr.wait()

    def test_tasto_non_scambia_le_risposte_del_terminale(self):
        """The wait for a key: replies to a program's queries and mouse reports are not keys."""
        casi = {
            "": "nessun tasto",
            "x": "tasto",
            "\n": "tasto",
            "\x1b[?62;22c": "nessun tasto",                                # DA1 reply
            "\x1b[?62;22c\x1b]11;rgb:0000/0000/0000\x1b\\": "nessun tasto",  # DA1 and background color
            "\x1b[<35;10;5M\x1b[<35;11;5M": "nessun tasto",                # mouse moves (SGR)
            "\x1b[?1u": "nessun tasto",                                    # kitty keyboard reply
        }
        for i, (dentro, atteso) in enumerate(casi.items()):
            p = os.path.join(self.tmp, "tty%d" % i)
            with open(p, "w") as f:
                f.write(dentro)
            c, out, err = self.pannello("hunk", BRUDR_PANNELLO_PROVA="tasto", BRUDR_PANNELLO_TTY=p)
            self.assertEqual((c, out.strip()), (0, atteso), (dentro, err))

    def test_link_nvim_aggiunge_le_opzioni_private(self):
        r = subprocess.run([os.path.join(self.bin, "nvim"), "file.txt"], env=self.env(), capture_output=True,
                           text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(" -n -i NONE ", r.stdout)
        self.assertIn("noundofile noswapfile nobackup nowritebackup", r.stdout)
        self.assertTrue(r.stdout.rstrip().endswith(" file.txt"))
        vero = r.stdout.split()[1]
        self.assertNotEqual(os.path.dirname(vero), self.bin, "the link must not call itself")


class ConfigurazioneSpf(Cartella):
    def config(self, base):
        with open(os.path.join(self.tmp, "spf-base.toml"), "w") as f:
            f.write(base)
        c, out, err = self.pannello("spf")
        self.assertEqual(c, 0, err)
        return "\n".join(r[len("spf.toml| "):] for r in out.splitlines() if r.startswith("spf.toml| "))

    def test_chiavi_del_pannello_al_posto_di_quelle_dell_utente(self):
        base = ('editor = "code"\nsidebar_width = 20\ndefault_open_file_preview = true\nshow_image_preview = true\n'
                'theme = "poimandres"\nzoxide_support = true\n[open_with]\ntoml = "nvim"\n')
        testo = self.config(base)
        for chiave, valore in (("sidebar_width", "0"), ("default_open_file_preview", "false"),
                               ("show_image_preview", "false"), ("zoxide_support", "false"), ("editor", '""'),
                               ("auto_check_update", "false"), ("ignore_missing_fields", "true")):
            righe = [r for r in testo.splitlines() if re.match(r"\s*%s\s*=" % chiave, r)]
            self.assertEqual(righe, ["%s = %s" % (chiave, valore)], chiave)
        self.assertIn('theme = "poimandres"', testo)
        self.assertLess(testo.index("sidebar_width = 0"), testo.index("[open_with]"), "panel keys must be top level")
        self.assertIn('toml = "nvim"', testo)

    def test_senza_config_dell_utente(self):
        testo = self.config("")
        os.remove(os.path.join(self.tmp, "spf-base.toml"))
        c, out, _ = self.pannello("spf")
        self.assertEqual(c, 0)
        self.assertIn("spf.toml| sidebar_width = 0", out)
        self.assertIn("ignore_missing_fields = true", testo)


@unittest.skipUnless(shutil.which("nvim"), "nvim not installed")
class NeovimSenzaTracce(Cartella):
    """The private nvim, with a config that turns undo, swap and backup on (as LazyVim does)."""

    def test_nessun_undo_swap_shada_backup(self):
        conf = os.path.join(self.tmp, "config", "nvim")
        os.makedirs(conf)
        with open(os.path.join(conf, "init.lua"), "w") as f:
            f.write('vim.opt.undofile = true\nvim.opt.swapfile = true\nvim.opt.backup = true\n'
                    'vim.opt.backupdir = vim.fn.stdpath("state") .. "/backup//"\n')
        lavoro = os.path.join(self.tmp, "lavoro")
        os.makedirs(lavoro)
        segreto = os.path.join(lavoro, "finto.txt")
        with open(segreto, "w") as f:
            f.write("%s=prima\n" % SEGRETO)
        stato = os.path.join(self.tmp, "state")
        env = self.env(BRUDR_PANNELLO_PROVA="", XDG_CONFIG_HOME=os.path.join(self.tmp, "config"),
                       XDG_STATE_HOME=stato, XDG_DATA_HOME=os.path.join(self.tmp, "data"))
        r = subprocess.run([os.path.join(self.bin, "nvim"), "--headless", segreto, "-c", "normal! o%s=dopo" % SEGRETO,
                            "-c", "w", "-c", "qa!"], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("=dopo", open(segreto).read())
        trovati = []
        for radice, _, nomi in os.walk(self.tmp):
            for n in nomi:
                p = os.path.join(radice, n)
                if p == segreto:
                    continue
                with open(p, "rb") as f:
                    if SEGRETO.encode() in f.read():
                        trovati.append(p)
        self.assertEqual(trovati, [], "the fake secret was copied to disk")
        self.assertFalse(os.path.exists(os.path.join(stato, "nvim", "undo")))
        self.assertFalse(os.path.exists(os.path.join(stato, "nvim", "shada")))


class Layout(unittest.TestCase):
    def crea(self, sorgente):
        d = tempfile.mkdtemp(prefix="pannelli-layout-")
        self.addCleanup(shutil.rmtree, d, True)
        src, out = os.path.join(d, "src.json"), os.path.join(d, "brudr-pannelli.json")
        with open(src, "w") as f:
            json.dump(sorgente, f)
        r = subprocess.run([sys.executable, CREA, src, out], capture_output=True, text=True)
        return r, out, src

    def test_stack_dei_pannelli(self):
        sorgente = json.load(open(TRASPARENTE))
        r, out, src = self.crea(sorgente)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.load(open(src)), sorgente, "the source is only read")
        d = json.load(open(out))
        self.assertEqual(d["title"], "brudr pannelli")
        self.assertNotIn("cloned_from", d)
        self.assertEqual(d["background_mode"], sorgente["background_mode"])

        def trova(n, id_):
            if n.get("id") == id_:
                return n
            for c in n.get("children", []):
                f = trova(c, id_)
                if f:
                    return f
        body = trova(d, "panel-body")
        self.assertNotIn("header", body, "the panel buttons are in the tab bar, not over the panel")
        schede = trova(d, "tabs")
        self.assertEqual(schede["content"], {"mod": "pannelli"})
        self.assertNotIn('"mod": "tabs"', json.dumps(d))
        figli = {c["id"]: c for c in body["children"]}
        self.assertEqual(list(figli), ["files", "neovim", "changes", "quota", "privato"])
        self.assertEqual({k: v["content"]["terminal"] for k, v in figli.items()},
                         {"files": "brudr-spf", "neovim": "brudr-nvim", "changes": "brudr-hunk",
                          "quota": "brudr-quota", "privato": "brudr-privato"})
        self.assertEqual([k for k, v in figli.items() if "background" in v], [], "Private has the panel's gray too")
        panel = trova(d, "panel")
        self.assertIsNotNone(panel)
        self.assertTrue(panel and panel["hidden"], "the panel column keeps its place and look")

    def test_senza_panel_body_rifiuta(self):
        r, out, _ = self.crea({"id": "root", "type": "row", "children": []})
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(out))

    def test_senza_barra_delle_schede_rifiuta(self):
        r, out, _ = self.crea({"id": "root", "type": "row", "children": [{"id": "panel-body", "type": "stack", "children": []}]})
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(out))

    @unittest.skipUnless(shutil.which("cargo") and shutil.which("node"), "cargo or node not installed")
    def test_lettore_vero_dei_layout(self):
        """src/layout.rs and src/layout_sync.rs, built apart with serde only (no GPUI).

        They read the layout made from herdr-transparent; after an ended Neovim
        block leaves the layout in memory, save() (without_clicks) writes a file
        without it (the cause of the lost Neovim panel); the mod's repair of that
        file reads back with the block, and the clicks kept on reload keep it.
        """
        r, out, _ = self.crea(json.load(open(TRASPARENTE)))
        self.assertEqual(r.returncode, 0, r.stderr)
        crate = tempfile.mkdtemp(prefix="pannelli-crate-")
        self.addCleanup(shutil.rmtree, crate, True)
        os.makedirs(os.path.join(crate, "src"))
        os.symlink(os.path.join(REPO, "defaults"), os.path.join(crate, "defaults"))
        shutil.copy(os.path.join(REPO, "Cargo.lock"), os.path.join(crate, "Cargo.lock"))
        with open(os.path.join(crate, "Cargo.toml"), "w") as f:
            f.write('[package]\nname = "pannelli-layout-check"\nversion = "0.0.0"\nedition = "2024"\n'
                    '[dependencies]\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n')
        moduli = "".join('#[path = %s] mod %s;\n' % (json.dumps(os.path.join(REPO, "src", n + ".rs")), n)
                         for n in ("layout", "layout_sync", "persist"))
        # A binary, not a test: layout.rs's own tests need the whole app.
        with open(os.path.join(crate, "src", "main.rs"), "w") as f:
            f.write("#![allow(dead_code)]\n" + moduli + r'''
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let text = std::fs::read_to_string(&args[1]).unwrap();
    let n: layout::Node = serde_json::from_str(&text).unwrap();
    // The panel shows Neovim; its terminal ends: terminal_ended drops the block.
    let mut now = n.clone();
    assert!(now.select("panel-body", "neovim"));
    now.find_mut("panel").unwrap().hidden = false;
    assert!(now.remove_slot("neovim").is_some());
    // What save() writes, and switch_layout saves before it loads.
    let saved = layout_sync::without_clicks(&n, &now);
    assert!(saved != n && saved.find("neovim").is_none(), "save writes the layout without the ended block");
    std::fs::write(&args[2], layout_sync::text_of(&saved)).unwrap();
    // The file the mod mended (node, blocchi.js ripara) reads back with the block.
    let status = std::process::Command::new("node").arg(&args[3]).arg(&args[2]).status().unwrap();
    assert!(status.success(), "ripara");
    let mended: layout::Node = serde_json::from_str(&std::fs::read_to_string(&args[2]).unwrap()).unwrap();
    assert_eq!(mended.find("neovim").and_then(layout::Node::terminal), Some("brudr-nvim"));
    let mut shown = mended.clone();
    layout_sync::State::between(&saved, &now).apply(&mut shown);
    assert_eq!(shown.find("neovim").and_then(layout::Node::terminal), Some("brudr-nvim"), "clicks kept on reload keep the block");
    assert!(shown.select("panel-body", "neovim"), "layout.select finds the block again");
    println!("save ok");
    for (id, name) in [("files", "brudr-spf"), ("neovim", "brudr-nvim"), ("changes", "brudr-hunk"), ("quota", "brudr-quota"), ("privato", "brudr-privato")] {
        assert_eq!(n.find(id).and_then(layout::Node::terminal), Some(name), "{id}");
    }
    let v = serde_json::to_value(n.find("privato").unwrap()).unwrap();
    assert!(v.get("background").is_none(), "{v}");
    let tabs = serde_json::to_value(n.find("tabs").unwrap()).unwrap();
    assert_eq!(tabs["content"]["mod"], "pannelli", "{tabs}");
    println!("layout ok");
}
''')
        ripara = os.path.join(crate, "ripara.mjs")
        with open(ripara, "w") as f:
            f.write('import fs from "node:fs";\nimport { ripara } from %s;\n'
                    'const p = process.argv[2], r = ripara(fs.readFileSync(p, "utf8"), ["neovim"]);\n'
                    'if (r.errore || r.aggiunti.join() !== "neovim") process.exit(1);\n'
                    'fs.writeFileSync(p, r.testo);\n' % json.dumps(pathlib_url(BLOCCHI)))
        salvato = os.path.join(crate, "salvato.json")
        env = dict(os.environ, CARGO_TARGET_DIR=os.path.join(tempfile.gettempdir(), "pannelli-layout-target"))
        r = subprocess.run(["cargo", "run", "-q", "--offline", "--manifest-path", os.path.join(crate, "Cargo.toml"),
                            "--", out, salvato, ripara], env=env, capture_output=True, text=True, timeout=900)
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        self.assertIn("layout ok", r.stdout)
        self.assertIn("save ok", r.stdout)


def pathlib_url(p):
    import pathlib
    return pathlib.Path(p).as_uri()


def node(codice, *args):
    """Runs an ES module given as text; returns its stdout parsed as JSON."""
    r = subprocess.run(["node", "--input-type=module", "-e", codice, *args], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


class ModPannelli(unittest.TestCase):
    def setUp(self):
        self.js = open(MOD).read()
        self.blocchi = open(BLOCCHI).read()

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_sintassi(self):
        d = tempfile.mkdtemp(prefix="pannelli-mod-")
        self.addCleanup(shutil.rmtree, d, True)
        for f in (MOD, BLOCCHI):
            p = os.path.join(d, os.path.basename(f).replace(".js", ".mjs"))
            shutil.copy(f, p)
            r = subprocess.run(["node", "--check", p], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_stessi_pannelli_della_mod_del_layout_e_del_programma(self):
        mod = re.findall(r'\{ child: "(\w+)", tipo: "(\w+)", nome: "[^"]+", privato: (true|false)', self.blocchi)
        self.assertEqual([(c, t) for c, t, _ in mod],
                         [("files", "spf"), ("neovim", "nvim"), ("changes", "hunk"), ("quota", "quota"), ("privato", "privato")])
        self.assertEqual({t for _, t, p in mod if p == "true"}, PRIVATI)
        programma = open(PANNELLO).read()
        self.assertIn("spf|nvim|privato) privato=1", programma)
        self.assertIn("hunk|quota) privato=0", programma)

    def test_terminali_privati_dalla_nascita_e_senza_keep(self):
        self.assertIn('args.push("--label", `${PRIVATE}=1`)', self.js)
        self.assertIn('const PANEL = "brudr.panel", PRIVATE = "brudr.private"', self.js)
        self.assertIn('"--rm"', self.js)
        self.assertNotIn("--keep", self.js)
        self.assertNotIn("--listen", self.js + open(PANNELLO).read())
        self.assertIn("`${home()}/bin/brudr-pannello`", self.js)

    def test_solo_hunk_segue_lo_spazio(self):
        segue = re.findall(r'tipo: "(\w+)"[^}]*segue: true', self.blocchi)
        self.assertEqual(segue, ["hunk"])

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_blocchi_della_mod_uguali_a_quelli_di_crea_layout(self):
        """The blocks the mod puts back are the ones crea-layout writes."""
        mod = node('import { PANNELLI, blocco } from %s; console.log(JSON.stringify(PANNELLI.map(blocco)));'
                   % json.dumps(pathlib_url(BLOCCHI)))
        r = subprocess.run([sys.executable, "-c", "import importlib.machinery as m; c = m.SourceFileLoader('c', %r).load_module();"
                            "import json; print(json.dumps(c.stack()['children']))" % CREA], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(mod, json.loads(r.stdout))

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_ripara_rimette_i_blocchi_al_loro_posto(self):
        d = {"id": "root", "type": "row", "children": [{"id": "panel", "type": "column", "hidden": True, "children": [
            {"id": "panel-body", "type": "stack", "active": "files", "children": [
                {"id": "files", "type": "block", "content": {"terminal": "brudr-spf"}},
                {"id": "mio", "type": "block", "content": {"terminal": "altro"}},
                {"id": "quota", "type": "block", "content": {"terminal": "brudr-quota"}}]}]}]}
        testo = json.dumps(d, indent=2) + "\n"
        out = node('import { ripara } from %s; const t = process.argv[1];'
                   'const a = ripara(t, ["neovim", "privato"]), b = ripara(t, ["files"]), c = ripara(b.testo, ["files"]);'
                   'console.log(JSON.stringify({ a, b, c, rotto: ripara("{", ["files"]), senza: ripara("{}", ["files"]) }));'
                   % json.dumps(pathlib_url(BLOCCHI)), testo)
        a = json.loads(out["a"]["testo"])
        figli = a["children"][0]["children"][0]["children"]
        self.assertEqual([c["id"] for c in figli], ["files", "neovim", "mio", "quota", "privato"])
        self.assertEqual(figli[1], {"id": "neovim", "type": "block", "content": {"terminal": "brudr-nvim"}})
        self.assertNotIn("background", figli[4])
        self.assertEqual(out["a"]["aggiunti"], ["neovim", "privato"])
        self.assertEqual(a["children"][0]["hidden"], True, "the rest of the file stays")
        # Nothing missing in the file: only the final newline changes, so brudr reads it again.
        self.assertEqual(out["b"]["aggiunti"], [])
        self.assertEqual(out["b"]["testo"], testo + "\n")
        self.assertNotEqual(out["c"]["testo"], out["b"]["testo"])
        self.assertEqual(json.loads(out["c"]["testo"]), d)
        self.assertIn("errore", out["rotto"])
        self.assertIn("errore", out["senza"])

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_neovim_torna_dopo_la_chiusura(self):
        """The sequence of the bug: Neovim shown, its terminal killed, a new one, a click on Neovim."""
        d = tempfile.mkdtemp(prefix="pannelli-seq-")
        self.addCleanup(shutil.rmtree, d, True)
        layout = os.path.join(d, "brudr-pannelli.json")
        r = subprocess.run([sys.executable, CREA, TRASPARENTE, layout], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = subprocess.run(["node", PROVA_MOD, MODS, layout], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        esiti = json.loads(r.stdout)
        tutti = ["files", "neovim", "changes", "quota", "privato"]
        # brudr saves the layout before the mod looks, or not yet: same end.
        for caso in ("salvaPrima", "senzaSalvare", "fileSenzaNeovim"):
            prima, dopo = esiti[caso]["prima"], esiti[caso]["dopo"]
            if caso == "fileSenzaNeovim":
                self.assertNotIn("neovim", prima["blocchiSuDisco"])
                self.assertFalse(prima["visibile"])
            else:
                self.assertEqual((prima["attivo"], prima["visibile"], prima["falliti"]), ("neovim", True, []), caso)
                # Neovim comes back by itself, with a new terminal; a click hides it like Files did.
                chiusura = esiti[caso]["dopoChiusura"]
                self.assertEqual((chiusura["blocchi"], chiusura["attivo"], chiusura["visibile"], chiusura["falliti"]),
                                 (tutti, "neovim", True, []), caso)
                self.assertEqual(esiti[caso]["nascosto"]["visibile"], False, caso)
            self.assertEqual(dopo["falliti"], [], caso)
            self.assertEqual(dopo["avvisi"], [], caso)
            self.assertEqual(dopo["blocchi"], tutti, caso)
            self.assertEqual(dopo["blocchiSuDisco"], tutti, caso)
            self.assertEqual(dopo["neovimSuDisco"], {"id": "neovim", "type": "block", "content": {"terminal": "brudr-nvim"}}, caso)
            self.assertEqual((dopo["attivo"], dopo["visibile"]), ("neovim", True), caso)
            self.assertTrue(dopo["nuovoTerminale"], caso)
            self.assertEqual(dopo["nvim"]["labels"], {"brudr.panel": "nvim", "brudr.private": "1"}, caso)

    def test_niente_layout_switch_per_rimettere_i_blocchi(self):
        """layout.switch saves before it loads: it would write the file without the block."""
        self.assertNotIn("layout.switch", self.js)


if __name__ == "__main__":
    unittest.main(verbosity=1)
