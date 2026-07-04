// Anthropic client + model selection for checkset vision analysis. Server-only.
// Ported from Checksets src/lib/anthropic.ts.
import Anthropic from '@anthropic-ai/sdk';

let client = null;

export function anthropic() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

// Default: current vision-capable Sonnet tier. Set ANTHROPIC_MODEL=claude-opus-4-8
// for tougher review.
export function analysisModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
}
