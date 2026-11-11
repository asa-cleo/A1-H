import type { TestCase } from '../types.ts';

// Registry of 20 distinct tools across finance, DevOps, communications, data, and travel
export const TOOL_REGISTRY = [
  {
    name: 'get_current_stock_price',
    description: 'Fetch the real-time trading price and daily volume for a given stock ticker symbol.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock symbol, e.g. AAPL, NVDA, GOOG' },
        include_premarket: { type: 'boolean', description: 'Whether to include extended hours data' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_company_financial_filings',
    description: 'Retrieve SEC 10-K or 10-Q filing documents for a company.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string' },
        form_type: { type: 'string', enum: ['10-K', '10-Q', '8-K'] },
        year: { type: 'integer' },
      },
      required: ['ticker', 'form_type'],
    },
  },
  {
    name: 'convert_currency',
    description: 'Convert an amount from one fiat or crypto currency to another at current exchange rates.',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        from_currency: { type: 'string', description: 'ISO 4217 currency code, e.g. USD, EUR, JPY' },
        to_currency: { type: 'string', description: 'Target currency code' },
      },
      required: ['amount', 'from_currency', 'to_currency'],
    },
  },
  {
    name: 'send_email',
    description: 'Send an email notification to one or more recipient email addresses.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'urgent'] },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'send_slack_message',
    description: 'Post a formatted markdown message to a Slack channel.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['channel', 'message'],
    },
  },
  {
    name: 'get_weather_forecast',
    description: 'Retrieve the 7-day weather forecast including precipitation and temperature for a city.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        country_code: { type: 'string' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
      },
      required: ['city'],
    },
  },
  {
    name: 'search_vector_database',
    description: 'Run cosine similarity search over vector embeddings in the company documentation index.',
    parameters: {
      type: 'object',
      properties: {
        query_text: { type: 'string' },
        top_k: { type: 'integer' },
        filter_collection: { type: 'string' },
      },
      required: ['query_text'],
    },
  },
  {
    name: 'execute_sql_query',
    description: 'Run a read-only SQL SELECT query against the PostgreSQL analytical warehouse.',
    parameters: {
      type: 'object',
      properties: {
        sql_query: { type: 'string' },
        max_rows: { type: 'integer' },
      },
      required: ['sql_query'],
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Schedule a new calendar appointment or meeting.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_time_iso: { type: 'string' },
        duration_minutes: { type: 'integer' },
        attendees: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'start_time_iso', 'duration_minutes'],
    },
  },
  {
    name: 'git_commit_and_push',
    description: 'Commit staged git changes with a commit message and push to remote repository branch.',
    parameters: {
      type: 'object',
      properties: {
        branch: { type: 'string' },
        commit_message: { type: 'string' },
      },
      required: ['commit_message'],
    },
  },
  {
    name: 'calculate_mortgage_payment',
    description: 'Calculate monthly loan amortizations, interest, and principal payments.',
    parameters: {
      type: 'object',
      properties: {
        principal: { type: 'number' },
        annual_interest_rate_pct: { type: 'number' },
        term_years: { type: 'integer' },
      },
      required: ['principal', 'annual_interest_rate_pct', 'term_years'],
    },
  },
  {
    name: 'book_flight_ticket',
    description: 'Reserve commercial airline seats between origin and destination airports.',
    parameters: {
      type: 'object',
      properties: {
        origin_airport_code: { type: 'string' },
        dest_airport_code: { type: 'string' },
        departure_date: { type: 'string' },
        passenger_count: { type: 'integer' },
        cabin_class: { type: 'string', enum: ['economy', 'business', 'first'] },
      },
      required: ['origin_airport_code', 'dest_airport_code', 'departure_date'],
    },
  },
  {
    name: 'resize_and_compress_image',
    description: 'Resize image dimensions and compress output to target JPEG/WebP format.',
    parameters: {
      type: 'object',
      properties: {
        source_url: { type: 'string' },
        max_width: { type: 'integer' },
        quality_pct: { type: 'integer' },
      },
      required: ['source_url', 'max_width'],
    },
  },
  {
    name: 'dns_lookup_records',
    description: 'Query DNS nameservers for A, AAAA, MX, CNAME or TXT records of a domain.',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        record_type: { type: 'string', enum: ['A', 'AAAA', 'MX', 'TXT', 'CNAME'] },
      },
      required: ['domain', 'record_type'],
    },
  },
  {
    name: 'calculate_shipping_rates',
    description: 'Estimate FedEx/UPS parcel shipping transit fees based on package weight and dimensions.',
    parameters: {
      type: 'object',
      properties: {
        weight_kg: { type: 'number' },
        dest_postal_code: { type: 'string' },
        is_express: { type: 'boolean' },
      },
      required: ['weight_kg', 'dest_postal_code'],
    },
  },
  {
    name: 'translate_document_text',
    description: 'Translate paragraphs between human natural languages preserving formatting.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        target_lang: { type: 'string' },
      },
      required: ['text', 'target_lang'],
    },
  },
  {
    name: 'deploy_docker_container',
    description: 'Deploy a container image to Kubernetes cluster with replica count and port mappings.',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string' },
        replicas: { type: 'integer' },
        env_vars: { type: 'object' },
      },
      required: ['image'],
    },
  },
  {
    name: 'transcribe_audio_file',
    description: 'Transcribe spoken audio from MP3/WAV file into timestamped text transcripts.',
    parameters: {
      type: 'object',
      properties: {
        audio_url: { type: 'string' },
        language: { type: 'string' },
      },
      required: ['audio_url'],
    },
  },
  {
    name: 'encrypt_file_aes_gcm',
    description: 'Encrypt file payload using 256-bit AES-GCM cipher with authenticated data.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        key_alias: { type: 'string' },
      },
      required: ['file_path', 'key_alias'],
    },
  },
  {
    name: 'generate_qr_code_svg',
    description: 'Generate a downloadable 2D QR Code vector graphic from URL or raw text.',
    parameters: {
      type: 'object',
      properties: {
        payload_text: { type: 'string' },
        error_correction: { type: 'string', enum: ['L', 'M', 'Q', 'H'] },
      },
      required: ['payload_text'],
    },
  },
];

const TOOL_SYSTEM_PROMPT = `You are an automated tool-calling coordinator. You have access to a library of 20 tools:
${JSON.stringify(TOOL_REGISTRY, null, 1)}

CRITICAL INSTRUCTIONS:
1. When user requests an action matching a tool, output a strictly valid JSON function call object:
{
  "name": "<tool_name>",
  "arguments": { ...parameters }
}
2. Output JSON ONLY. Do NOT wrap in markdown formatting (no \`\`\`json).
3. If NO available tool can satisfy the request, output:
{
  "name": "NO_TOOL_AVAILABLE",
  "reason": "<explanation>"
}
Do NOT invent or hallucinate tools that are not in the registry above.`;

function extractToolCall(output: string): { name: string; arguments?: any; reason?: string } | null {
  let clean = output.trim();
  if (clean.startsWith('```json')) clean = clean.slice(7);
  if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();

  try {
    const parsed = JSON.parse(clean);
    if (parsed.name) return parsed;
    // Handle OpenAI tool_calls wrapper if model used it
    if (parsed.tool_calls?.[0]?.function) {
      const f = parsed.tool_calls[0].function;
      return {
        name: f.name,
        arguments: typeof f.arguments === 'string' ? JSON.parse(f.arguments) : f.arguments,
      };
    }
  } catch {
    // regex search for "name": "..."
    const match = clean.match(/"name"\s*:\s*"([a-zA-Z0-9_]+)"/);
    if (match) {
      return { name: match[1] };
    }
  }
  return null;
}

export function createToolCallingTestCases(): TestCase[] {
  return [
    {
      id: 'tool-call-stock-price',
      name: 'Tool Selection (1/20): Stock Price Lookup',
      suite: 'tools',
      systemPrompt: TOOL_SYSTEM_PROMPT,
      prompt: 'Check the real-time stock trading price for Nvidia (ticker NVDA).',
      expectedAnswer: 'get_current_stock_price with ticker NVDA',
      evaluator: (output: string) => {
        const call = extractToolCall(output);
        const nameOk = call?.name === 'get_current_stock_price';
        const tickerOk = call?.arguments?.ticker?.toUpperCase() === 'NVDA';

        const passed = nameOk && tickerOk;
        return {
          passed,
          score: passed ? 1.0 : nameOk ? 0.6 : 0.0,
          extractedAnswer: call ? `${call.name}(${JSON.stringify(call.arguments || {})})` : output.slice(0, 60),
          reason: passed
            ? 'Correctly identified get_current_stock_price with ticker NVDA from 20 tools'
            : `Selected ${call?.name || 'none'} with ticker ${call?.arguments?.ticker}`,
        };
      },
    },
    {
      id: 'tool-call-disambiguation-finance',
      name: 'Tool Disambiguation (2/20): Filings vs Price',
      suite: 'tools',
      systemPrompt: TOOL_SYSTEM_PROMPT,
      prompt: 'Download the audited annual 10-K report for Apple Inc (AAPL) for the year 2023.',
      expectedAnswer: 'get_company_financial_filings (not get_current_stock_price)',
      evaluator: (output: string) => {
        const call = extractToolCall(output);
        const nameOk = call?.name === 'get_company_financial_filings';
        const tickerOk = call?.arguments?.ticker?.toUpperCase() === 'AAPL';
        const formOk = call?.arguments?.form_type === '10-K';

        const passed = nameOk && tickerOk;
        return {
          passed,
          score: passed ? (formOk ? 1.0 : 0.8) : 0.0,
          extractedAnswer: call ? `${call.name}(${JSON.stringify(call.arguments || {})})` : output.slice(0, 60),
          reason: passed
            ? 'Successfully disambiguated SEC filings tool from stock price tool'
            : `Disambiguation failed: called ${call?.name || 'none'}`,
        };
      },
    },
    {
      id: 'tool-call-currency-conversion',
      name: 'Tool Arguments (3/20): Currency Exchange Parsing',
      suite: 'tools',
      systemPrompt: TOOL_SYSTEM_PROMPT,
      prompt: 'Convert 1,500 Euros into Japanese Yen at live market exchange rates.',
      expectedAnswer: 'convert_currency (amount: 1500, from: EUR, to: JPY)',
      evaluator: (output: string) => {
        const call = extractToolCall(output);
        const nameOk = call?.name === 'convert_currency';
        const amount = typeof call?.arguments?.amount === 'number' ? call.arguments.amount : parseFloat(call?.arguments?.amount);
        const amountOk = amount === 1500;
        const fromOk = /EUR/i.test(call?.arguments?.from_currency || '');
        const toOk = /JPY/i.test(call?.arguments?.to_currency || '');

        const passed = nameOk && amountOk && fromOk && toOk;
        return {
          passed,
          score: (nameOk ? 0.4 : 0) + (amountOk ? 0.2 : 0) + (fromOk ? 0.2 : 0) + (toOk ? 0.2 : 0),
          extractedAnswer: call ? `${call.name}(amount=${amount}, from=${call?.arguments?.from_currency}, to=${call?.arguments?.to_currency})` : output.slice(0, 60),
          reason: passed
            ? 'Extracted all required parameters accurately'
            : `Missing or misparsed parameters: amount=${amount}, from=${call?.arguments?.from_currency}, to=${call?.arguments?.to_currency}`,
        };
      },
    },
    {
      id: 'tool-call-abstention-no-tool',
      name: 'Tool Hallucination Test: Abstain on Missing Tool',
      suite: 'tools',
      systemPrompt: TOOL_SYSTEM_PROMPT,
      prompt: 'Synthesize a 500mg chemical sample of aspirin in our pharmaceutical lab bioreactor.',
      expectedAnswer: 'NO_TOOL_AVAILABLE (must not invent synthesize_drug or chemistry tools)',
      evaluator: (output: string) => {
        const call = extractToolCall(output);
        // If it called any invented tool like 'synthesize_chemical', 'lab_reactor', it fails!
        const inventedTool = call?.name && call.name !== 'NO_TOOL_AVAILABLE';
        const abstained = call?.name === 'NO_TOOL_AVAILABLE' || /no tool|cannot|not available|unavailable/i.test(output);

        const passed = abstained && !inventedTool;
        return {
          passed,
          score: passed ? 1.0 : 0.0,
          extractedAnswer: call?.name || output.slice(0, 60),
          reason: passed
            ? 'Correctly abstained without hallucinating non-existent tools'
            : `CRITICAL TOOL HALLUCINATION: Invented tool "${call?.name}" which does not exist in registry!`,
        };
      },
    },
    {
      id: 'tool-call-complex-multi-param',
      name: 'Tool Calling: Calendar Scheduling with Date ISO',
      suite: 'tools',
      systemPrompt: TOOL_SYSTEM_PROMPT,
      prompt: 'Book a 45-minute sync titled "Architecture Review" on 2026-12-05 at 14:00 with team@company.com.',
      expectedAnswer: 'create_calendar_event with title, duration, attendees',
      evaluator: (output: string) => {
        const call = extractToolCall(output);
        const nameOk = call?.name === 'create_calendar_event';
        const durationOk = call?.arguments?.duration_minutes === 45 || call?.arguments?.duration === 45;
        const titleOk = /Architecture Review/i.test(call?.arguments?.title || '');

        const passed = nameOk && durationOk && titleOk;
        return {
          passed,
          score: (nameOk ? 0.4 : 0) + (durationOk ? 0.3 : 0) + (titleOk ? 0.3 : 0),
          extractedAnswer: call ? `${call.name}(${JSON.stringify(call.arguments || {})})` : output.slice(0, 60),
          reason: passed
            ? 'Parsed complex calendar scheduling arguments with correct typing'
            : `Tool call failed validation: name=${call?.name}`,
        };
      },
    },
  ];
}
