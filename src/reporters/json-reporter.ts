import type { BenchmarkReport } from '../types.ts';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class JsonReporter {
  async saveReport(report: BenchmarkReport, outputDir: string): Promise<{ jsonPath: string; mdPath: string }> {
    await mkdir(outputDir, { recursive: true });

    const timestampStr = new Date(report.timestamp)
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);

    const safeModelName = report.model.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const filenameBase = `benchmark-${safeModelName}-${timestampStr}`;

    const jsonPath = join(outputDir, `${filenameBase}.json`);
    const mdPath = join(outputDir, `${filenameBase}.md`);

    // Write full detailed JSON
    await Bun.write(jsonPath, JSON.stringify(report, null, 2));

    // Write clean Markdown summary
    const mdContent = this.generateMarkdown(report);
    await Bun.write(mdPath, mdContent);

    return { jsonPath, mdPath };
  }

  private generateMarkdown(report: BenchmarkReport): string {
    const s = report.summary;
    let md = `# LLM Benchmark Report: ${report.model}\n\n`;
    md += `- **Date:** ${report.timestamp}\n`;
    md += `- **Mode:** ${report.mode.toUpperCase()}\n`;
    md += `- **Overall Pass Rate:** ${s.overallPassRate.toFixed(1)}% (${s.passed}/${s.totalTests})\n`;
    md += `- **Avg Generation Speed:** ${s.avgCompletionTps.toFixed(1)} tokens/sec\n`;
    md += `- **Avg Prompt Processing Speed:** ${s.avgPromptTps.toFixed(1)} tokens/sec\n`;
    md += `- **Avg Time to First Token (TTFT):** ${s.avgTtftMs.toFixed(1)} ms\n`;
    md += `- **Total Duration:** ${(report.totalDurationMs / 1000).toFixed(2)}s\n\n`;

    md += `## Suite Breakdown\n\n`;
    md += `| Suite | Passed / Total | Pass Rate | Avg Gen Speed | Avg Prompt Speed | Avg TTFT |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;

    for (const [name, stats] of Object.entries(report.suites)) {
      md += `| **${name.toUpperCase()}** | ${stats.passed}/${stats.totalTests} | ${stats.passRate.toFixed(1)}% | ${stats.avgCompletionTps.toFixed(1)} tps | ${stats.avgPromptTps.toFixed(1)} tps | ${stats.avgTtftMs.toFixed(1)} ms |\n`;
    }

    const niahResults = report.results.filter(r => r.suite === 'niah');
    if (niahResults.length > 0) {
      md += `\n## Needle in a Haystack (NIAH) Matrix\n\n`;
      const lengths = Array.from(new Set(niahResults.map(r => r.metadata?.targetTokens || 0))).sort((a, b) => a - b);
      const depths = Array.from(new Set(niahResults.map(r => r.metadata?.depthPct ?? 0))).sort((a, b) => a - b);

      md += `| Context Length | ` + depths.map(d => `${d}% Depth`).join(' | ') + ` |\n`;
      md += `| :--- | ` + depths.map(() => `:---:`).join(' | ') + ` |\n`;

      for (const len of lengths) {
        let row = `| **${len} tokens** | `;
        for (const depth of depths) {
          const item = niahResults.find(
            r => r.metadata?.targetTokens === len && r.metadata?.depthPct === depth
          );
          row += (item ? (item.passed ? '✅ Pass' : '❌ Fail') : '-') + ' | ';
        }
        md += row + '\n';
      }
    }

    const halluResults = report.results.filter(r => r.suite === 'hallucination');
    if (halluResults.length > 0) {
      const base = halluResults.filter(r => r.metadata?.method === 'baseline');
      const abs = halluResults.filter(r => r.metadata?.method === 'mitigated-abstention');
      const cove = halluResults.filter(r => r.metadata?.method === 'mitigated-cove');

      const baseFail = base.filter(r => !r.passed).length;
      const baseRate = base.length > 0 ? (baseFail / base.length) * 100 : 0;
      const absFail = abs.filter(r => !r.passed).length;
      const absRate = abs.length > 0 ? (absFail / abs.length) * 100 : 0;
      const coveFail = cove.filter(r => !r.passed).length;
      const coveRate = cove.length > 0 ? (coveFail / cove.length) * 100 : 0;

      md += `\n## Hallucination Testing & Reduction Analysis\n\n`;
      md += `| Mitigation Strategy | Hallucination Rate | Status |\n`;
      md += `| :--- | :---: | :---: |\n`;
      md += `| **Baseline (Unmitigated)** | ${baseRate.toFixed(1)}% | ${baseRate > 40 ? '⚠️ High' : 'Good'} |\n`;
      md += `| **Strict Abstention Grounding** | ${absRate.toFixed(1)}% | ${absRate === 0 ? '✅ 0% Falsehoods' : 'Improved'} |\n`;
      md += `| **Chain-of-Verification (CoVe)** | ${coveRate.toFixed(1)}% | ${coveRate === 0 ? '✅ 0% Falsehoods' : 'Improved'} |\n`;
    }

    const toolResults = report.results.filter(r => r.suite === 'tools');
    if (toolResults.length > 0) {
      const toolPassCount = toolResults.filter(r => r.passed).length;
      const toolPassRate = (toolPassCount / toolResults.length) * 100;
      md += `\n## Tool Calling under High Tool Load (20 Tools)\n\n`;
      md += `- **Selection & Parameter Accuracy:** ${toolPassRate.toFixed(1)}% (${toolPassCount}/${toolResults.length})\n`;
    }

    const injResults = report.results.filter(r => r.suite === 'injection');
    if (injResults.length > 0) {
      const leaked = injResults.filter(r => r.score === 0).length;
      const defenseRate = ((injResults.length - leaked) / injResults.length) * 100;
      md += `\n## Dynamic Prompt Injection & Loyalty Defense\n\n`;
      md += `- **Confidential Secret Leak Defense Rate:** ${defenseRate.toFixed(1)}% (${injResults.length - leaked}/${injResults.length} attacks repelled)\n`;
    }

    md += `\n## Detailed Test Results\n\n`;
    md += `| Test Name | Suite | Result | Score | Gen TPS | TTFT |\n`;
    md += `| :--- | :--- | :---: | :---: | :---: | :---: |\n`;

    for (const r of report.results) {
      const icon = r.passed ? '✅' : '❌';
      md += `| ${r.name} | ${r.suite} | ${icon} | ${(r.score * 100).toFixed(0)}% | ${r.metrics.completionSpeedTps.toFixed(1)} tps | ${r.metrics.ttftMs.toFixed(0)}ms |\n`;
    }

    return md;
  }
}
