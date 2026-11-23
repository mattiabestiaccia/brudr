#!/usr/bin/env python3
"""Tests of the detached Superfile opener, without showing any GUI window."""
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

OPENER = runpy.run_path(str(Path(__file__).with_name("spf-apri")))


class Opener(unittest.TestCase):
    @patch("subprocess.run")
    def test_markdown_path_is_uri_encoded(self, run):
        name = "/cartella con spazi/È $() #?&.MD"
        OPENER["main"]([name])
        command, = run.call_args.args
        self.assertEqual(command[:3], ["/usr/bin/open", "-a", "Obsidian"])
        url = urlparse(command[3])
        self.assertEqual(url.netloc, "open")
        self.assertEqual(parse_qs(url.query), {"path": [name]})

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
        with patch.dict(OPENER["main"].__globals__, {"table": lambda *_: b"tabella privata"}):
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

    @patch("subprocess.run", side_effect=subprocess.TimeoutExpired("nu", 10))
    def test_timeout_does_not_leak_data(self, _run):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.json"
            path.write_text('"never included in an error"')
            self.assertIn(b"non disponibile", OPENER["table"](path, "json"))


if __name__ == "__main__":
    unittest.main()
