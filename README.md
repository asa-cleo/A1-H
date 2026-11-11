# High-Performance LLM Benchmark Suite (0.9B - 4B Models)

A high-performance TypeScript & Bun benchmark suite and hosting runner for small language models (e.g. Spark-X2.6 4B, Qwen 2.5 0.5B/1.5B/3B, Llama 3.2 1B/3B, SmolLM2 1.7B, Gemma 2 2B, Phi-3.5 mini 3.8B).

---

## ⚡ Clone & Run in Google Colab (Terminal / Cell)

Clone this repository in your Colab environment:
```bash
git clone https://github.com/<your-username>/A1-H.git
cd A1-H
```

### 1. Host Model & Launch Cloudflare Tunnel (Serve-Only)
Launches your model using your local or pre-built `llama.cpp` binary, caps the context window to **128K** (`131072` tokens) with Flash Attention (`-fa`) and 8-bit quantized KV cache (`-ctk q8_0 -ctv q8_0`), connects to Cloudflare Tunnel, and prints your public URL:

```bash
bun run serve:tunnel --model /path/to/Spark-X2.6-4B-Q4_K_M.gguf
```

### 2. Run Full 58-Test Benchmark on Colab Directly (One-Liner)
Automatically starts the server, waits for the health check, runs all 58 benchmark tests, and terminates the server when done:
```bash
bun run bench:colab --model /path/to/Spark-X2.6-4B-Q4_K_M.gguf
```

### 3. Run Benchmark Locally Against Colab's Cloudflare Tunnel
Test from your local terminal against the remote Cloudflare tunnel URL:
```bash
# Real-time streaming (bypasses Cloudflare edge buffering using anti-compression headers)
bun run bench --mode server --server-url https://xxxx.trycloudflare.com --suite all

# Atomic POST mode (if network has high packet loss)
bun run bench --mode server --server-url https://xxxx.trycloudflare.com --no-stream --suite all
```

---

## 🔧 Binary & Module Resolution Engine

The suite automatically detects how `llama.cpp` is installed on your system in the following order:

1. **Custom Directory (`LLAMA_DIR`)**:
   Set `export LLAMA_DIR="/path/to/prebuilt/binaries"` or pass `--llama-dir /path/to/dir`.
2. **System PATH**:
   Detects `llama-server`, `llama-serve`, or `llama` CLI (`llama serve`) if installed globally via package managers or URL installers.
3. **Local Paths**:
   Checks `./llama-server`, `./bin/llama-server`, `/content/llama.cpp/build/bin/llama-server`, etc.
4. **Auto-Download Fallback**:
   If no binary is found anywhere, it automatically downloads and extracts the latest pre-built CUDA binary into `./` so you never get stuck.

---

## ⚙️ Spark-X2.6-4B Recommended Settings

The runner defaults to the official SparkLLM team (`XHToken`) recommended generation settings:
- **Context Window**: Capped at **128K (`131072`)** to guarantee stability in 16GB VRAM.
- **Flash Attention**: Enabled (`-fa`).
- **KV Cache Quantization**: Enabled (`-ctk q8_0 -ctv q8_0`) to halve memory consumption for deep context.
- **GPU Layers**: `-ngl 99` (offloads all 33 layers into VRAM).
- **Sampling**: `temperature=1.0`, `top_p=0.95`, `top_k=0`.

---

## 🧪 Included Benchmark Suites (58 Tests Total)

| Suite | Tests | Description |
| :--- | :---: | :--- |
| **NIAH** | 15 | Needle In A Haystack retrieval across 1k, 2k, 4k tokens and 0%, 25%, 50%, 75%, 100% depths. |
| **Reasoning** | 8 | GSM8K multi-step math, relative train pursuit, calendar modulo 7, age deduction, syllogisms. |
| **Hard Tasks** | 6 | Lipograms (no 'e'), strict JSON schema, multi-rule checklists, runtime TypeScript execution. |
| **Hallucination** | 15 | Compares Baseline vs Strict Abstention vs Chain-of-Verification (CoVe) across 5 domains. |
| **Injection** | 5 | Dynamic prompt injection, XML delimiter smuggling, translation trojans, roleplay bypasses. |
| **Creativity** | 4 | Alternative Uses Test (AUT), quantum dance metaphor blending, constrained twist stories. |
| **Tool Calling** | 5 | 20-tool enterprise schema selection, disambiguation, parameter parsing, tool hallucination test. |

---

## 📋 CLI Reference

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--model <path>` | Path to `.gguf` model file | Required |
| `--llama-dir <path>` | Directory with pre-built binaries (or `$LLAMA_DIR`) | Auto-detect |
| `--tunnel` | Launch Cloudflare Tunnel and output public URL | `false` |
| `--serve-only` | Run server & tunnel indefinitely without running tests | `false` |
| `--auto-server` | Auto-launch server, run tests, and shut down | `false` |
| `--server-url <url>` | Target running server or Cloudflare URL | `http://127.0.0.1:8080` |
| `--suite <name>` | `all`, `niah`, `reasoning`, `hard`, `hallucination`, `injection`, `creativity`, `tools` | `all` |
| `--no-stream` | Force atomic non-streaming POST | `false` |
| `--temp <float>` | Sampling temperature | `1.0` |
| `--top-p <float>` | Top-p sampling | `0.95` |
| `--top-k <int>` | Top-k sampling | `0` |
