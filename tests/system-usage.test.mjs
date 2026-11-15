import test from 'node:test';
import assert from 'node:assert/strict';
import { contextUsage, systemUsage } from '../daemon/system-usage.mjs';
import { resolveResponseMode } from '../daemon/llm-provider.mjs';

test('response mode: only known values, null when unset', () => {
  assert.equal(resolveResponseMode({ responseMode: 'fast' }), 'fast');
  assert.equal(resolveResponseMode({ responseMode: 'reasoning' }), 'reasoning');
  assert.equal(resolveResponseMode({ responseMode: 'turbo' }), null);
  assert.equal(resolveResponseMode({}), null);
});

test('context usage comes from the latest reply that has real token counts', () => {
  const thread = {
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'a', usage: { promptTokens: 100, outputTokens: 20, numCtx: 8192, tokPerSec: 40 } },
      { role: 'user', content: 'more' },
      { role: 'assistant', content: 'b', model: 'qwen3:1.7b', usage: { promptTokens: 900, outputTokens: 60, numCtx: 8192, tokPerSec: 50 } },
      { role: 'assistant', content: 'tool step, no usage' },
    ],
  };
  const c = contextUsage(thread, {});
  assert.equal(c.usedTokens, 960);
  assert.equal(c.windowTokens, 8192);
  assert.equal(c.lastReply.model, 'qwen3:1.7b');
  assert.equal(c.messages, 5);
});

test('context usage of an empty chat reports the configured window', () => {
  const c = contextUsage(null, { ollamaNumCtx: 16384 });
  assert.deepEqual([c.usedTokens, c.windowTokens, c.lastReply], [0, 16384, null]);
});

test('system usage works with no GPU and no Ollama', async () => {
  const noGpu = async () => {
    throw new Error('nvidia-smi not found');
  };
  const u = await systemUsage({ settings: { ollamaUrl: 'http://127.0.0.1:9', responseMode: 'fast' }, thread: null, exec: noGpu });
  assert.ok(u.ram.totalGb > 0 && u.ram.usedGb > 0);
  assert.ok(u.mimir.serviceGb > 0);
  assert.deepEqual(u.mimir.loaded, []);
  assert.equal(u.mode, 'fast');
});
