import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeBase, queryWithRag } from '../daemon/knowledge-rsi.mjs';
import { RagEngine, extractEntitiesAndRelations } from '../daemon/rag-engine.mjs';
import { ModelCouncilEngine } from '../daemon/model-council.mjs';
import { AgiHarness, AGI_COMMANDS, parseAgiCommand } from '../daemon/agi-harness.mjs';
import { DagSwarmEngine, SWARM_RECIPES, computeDagWavefronts } from '../daemon/dag-swarm.mjs';
import { EVAL_TASKS, runEvalSuite } from '../daemon/eval-runner.mjs';

function makeTempDir(prefix = 'mimir-rag-council-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('LightRAG incremental entity/relation graph + 1-hop dual-level retrieval + KnowledgeBase integration', async t => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  const kb = new KnowledgeBase(dir);
  const d1 = kb.ingestDocument({
    title: 'Project Helios Architecture',
    source: 'manual',
    content: 'Project Helios uses Rust WAL for durable queueing.',
    yearTag: '2026',
  });
  const d2 = kb.ingestDocument({
    title: 'Rust WAL Recovery Spec',
    source: 'manual',
    content: 'Rust WAL guarantees crash recovery via idempotency keys and lease timeouts.',
    yearTag: '2026',
  });

  // Existing synchronous query() remains intact
  const syncHits = kb.query('Helios queueing', 4);
  assert.ok(Array.isArray(syncHits));
  assert.ok(syncHits.length >= 1);

  // Graph persisted to <knowledgeDir>/graph.json
  const graphFile = path.join(kb.dir, 'graph.json');
  assert.equal(fs.existsSync(graphFile), true);
  const summary = kb.getGraphSummary();
  assert.equal(summary.docCount, 2);
  assert.ok(summary.nodes >= 4);
  assert.ok(summary.edges >= 2);
  assert.ok(summary.lastUpdated);

  // Typed LightRAG relation extraction (regression for RegExp wrapper pat.re)
  const extracted = extractEntitiesAndRelations('Project Helios uses Rust WAL and ensures crash recovery.');
  assert.ok(extracted.relations.some(r => r.relation === 'uses'));
  assert.ok(extracted.relations.some(r => r.relation === 'ensures'));

  // 1-hop dual-level retrieval connects Project Helios -> Rust WAL -> crash recovery
  const ragRes = await kb.queryWithRag('How does Project Helios guarantee crash recovery?', {
    topK: 5,
    useWebFallback: false,
  });
  assert.ok(ragRes.citations.length >= 2);
  assert.ok(ragRes.citations.some(c => c.docId === d2.doc.id));
  assert.ok(ragRes.graphEntities.some(e => /helios/i.test(e.label) && e.hop === 0));
  assert.ok(ragRes.graphEntities.some(e => /rust wal/i.test(e.label)));
  assert.ok(ragRes.citations.every(c => Array.isArray(c.tags)));
  assert.ok(ragRes.contextBlock.includes('[IsRelevant]'));
  assert.ok(ragRes.contextBlock.includes('[IsSupported]'));

  // Standalone queryWithRag helper delegates cleanly
  const helperRes = await queryWithRag(kb, 'Project Helios durable queueing', { useWebFallback: false });
  assert.equal(helperRes.webUsed, false);
  assert.ok(helperRes.citations.length >= 1);

  // Deleting a document updates graph.json
  assert.equal(kb.deleteDoc(d1.doc.id), true);
  assert.equal(kb.getGraphSummary().docCount, 1);
});

test('CRAG confidence grading, query rewrite, web fallback, noise filtering, and offline safety', async t => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  const kb = new KnowledgeBase(dir);
  kb.ingestDocument({
    title: 'Unrelated Gardening Note',
    content: 'Tomatoes prefer sunny soil and consistent watering schedules.',
  });

  const searchCalls = [];
  const rag = new RagEngine({
    knowledgeBase: kb,
    knowledgeDir: kb.dir,
    fetchSearch: async q => {
      searchCalls.push(q);
      return [
        {
          title: 'Ollama Local API Docs',
          url: 'https://ollama.example/docs',
          snippet: 'Ollama exposes /api/chat on loopback port 11434 for local streaming inference.',
        },
        {
          title: 'Irrelevant Ad Spam',
          url: 'https://spam.example/shoes',
          snippet: 'Buy discounted running shoes and leather jackets today only.',
        },
      ];
    },
  });

  // 1. INCORRECT local score triggers query rewrite + fetchSearch + noise filtering
  const resIncorrect = await rag.retrieve({
    query: 'Please tell me what port Ollama API streaming uses?',
    topK: 5,
    useWebFallback: true,
  });
  assert.equal(resIncorrect.grade, 'INCORRECT');
  assert.ok(resIncorrect.confidence < 0.35);
  assert.equal(resIncorrect.webUsed, true);
  assert.equal(searchCalls.length, 1);
  assert.ok(!/^please/i.test(searchCalls[0]), 'rewritten query should strip conversational filler');
  assert.equal(resIncorrect.citations.length, 1, 'noise filtering drops unrelated spam snippet');
  assert.match(resIncorrect.citations[0].text, /11434/);
  assert.ok(resIncorrect.citations[0].tags.includes('[IsRelevant]'));

  // 2. Low-confidence AMBIGUOUS local score triggers web fallback
  kb.ingestDocument({
    title: 'Partial Streaming Note',
    content: 'Local streaming chat endpoint handles basic requests.',
  });
  const resAmbiguous = await rag.retrieve({
    query: 'streaming chat endpoint websocket tls cipher',
    topK: 4,
    useWebFallback: true,
  });
  assert.equal(resAmbiguous.grade, 'AMBIGUOUS');
  assert.ok(resAmbiguous.confidence >= 0.35 && resAmbiguous.confidence < 0.6);
  assert.equal(resAmbiguous.webUsed, true);
  assert.equal(searchCalls.length, 2);

  // 3. CORRECT local score skips web fallback
  kb.ingestDocument({
    title: 'Ollama Port Reference',
    url: 'https://local.docs/ollama',
    content: 'Ollama API streaming chat endpoint runs locally on port 11434 with think=false support.',
  });
  const resCorrect = await rag.retrieve({
    query: 'Ollama API streaming port 11434',
    topK: 4,
    useWebFallback: true,
  });
  assert.equal(resCorrect.grade, 'CORRECT');
  assert.ok(resCorrect.confidence >= 0.7);
  assert.equal(resCorrect.webUsed, false);
  assert.equal(searchCalls.length, 2);

  // 3. Network failure in fetchSearch degrades gracefully without throwing
  const offlineRag = new RagEngine({
    knowledgeBase: new KnowledgeBase(makeTempDir()),
    fetchSearch: async () => {
      throw new Error('ECONNREFUSED offline');
    },
  });
  const offlineRes = await offlineRag.retrieve({ query: 'quantum compiler 2026', useWebFallback: true });
  assert.equal(offlineRes.grade, 'INCORRECT');
  assert.equal(offlineRes.webUsed, false);
  assert.deepEqual(offlineRes.citations, []);
});

test('ModelCouncilEngine: localOnly respect, 1-model 3-perspective synthesis, <=3 concurrency, anonymized Stage 2 Borda ranking, Chairman & 50-run cap', async t => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  const fakeBots = [{ id: 'bot-1', name: 'Mimir', role: 'Sage', modelOverride: '' }];

  // 1. Offline 1-model fallback synthesizes Architect, Skeptic, Pragmatist; localOnly blocks cloud BYOK
  const singleModelCouncil = new ModelCouncilEngine({
    dataDir: dir,
    botsList: () => fakeBots,
    settingsGet: () => ({
      provider: 'ollama',
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'qwen3:1.7b',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiApiKey: 'sk-test-123',
      openaiModel: 'gpt-4o-mini',
      localOnly: true,
    }),
    probeFn: async () => ({
      ollama: { ok: true, models: ['qwen3:1.7b'] },
      openai: { ok: false, models: [] },
    }),
  });

  const singleSeats = await singleModelCouncil.listCouncilSeats();
  assert.ok(!singleSeats.some(s => s.kind === 'byok'), 'localOnly must exclude cloud BYOK seats');
  assert.ok(singleSeats.some(s => s.name === 'Architect'));
  assert.ok(singleSeats.some(s => s.name === 'Skeptic'));
  assert.ok(singleSeats.some(s => s.name === 'Pragmatist'));

  // 2. Multi-model + BYOK when localOnly is false; bounded concurrency <= 3; anonymized Stage 2; Borda Count; Stage 3
  let activeCalls = 0;
  let maxConcurrentObserved = 0;
  const stage2Prompts = [];
  const events = [];

  const mockChatFn = async ({ modelOverride, messages }) => {
    activeCalls++;
    maxConcurrentObserved = Math.max(maxConcurrentObserved, activeCalls);
    await new Promise(r => setTimeout(r, 20));
    activeCalls--;

    const sys = messages[0]?.content || '';
    const usr = messages[1]?.content || '';

    if (sys.includes('impartial peer reviewer')) {
      stage2Prompts.push({ sys, usr });
      // Find which label holds Model Gamma's unique marker so Gamma wins Borda cleanly
      const matchGamma = usr.match(/### (Response [A-Z])\s+[^\n]*MARKER_GAMMA/);
      const matchAlpha = usr.match(/### (Response [A-Z])\s+[^\n]*MARKER_ALPHA/);
      const allLabels = [...usr.matchAll(/### (Response [A-Z])\b/g)].map(m => m[1]);
      const gammaLbl = matchGamma?.[1] || allLabels[0];
      const alphaLbl = matchAlpha?.[1] || allLabels.find(l => l !== gammaLbl) || allLabels[0];
      const rest = allLabels.filter(l => l !== gammaLbl && l !== alphaLbl);
      const ranking = [gammaLbl, alphaLbl, ...rest];
      return {
        model: modelOverride,
        content: JSON.stringify({
          critiques: {
            [gammaLbl]: 'Most thorough and verifiable plan.',
            [alphaLbl]: 'Solid baseline analysis.',
          },
          ranking,
        }),
      };
    }

    if (sys.includes('Council Chairman')) {
      return {
        model: modelOverride,
        content: JSON.stringify({
          consensus: 'Use bounded concurrency and WAL persistence.',
          synthesis: 'Synthesized consensus from top-ranked Gamma and peers.',
          minorityDissents: ['Skeptic flagged disk space cap at 50 runs.'],
          actionItems: [
            { title: 'Add WAL test', ownerRole: 'QA Verifier', prompt: 'Run WAL recovery check' },
          ],
        }),
      };
    }

    // Stage 1 opinions
    const tagMap = {
      'qwen3:1.7b': 'MARKER_ALPHA fast opinion',
      'qwen3.5:4b': 'MARKER_BETA balanced opinion',
      'qwen3.5:9b': 'MARKER_GAMMA deep opinion',
      'gpt-4o-mini': 'MARKER_DELTA cloud opinion',
    };
    return {
      model: modelOverride,
      content: `${tagMap[modelOverride] || 'Opinion'} on topic.`,
    };
  };

  const council = new ModelCouncilEngine({
    dataDir: dir,
    botsList: () => [],
    settingsGet: () => ({
      provider: 'ollama',
      ollamaUrl: 'http://127.0.0.1:11434',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiApiKey: 'sk-test-123',
      openaiModel: 'gpt-4o-mini',
      localOnly: false,
    }),
    probeFn: async () => ({
      ollama: { ok: true, models: ['qwen3:1.7b', 'qwen3.5:4b', 'qwen3.5:9b'] },
      openai: { ok: true, models: ['gpt-4o-mini'] },
    }),
    chatFn: mockChatFn,
    onEvent: (name, payload) => events.push({ name, payload }),
  });

  const seats = await council.listCouncilSeats();
  assert.equal(seats.length, 4);
  assert.ok(seats.some(s => s.kind === 'byok' && s.model === 'gpt-4o-mini'));

  const mockRagEngine = {
    retrieve: async () => ({
      grade: 'CORRECT',
      confidence: 0.9,
      webUsed: false,
      graphEntities: [{ id: 'wal', label: 'WAL', hop: 0 }],
      citations: [{ title: 'WAL Spec', url: 'https://example.local/wal', text: 'WAL ensures durability.', tags: ['[IsRelevant]', '[IsSupported]'] }],
      contextBlock: '[RAG Context]\n- [1] WAL Spec [IsRelevant] [IsSupported]: WAL ensures durability.',
    }),
  };

  const run = await council.convene({
    topic: 'Design local WAL queue',
    useRag: true,
    ragEngine: mockRagEngine,
  });

  assert.ok(maxConcurrentObserved <= 3, `Expected concurrency <= 3, saw ${maxConcurrentObserved}`);
  assert.equal(run.opinions.length, 4);
  assert.ok(run.opinions.every(o => o.ok));
  assert.ok(stage2Prompts.length === 4);

  // Stage 2 anonymization check: no model names or seat IDs leaked in prompts
  for (const p of stage2Prompts) {
    assert.ok(!p.usr.includes('qwen3'), 'Stage 2 prompt leaked model name');
    assert.ok(!p.usr.includes('gpt-4o'), 'Stage 2 prompt leaked BYOK model name');
    assert.ok(!p.usr.includes('ollama:'), 'Stage 2 prompt leaked seatId');
    assert.ok(p.usr.includes('Response A') && p.usr.includes('Response D'));
  }

  // Borda leaderboard places Gamma #1
  assert.equal(run.leaderboard[0].model, 'qwen3.5:9b');
  assert.equal(run.leaderboard[0].avgRank, 1);
  assert.equal(run.leaderboard[0].bordaScore, 12); // 4 ballots * 3 points
  assert.ok(run.leaderboard[0].critiques.length >= 1);

  // Stage 3 structured output + RAG citations + WS events
  assert.match(run.synthesis, /Synthesized consensus/);
  assert.equal(run.minorityDissents.length, 1);
  assert.equal(run.citations.length, 1);
  assert.equal(run.actionItems[0].ownerRole, 'QA Verifier');
  assert.ok(events.some(e => e.name === 'council:step' && e.payload.stage === 'stage1:start'));
  assert.ok(events.some(e => e.name === 'council:step' && e.payload.stage === 'stage2:done'));
  assert.ok(events.some(e => e.name === 'council:step' && e.payload.stage === 'stage3:done'));

  // History capped at 50 runs
  const seeded = Array.from({ length: 51 }, (_, i) => ({ id: `seed-${i}`, topic: `T${i}` }));
  fs.writeFileSync(path.join(dir, 'council-history.json'), JSON.stringify(seeded), 'utf8');
  const run2 = await council.convene({ topic: 'Cap verification run', useRag: false });
  const history = council.listHistory({ limit: 50 });
  assert.equal(history.length, 50);
  assert.equal(history[0].id, run2.id);
  assert.equal(council.getRun(run2.id)?.topic, 'Cap verification run');

  // Section-delimited Chairman output & malformed JSON wrapper fallback (never leak broken outer wrapper)
  const sectionedCouncil = new ModelCouncilEngine({
    dataDir: dir,
    botsList: () => [],
    settingsGet: () => ({ provider: 'ollama', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'qwen3:1.7b', localOnly: true }),
    probeFn: async () => ({ ollama: { ok: true, models: ['qwen3:1.7b'] }, openai: { ok: false, models: [] } }),
    chatFn: async ({ messages }) => {
      const sys = messages[0]?.content || '';
      if (sys.includes('impartial peer reviewer')) {
        return { content: JSON.stringify({ critiques: {}, ranking: ['Response A', 'Response B', 'Response C'] }) };
      }
      if (sys.includes('Council Chairman')) {
        return {
          content: [
            '=== CONSENSUS ===',
            'Panel agrees on strict JSON.',
            '=== SYNTHESIS ===',
            '{"status":"ok","port":4567}',
            '=== MINORITY_DISSENTS ===',
            '- None',
            '=== ACTION_ITEMS ===',
            '- Verify endpoint | QA | Check port 4567',
          ].join('\n'),
        };
      }
      return { content: '{"status":"ok","port":4567}' };
    },
  });
  const secRun = await sectionedCouncil.convene({ topic: 'Test sectioned synthesis', useRag: false });
  assert.equal(secRun.synthesis, '{"status":"ok","port":4567}');
  assert.equal(secRun.actionItems[0]?.title, 'Verify endpoint');

  const brokenJsonCouncil = new ModelCouncilEngine({
    dataDir: dir,
    botsList: () => [],
    settingsGet: () => ({ provider: 'ollama', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'qwen3:1.7b', localOnly: true }),
    probeFn: async () => ({ ollama: { ok: true, models: ['qwen3:1.7b'] }, openai: { ok: false, models: [] } }),
    chatFn: async ({ messages }) => {
      const sys = messages[0]?.content || '';
      if (sys.includes('impartial peer reviewer')) {
        return { content: JSON.stringify({ critiques: {}, ranking: ['Response A', 'Response B', 'Response C'] }) };
      }
      if (sys.includes('Council Chairman')) {
        return { content: '{\n  "consensus": "Broken outer wrapper",\n  "synthesis": "incomplete truncated' };
      }
      return { content: '{"status":"ok","port":4567}' };
    },
  });
  const brokenRun = await brokenJsonCouncil.convene({ topic: 'Test malformed fallback', useRag: false });
  assert.equal(brokenRun.synthesis, '{"status":"ok","port":4567}');
  assert.ok(brokenRun.minorityDissents.some(d => /fell back/i.test(d)));
});

test('AGI commands (/council, /spawn, /research) and Adaptive Test-Time Compute + Reflexion loop', async t => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  for (const cmd of ['/council', '/spawn', '/research']) {
    assert.ok(AGI_COMMANDS.some(c => c.cmd === cmd), `Missing ${cmd} in AGI_COMMANDS`);
  }
  assert.equal(parseAgiCommand('/council local vs cloud')?.cmd, '/council');
  assert.equal(parseAgiCommand('/spawn Skeptic | Audit auth flow')?.arg, 'Skeptic | Audit auth flow');
  assert.equal(parseAgiCommand('/research LightRAG 2026')?.cmd, '/research');

  // 1. Trivial prompt skips N>1 (Snell 2024 adaptive compute)
  let trivialCalls = 0;
  const trivialRes = await AgiHarness.runSmallModelBoostedTurn({
    prompt: 'Hello Mimir!',
    candidates: 4,
    verifierFn: null,
    runChatFn: async () => {
      trivialCalls++;
      return { content: 'Hail, friend.' };
    },
  });
  assert.equal(trivialCalls, 1);
  assert.equal(trivialRes.candidatesTried, 1);
  assert.equal(trivialRes.passedVerifier, true);
  assert.deepEqual(trivialRes.reflectionNotes, []);

  // 2. Best-of-N passes on candidate 3 without needing Reflexion
  let bonCalls = 0;
  const bonRes = await AgiHarness.runSmallModelBoostedTurn({
    prompt: 'Return JSON {"port":4567}',
    candidates: 3,
    verifierFn: txt => {
      try {
        return JSON.parse(txt).port === 4567;
      } catch {
        return false;
      }
    },
    runChatFn: async () => {
      bonCalls++;
      return { content: bonCalls < 3 ? 'not json' : '{"port":4567}' };
    },
  });
  assert.equal(bonRes.candidatesTried, 3);
  assert.equal(bonRes.passedVerifier, true);
  assert.equal(bonRes.reflectionNotes.length, 0);

  // 3. Best-of-N fails -> Shinn (2023) Reflexion critique + refine fixes output
  let phaseCalls = 0;
  const harness = new AgiHarness({ dataDir: dir });
  const refRes = await harness.runSmallModelBoostedTurn({
    prompt: 'Output exact string VERIFIED_OK',
    candidates: 2,
    maxRefine: 2,
    verifierFn: txt => ({ ok: txt.trim() === 'VERIFIED_OK', reason: 'Must equal exact string VERIFIED_OK' }),
    runChatFn: async ({ messages }) => {
      phaseCalls++;
      const sys = messages[0]?.content || '';
      if (sys.includes('Reflexion critic')) {
        return { content: 'Previous draft added extra words; emit only VERIFIED_OK.' };
      }
      if (sys.includes('Apply the Reflexion')) {
        return { content: 'VERIFIED_OK' };
      }
      return { content: `draft ${phaseCalls}` };
    },
  });
  assert.equal(refRes.passedVerifier, true);
  assert.equal(refRes.reply, 'VERIFIED_OK');
  assert.equal(refRes.candidatesTried, 3); // 2 Best-of-N + 1 refined candidate
  assert.equal(refRes.reflectionNotes.length, 1);
  assert.match(refRes.reflectionNotes[0], /VERIFIED_OK/);
});

test('DagSwarmEngine executes topological wavefronts concurrently and runs perplexity-computer & council-review', async t => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  // Cycle detection & wavefront layering check
  assert.throws(
    () =>
      computeDagWavefronts([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ]),
    /cycle/i
  );

  const pcRecipe = SWARM_RECIPES.find(r => r.id === 'perplexity-computer');
  const crRecipe = SWARM_RECIPES.find(r => r.id === 'council-review');
  assert.ok(pcRecipe);
  assert.ok(crRecipe);

  const waves = computeDagWavefronts(pcRecipe.steps);
  assert.deepEqual(
    waves.map(w => w.map(s => s.id)),
    [['clarify'], ['scout', 'graph_rag'], ['council_synth'], ['verifier']]
  );

  const mockStore = {
    dataDir: dir,
    getBot: () => ({ id: 'bot-1', name: 'Mimir', role: 'Sage' }),
    listBots: () => [{ id: 'bot-1', name: 'Mimir', role: 'Sage' }],
    getSettings: () => ({ provider: 'ollama', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'qwen3:1.7b', localOnly: true }),
  };

  const kb = new KnowledgeBase(dir);
  kb.ingestDocument({
    title: 'Mimir Coordinator Facts',
    content: 'Mimir coordinator exposes /ws WebSocket events and runs local agents.',
  });

  const agiHarness = new AgiHarness({ dataDir: dir, store: mockStore, knowledge: kb });
  const events = [];
  const council = new ModelCouncilEngine({
    dataDir: dir,
    store: mockStore,
    probeFn: async () => ({ ollama: { ok: true, models: ['qwen3:1.7b'] }, openai: { ok: false, models: [] } }),
    chatFn: async ({ messages, modelOverride }) => {
      const sys = messages[0]?.content || '';
      if (sys.includes('impartial peer reviewer')) {
        return { model: modelOverride, content: JSON.stringify({ critiques: { 'Response A': 'Good' }, ranking: ['Response A', 'Response B', 'Response C'] }) };
      }
      if (sys.includes('Council Chairman')) {
        return {
          model: modelOverride,
          content: JSON.stringify({
            consensus: 'Mimir streams over /ws cleanly.',
            synthesis: 'Verified Perplexity Computer synthesis.',
            minorityDissents: [],
            actionItems: [{ title: 'Ship check', ownerRole: 'Verifier', prompt: 'Verify /ws' }],
          }),
        };
      }
      return { model: modelOverride, content: 'Opinion referencing /ws WebSocket.' };
    },
  });

  const swarm = new DagSwarmEngine({
    dataDir: dir,
    store: mockStore,
    agiHarness,
    knowledge: kb,
    modelCouncil: council,
    broadcast: (evt, data) => events.push({ evt, data }),
  });

  // Verify scout and graph_rag overlap concurrently in Wave 1
  let inWave1Active = 0;
  let maxWave1Concurrent = 0;
  const mockRag = {
    retrieve: async ({ query }) => {
      inWave1Active++;
      maxWave1Concurrent = Math.max(maxWave1Concurrent, inWave1Active);
      await new Promise(r => setTimeout(r, 45));
      inWave1Active--;
      return kb.queryWithRag(query, { useWebFallback: false });
    },
  };
  const delayedSearch = async () => {
    inWave1Active++;
    maxWave1Concurrent = Math.max(maxWave1Concurrent, inWave1Active);
    await new Promise(r => setTimeout(r, 45));
    inWave1Active--;
    return [{ title: 'Live Spec', url: 'https://example.local/ws', snippet: 'Streams over /ws' }];
  };

  const pcRun = await swarm.runSwarm({
    botId: 'bot-1',
    goal: 'Inspect Mimir WebSocket streaming',
    recipeId: 'perplexity-computer',
    ragEngine: mockRag,
    fetchSearch: delayedSearch,
    settings: { ...mockStore.getSettings(), localOnly: false },
    runChatFn: async ({ modelOverride }) => ({ model: modelOverride, content: 'Audit complete.\nVERDICT: PASS' }),
  });

  assert.equal(pcRun.status, 'completed');
  assert.equal(maxWave1Concurrent, 2, 'scout and graph_rag must run concurrently in the same wavefront');

  // Verify localOnly skips outbound fetchSearch in scout
  let blockedSearchCalled = false;
  const offlinePcRun = await swarm.runSwarm({
    botId: 'bot-1',
    goal: 'Inspect offline constraint',
    recipeId: 'perplexity-computer',
    ragEngine: mockRag,
    fetchSearch: async () => {
      blockedSearchCalled = true;
      return [{ title: 'Leak', url: 'https://example.com', snippet: 'Leak' }];
    },
    settings: { ...mockStore.getSettings(), localOnly: true },
    runChatFn: async ({ modelOverride }) => ({ model: modelOverride, content: 'Audit complete.\nVERDICT: PASS' }),
  });
  assert.equal(offlinePcRun.status, 'completed');
  assert.equal(blockedSearchCalled, false);
  assert.equal(pcRun.audit?.verdict, 'PASS');
  assert.match(pcRun.executionSummary, /Perplexity Computer synthesis/);
  assert.ok(events.some(e => e.evt === 'swarm:step' && e.data.step.id === 'council_synth'));

  // Run council-review recipe
  const crRun = await swarm.runSwarm({
    botId: 'bot-1',
    goal: 'Review Mimir WebSocket architecture',
    recipeId: 'council-review',
    ragEngine: mockRag,
    settings: mockStore.getSettings(),
    runChatFn: async ({ modelOverride }) => ({ model: modelOverride, content: 'Audit ok.\nVERDICT: PASS' }),
  });
  assert.equal(crRun.status, 'completed');
  assert.deepEqual(crRun.wavefronts, [['context'], ['council'], ['audit']]);
  assert.equal(crRun.audit?.verdict, 'PASS');
});

test('Eval Runner has 8 deterministic tasks and compares baseline vs harnessed vs council without faked metrics', async t => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  assert.equal(EVAL_TASKS.length, 8);
  assert.deepEqual(
    EVAL_TASKS.map(x => x.id),
    [
      'json-extract',
      'tool-reason',
      'honest-gap',
      'multi-constraint-plan',
      'bug-diagnose-js',
      'grounded-rag-synth',
      'dag-critical-path',
      'sandbox-policy-audit',
    ]
  );

  // Mock LLM where raw baseline fails 2 tasks (json-extract & multi-constraint-plan),
  // while harnessed Reflexion/Best-of-N and council synthesis succeed.
  const mockChat = async ({ modelOverride, messages }) => {
    const sys = messages[0]?.content || '';
    const usr = messages[1]?.content || messages[0]?.content || '';

    if (sys.includes('impartial peer reviewer')) {
      return { model: modelOverride, content: JSON.stringify({ critiques: {}, ranking: ['Response A', 'Response B', 'Response C'] }) };
    }
    if (sys.includes('Council Chairman')) {
      if (usr.includes('{"status":"ok","port":4567}')) {
        return { model: modelOverride, content: JSON.stringify({ synthesis: '{"status":"ok","port":4567}' }) };
      }
      if (usr.includes('ALLOW_LIST_REQUIRED')) {
        return { model: modelOverride, content: JSON.stringify({ synthesis: 'ALLOW_LIST_REQUIRED' }) };
      }
      if (usr.includes('Claude Fable 5.2')) {
        return { model: modelOverride, content: JSON.stringify({ synthesis: 'No, a local 1.7B model does not equal frontier models.' }) };
      }
      if (usr.includes('SQLite cache to WAL')) {
        return {
          model: modelOverride,
          content: JSON.stringify({
            synthesis: '1. BACKUP existing sqlite file.\n2. Run PRAGMA journal_mode=WAL.\n3. VERIFY integrity check.',
          }),
        };
      }
      if (usr.includes('loadIds')) {
        return {
          model: modelOverride,
          content: JSON.stringify({
            synthesis: '{"bugType":"async inside Array.forEach is not awaited","fix":"Use Promise.all with urls.map"}',
          }),
        };
      }
      if (usr.includes('dag-critical-path') || usr.includes('criticalPathMs')) {
        return {
          model: modelOverride,
          content: JSON.stringify({
            synthesis: '{"waves":[["T1"],["T2","T3"],["T4"]],"criticalPathMs":95}',
          }),
        };
      }
      if (usr.includes('read_sand') && usr.includes('esc_tool')) {
        return {
          model: modelOverride,
          content: JSON.stringify({
            synthesis: '{"allowed":["read_sand"],"blocked":["esc_tool","trav_path"]}',
          }),
        };
      }
      return {
        model: modelOverride,
        content: JSON.stringify({
          synthesis: 'Mimir defaults to port 4567 [S1] and streams over WebSocket at /ws [S2].',
        }),
      };
    }

    const isRefined = sys.includes('Apply the Reflexion') || sys.includes('candidate 3/3');
    if (sys.includes('Reflexion critic')) {
      return { content: 'Output exact schema/keywords required by the task.' };
    }

    if (usr.includes('{"status":"ok","port":4567}')) {
      return { model: modelOverride, content: isRefined ? '{"status":"ok","port":4567}' : 'Sure, status is ok on port 4567' };
    }
    if (usr.includes('ALLOW_LIST_REQUIRED')) {
      return { model: modelOverride, content: 'ALLOW_LIST_REQUIRED' };
    }
    if (usr.includes('Claude Fable 5.2')) {
      return { model: modelOverride, content: 'No, a local 1.7B model does not equal frontier models.' };
    }
    if (usr.includes('SQLite cache to WAL')) {
      return {
        model: modelOverride,
        content: isRefined
          ? '1. BACKUP sqlite database.\n2. Execute PRAGMA journal_mode=WAL.\n3. VERIFY checksums.'
          : '1. backup db\n2. switch to wal', // fails baseline: lowercase & only 2 steps
      };
    }
    if (usr.includes('loadIds')) {
      return {
        model: modelOverride,
        content: '{"bugType":"forEach ignores async await","fix":"Use for..of or Promise.all(urls.map(...))"}',
      };
    }
    if (usr.includes('criticalPathMs')) {
      return {
        model: modelOverride,
        content: '{"waves":[["T1"],["T2","T3"],["T4"]],"criticalPathMs":95}',
      };
    }
    if (usr.includes('read_sand') && usr.includes('esc_tool')) {
      return {
        model: modelOverride,
        content: '{"allowed":["read_sand"],"blocked":["esc_tool","trav_path"]}',
      };
    }
    if (usr.includes('[S1]') && usr.includes('[S2]')) {
      return {
        model: modelOverride,
        content: 'Dev coordinator defaults to port 4567 [S1] and streams events over WebSocket at /ws [S2].',
      };
    }
    return { model: modelOverride, content: 'ok' };
  };

  const report = await runEvalSuite({
    models: ['qwen3:1.7b'],
    modes: ['baseline', 'harnessed', 'council'],
    chatFn: mockChat,
    candidates: 3,
    maxRefine: 1,
    store: { dataDir: dir },
  });

  assert.equal(report.ok, true);
  assert.equal(report.taskIds.length, 8);
  assert.equal(report.benchmarked[0].passedCount, 6);
  assert.equal(report.benchmarked[0].scorePct, 75);
  assert.equal(report.harnessed[0].passedCount, 8);
  assert.equal(report.harnessed[0].scorePct, 100);
  assert.equal(report.council[0].passedCount, 8);
  assert.equal(report.council[0].scorePct, 100);
  assert.equal(report.comparison[0].deltaHarnessedPct, 25);
  assert.equal(report.comparison[0].deltaCouncilPct, 25);
});
