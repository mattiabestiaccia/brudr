#!/usr/bin/env python3
"""Tests of the brudr side panels: brudr-pannello, crea-layout and the pannelli mod.

Usage: python3 personal/pannelli/test_pannelli.py
No Herdr, no core, no terminal: brudr-pannello runs in its test mode
(BRUDR_PANNELLO_PROVA=1), Neovim runs headless with a fake config and fake
state folders, the layout goes through brudr's real layout reader (src/layout.rs,
built offline with the repository's Cargo.lock). Fake secrets only.
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
MOD = os.path.join(QUI, "mods", "pannelli", "main.js")
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


class BrudrPannello(Cartella):
    def test_ogni_tipo_parte(self):
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
        self.assertEqual(body["header"], {"content": {"mod": "pannelli"}, "height": 32})
        figli = {c["id"]: c for c in body["children"]}
        self.assertEqual(list(figli), ["files", "neovim", "changes", "quota", "privato"])
        self.assertEqual({k: v["content"]["terminal"] for k, v in figli.items()},
                         {"files": "brudr-spf", "neovim": "brudr-nvim", "changes": "brudr-hunk",
                          "quota": "brudr-quota", "privato": "brudr-privato"})
        self.assertEqual(figli["privato"]["background"], "#000000")
        self.assertEqual([k for k, v in figli.items() if "background" in v], ["privato"])
        panel = trova(d, "panel")
        self.assertIsNotNone(panel)
        self.assertTrue(panel and panel["hidden"], "the panel column keeps its place and look")

    def test_senza_panel_body_rifiuta(self):
        r, out, _ = self.crea({"id": "root", "type": "row", "children": []})
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(out))

    @unittest.skipUnless(shutil.which("cargo"), "cargo not installed")
    def test_lettore_vero_dei_layout(self):
        """src/layout.rs, built apart with serde only (no GPUI), reads the layout made from herdr-transparent."""
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
    let text = std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap();
    let n: layout::Node = serde_json::from_str(&text).unwrap();
    for (id, name) in [("files", "brudr-spf"), ("neovim", "brudr-nvim"), ("changes", "brudr-hunk"), ("quota", "brudr-quota"), ("privato", "brudr-privato")] {
        assert_eq!(n.find(id).and_then(layout::Node::terminal), Some(name), "{id}");
    }
    let v = serde_json::to_value(n.find("privato").unwrap()).unwrap();
    assert_eq!(v["background"], "#000000", "{v}");
    let body = serde_json::to_value(n.find("panel-body").unwrap()).unwrap();
    assert_eq!(body["header"]["content"]["mod"], "pannelli", "{body}");
    println!("layout ok");
}
''')
        env = dict(os.environ, CARGO_TARGET_DIR=os.path.join(tempfile.gettempdir(), "pannelli-layout-target"))
        r = subprocess.run(["cargo", "run", "-q", "--offline", "--manifest-path", os.path.join(crate, "Cargo.toml"),
                            "--", out], env=env, capture_output=True, text=True, timeout=900)
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        self.assertIn("layout ok", r.stdout)


class ModPannelli(unittest.TestCase):
    def setUp(self):
        self.js = open(MOD).read()

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_sintassi(self):
        d = tempfile.mkdtemp(prefix="pannelli-mod-")
        self.addCleanup(shutil.rmtree, d, True)
        p = os.path.join(d, "main.mjs")
        shutil.copy(MOD, p)
        r = subprocess.run(["node", "--check", p], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_stessi_pannelli_della_mod_del_layout_e_del_programma(self):
        mod = re.findall(r'\{ child: "(\w+)", tipo: "(\w+)", nome: "[^"]+", privato: (true|false)', self.js)
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
        segue = re.findall(r'tipo: "(\w+)"[^}]*segue: true', self.js)
        self.assertEqual(segue, ["hunk"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
