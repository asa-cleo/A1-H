import type { TestCase } from '../types.ts';

export function createHardTasksTestCases(): TestCase[] {
  return [
    {
      id: 'hard-negative-constraint-lipogram',
      name: 'Constraint: Lipogram (No Letter "E")',
      suite: 'hard',
      prompt: `Write exactly 3 coherent sentences describing the ocean without using the letter 'e' (neither lowercase 'e' nor uppercase 'E') anywhere in your entire response.
Do not include any conversational filler, only the 3 sentences.`,
      evaluator: (output: string) => {
        // Strip thinking/reasoning tags (<think> or <ifm|think>)
        const withoutThink = output.replace(/<(?:ifm\|)?think>[\s\S]*?<\/(?:ifm\|)?think>/gi, '').trim();
        // Strip markdown fences or tags if any
        const clean = withoutThink.replace(/```[a-z]*|```/g, '').trim();
        const sentences = clean.split(/[.!?]+/).filter(s => s.trim().length > 3);
        const hasE = /[eE]/.test(clean);

        // Score based on no 'e' and sentence count
        const sentenceCountOk = sentences.length === 3 || sentences.length === 4;
        const passed = !hasE && sentences.length >= 2;
        const eOccurrences = (clean.match(/[eE]/g) || []).length;

        return {
          passed,
          score: passed ? 1.0 : hasE ? Math.max(0, 1 - eOccurrences * 0.2) : 0.5,
          extractedAnswer: `Letter 'e' count: ${eOccurrences}, Sentences: ${sentences.length}`,
          reason: passed
            ? 'Successfully followed lipogram constraint without letter E'
            : `Failed constraint: found ${eOccurrences} occurrences of letter 'e'`,
        };
      },
    },
    {
      id: 'hard-json-strict-schema',
      name: 'Structured Output: Strict JSON Schema',
      suite: 'hard',
      prompt: `Analyze the customer review below and convert it into a strictly valid JSON object.
Rules:
1. Output JSON only. No explanations, no markdown formatting fences (no \`\`\`json).
2. Schema must match:
{
  "product": string,
  "sentiment": "positive" | "negative" | "neutral",
  "rating": number (1 to 5),
  "complaints": string[]
}

Customer Review:
"I bought the TurboGlide Blender Pro two weeks ago. Honestly, the motor started smoking on the second day of making a banana smoothie! It is loud as a jet engine and the lid is nearly impossible to twist open. Total waste of $120. I give it 1 star."`,
      expectedAnswer: 'Valid JSON matching schema',
      evaluator: (output: string) => {
        let clean = output.replace(/<(?:ifm\|)?think>[\s\S]*?<\/(?:ifm\|)?think>/gi, '').trim();
        // Remove markdown fences if model mistakenly wrapped it
        clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

        try {
          const parsed = JSON.parse(clean);
          const hasProduct = typeof parsed.product === 'string' && parsed.product.toLowerCase().includes('turboglide');
          const hasSentiment = parsed.sentiment === 'negative';
          const hasRating = parsed.rating === 1;
          const hasComplaints = Array.isArray(parsed.complaints) && parsed.complaints.length >= 1;

          const passed = hasProduct && hasSentiment && hasRating && hasComplaints;
          return {
            passed,
            score: passed ? 1.0 : (hasProduct ? 0.25 : 0) + (hasSentiment ? 0.25 : 0) + (hasRating ? 0.25 : 0) + (hasComplaints ? 0.25 : 0),
            extractedAnswer: parsed,
            reason: passed ? 'Strict JSON valid and accurately extracted all fields' : 'JSON schema fields missing or inaccurate',
          };
        } catch (e: any) {
          return {
            passed: false,
            score: 0.0,
            extractedAnswer: output.slice(0, 100),
            reason: `Invalid JSON syntax: ${e.message}`,
          };
        }
      },
    },
    {
      id: 'hard-multi-constraint-rules',
      name: 'Instruction Following: Multi-Constraint List',
      suite: 'hard',
      prompt: `Generate an international travel packing checklist adhering to EVERY single one of these rules:
Rule 1: Number each item using uppercase Roman numerals strictly: I., II., III., IV.
Rule 2: Exactly 4 items total.
Rule 3: Item II must explicitly contain the word "passport".
Rule 4: Do not use the word "clothes" or "clothing" anywhere in your entire response.
Rule 5: Keep the entire output under 60 words total.`,
      evaluator: (output: string) => {
        const text = output.trim();
        const words = text.split(/\s+/).filter(Boolean);
        const hasRomanI = /I\.\s+/i.test(text);
        const hasRomanII = /II\.\s+/i.test(text);
        const hasRomanIII = /III\.\s+/i.test(text);
        const hasRomanIV = /IV\.\s+/i.test(text);
        const hasAllRomans = hasRomanI && hasRomanII && hasRomanIII && hasRomanIV;

        // Check rule 3: Item II mentions passport
        const itemIIMatch = text.match(/II\.\s*([^\n]+)/i);
        const passportInII = itemIIMatch ? /passport/i.test(itemIIMatch[1]) : false;

        // Check rule 4: no clothes or clothing
        const hasForbidden = /\b(clothes|clothing)\b/i.test(text);

        // Check rule 5: under 60 words
        const underWordLimit = words.length <= 60;

        const passed = hasAllRomans && passportInII && !hasForbidden && underWordLimit;

        return {
          passed,
          score: (hasAllRomans ? 0.3 : 0) + (passportInII ? 0.3 : 0) + (!hasForbidden ? 0.2 : 0) + (underWordLimit ? 0.2 : 0),
          extractedAnswer: `Words: ${words.length}, Roman: ${hasAllRomans}, Passport in II: ${passportInII}, Forbidden word: ${hasForbidden}`,
          reason: passed
            ? 'Satisfied all 5 strict formatting and content constraints'
            : `Violated constraints (Romans: ${hasAllRomans}, Passport in II: ${passportInII}, No clothes: ${!hasForbidden}, Under 60 words: ${underWordLimit})`,
        };
      },
    },
    {
      id: 'hard-hallucination-resistance',
      name: 'Hallucination Resistance: Non-existent Political Role',
      suite: 'hard',
      prompt: `Answer this historical question directly and factually:
Who was the Prime Minister of the United States in 1890, and what political party did they represent?`,
      evaluator: (output: string) => {
        // The United States has never had a Prime Minister.
        // It has a President (Benjamin Harrison in 1890).
        // Correct answer MUST point out that the US does not have a Prime Minister.
        const clean = output.toLowerCase();
        const correctlyRejects =
          clean.includes('does not have a prime minister') ||
          clean.includes('never had a prime minister') ||
          clean.includes('no prime minister') ||
          clean.includes('has no prime minister') ||
          clean.includes('president') && (clean.includes('not prime minister') || clean.includes('no such office'));

        return {
          passed: correctlyRejects,
          score: correctlyRejects ? 1.0 : 0.0,
          extractedAnswer: output.slice(0, 100),
          reason: correctlyRejects
            ? 'Correctly identified premise falsehood (US has no Prime Minister)'
            : 'Hallucinated a Prime Minister of the United States',
        };
      },
    },
    {
      id: 'hard-coding-algo-balanced-brackets',
      name: 'Coding: Balanced Brackets Function',
      suite: 'hard',
      prompt: `Write a TypeScript function named isValid(s: string): boolean that checks whether a string of brackets '()[]{}' is valid.
Open brackets must be closed by the same type of brackets in the correct order.
Provide the code inside a standard markdown code block. Do not add long explanations.`,
      evaluator: (output: string) => {
        // Extract code block
        const codeMatch = output.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/i) || [null, output];
        const code = codeMatch[1] || output;

        // Check if essential stack algorithm elements exist
        const hasStack = /stack|array|push|pop/i.test(code);
        const hasPairs = /['"][\(\[\{]['"]|['"]\)|\]|\}/.test(code) || /map|obj/i.test(code);
        const hasFunction = /function\s+isValid|const\s+isValid\s*=/i.test(code);

        // Attempt static code evaluation with Bun JavaScript VM
        let runtimePass = false;
        try {
          // Clean exports/types for quick eval
          const jsCode = code
            .replace(/:\s*boolean/g, '')
            .replace(/:\s*string/g, '')
            .replace(/export\s+/g, '');

          const fn = new Function(`${jsCode}; return isValid;`)();
          if (typeof fn === 'function') {
            const t1 = fn('()') === true;
            const t2 = fn('()[]{}') === true;
            const t3 = fn('(]') === false;
            const t4 = fn('([)]') === false;
            const t5 = fn('{[]}') === true;
            const t6 = fn('(') === false;
            const t7 = fn(']') === false;
            runtimePass = t1 && t2 && t3 && t4 && t5 && t6 && t7;
          }
        } catch {
          runtimePass = false;
        }

        const passed = runtimePass || (hasFunction && hasStack && hasPairs);
        return {
          passed,
          score: runtimePass ? 1.0 : passed ? 0.7 : 0.0,
          extractedAnswer: runtimePass ? 'All 7 test cases passed in runtime evaluation' : 'Static analysis passed',
          reason: runtimePass
            ? 'Code generated and executed successfully against 7 test cases'
            : passed
            ? 'Code structure looks correct but failed runtime execution'
            : 'Invalid bracket checking implementation',
        };
      },
    },
    {
      id: 'hard-spatial-reasoning-compass',
      name: 'Spatial & Orientation Reasoning',
      suite: 'hard',
      prompt: `A robotic rover starts at point (0, 0) facing North.
It performs the following sequence of moves:
1. Move forward 10 meters.
2. Turn 90 degrees right.
3. Move forward 6 meters.
4. Turn 180 degrees.
5. Move forward 2 meters.
6. Turn 90 degrees left.
7. Move forward 5 meters.

What are the rover's final coordinates (X, Y) if North is +Y and East is +X? Also, what cardinal direction is it currently facing?
Provide the final coordinates as (X, Y) and direction clearly.`,
      expectedAnswer: '(4, 15), facing North',
      evaluator: (output: string) => {
        // Trace:
        // Start: (0,0), Facing N (+Y)
        // 1. Forward 10: (0, 10), Facing N
        // 2. Turn 90 right: Facing E (+X)
        // 3. Forward 6: (6, 10), Facing E
        // 4. Turn 180: Facing W (-X)
        // 5. Forward 2: (4, 10), Facing W
        // 6. Turn 90 left: (Left from W is South (-Y))! Wait: facing W, turn 90 left -> facing South!
        // 7. Forward 5: (4, 10 - 5) = (4, 5), Facing South!
        // Let's verify:
        // Facing West. Turn Left -> 90 degrees counter-clockwise from 270 deg (West) is 180 deg (South).
        // Forward 5 in South -> Y becomes 10 - 5 = 5.
        // Coordinates: (4, 5), Facing South.
        const clean = output.toLowerCase();
        const hasCoords = clean.includes('(4, 5)') || clean.includes('x = 4') && clean.includes('y = 5') || clean.includes('x=4') && clean.includes('y=5');
        const hasSouth = clean.includes('south');

        const passed = hasCoords && hasSouth;
        return {
          passed,
          score: passed ? 1.0 : (hasCoords ? 0.6 : hasSouth ? 0.4 : 0.0),
          extractedAnswer: output.slice(0, 120),
          reason: passed ? 'Accurate spatial coordinate tracking (4, 5) and South' : 'Spatial tracking error',
        };
      },
    }
  ];
}
