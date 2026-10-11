"""One generation gate for chat, drafts and reviewed computer planning."""
from __future__ import annotations

import json
import time
import uuid

from provider_broker import ProviderUnavailable


def infer(handler, payload, native, vision=False, session=None, timeout=120):
    import router as runtime
    runtime.expire_computer_lease()
    mode, profile = runtime.resolve_profile(payload.get("model"))
    if runtime.STATE["halted"]:
        return handler.send_json(409, {"error": "Stopped by user. Select a mode to resume."})
    if runtime.STATE["computer_use_active"] and (not vision or session != runtime.STATE["computer_session"]):
        return handler.send_json(409, {"error": "Finish the active Computer Use session first"})
    if session is not None and (not runtime.STATE["computer_use_active"] or session != runtime.STATE["computer_session"]):
        return handler.send_json(409, {"error": "Computer Use session is expired or unavailable"})
    if not runtime.GATE.acquire(blocking=False):
        return handler.send_json(429, {"error": "AI generation is busy; retry after the current task"})
    started = False
    try:
        if runtime.CANCEL.is_set() or runtime.STATE["halted"]:
            raise InterruptedError("Stopped by user")
        with runtime.STATE_LOCK:
            runtime.STATE.update(busy=True, operation="AI ishlamoqda", last_error=None, tokens_per_second=None)
        body = runtime.request_body(payload, mode, profile, vision=vision)
        result = runtime.BROKER.complete(body, cancel=runtime.CANCEL, timeout=min(120, timeout))
        with runtime.STATE_LOCK:
            runtime.STATE["active_model"] = result["model"]
        handler.metrics(result)
        message = result.get("message", {})
        calls = runtime.openai_tools(message.get("tool_calls", []))
        for call in calls:
            call.pop("index", None)
        answer = {"role": "assistant", "content": message.get("content") or ""}
        if calls:
            answer["tool_calls"] = calls
        request_id = "chatcmpl-" + uuid.uuid4().hex
        if body["stream"]:
            # Buffer a single provider generation before delivering compatible
            # SSE/NDJSON. A provider failure can never duplicate action effects.
            handler.send_response(200)
            handler.send_header("Content-Type", "application/x-ndjson" if native else "text/event-stream")
            handler.send_header("Cache-Control", "no-cache")
            handler.send_header("Connection", "close")
            handler.end_headers()
            handler.close_connection = True
            started = True
            if native:
                handler.wfile.write((json.dumps({**result, "done": True}, ensure_ascii=False) + "\n").encode("utf-8"))
            else:
                chunk = {"id": request_id, "object": "chat.completion.chunk", "created": int(time.time()),
                         "model": result["model"], "provider": result["provider"],
                         "choices": [{"index": 0, "delta": answer, "finish_reason": None}]}
                handler.wfile.write(("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n").encode("utf-8"))
                chunk["choices"] = [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if calls else "stop"}]
                handler.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode("utf-8"))
            handler.wfile.flush()
        elif native:
            handler.send_json(200, {**result, "done": True})
        else:
            prompt, completion = result.get("prompt_eval_count", 0), result.get("eval_count", 0)
            handler.send_json(200, {"id": request_id, "object": "chat.completion", "created": int(time.time()),
                "model": result["model"], "provider": result["provider"],
                "choices": [{"index": 0, "message": answer, "finish_reason": "tool_calls" if calls else "stop"}],
                "usage": {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion}})
        runtime.log("inference_completed", mode=mode, provider=result["provider"], vision=vision)
    except (BrokenPipeError, ConnectionResetError):
        pass
    except Exception as exc:
        message = ("Stopped by user" if runtime.CANCEL.is_set() or isinstance(exc, InterruptedError)
                   else str(exc) if isinstance(exc, (ProviderUnavailable, ValueError))
                   else "AI generation failed; check provider settings")
        with runtime.STATE_LOCK:
            runtime.STATE["last_error"] = message[:500]
        runtime.log("inference_error", type=type(exc).__name__, cancelled=runtime.CANCEL.is_set())
        if not started:
            handler.send_json(503, {"error": message[:500]})
    finally:
        with runtime.STATE_LOCK:
            runtime.STATE.update(busy=False, operation="Windows boshqaruvi" if runtime.STATE["computer_use_active"] else None)
        runtime.GATE.release()
