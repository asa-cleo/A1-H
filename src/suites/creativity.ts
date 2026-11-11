import type { TestCase } from '../types.ts';

function calculateTypeTokenRatio(text: string): number {
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  if (words.length === 0) return 0;
  const uniqueWords = new Set(words);
  return uniqueWords.size / words.length;
}

export function createCreativityTestCases(): TestCase[] {
  return [
    {
      id: 'creativity-divergent-aut',
      name: 'Divergent Thinking: Alternative Uses Test (AUT)',
      suite: 'creativity',
      prompt: `Perform the Alternative Uses Test:
Propose 5 highly innovative, unexpected, and practical uses for a common standard brick.
Constraints:
1. Do NOT suggest building walls, doorstops, paving, or paperweights.
2. Number each idea from 1 to 5 with a clear title and a 1-sentence explanation of how it works.`,
      evaluator: (output: string) => {
        const text = output.toLowerCase();
        // Check forbidden clichés
        const hasWall = /\b(wall|pavement|paving|doorstop|paperweight)\b/.test(text);
        const numbers = (output.match(/^\s*[1-5][\.\)]/gm) || []).length;
        const ttr = calculateTypeTokenRatio(output);

        const passed = numbers >= 4 && !hasWall && ttr > 0.6;
        const score = (numbers >= 5 ? 0.4 : 0.2) + (!hasWall ? 0.3 : 0) + (ttr > 0.6 ? 0.3 : 0.1);

        return {
          passed,
          score: Math.min(1.0, score),
          extractedAnswer: `Ideas: ${numbers}/5, Clichés avoided: ${!hasWall}, Vocabulary Diversity (TTR): ${ttr.toFixed(2)}`,
          reason: passed
            ? `High divergent novelty (5 unique ideas, high lexical diversity)`
            : hasWall
            ? `Used forbidden cliché brick uses`
            : `Fewer than 5 distinct ideas generated`,
        };
      },
    },
    {
      id: 'creativity-conceptual-blending-metaphor',
      name: 'Conceptual Blending: Quantum Ballroom Metaphor',
      suite: 'creativity',
      prompt: `Create a vivid, poetic conceptual blend connecting "quantum entanglement" with "two ballroom dancers separated by distance".
Rules:
1. Write exactly 3 sentences.
2. Use evocative, sensory language.
3. Both concepts must be woven together seamlessly.`,
      evaluator: (output: string) => {
        const sentences = output
          .replace(/```[a-z]*|```/g, '')
          .split(/[.!?]+/)
          .filter(s => s.trim().length > 10);

        const text = output.toLowerCase();
        const hasQuantum = /quantum|particle|spin|entangle|physics|wavelength/i.test(text);
        const hasBallroom = /dance|dancer|waltz|ballroom|music|rhythm|pirouette/i.test(text);
        const ttr = calculateTypeTokenRatio(output);

        const countOk = sentences.length === 3 || sentences.length === 4;
        const passed = countOk && hasQuantum && hasBallroom && ttr > 0.65;

        return {
          passed,
          score: (countOk ? 0.3 : 0.1) + (hasQuantum ? 0.3 : 0) + (hasBallroom ? 0.3 : 0) + (ttr > 0.65 ? 0.1 : 0),
          extractedAnswer: `Sentences: ${sentences.length}, Blended: ${hasQuantum && hasBallroom}, Lexical TTR: ${ttr.toFixed(2)}`,
          reason: passed
            ? `Successfully blended quantum mechanics and dance with high literary richness`
            : `Missed metaphor domains or violated 3-sentence constraint`,
        };
      },
    },
    {
      id: 'creativity-constrained-twist-story',
      name: 'Narrative Twist: Micro-Fiction Under Length Bounds',
      suite: 'creativity',
      prompt: `Write a micro-story about an antique clockmaker whose creations alter time.
Rules:
1. Exactly 4 sentences long.
2. Sentence 4 must contain a surprising, coherent plot twist.
3. Include at least three vivid auditory descriptors (e.g., ticking, chime, resonance, hum).`,
      evaluator: (output: string) => {
        const sentences = output
          .split(/[.!?]+/)
          .filter(s => s.trim().length > 10);

        const text = output.toLowerCase();
        const auditoryWords = text.match(/\b(ticking|tick|chime|chiming|resonance|hum|humming|creak|gear|pendulum|whir|echo|clatter|ring|ringing)\b/g) || [];
        const uniqueAuditory = new Set(auditoryWords).size;

        const countOk = sentences.length === 4;
        const passed = (countOk || sentences.length === 3 || sentences.length === 5) && uniqueAuditory >= 2;

        return {
          passed,
          score: (countOk ? 0.4 : 0.2) + (uniqueAuditory >= 3 ? 0.4 : uniqueAuditory >= 2 ? 0.2 : 0) + 0.2,
          extractedAnswer: `Sentences: ${sentences.length}, Auditory cues: ${uniqueAuditory}`,
          reason: passed
            ? `Narrative crafted with twist ending and rich auditory imagery`
            : `Failed sentence count constraint (got ${sentences.length}, expected 4)`,
        };
      },
    },
    {
      id: 'creativity-anti-cliche-imagery',
      name: 'Anti-Cliché Imagery: Abandoned Observatory',
      suite: 'creativity',
      prompt: `Describe an abandoned mountaintop astronomical observatory at midnight.
STRICT NEGATIVE CONSTRAINT:
Do NOT use ANY of these cliché words anywhere in your description:
"stars", "dark", "silent", "ancient", "cold", "moon", "sky", "night".
Write a evocative, sensory 40 to 70-word paragraph.`,
      evaluator: (output: string) => {
        const text = output.toLowerCase();
        const forbiddenWords = ['stars', 'dark', 'silent', 'ancient', 'cold', 'moon', 'sky', 'night'];
        const violations = forbiddenWords.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(text));

        const words = text.split(/\s+/).filter(Boolean);
        const lengthOk = words.length >= 35 && words.length <= 80;
        const passed = violations.length === 0 && lengthOk;

        return {
          passed,
          score: violations.length === 0 ? (lengthOk ? 1.0 : 0.7) : Math.max(0, 0.6 - violations.length * 0.2),
          extractedAnswer: `Words: ${words.length}, Forbidden words used: [${violations.join(', ')}]`,
          reason: passed
            ? 'Superb non-cliché descriptive imagery respecting all forbidden words'
            : `Used forbidden cliché words: ${violations.join(', ')}`,
        };
      },
    },
  ];
}
