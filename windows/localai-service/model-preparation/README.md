# Uzbek Whisper build preparation

This directory is used only when preparing a release. The application does not
import it, download models at startup, read user configuration, or capture audio.

The candidate is NavAI's Apache-2.0 Uzbek fine-tune of OpenAI Whisper small,
revision `4b432caf21c2752bca3384b5df1d41cf0da2801d`:
<https://huggingface.co/navai-uz/whisper-small-uzbek/tree/4b432caf21c2752bca3384b5df1d41cf0da2801d>.
The original `model.safetensors` is 966,995,080 bytes, SHA256
`3662e1baf3a9bc9a3b3df9bb75060c99708f8c461df19e0e3acd80ae6814411e`.
All source/config/tokenizer assets are pinned in `source-pins.json`.

Use Python with NumPy. The converter adapts the official whisper.cpp v1.9.4
`models/convert-h5-to-ggml.py` tensor map, positions, mel filters, tokenizer and
F16/F32 layout. It reads the safetensors JSON header and memory-maps numeric data;
it does not install Torch/Transformers, load pickle, or execute model repository
code. It verifies all 479 tensors and the small architecture before conversion.

The native b5130 Windows release ZIP is verified against GitHub's declared
SHA256 `f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c`.
The extracted `whisper-quantize.exe` SHA256 is
`282a6e5e30ea10b0b63624ec32193ffdb6f3cd0f6a2fbc7d9099e1ec4d972466`.

The candidate also includes official Silero v6.2.0 VAD from
`ggml-org/whisper-vad`, revision `c5c26827b67dfd053856f92e824e14fdcc123daf`.
Its `ggml-silero-v6.2.0.bin` is 885,098 bytes, SHA256
`2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`.
Silero's MIT license is pinned to upstream v6.2 commit
`be95df9152c0d7618fa1edfeb296fc3dae32376f`; `VAD-SOURCE.json` records both sources.

Run from `windows` using your build Python. `--fetch` explicitly enables public
downloads; omit it to build entirely from an already verified cache. The output
must be a new, empty candidate directory outside `public-voice`.

```powershell
python localai-service/model-preparation/prepare_uzbek_model.py --cache ./model-cache/uzbek --output ./model-candidates/uzbek --fetch
python localai-service/model-preparation/prepare_uzbek_model.py --cache ./model-cache/uzbek --verify-only
```

The input checkpoint, intermediate F16 model and build ZIP require about 1.6 GB
of cache space. The packaged Q5_1 output is `ggml-navai-small-uz-q5_1.bin`,
190,085,504 bytes. Both output identities must match:

- SHA256: `b37c8935d4c2603404bdd7659a9e98c4f1f780712392de43d7a2c96fc5a8196b`
- SHA1: `5a549f1750434650c3bcbc2fb2c85ff91b30cbcc`

The candidate includes NavAI's original license and NOTICE, the full Apache-2.0
license, OpenAI Whisper's MIT license and whisper.cpp's MIT license. The NOTICE
preserves the USC/FLEURS and other dataset attributions. GGML conversion and
quantization are recorded as modifications in `MODEL-SOURCE.json`.

Quality evaluation and release promotion are separate steps. Use held-out public
Uzbek speech for evaluation. The application's silence gate must remain enabled:
bare Whisper CLI may hallucinate words on silent input. Native VAD additionally
filters non-speech noise before decoding. No microphone is needed to prepare or
evaluate this build candidate.
