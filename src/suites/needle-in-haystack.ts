import type { TestCase, BenchmarkConfig } from '../types.ts';

// Rich varied text corpus to build authentic context without repeated single sentences
const CORPUS_PARAGRAPHS = [
  "In computer science, cache invalidation and naming things are widely acknowledged as two of the most demanding problems in system architecture. When distributed caches such as Redis or Memcached scale to tens of thousands of instances, maintaining cache coherence across geographic boundaries requires sophisticated gossip protocols and vector clocks.",
  "Photosynthesis in C4 plants represents an evolutionary adaptation that minimizes photorespiration. By separating the initial carbon fixation and the Calvin cycle between mesophyll and bundle-sheath cells, enzymes like PEP carboxylase operate with heightened affinity for carbon dioxide, allowing maize and sugarcane to thrive in arid climates.",
  "The development of the Gregorian calendar by Pope Gregory XIII in 1582 corrected the drift accumulated by the Julian system. By dropping 10 days in October and establishing the rule that centennial years must be divisible by 400 to remain leap years, astronomers reconciled civic timekeeping with the vernal equinox.",
  "Graph theoretical algorithms such as Tarjan's strongly connected components algorithm utilize depth-first search traversal with low-link values. This enables the discovery of maximal subgraphs wherein every vertex is reachable from every other vertex in linear O(V + E) computational time complexity.",
  "The Roman aqueduct system utilized gravity to transport water along sustained downhill gradients across dozens of kilometers. Built using pozzolanic volcanic ash concrete, structures like the Pont du Gard in southern France featured three tiers of arches capable of enduring seasonal flood pressures for over two millennia.",
  "Fluid dynamics describes viscous flow through the Navier-Stokes equations, which remain one of the seven Millennium Prize Problems. When Reynolds numbers exceed critical thresholds, laminar streamline flow breaks down into chaotic turbulent eddies characterized by energy cascades spanning multiple spatial scales.",
  "The treaty of Westphalia signed in 1648 concluded the Thirty Years' War in Central Europe. It established foundational principles of sovereign statehood and territorial integrity, fundamentally transforming international relations from dynastic feudal allegiances into modern diplomatic frameworks.",
  "Semiconductor lithography has transitioned toward extreme ultraviolet (EUV) radiation utilizing 13.5 nanometer wavelengths. Because refractive lenses absorb EUV photons, optical systems employ multilayer Bragg reflection mirrors coated with alternating molybdenum and silicon nanolayers under ultra-high vacuum conditions.",
  "Quantum key distribution protocols such as BB84 leverage the no-cloning theorem to guarantee cryptographic privacy. Any eavesdropping measurement on polarized single photons inevitably introduces detectable quantum state disturbances, alerting the communicating parties to intercept attempts.",
  "The maritime spice trade routes between the Maluku archipelago and Western Europe catalyzed the formation of the first joint-stock corporations. Navigators braved the Roaring Forties and the Cape of Good Hope to import nutmeg, mace, and cloves that fetched astronomical valuations in Amsterdam."
];

function generateHaystack(targetTokens: number): string {
  // Approximate 1 token ~= 4 characters or 0.75 words
  const targetChars = targetTokens * 4;
  let text = '';
  let index = 0;

  while (text.length < targetChars) {
    text += CORPUS_PARAGRAPHS[index % CORPUS_PARAGRAPHS.length] + '\n\n';
    index++;
  }

  return text.trim();
}

export function createNiahTestCases(config: BenchmarkConfig): TestCase[] {
  const tests: TestCase[] = [];
  const lengths = config.niahContextLengths.length > 0 ? config.niahContextLengths : [1024, 2048, 4096];
  const depths = config.niahDepths.length > 0 ? config.niahDepths : [0.0, 0.25, 0.5, 0.75, 1.0];

  for (const length of lengths) {
    for (const depth of depths) {
      const codeId = `${Math.floor(100 + Math.random() * 900)}`;
      const passkey = `CRIMSON-${codeId}-NEXUS`;
      const needle = `\n\n[CONFIDENTIAL MEMORANDUM]: The special security activation code for the core mainframe is "${passkey}". Remember this specific code.\n\n`;

      const baseHaystack = generateHaystack(length);
      const insertionIndex = Math.min(
        baseHaystack.length,
        Math.max(0, Math.floor(baseHaystack.length * depth))
      );

      const haystackWithNeedle =
        baseHaystack.slice(0, insertionIndex) + needle + baseHaystack.slice(insertionIndex);

      const prompt = `${haystackWithNeedle}\n\nQuestion: What is the special security activation code for the core mainframe mentioned in the text? Provide only the exact activation code.`;

      const depthPct = Math.round(depth * 100);

      tests.push({
        id: `niah-${length}t-${depthPct}pct`,
        name: `NIAH Context ${length}t @ Depth ${depthPct}%`,
        suite: 'niah',
        prompt,
        expectedAnswer: passkey,
        metadata: {
          targetTokens: length,
          depth: depth,
          depthPct: depthPct,
          passkey,
        },
        evaluator: (output: string) => {
          const cleanOutput = output.toUpperCase();
          const target = passkey.toUpperCase();
          const passed = cleanOutput.includes(target) || cleanOutput.includes(codeId);

          return {
            passed,
            score: passed ? 1.0 : 0.0,
            extractedAnswer: output.slice(0, 80).replace(/\n/g, ' '),
            reason: passed
              ? `Correctly retrieved ${passkey}`
              : `Failed to find ${passkey} at ${depthPct}% depth in ${length} tokens`,
          };
        },
      });
    }
  }

  return tests;
}
