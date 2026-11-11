import type { BenchmarkConfig, BenchmarkSuiteName } from './types.ts';
import { existsSync, readFileSync } from 'node:fs';
import { BenchmarkRunner } from './runner/benchmark.ts';
import { JsonReporter } from './reporters/json-reporter.ts';
import { ServerManager } from './runner/server-manager.ts';

const ALL_SUITES: BenchmarkSuiteName[] = [
  'niah',
  'reasoning',
  'hard',
  'hallucination',
  'injection',
  'creativity',
  'tools',
];

function printHelp() {
  console.log(`
Usage: bun run src/index.ts [options]

High-Performance Benchmark Suite & Host for Small LLMs (0.9B - 4B)
Default Configuration: Pre-configured via benchmark.config.json (Spark-X2.6-4B, 128K context, T4 CUDA)

Quick Commands:
  bun run serve:tunnel       # Host Spark-X2.6-4B on Colab with Cloudflare Tunnel
  bun run bench:colab        # Auto-launch server and run full 58-test benchmark
  bun run serve              # Host model locally on port 8080

Options:
  --config <path>              Path to JSON config file (Default: ./benchmark.config.json)
  --mode <server|cli|mock>     Execution mode (Default: server)
  --model <path>               Local GGUF model path (e.g. ./Spark-X2.6-4B-Q4_K_M.gguf)
  --hf <repo:file>             Hugging Face model (e.g. bartowski/Spark-X2.6-4B-GGUF:Spark-X2.6-4B-Q4_K_M.gguf)
  --llama-dir <path>           Folder with pre-built binaries (or env $LLAMA_DIR)
  --server-bin <path>          Path or name of server binary (Default: auto-detected)
  --cli-path <path>            Path or name of cli binary (Default: auto-detected)
  --auto-server                Auto-spawn server in background, wait for ready, run tests
  --tunnel                     Launch Cloudflare tunnel and output public trycloudflare.com URL
  --serve-only                 Start server & tunnel and keep running without running benchmark tests
  --server-url <url>           Base URL of running server (Default: http://127.0.0.1:8080)
  --context-size <int>         Context window size (Default: 131072 / 128K capped)
  --no-fa                      Disable Flash Attention
  --no-kv-quant                Disable 8-bit KV Cache quantization
  --suite <all|suite_name>     Test suite to run (Default: all)
  --lengths <n,n,...>          Context lengths for NIAH (Default: 1024,2048,4096)
  --depths <n,n,...>           Needle insertion depths for NIAH (Default: 0,0.25,0.5,0.75,1.0)
  --temp <float>               Sampling temperature (Default: 1.0)
  --top-p <float>              Top-p sampling (Default: 0.95)
  --top-k <int>                Top-k sampling (Default: 0)
  --max-tokens <int>           Max tokens to generate per prompt (Default: 512)
  --no-stream                  Force atomic POST instead of SSE streaming
  --timeout <ms>               Timeout per test in milliseconds (Default: 60000)
  --output <dir>               Directory to save JSON & Markdown reports (Default: ./results)
  --help                       Show this help message
`);
}

function loadConfigFile(configPath: string = './benchmark.config.json'): any {
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch (e: any) {
      console.warn(`⚠️ Warning: Failed to parse ${configPath}: ${e.message}`);
    }
  }
  return {};
}

function parseArgs(): { config: BenchmarkConfig; serveOnly: boolean } {
  const args = process.argv.slice(2);
  let serveOnly = false;

  // 1. Load defaults from benchmark.config.json if present
  let customConfigPath = './benchmark.config.json';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      customConfigPath = args[++i];
    }
  }
  const fileCfg = loadConfigFile(customConfigPath);

  // 2. Initialize with configuration file values
  const config: BenchmarkConfig = {
    mode: 'server',
    serverUrl: 'http://127.0.0.1:8088',
    serverBinPath: process.env.LLAMA_SERVER_BIN || './llama-server',
    llamaDir: fileCfg.server?.llamaDir || process.env.LLAMA_DIR || '',
    cliPath: process.env.LLAMA_CLI_BIN || './llama-cli',
    modelPath: fileCfg.model?.localPath || '',
    hfModel: fileCfg.model?.hf || 'bartowski/Spark-X2.6-4B-GGUF:Spark-X2.6-4B-Q4_K_M.gguf',
    autoSpawnServer: false,
    enableTunnel: fileCfg.server?.autoTunnel ?? false,
    serverGpuLayers: fileCfg.server?.gpuLayers ?? 99,
    serverContextSize: Math.min(fileCfg.server?.contextSize ?? 131072, 131072), // 128k cap
    serverPort: fileCfg.server?.port ?? 8088,
    flashAttention: fileCfg.server?.flashAttention ?? true,
    quantizeKv: fileCfg.server?.quantizeKv ?? true,
    suites: ALL_SUITES,
    temperature: fileCfg.server?.temperature ?? 1.0,
    topP: fileCfg.server?.topP ?? 0.95,
    topK: fileCfg.server?.topK ?? 0,
    maxTokens: fileCfg.benchmark?.maxTokens ?? 512,
    timeoutMs: fileCfg.benchmark?.timeoutMs ?? 60000,
    niahContextLengths: [1024, 2048, 4096],
    niahDepths: [0.0, 0.25, 0.5, 0.75, 1.0],
    outputDir: fileCfg.benchmark?.outputDir ?? './results',
    noStream: fileCfg.benchmark?.noStream ?? false,
    verbose: false,
  };

  // 3. Override with any explicit CLI flags passed
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--mode' && args[i + 1]) {
      config.mode = args[++i] as any;
    } else if (arg === '--llama-dir' && args[i + 1]) {
      config.llamaDir = args[++i];
    } else if (arg === '--auto-server') {
      config.autoSpawnServer = true;
    } else if (arg === '--tunnel') {
      config.enableTunnel = true;
    } else if (arg === '--serve-only') {
      serveOnly = true;
      config.autoSpawnServer = true;
    } else if (arg === '--server-bin' && args[i + 1]) {
      config.serverBinPath = args[++i];
    } else if (arg === '--server-url' && args[i + 1]) {
      config.serverUrl = args[++i];
    } else if (arg === '--cli-path' && args[i + 1]) {
      config.cliPath = args[++i];
    } else if (arg === '--model' && args[i + 1]) {
      config.modelPath = args[++i];
    } else if (arg === '--hf' && args[i + 1]) {
      config.hfModel = args[++i];
    } else if (arg === '--context-size' && args[i + 1]) {
      config.serverContextSize = Math.min(parseInt(args[++i], 10), 131072);
    } else if (arg === '--no-fa') {
      config.flashAttention = false;
    } else if (arg === '--no-kv-quant') {
      config.quantizeKv = false;
    } else if (arg === '--no-stream') {
      config.noStream = true;
    } else if (arg === '--suite' && args[i + 1]) {
      const suiteVal = args[++i].toLowerCase();
      if (suiteVal === 'all') {
        config.suites = ALL_SUITES;
      } else if (ALL_SUITES.includes(suiteVal as any)) {
        config.suites = [suiteVal as BenchmarkSuiteName];
      } else {
        console.error(`Invalid suite: ${suiteVal}. Must be: ${ALL_SUITES.join(', ')}, or all.`);
        process.exit(1);
      }
    } else if (arg === '--lengths' && args[i + 1]) {
      config.niahContextLengths = args[++i].split(',').map(s => parseInt(s.trim(), 10));
    } else if (arg === '--depths' && args[i + 1]) {
      config.niahDepths = args[++i].split(',').map(s => parseFloat(s.trim()));
    } else if (arg === '--temp' && args[i + 1]) {
      config.temperature = parseFloat(args[++i]);
    } else if (arg === '--top-p' && args[i + 1]) {
      config.topP = parseFloat(args[++i]);
    } else if (arg === '--top-k' && args[i + 1]) {
      config.topK = parseInt(args[++i], 10);
    } else if (arg === '--max-tokens' && args[i + 1]) {
      config.maxTokens = parseInt(args[++i], 10);
    } else if (arg === '--timeout' && args[i + 1]) {
      config.timeoutMs = parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      config.outputDir = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    }
  }

  return { config, serveOnly };
}

async function main() {
  const { config, serveOnly } = parseArgs();

  // Validate configuration
  if (config.mode === 'cli' && !config.modelPath && !config.hfModel) {
    console.error('Error: In "cli" mode, you must provide --model <path/to/model.gguf>');
    process.exit(1);
  }

  let serverManager: ServerManager | null = null;

  // Handle auto-spawning server if requested or in serve-only mode or if model is configured
  if (config.mode === 'server' && (config.autoSpawnServer || serveOnly)) {
    serverManager = new ServerManager({
      binaryPath: config.serverBinPath,
      llamaDir: config.llamaDir,
      modelPath: config.modelPath,
      hfModel: config.hfModel,
      port: config.serverPort,
      contextSize: config.serverContextSize,
      gpuLayers: config.serverGpuLayers,
      flashAttention: config.flashAttention,
      quantizeKv: config.quantizeKv,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      enableTunnel: config.enableTunnel,
    });

    await serverManager.start();
    config.serverUrl = serverManager.getUrl();

    if (serveOnly) {
      console.log('✨ Server is running in serve-only mode. Press Ctrl+C to stop.\n');
      // Keep running indefinitely until user stops
      await new Promise(() => {});
      return;
    }
  }

  try {
    const runner = new BenchmarkRunner(config);
    const report = await runner.run();

    const jsonReporter = new JsonReporter();
    const { jsonPath, mdPath } = await jsonReporter.saveReport(report, config.outputDir);

    console.log(`📁 Detailed JSON Report: ${jsonPath}`);
    console.log(`📝 Markdown Summary:     ${mdPath}\n`);
  } finally {
    if (serverManager && config.autoSpawnServer && !serveOnly) {
      serverManager.stop();
    }
  }
}

main().catch(err => {
  console.error('\n❌ Benchmark error:', err.message);
  process.exit(1);
});
