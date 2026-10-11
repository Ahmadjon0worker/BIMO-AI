"""Apply the small portable-service changes to the reviewed source copy once."""
from pathlib import Path

SRC = Path(__file__).resolve().parent / "src"


def replace(path, old, new, count=1):
    text = path.read_text(encoding="utf-8")
    if text.count(old) != count:
        raise RuntimeError(f"Unexpected source layout in {path.name}")
    path.write_text(text.replace(old, new), encoding="utf-8", newline="\n")


router = SRC / "router.py"
replace(router, '"""Loopback-only model broker. No cloud endpoints or arbitrary upstream URLs."""',
        '"""Coucou per-user bridge: fixed loopback, Ollama, Gemini and Groq."""')
replace(router, "ROOT = Path(__file__).resolve().parents[1]",
        "from service_paths import data_root, service_port, SERVICE_ID, SERVICE_VERSION\nfrom provider_broker import ProviderBroker\n\nROOT = data_root()\nPORT = service_port()")
replace(router, "OLLAMA = f'http://127.0.0.1:{OLLAMA_PORT}'",
        "OLLAMA = f'http://127.0.0.1:{OLLAMA_PORT}'\nBROKER = ProviderBroker(ollama_port=OLLAMA_PORT)")
replace(router, "def loaded():\n    return native_json('/api/ps', timeout=3).get('models', [])",
        "def loaded():\n    try:\n        return native_json('/api/ps', timeout=3).get('models', [])\n    except (OSError, RuntimeError, ValueError, http.client.HTTPException):\n        return []")
replace(router, "return host in ('127.0.0.1:11435', 'localhost:11435') and origin is None",
        "return host in (f'127.0.0.1:{PORT}', f'localhost:{PORT}') and origin is None")
replace(router, "status.update(ram_available_gib=round(ram.available / 2**30, 2),",
        "status.update(service=SERVICE_ID, service_version=SERVICE_VERSION, bridge_ready=True, provider_status=BROKER.available(),\n                          capabilities={'telegram': True, 'personal_telegram': True, 'computer': True, 'opencode': False},\n                          ram_available_gib=round(ram.available / 2**30, 2),")
replace(router, "CANCEL.set()\n                STATE['stop_generation'] += 1",
        "CANCEL.set()\n                BROKER.cancel()\n                STATE['stop_generation'] += 1")
old = """            subprocess.Popen([str(ROOT / '.venv' / 'Scripts' / 'python.exe'), '-X', 'utf8',
                              str(ROOT / 'scripts' / 'services.py'), 'opencode'],
                             creationflags=subprocess.CREATE_NEW_CONSOLE)
            return self.send_json(200, {'opened': True})"""
replace(router, old, "            return self.send_json(400, {'error': 'OpenCode is not included in this installer. Use Coucou chat or install OpenCode separately.'})")
text = router.read_text(encoding="utf-8")
start = text.index("    def infer(self, payload, native, vision=False, session=None, timeout=300):")
end = text.index("    def metrics(self, result):", start)
text = text[:start] + """    def infer(self, payload, native, vision=False, session=None, timeout=120):
        from service_inference import infer
        return infer(self, payload, native, vision=vision, session=session, timeout=timeout)

""" + text[end:]
text = text.replace("if __name__ == '__main__':", "def main():")
text = text.replace("server = ThreadingHTTPServer(('127.0.0.1', 11435), Handler)", "server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)")
text = text.replace("log('router_started', port=11435, ollama_port=OLLAMA_PORT)", "log('router_started', service=SERVICE_ID, port=PORT, ollama_port=OLLAMA_PORT)")
text = text.replace("    server.serve_forever()", "    try:\n        server.serve_forever()\n    finally:\n        server.server_close()\n        (ROOT / 'runtime' / 'router.pid').unlink(missing_ok=True)")
router.write_text(text, encoding="utf-8", newline="\n")

capabilities = SRC / "capabilities.py"
replace(capabilities, "TOKEN_PATTERN = re.compile", "from service_paths import service_port\n\nTOKEN_PATTERN = re.compile")
replace(capabilities, 'http.client.HTTPConnection("127.0.0.1", 11435, timeout=timeout)',
        'http.client.HTTPConnection("127.0.0.1", service_port(), timeout=timeout)')
replace(capabilities, '"scope": "Tasdiqlangan Notepad TXT/MD hujjati, D:/LocalAI/workspace"',
        '"scope": "Tasdiqlangan Notepad TXT/MD hujjati: " + str(self.tools.policy.root)')

tools = SRC / "local_tools.py"
replace(tools, 'ROOT = Path(os.environ.get("LOCALAI_ROOT", r"D:\\LocalAI")).resolve()',
        'from service_paths import data_root, service_port\n\nROOT = data_root()')
text = tools.read_text(encoding="utf-8")
text = text.replace('Run with D:\\\\LocalAI\\\\.venv\\\\Scripts\\\\python.exe local_tools.py.', 'Run with the bundled Coucou Python runtime and local_tools.py.')
text = text.replace('D:\\\\LocalAI\\\\workspace', 'the per-user Coucou LocalAI workspace')
text = text.replace('"http://127.0.0.1:11435" + endpoint', 'f"http://127.0.0.1:{service_port()}" + endpoint')
tools.write_text(text, encoding="utf-8", newline="\n")
print("Portable adaptations applied to 3 source modules")
