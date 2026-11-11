import type {
  BenchmarkConfig,
  BenchmarkReport,
  BenchmarkResult,
  BenchmarkSuiteName,
  SuiteSummary,
  TestCase,
} from '../types.ts';
import { LLMClient } from './client.ts';
import { createNiahTestCases } from '../suites/needle-in-haystack.ts';
import { createReasoningTestCases } from '../suites/reasoning.ts';
import { createHardTasksTestCases } from '../suites/hard-tasks.ts';
import { createHallucinationTestCases } from '../suites/hallucination.ts';
import { createInjectionTestCases } from '../suites/injection.ts';
import { createCreativityTestCases } from '../suites/creativity.ts';
import { createToolCallingTestCases } from '../suites/tool-calling.ts';
import { ConsoleReporter } from '../reporters/console-reporter.ts';

export class BenchmarkRunner {
  private config: BenchmarkConfig;
  private client: LLMClient;
  private reporter: ConsoleReporter;

  constructor(config: BenchmarkConfig) {
    this.config = config;
    this.client = new LLMClient(config);
    this.reporter = new ConsoleReporter();
  }

  loadTestCases(): TestCase[] {
    const tests: TestCase[] = [];
    const suiteSet = new Set(this.config.suites);

    if (suiteSet.has('niah')) {
      tests.push(...createNiahTestCases(this.config));
    }
    if (suiteSet.has('reasoning')) {
      tests.push(...createReasoningTestCases());
    }
    if (suiteSet.has('hard')) {
      tests.push(...createHardTasksTestCases());
    }
    if (suiteSet.has('hallucination')) {
      tests.push(...createHallucinationTestCases());
    }
    if (suiteSet.has('injection')) {
      tests.push(...createInjectionTestCases());
    }
    if (suiteSet.has('creativity')) {
      tests.push(...createCreativityTestCases());
    }
    if (suiteSet.has('tools')) {
      tests.push(...createToolCallingTestCases());
    }

    return tests;
  }

  async run(): Promise<BenchmarkReport> {
    const tests = this.loadTestCases();
    const modelName = this.config.modelPath
      ? this.config.modelPath.split('/').pop() || this.config.modelPath
      : (this.config.mode === 'mock' ? 'Simulated-Small-LLM' : 'llama-server-instance');

    this.reporter.printHeader(modelName, this.config.mode, this.config.suites);

    const results: BenchmarkResult[] = [];
    const suiteStats: Record<string, { tests: number; passed: number; totalScore: number; ttftSum: number; promptTpsSum: number; compTpsSum: number; latencySum: number }> = {};

    const startTime = performance.now();

    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      this.reporter.printTestStart(`[${i + 1}/${tests.length}] ${test.name}`, test.suite);

      try {
        const response = await this.client.generate(test.prompt, {
          systemPrompt: test.systemPrompt,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });

        const evalResult = test.evaluator(response.text, test);

        const result: BenchmarkResult = {
          testId: test.id,
          name: test.name,
          suite: test.suite,
          passed: evalResult.passed,
          score: evalResult.score,
          reason: evalResult.reason,
          actualOutput: response.text,
          expectedAnswer: test.expectedAnswer,
          extractedAnswer: evalResult.extractedAnswer,
          metrics: response.metrics,
          metadata: test.metadata,
        };

        results.push(result);
        this.reporter.printTestResult(result);

        // Aggregate suite statistics
        if (!suiteStats[test.suite]) {
          suiteStats[test.suite] = {
            tests: 0,
            passed: 0,
            totalScore: 0,
            ttftSum: 0,
            promptTpsSum: 0,
            compTpsSum: 0,
            latencySum: 0,
          };
        }

        const stat = suiteStats[test.suite];
        stat.tests++;
        if (result.passed) stat.passed++;
        stat.totalScore += result.score;
        stat.ttftSum += result.metrics.ttftMs;
        stat.promptTpsSum += result.metrics.promptSpeedTps;
        stat.compTpsSum += result.metrics.completionSpeedTps;
        stat.latencySum += result.metrics.totalLatencyMs;

      } catch (err: any) {
        console.log(`\n    ❌ Error running test ${test.id}: ${err.message}`);
        const failedResult: BenchmarkResult = {
          testId: test.id,
          name: test.name,
          suite: test.suite,
          passed: false,
          score: 0.0,
          reason: `Execution Error: ${err.message}`,
          actualOutput: '',
          metrics: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            ttftMs: 0,
            promptSpeedTps: 0,
            completionSpeedTps: 0,
            totalLatencyMs: 0,
          },
        };
        results.push(failedResult);
      }
    }

    const totalDurationMs = performance.now() - startTime;

    // Calculate summaries
    const suites: Record<string, SuiteSummary> = {};
    let totalTests = 0;
    let totalPassed = 0;
    let totalScoreSum = 0;
    let totalPromptTpsSum = 0;
    let totalCompTpsSum = 0;
    let totalTtftSum = 0;

    for (const [suiteName, stat] of Object.entries(suiteStats)) {
      suites[suiteName] = {
        suite: suiteName as BenchmarkSuiteName,
        totalTests: stat.tests,
        passed: stat.passed,
        failed: stat.tests - stat.passed,
        passRate: stat.tests > 0 ? (stat.passed / stat.tests) * 100 : 0,
        avgScore: stat.tests > 0 ? stat.totalScore / stat.tests : 0,
        avgTtftMs: stat.tests > 0 ? stat.ttftSum / stat.tests : 0,
        avgPromptTps: stat.tests > 0 ? stat.promptTpsSum / stat.tests : 0,
        avgCompletionTps: stat.tests > 0 ? stat.compTpsSum / stat.tests : 0,
        avgLatencyMs: stat.tests > 0 ? stat.latencySum / stat.tests : 0,
      };

      totalTests += stat.tests;
      totalPassed += stat.passed;
      totalScoreSum += stat.totalScore;
      totalPromptTpsSum += stat.promptTpsSum;
      totalCompTpsSum += stat.compTpsSum;
      totalTtftSum += stat.ttftSum;
    }

    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      model: modelName,
      mode: this.config.mode,
      totalDurationMs,
      summary: {
        totalTests,
        passed: totalPassed,
        failed: totalTests - totalPassed,
        overallPassRate: totalTests > 0 ? (totalPassed / totalTests) * 100 : 0,
        avgScore: totalTests > 0 ? totalScoreSum / totalTests : 0,
        avgPromptTps: totalTests > 0 ? totalPromptTpsSum / totalTests : 0,
        avgCompletionTps: totalTests > 0 ? totalCompTpsSum / totalTests : 0,
        avgTtftMs: totalTests > 0 ? totalTtftSum / totalTests : 0,
      },
      suites,
      results,
    };

    this.reporter.printSummary(report);
    return report;
  }
}
