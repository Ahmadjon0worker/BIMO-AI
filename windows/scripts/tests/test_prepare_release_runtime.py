"""Regression checks for the relocated, byte-identical runtime base pin."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "prepare-release-runtime.py"
SPEC = importlib.util.spec_from_file_location("prepare_release_runtime", SCRIPT)
BOOTSTRAP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BOOTSTRAP)


class RuntimeReleasePinTests(unittest.TestCase):
    def test_current_release_reuses_the_immutable_runtime_base(self):
        pins = BOOTSTRAP.load_pins()
        self.assertEqual(pins["version"], "0.6.3")
        self.assertEqual(pins["release_version"], "0.7.1")
        self.assertEqual(pins["file"], "BIMOAI-Windows-runtime-base.zip")
        self.assertEqual(pins["sha256"], "79bad9bbf4cff6bf9312e9dbc45ff9dedae44f321872c5d66c01d219cf8ddea0")
        self.assertEqual(pins["manifest_sha256"], "ecc66b90c2bddddbe9d140ea014805ec8366218c1d80a08cdbec303533e7c2e4")
        self.assertEqual(pins["bytes"], 454608149)
        self.assertEqual(pins["files"], 2068)
        self.assertEqual(pins["payload_bytes"], 571951706)

    def test_fixed_download_contract_rejects_historical_or_mixed_location(self):
        pins = BOOTSTRAP.load_pins()
        changes = [
            {"release_version": "0.6.4"},
            {"file": "QanotAI-Windows-0.6.3-runtime.zip"},
            {"version": "0.7.1"},
            {"url": pins["url"].replace("v0.7.1/", "v0.6.4/")},
            {"url": pins["url"].replace("BIMO-AI/", "CouCou-Uzbek-edition-/")},
        ]
        with tempfile.TemporaryDirectory(prefix="bimo-runtime-pin-") as fixture:
            pin_path = Path(fixture) / "pins.json"
            for changed in changes:
                with self.subTest(changed=changed):
                    pin_path.write_text(json.dumps({**pins, **changed}), encoding="utf-8")
                    with patch.object(BOOTSTRAP, "PINS", pin_path):
                        with self.assertRaisesRegex(ValueError, "Invalid fixed release asset pin"):
                            BOOTSTRAP.load_pins()


if __name__ == "__main__":
    unittest.main()
