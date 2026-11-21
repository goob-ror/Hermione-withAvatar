"""
Hermione's voice: a small local VoxCPM2 text-to-speech service.

Run by the app (lib/tts/voxcpm.ts) with the Python in tools/voxcpm/.venv:
    python scripts/voxcpm_server.py --port 8765

  GET  /health  -> {"ready": bool, "loading": bool, "error": str|null, "voice": str, "sample_rate": int}
  POST /tts     {"text": "...", "lang": "en"|"id", "style": "(optional)"} -> audio/wav (16-bit mono, 48 kHz)
  POST /stream  same body -> raw 16-bit mono PCM as it is generated (X-Sample-Rate header):
                the first audio arrives in ~0.2 s instead of after the whole line.

Speed (RTX 4060 Laptop): torch.compile needs Triton (pip "triton-windows" on
Windows); with it generation is ~1.1x real time instead of ~1.7x. The first
start compiles for a few minutes; later starts reuse the compile cache (~45 s).
Each language's reference clip is encoded once at load (prompt cache), not per line.

Listens on 127.0.0.1 only and never goes online (HF_HUB_OFFLINE is set by the
app). One request is generated at a time — the 8 GB GPU has room for one.

The voice stays the same everywhere: on first start a voice is designed from
VOXCPM_VOICE_EN / _ID and saved per language as tools/voxcpm/voice/reference-<lang>.wav
(+ .txt transcript); every line clones its language's clip. English is the
default; Indonesian is used only when the app asks for it. Replace those files
(10-20 s of clean speech + exact transcript) to use another voice.
"""
import argparse
import io
import json
import os
import sys
import threading
import time
import wave
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE_DIR = os.path.join(ROOT, "tools", "voxcpm", "voice")
# One reference clip per language. Every line is spoken as a continuation of its
# language's clip, so it inherits that clip's accent, pace and tone — English
# never picks up an Indonesian accent (and vice versa). English is the default.
# The reference lines are slow and full of pauses on purpose: the pace carries over.
LANGS = {
    "en": {
        "design": os.environ.get(
            "VOXCPM_VOICE_EN",
            # Chosen by the operator from three candidates (≈150 words/min).
            "A composed woman in her late twenties from London, warm and reassuring, unhurried measured pace, clear refined British accent",
        ),
        "line": "Hello, I'm Hermione. There's no rush... take your time. We'll work through it together, one step at a time.",
    },
    "id": {
        "design": os.environ.get(
            "VOXCPM_VOICE_ID",
            "A young woman in her twenties, warm, clear and friendly voice, natural pace, confident",
        ),
        "line": "Halo, aku Hermione. Senang sekali bisa membantumu hari ini. Ayo kita mulai!",
    },
}
DEFAULT_LANG = "en"


def ref_paths(lang):
    return os.path.join(VOICE_DIR, f"reference-{lang}.wav"), os.path.join(VOICE_DIR, f"reference-{lang}.txt")
STEPS = int(os.environ.get("VOXCPM_STEPS", "10"))
# torch.compile (needs Triton). VOXCPM_OPTIMIZE=0 turns it off (faster start, slower speech).
OPTIMIZE = os.environ.get("VOXCPM_OPTIMIZE", "1") != "0"
# Encoded reference clips, per language: "clone" = continuation of the clip with its
# transcript (most faithful voice); "ref" = reference only, which also accepts a
# delivery style like "(amused, a light laugh in her voice)".
prompt_caches = {}
MAX_CHARS = 600

state = {"ready": False, "loading": True, "error": None, "languages": list(LANGS), "sample_rate": 48000}
model = None
gpu = threading.Lock()
cache: "OrderedDict[str, bytes]" = OrderedDict()


def log(msg):
    print(f"[voxcpm] {msg}", flush=True)


def to_wav(samples, rate):
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def load():
    global model
    try:
        import torch
        from voxcpm import VoxCPM
        import soundfile as sf

        t = time.time()
        # Loading briefly needs ~15 GB of Windows commit (RAM + page file).
        # (Building in bfloat16 to save memory made generation run away — don't.)
        model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=OPTIMIZE)
        # Drop the CPU-side loading copies (weights file, float32 build) now that
        # the model is on the GPU, so the service doesn't keep ~15 GB reserved.
        import gc

        gc.collect()
        torch.cuda.empty_cache()
        log(f"GPU memory after load: {torch.cuda.memory_allocated() / 1024**3:.1f} GB")
        state["sample_rate"] = model.tts_model.sample_rate
        log(f"model loaded in {time.time() - t:.1f}s")
        os.makedirs(VOICE_DIR, exist_ok=True)
        for lang, voice in LANGS.items():
            wav_path, txt_path = ref_paths(lang)
            if os.path.exists(wav_path):
                continue
            log(f"designing Hermione's {lang} voice (first start only)")
            wav = model.generate(text=f"({voice['design']}){voice['line']}", cfg_value=2.0, inference_timesteps=STEPS)
            sf.write(wav_path, wav, state["sample_rate"])
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(voice["line"])
        for lang in LANGS:
            wav_path, txt_path = ref_paths(lang)
            ref_text = open(txt_path, encoding="utf-8").read().strip() if os.path.exists(txt_path) else ""
            tm = model.tts_model
            prompt_caches[lang] = {
                "clone": tm.build_prompt_cache(prompt_text=ref_text, prompt_wav_path=wav_path, reference_wav_path=wav_path)
                if ref_text
                else tm.build_prompt_cache(reference_wav_path=wav_path),
                "ref": tm.build_prompt_cache(reference_wav_path=wav_path),
            }
        # Warm-up: the first generations pay one-off GPU setup / compile costs.
        speak("Hello.")
        speak("Hello.", style="cheerful")
        state["ready"] = True
        log("ready")
    except Exception as e:  # noqa: BLE001 — report any load failure to the app
        state["error"] = f"{type(e).__name__}: {e}"
        state["loading"] = False
        log(f"failed to load: {state['error']}")
        # Give the memory back: a half-loaded model holds many GB. The app sees
        # the exit (and this message) and retries later.
        time.sleep(3)
        os._exit(3)
    finally:
        state["loading"] = False


def _target(text, style, lang):
    """The prompt cache and text for a line: a style uses the reference-only clone."""
    lang = lang if lang in LANGS else DEFAULT_LANG
    caches = prompt_caches[lang]
    if style:
        return caches["ref"], f"({style}){text}"
    return caches["clone"], text


def speak(text, style="", lang=DEFAULT_LANG):
    lang = lang if lang in LANGS else DEFAULT_LANG
    key = f"{lang}|{style}|{text}"
    if key in cache:
        cache.move_to_end(key)
        return cache[key]
    prompt_cache, line = _target(text, style, lang)
    with gpu:
        wav, _, _ = model.tts_model.generate_with_prompt_cache(
            target_text=line, prompt_cache=prompt_cache, inference_timesteps=STEPS, cfg_value=2.0, retry_badcase=True
        )
    data = to_wav(wav.squeeze(0).float().cpu().numpy(), state["sample_rate"])
    remember(key, data)
    return data


def remember(key, data):
    cache[key] = data
    if len(cache) > 80:
        cache.popitem(last=False)


def speak_stream(text, style="", lang=DEFAULT_LANG):
    """Yield 16-bit PCM chunks as they are generated (cached lines come in one piece)."""
    import numpy as np

    lang = lang if lang in LANGS else DEFAULT_LANG
    key = f"{lang}|{style}|{text}"
    if key in cache:
        cache.move_to_end(key)
        data = cache[key]
        yield data[44:]  # the cached WAV minus its header
        return
    prompt_cache, line = _target(text, style, lang)
    parts = []
    with gpu:
        for wav, _, _ in model.tts_model.generate_with_prompt_cache_streaming(
            target_text=line, prompt_cache=prompt_cache, inference_timesteps=STEPS, cfg_value=2.0
        ):
            chunk = (np.clip(wav.squeeze(0).float().cpu().numpy(), -1.0, 1.0) * 32767).astype("<i2").tobytes()
            parts.append(chunk)
            yield chunk
    pcm = b"".join(parts)
    remember(key, to_wav(np.frombuffer(pcm, dtype="<i2").astype("float32") / 32767, state["sample_rate"]))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep the app's log quiet
        pass

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, state)
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/tts", "/stream"):
            return self.send_json(404, {"error": "not found"})
        if not state["ready"]:
            return self.send_json(503, {"error": state["error"] or "still loading"})
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 20_000)
            req = json.loads(self.rfile.read(length) or b"{}")
            text = " ".join(str(req.get("text", "")).split())[:MAX_CHARS]
            style = " ".join(str(req.get("style", "")).split())[:120]
            lang = str(req.get("lang") or DEFAULT_LANG).lower()
            if not text:
                return self.send_json(400, {"error": "text is required"})
            t = time.time()
            if self.path == "/stream":
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("X-Sample-Rate", str(state["sample_rate"]))
                self.end_headers()
                for chunk in speak_stream(text, style, lang):
                    self.wfile.write(chunk)
                    self.wfile.flush()
                return
            data = speak(text, style, lang)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Gen-Seconds", f"{time.time() - t:.2f}")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            log(f"tts failed: {e}")
            self.send_json(500, {"error": str(e)})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    threading.Thread(target=load, daemon=True).start()
    log(f"listening on 127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
