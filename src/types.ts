export type BenchmarkSuiteName =
  | 'niah'
  | 'reasoning'
  | 'hard'
  | 'hallucination'
  | 'injection'
  | 'creativity'
  | 'tools';

export interface TestCase {
  id: string;
  name: string;
  suite: BenchmarkSuiteName;
  prompt: string;
  systemPrompt?: string;
  expectedAnswer?: string | number | boolean;
  metadata?: Record<string, any>;
  evaluator: (output: string, context?: any) => {
    passed: boolean;
    score: number; // 0 to 1
    reason?: string;
    extractedAnswer?: any;
  };
}

export interface GenerationMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ttftMs: number; // Time to first token
  promptSpeedTps: number; // Tokens per second (prompt eval)
  completionSpeedTps: number; // Tokens per second (generation)
  totalLatencyMs: number;
}

export interface LLMResponse {
  text: string;
  metrics: GenerationMetrics;
  rawTimings?: any;
}

export interface BenchmarkResult {
  testId: string;
  name: string;
  suite: BenchmarkSuiteName;
  passed: boolean;
  score: number;
  reason?: string;
  actualOutput: string;
  expectedAnswer?: string | number | boolean;
  extractedAnswer?: any;
  metrics: GenerationMetrics;
  metadata?: Record<string, any>;
}

export interface SuiteSummary {
  suite: BenchmarkSuiteName;
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number; // 0 - 100%
  avgScore: number; // 0 - 1
  avgTtftMs: number;
  avgPromptTps: number;
  avgCompletionTps: number;
  avgLatencyMs: number;
}

export interface BenchmarkReport {
  timestamp: string;
  model: string;
  mode: 'server' | 'cli' | 'mock';
  totalDurationMs: number;
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    overallPassRate: number;
    avgScore: number;
    avgPromptTps: number;
    avgCompletionTps: number;
    avgTtftMs: number;
  };
  suites: Record<string, SuiteSummary>;
  results: BenchmarkResult[];
}

export interface BenchmarkConfig {
  mode: 'server' | 'cli' | 'mock';
  serverUrl: string;
  serverBinPath: string; // Path or binary name for llama-server
  llamaDir: string;      // Folder containing pre-built binaries ($LLAMA_DIR)
  cliPath: string;
  modelPath: string;
  hfModel: string;       // Hugging Face model repo/file (e.g. bartowski/Spark-X2.6-4B-GGUF:Spark-X2.6-4B-Q4_K_M.gguf)
  autoSpawnServer: boolean;
  enableTunnel: boolean;  // Auto-launch cloudflared tunnel
  serverGpuLayers: number; // -ngl (default: 99 for T4)
  serverContextSize: number; // -c (capped to 131072 max)
  serverPort: number;
  flashAttention: boolean; // -fa
  quantizeKv: boolean;     // -ctk q8_0 -ctv q8_0
  suites: BenchmarkSuiteName[];
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  timeoutMs: number;
  niahContextLengths: number[];
  niahDepths: number[]; // e.g. [0.0, 0.25, 0.5, 0.75, 1.0]
  outputDir: string;
  noStream: boolean; // Use atomic POST instead of SSE streaming (essential for Cloudflare tunnels)
  verbose: boolean;
}
