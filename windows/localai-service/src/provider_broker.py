"""Ollama, Gemini and Groq generation, with no action execution or secret logs."""
from __future__ import annotations

import copy
import http.client
import json
import threading
from urllib.parse import urlsplit

from provider_credentials import read_key
from service_paths import settings_path

MAX_RESPONSE = 4 * 1024 * 1024
DEFAULT_MODELS = {"google": "gemini-3.8-flash", "groq": "llama-3.3-70b-versatile"}
CLOUD = {"google": ("generativelanguage.googleapis.com", "/v1beta/openai"),
         "groq": ("api.groq.com", "/openai/v1")}
NOT_CHAT = ("embed", "whisper", "tts", "orpheus", "guard", "imagen", "veo", "audio", "live", "image", "robotics", "compound")


class ProviderUnavailable(RuntimeError):
    pass


class Transport:
    def __init__(self):
        self.active = None
        self.lock = threading.Lock()

    def cancel(self):
        with self.lock:
            connection = self.active
        if connection and connection.sock:
            try:
                connection.sock.shutdown(2)
            except OSError:
                pass
        if connection:
            connection.close()

    def json(self, provider, path, body=None, key=None, timeout=90, ollama_port=11434):
        if provider == "ollama":
            if ollama_port not in (11434, 11436):
                raise ProviderUnavailable("Ollama port is unavailable")
            connection = http.client.HTTPConnection("127.0.0.1", ollama_port, timeout=timeout)
            target = path
        elif provider in CLOUD:
            host, prefix = CLOUD[provider]
            connection = http.client.HTTPSConnection(host, timeout=timeout)
            target = prefix + path
        else:
            raise ProviderUnavailable("Unsupported provider")
        headers = {"Content-Type": "application/json"}
        if provider in CLOUD:
            if not key:
                raise ProviderUnavailable("Provider key has not been configured")
            headers["Authorization"] = "Bearer " + key
        payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        try:
            with self.lock:
                self.active = connection
            connection.request("GET" if body is None else "POST", target, payload, headers)
            response = connection.getresponse()
            data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise ProviderUnavailable("Provider response is too large")
            if not 200 <= response.status < 300:
                # Do not echo remote errors: they may contain request text/keys.
                raise ProviderUnavailable(f"Provider HTTP {response.status}")
            result = json.loads(data)
            if not isinstance(result, dict):
                raise ProviderUnavailable("Invalid provider response")
            return result
        except (OSError, ValueError, http.client.HTTPException):
            raise ProviderUnavailable("Provider is unreachable or returned invalid data") from None
        finally:
            connection.close()
            with self.lock:
                if self.active is connection:
                    self.active = None


def read_settings():
    path = settings_path()
    if path is None:
        return {}
    try:
        if path.stat().st_size > 256 * 1024:
            return {}
        value = json.loads(path.read_text(encoding="utf-8-sig"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def provider_order(settings):
    provider = settings.get("chatProvider", "auto")
    if provider == "auto":
        return ["ollama", "google", "groq"]
    if provider in ("ollama", "google", "groq"):
        return [provider]
    raise ProviderUnavailable("Choose Auto, Ollama, Gemini or Groq in BIMO AI Settings for LocalAI tools.")


def openai_messages(messages):
    result = []
    for original in messages:
        item = copy.deepcopy(original)
        images = item.pop("images", [])
        if images:
            content = item.get("content", "")
            parts = [{"type": "text", "text": content}] if isinstance(content, str) else list(content)
            parts.extend({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + image}} for image in images)
            item["content"] = parts
        if item.get("tool_calls"):
            for index, call in enumerate(item["tool_calls"]):
                call.setdefault("id", f"call_{index}")
                call.setdefault("type", "function")
                arguments = call.get("function", {}).get("arguments", {})
                if not isinstance(arguments, str):
                    call["function"]["arguments"] = json.dumps(arguments, ensure_ascii=False)
        item.pop("tool_name", None)
        result.append(item)
    return result


class ProviderBroker:
    def __init__(self, *, transport=None, credentials=None, settings=None, ollama_port=11434):
        self.transport = transport or Transport()
        self.credentials = credentials or read_key
        self.settings = settings or read_settings
        self.ollama_port = ollama_port
        self.last_provider = None
        self.last_model = None

    def available(self):
        configured = {name: bool(self.credentials(name)) for name in CLOUD}
        try:
            order = provider_order(self.settings())
        except ProviderUnavailable:
            order = []
        return {"selected": self.settings().get("chatProvider", "auto"),
                "configured": configured, "order": order,
                "active_provider": self.last_provider, "active_model": self.last_model}

    def cancel(self):
        if hasattr(self.transport, "cancel"):
            self.transport.cancel()

    def local_port(self, settings):
        raw = settings.get("ollamaUrl", "")
        if not raw:
            return self.ollama_port
        if not isinstance(raw, str):
            raise ProviderUnavailable("Ollama address is invalid")
        try:
            address = urlsplit(raw.strip())
            port = address.port or 80
            supported = (address.scheme == "http" and address.hostname in {"localhost", "127.0.0.1", "::1"}
                         and port in {11434, 11436} and address.path.rstrip("/") in {"", "/v1"}
                         and not address.username and not address.password and not address.query and not address.fragment)
        except ValueError:
            supported = False
        if not supported:
            raise ProviderUnavailable("LocalAI tools require local Ollama on http://127.0.0.1:11434 or :11436; the router on :11435 cannot be its own upstream")
        return port

    def models(self, provider, key, *, ollama_port=None):
        if provider == "ollama":
            value = self.transport.json(provider, "/api/tags", timeout=3, ollama_port=ollama_port or self.ollama_port)
            rows = value.get("models", [])
            ids = [row.get("name", row.get("model")) for row in rows if isinstance(row, dict)]
        else:
            value = self.transport.json(provider, "/models", key=key, timeout=8)
            ids = [row.get("id") for row in value.get("data", []) if isinstance(row, dict)]
        return list(dict.fromkeys(item.removeprefix("models/") for item in ids
            if isinstance(item, str) and item and not any(token in item.lower() for token in NOT_CHAT)))

    def complete(self, native_body, *, cancel=None, timeout=120):
        settings = self.settings()
        errors = []
        for provider in provider_order(settings):
            if cancel and cancel.is_set():
                raise InterruptedError("Stopped by user")
            key = None if provider == "ollama" else self.credentials(provider)
            if provider != "ollama" and not key:
                errors.append(provider + ": key not configured")
                continue
            try:
                port = self.local_port(settings) if provider == "ollama" else None
                models = self.models(provider, key, ollama_port=port)
                if not models:
                    raise ProviderUnavailable("No chat model is available")
                saved = settings.get("chatModels", {}).get(provider) if isinstance(settings.get("chatModels"), dict) else None
                if settings.get("chatProvider") != "auto" and saved and saved not in models:
                    raise ProviderUnavailable("The selected model is unavailable; choose an available model in BIMO AI Settings")
                preferred = native_body.get("model") if provider == "ollama" else DEFAULT_MODELS[provider]
                model = saved if saved in models else preferred if preferred in models else models[0]
                body = copy.deepcopy(native_body)
                body.update(model=model, stream=False)
                if provider == "ollama":
                    value = self.transport.json(provider, "/api/chat", body, timeout=timeout, ollama_port=port)
                    message = value.get("message")
                    if not isinstance(message, dict):
                        raise ProviderUnavailable("Provider returned no message")
                    result = {"message": message, "model": model,
                              "prompt_eval_count": value.get("prompt_eval_count", 0),
                              "eval_count": value.get("eval_count", 0), "eval_duration": value.get("eval_duration", 0)}
                else:
                    outgoing = {"model": model, "messages": openai_messages(body.get("messages", [])), "stream": False}
                    token_field = "max_completion_tokens" if provider == "groq" else "max_tokens"
                    outgoing[token_field] = int(body.get("options", {}).get("num_predict", 512))
                    outgoing["temperature"] = body.get("options", {}).get("temperature", 0.35)
                    if body.get("tools"):
                        outgoing["tools"] = body["tools"]
                    if body.get("format"):
                        schema = body["format"]
                        if provider == "groq":
                            # llama-3.3-70b-versatile supports JSON mode, not
                            # strict JSON Schema. Capability validators remain
                            # authoritative before any approved action.
                            outgoing["response_format"] = {"type": "json_object"}
                            instruction = "Return exactly one valid JSON object. No Markdown or extra text."
                            if isinstance(schema, dict):
                                instruction += " Match this JSON schema: " + json.dumps(schema, separators=(",", ":"), ensure_ascii=False)
                            outgoing["messages"].insert(1 if outgoing["messages"] and outgoing["messages"][0].get("role") == "system" else 0,
                                                        {"role": "system", "content": instruction})
                        else:
                            outgoing["response_format"] = {"type": "json_object"} if schema == "json" else {
                                "type": "json_schema", "json_schema": {"name": "response", "schema": schema}}
                    value = self.transport.json(provider, "/chat/completions", outgoing, key=key, timeout=timeout)
                    choices = value.get("choices") or []
                    message = choices[0].get("message") if choices and isinstance(choices[0], dict) else None
                    if not isinstance(message, dict):
                        raise ProviderUnavailable("Provider returned no message")
                    message = copy.deepcopy(message)
                    for call in message.get("tool_calls", []):
                        arguments = call.get("function", {}).get("arguments")
                        if isinstance(arguments, str):
                            call["function"]["arguments"] = json.loads(arguments or "{}")
                    usage = value.get("usage") or {}
                    result = {"message": message, "model": model,
                              "prompt_eval_count": usage.get("prompt_tokens", 0),
                              "eval_count": usage.get("completion_tokens", 0), "eval_duration": 0}
                if cancel and cancel.is_set():
                    raise InterruptedError("Stopped by user")
                self.last_provider, self.last_model = provider, model
                result["provider"] = provider
                return result
            except (ProviderUnavailable, ValueError) as exc:
                errors.append(provider + ": " + (str(exc) if isinstance(exc, ProviderUnavailable) else "Invalid provider result"))
        raise ProviderUnavailable("AI provider unavailable. Start Ollama with a chat model, or configure Gemini/Groq in BIMO AI Settings. " + "; ".join(errors))
