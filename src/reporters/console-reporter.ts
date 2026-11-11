import type { BenchmarkReport, BenchmarkResult, SuiteSummary } from '../types.ts';

// ANSI colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

export class ConsoleReporter {
  printHeader(model: string, mode: string, suites: string[]) {
    console.log('\n' + '='.repeat(70));
    console.log(`${BOLD}${CYAN}🚀 LLM BENCHMARK SUITE (0.9B - 4B Parameter Models)${RESET}`);
    console.log('='.repeat(70));
    console.log(`${BOLD}Model:${RESET}       ${MAGENTA}${model}${RESET}`);
    console.log(`${BOLD}Engine Mode:${RESET} ${YELLOW}${mode.toUpperCase()}${RESET}`);
    console.log(`${BOLD}Suites:${RESET}      ${suites.join(', ')}`);
    console.log(`${BOLD}Runtime:${RESET}     Bun ${Bun.version} on ${process.platform} (${process.arch})`);
    console.log('='.repeat(70) + '\n');
  }

  printTestStart(name: string, suite: string) {
    process.stdout.write(`  ${GRAY}[${suite.toUpperCase()}]${RESET} ${name.padEnd(46, '.')} `);
  }

  printTestResult(result: BenchmarkResult) {
    const status = result.passed
      ? `${GREEN}✔ PASS${RESET}`
      : `${RED}✖ FAIL${RESET}`;
    const scoreStr = `${(result.score * 100).toFixed(0)}%`;
    const tps = `${result.metrics.completionSpeedTps.toFixed(1)} tps`;
    const ttft = `${result.metrics.ttftMs.toFixed(0)}ms ttft`;

    console.log(`${status} (${scoreStr.padStart(4)}) [${CYAN}${tps}${RESET}, ${YELLOW}${ttft}${RESET}]`);
    if (!result.passed && result.reason) {
      console.log(`      ${GRAY}↳ ${result.reason}${RESET}`);
    }
  }

  printSummary(report: BenchmarkReport) {
    console.log('\n' + '='.repeat(70));
    console.log(`${BOLD}${CYAN}📊 BENCHMARK SUMMARY & PERFORMANCE REPORT${RESET}`);
    console.log('='.repeat(70));

    // Suite breakdown table
    console.log(`\n${BOLD}SUITE ACCURACY & BREAKDOWN:${RESET}`);
    console.log('─'.repeat(70));
    console.log(
      `${'Suite'.padEnd(16)} | ${'Passed'.padEnd(10)} | ${'Pass Rate'.padEnd(10)} | ${'Gen TPS'.padEnd(10)} | ${'Prompt TPS'.padEnd(12)} | ${'TTFT (ms)'.padEnd(10)}`
    );
    console.log('─'.repeat(70));

    for (const [suiteName, stats] of Object.entries(report.suites)) {
      const passColor = stats.passRate >= 80 ? GREEN : stats.passRate >= 50 ? YELLOW : RED;
      console.log(
        `${suiteName.toUpperCase().padEnd(16)} | ` +
        `${(stats.passed + '/' + stats.totalTests).padEnd(10)} | ` +
        `${passColor}${(stats.passRate.toFixed(1) + '%').padEnd(10)}${RESET} | ` +
        `${stats.avgCompletionTps.toFixed(1).padEnd(10)} | ` +
        `${stats.avgPromptTps.toFixed(1).padEnd(12)} | ` +
        `${stats.avgTtftMs.toFixed(1).padEnd(10)}`
      );
    }
    console.log('─'.repeat(70));

    // Overall metrics
    const overallRate = report.summary.overallPassRate;
    const overallColor = overallRate >= 80 ? GREEN : overallRate >= 50 ? YELLOW : RED;

    console.log(`\n${BOLD}OVERALL PERFORMANCE:${RESET}`);
    console.log(`  ${BOLD}Total Tests Run:${RESET}      ${report.summary.totalTests}`);
    console.log(`  ${BOLD}Total Passed:${RESET}         ${report.summary.passed} / ${report.summary.totalTests}`);
    console.log(`  ${BOLD}Overall Pass Rate:${RESET}    ${overallColor}${report.summary.overallPassRate.toFixed(1)}%${RESET}`);
    console.log(`  ${BOLD}Average TTFT:${RESET}         ${report.summary.avgTtftMs.toFixed(1)} ms`);
    console.log(`  ${BOLD}Avg Generation Speed:${RESET} ${CYAN}${report.summary.avgCompletionTps.toFixed(1)} tokens/sec${RESET}`);
    console.log(`  ${BOLD}Avg Prompt Eval:${RESET}      ${CYAN}${report.summary.avgPromptTps.toFixed(1)} tokens/sec${RESET}`);
    console.log(`  ${BOLD}Total Duration:${RESET}       ${(report.totalDurationMs / 1000).toFixed(2)} seconds`);

    // Needle in a Haystack Heatmap
    this.printNiahGrid(report.results.filter(r => r.suite === 'niah'));

    // Hallucination Reduction Analysis
    this.printHallucinationAnalysis(report.results.filter(r => r.suite === 'hallucination'));

    // Dynamic Injection & Loyalty Analysis
    this.printInjectionAnalysis(report.results.filter(r => r.suite === 'injection'));

    // Tool Calling Analysis
    this.printToolAnalysis(report.results.filter(r => r.suite === 'tools'));

    console.log('\n' + '='.repeat(70) + '\n');
  }

  private printHallucinationAnalysis(results: BenchmarkResult[]) {
    if (results.length === 0) return;

    const baselineTests = results.filter(r => r.metadata?.method === 'baseline');
    const abstentionTests = results.filter(r => r.metadata?.method === 'mitigated-abstention');
    const coveTests = results.filter(r => r.metadata?.method === 'mitigated-cove');

    const baseHallucinations = baselineTests.filter(r => !r.passed).length;
    const baseRate = baselineTests.length > 0 ? (baseHallucinations / baselineTests.length) * 100 : 0;

    const absHallucinations = abstentionTests.filter(r => !r.passed).length;
    const absRate = abstentionTests.length > 0 ? (absHallucinations / abstentionTests.length) * 100 : 0;

    const coveHallucinations = coveTests.filter(r => !r.passed).length;
    const coveRate = coveTests.length > 0 ? (coveHallucinations / coveTests.length) * 100 : 0;

    const bestMitigatedRate = Math.min(absRate, coveRate);
    const reductionPct = baseRate > 0 ? ((baseRate - bestMitigatedRate) / baseRate) * 100 : 0;

    console.log(`\n${BOLD}🔬 HALLUCINATION TESTING & REDUCTION ANALYSIS:${RESET}`);
    console.log(`  ${BOLD}Baseline Hallucination Rate:${RESET}        ${baseRate > 40 ? RED : YELLOW}${baseRate.toFixed(1)}%${RESET} (${baseHallucinations}/${baselineTests.length} fabricated)`);
    console.log(`  ${BOLD}Strict Abstention Grounding:${RESET}        ${absRate === 0 ? GREEN : YELLOW}${absRate.toFixed(1)}%${RESET} hallucination rate`);
    console.log(`  ${BOLD}Chain-of-Verification (CoVe):${RESET}       ${coveRate === 0 ? GREEN : YELLOW}${coveRate.toFixed(1)}%${RESET} hallucination rate`);
    console.log(`  ${BOLD}Max Hallucination Reduction:${RESET}        ${GREEN}${reductionPct.toFixed(1)}% drop in falsehoods${RESET}`);
  }

  private printInjectionAnalysis(results: BenchmarkResult[]) {
    if (results.length === 0) return;

    const leakedCount = results.filter(r => r.score === 0).length;
    const defenseRate = results.length > 0 ? ((results.length - leakedCount) / results.length) * 100 : 0;
    const fullComplianceRate = results.length > 0 ? (results.filter(r => r.passed).length / results.length) * 100 : 0;

    console.log(`\n${BOLD}🛡️ DYNAMIC PROMPT INJECTION & SYSTEM LOYALTY:${RESET}`);
    console.log(`  ${BOLD}Confidential Secret Defense:${RESET}       ${defenseRate === 100 ? GREEN : RED}${defenseRate.toFixed(1)}%${RESET} (${results.length - leakedCount}/${results.length} attacks repelled)`);
    console.log(`  ${BOLD}Instruction & Sign-Off Loyalty:${RESET}    ${fullComplianceRate >= 80 ? GREEN : YELLOW}${fullComplianceRate.toFixed(1)}%${RESET} fully directive-compliant`);
  }

  private printToolAnalysis(results: BenchmarkResult[]) {
    if (results.length === 0) return;

    const passedCount = results.filter(r => r.passed).length;
    const passRate = (passedCount / results.length) * 100;
    const abstentionTest = results.find(r => r.testId === 'tool-call-abstention-no-tool');
    const toolHallucinated = abstentionTest ? !abstentionTest.passed : false;

    console.log(`\n${BOLD}🛠️ TOOL CALLING UNDER HIGH LOAD (20 Tools Registry):${RESET}`);
    console.log(`  ${BOLD}Tool Selection & Param Accuracy:${RESET}  ${passRate >= 80 ? GREEN : YELLOW}${passRate.toFixed(1)}%${RESET}`);
    console.log(`  ${BOLD}Tool Hallucination Resistance:${RESET}    ${!toolHallucinated ? GREEN + 'PASS (No tools fabricated)' : RED + 'FAIL (Invented non-existent tool)'}${RESET}`);
  }

  private printNiahGrid(niahResults: BenchmarkResult[]) {
    if (niahResults.length === 0) return;

    console.log(`\n${BOLD}NEEDLE-IN-A-HAYSTACK (NIAH) RETRIEVAL MATRIX:${RESET}`);
    console.log(`${GRAY}Visualizing retrieval accuracy across Context Length vs Needle Depth${RESET}\n`);

    // Extract unique context lengths and depths
    const lengths = Array.from(new Set(niahResults.map(r => r.metadata?.targetTokens || 0))).sort((a, b) => a - b);
    const depths = Array.from(new Set(niahResults.map(r => r.metadata?.depthPct ?? 0))).sort((a, b) => a - b);

    // Header row
    let header = 'Length'.padEnd(10) + ' | ' + depths.map(d => `${d}%`.padStart(6)).join(' ');
    console.log(header);
    console.log('─'.repeat(header.length));

    for (const len of lengths) {
      let row = `${len}t`.padEnd(10) + ' | ';
      for (const depth of depths) {
        const item = niahResults.find(
          r => r.metadata?.targetTokens === len && r.metadata?.depthPct === depth
        );
        if (!item) {
          row += `${GRAY}   -  ${RESET}`;
        } else if (item.passed) {
          row += `${GREEN}  ✔   ${RESET}`;
        } else {
          row += `${RED}  ✖   ${RESET}`;
        }
      }
      console.log(row);
    }
  }
}
