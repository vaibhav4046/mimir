# Mimir — hardware-fit system design

Date 2026-11-13. Every number marked **measured** was taken on the owner's laptop this session. Numbers marked **estimate** have not been run and must be measured before anyone relies on them.

## 1. The machine

| Part | Value (measured) |
|---|---|
| GPU | NVIDIA RTX 3050 Laptop, 6,144 MiB VRAM; about 1.8 GB already in use by the desktop |
| CPU | Intel i5-12450HX, 8 cores / 12 threads |
| RAM | 15.7 GB total; 4.0 GB free with apps open, 8.4 GB free after models unload |
| Disk | C: 25 GB free, D: 160 GB free (models live on D:) |
| Ollama | 0.40.4, flash attention on, 8-bit KV cache on, default context 8,192 |

## 2. What each model costs here (measured, 120-token reply)

| Model | Context window | Speed | Memory | On GPU |
|---|---|---|---|---|
| qwen3 1.7B (Q4) | 8,192 | **106 tok/s** | 1.7 GB | 100% |
| qwen3 1.7B (Q4) | 40,960 (its maximum) | 31 tok/s | 3.6 GB | 100% |
| qwen3.5 4B (Q4) | 8,192 | **46 tok/s** | 2.7 GB | 100% |
| qwen3.5 4B (Q4) | 65,536 | 26 tok/s | 5.0 GB | 71% |
| qwen3.5 4B (Q4) | 262,144 (its maximum) | 11 tok/s | 9.9 GB | 36% |
| qwen3.5 9B (Q4) | 8,192 | 9 tok/s | 5.9 GB | 55% |

These were measured with an almost empty prompt. A window that is actually full is slower again, because every token in it has to be read first.

Three conclusions follow directly:

1. **Bigger windows are paid for in speed even when empty.** The same 1.7B model is 3.4× slower at 40k than at 8k.
2. **Anything that spills off the GPU collapses.** The 9B model and the 4B model at large windows run mostly on the CPU.
3. **The largest window any installed model has is 262,144 tokens**, and using it takes 9.9 GB of a 15.7 GB machine at 11 tok/s.

## 3. "1M context" — what is real

A true 1,000,000-token attention window does not exist on this hardware. No installed model has one (maximum 262k), and the memory for it is not there.

What Mimir provides instead is **1M+ of reachable context through an 8k working window**:

```
                 8,192-token working window (fast, all on GPU)
  ┌──────────────┬───────────────┬──────────────────────┬──────────────┐
  │ rules+tools  │ recalled      │ newest messages of   │ reserved for │
  │ ~2,500 tok   │ context ~500  │ this chat ~3,700     │ reply 1,500  │
  └──────────────┴───────▲───────┴──────────▲───────────┴──────────────┘
                         │ by relevance     │ newest first, explicit cut
   ┌─────────────────────┴──────────────────┴─────────────────────────┐
   │ Everything else, on disk, unlimited:                             │
   │  shared profile · earlier chats · cut part of this chat ·        │
   │  indexed files and web pages · skills · run logs                 │
   └──────────────────────────────────────────────────────────────────┘
```

Status of each piece:

| Piece | Status |
|---|---|
| Window size requested explicitly (`ollamaNumCtx`, default 8,192) | **Built this session.** Before, the app sent no size and got whatever the host defaulted to |
| Explicit trimming of long chats, newest kept, model told what was cut | **Built this session**, tested |
| Recall of relevant lines from the cut part of a chat | **Built this session**, tested (keyword match) |
| Recall across earlier chats + shared profile | Built earlier today, tested live |
| Indexed knowledge (web pages, documents) | Exists (`knowledge-rsi.mjs`, `rag-engine.mjs`) |
| Semantic (embedding) recall | **Not built.** Recall is keyword-based, so it misses paraphrases. Needs a small embedding model on CPU |
| Rolling summaries of old chat segments | **Not built.** Today the cut part is searched, not summarized |
| Base overhead reduction | **Not built.** 17 tool definitions cost about 2,000 tokens every turn; role-scoped tool sets would roughly halve that |

Measured base overhead: system prompt 1,644 chars + 17 tools 7,381 chars ≈ 2,500 tokens before any conversation.

## 4. "1M output" — what is real

No model writes a million tokens in one reply; replies are bounded by the window. At measured speeds, a million tokens of raw generation is about **2.6 hours** on the 1.7B model or **6 hours** on the 4B model, GPU fully busy.

Long output is a job, not a reply:

1. Outline (one call) → list of sections with a one-line brief each.
2. Each section is its own call, with the outline and the previous section's last paragraph in the window.
3. Each section is appended to a file on disk as it finishes.
4. The job lives on the durable queue, so a restart resumes at the next unwritten section.
5. A final pass checks section count and headings against the outline.

**Not built.** The queue, file tools and document builder it would use exist.

## 5. Model roles on this machine

| Role | Model | Why |
|---|---|---|
| Default chat, routing, extraction, tool calls | qwen3 1.7B @ 8k | 106 tok/s; passed the 4-check capability test (stream, tool call, JSON) |
| Planning, longer reasoning, images | qwen3.5 4B @ 8k | 46 tok/s, still fully on GPU; has vision |
| Overnight batch only | qwen3.5 9B @ 8k | 9 tok/s; never interactive |
| Hard tasks, opt-in | user's own cloud key | blocked entirely when local-only is on |

Rules:
- **One generation at a time.** One GPU; a second concurrent generation halves both. Other work waits in the queue.
- **One model resident.** 1.7B + 4B together need 4.4 GB and the desktop already holds 1.8 GB of 6.1 GB. Swap on demand (measured load time 8–15 s).
- **Never raise the window to "fix" memory.** Use recall.
- **Deterministic code first.** Schedules, file operations, command parsing and approvals do not go through a model.

## 6. Training the local model on the owner's conversations

### What exists today
- Conversations are logged as training pairs. **Count right now: 17 examples, 2 preference pairs** (measured).
- "Compile Distilled Model" in the app writes an Ollama model file with a baked-in system prompt. **It does not train weights.**
- No training software is installed: PyTorch, transformers, peft and bitsandbytes are all absent (measured).

### What is feasible on 6 GB
LoRA fine-tuning of the **1.7B model only** (4-bit base, small adapter):

| Item | Value |
|---|---|
| VRAM during training | **estimate** 3.5–5 GB at sequence length 1,024, batch 1 with gradient accumulation |
| Larger models | 4B and up will not fit in 6 GB for training |
| Software to install | PyTorch with CUDA (~2.5 GB), transformers, peft, bitsandbytes, the original Qwen3-1.7B weights (~3.5 GB) |
| Output | an adapter file of tens of MB, loaded through Ollama's `ADAPTER` line |
| Unknown | whether bitsandbytes works on this Python 3.13 / Windows setup — must be tried |

### The loop (none of this is built)
1. **Collect** only what is safe: the user's own messages and replies that were not errors or rejected. Exclude tool output, web text, vault secrets, and anything from connected accounts unless the owner opts in.
2. **Wait for enough data.** A few hundred to a few thousand examples. Seventeen is not enough to train anything.
3. **Split** 90/10 into train and held-out sets, by conversation.
4. **Train at night or when idle**, with all Ollama models unloaded (training and inference cannot share 6 GB).
5. **Evaluate** the old and new model on the held-out set and on the fixed evaluation tasks.
6. **Promote only if better with no regressions.** Otherwise discard.
7. **Keep the previous adapter** so one click rolls back.

### What it will and will not do
- **Will:** pick up the owner's vocabulary, formats, tone, and common tool-call patterns.
- **Will not:** make a 1.7B model reason like a large one. Capacity is set by size.
- **Facts belong in memory, not weights.** A fact saved to the shared profile works in the next message; a fact trained in needs hundreds of examples and can be wrong.
- **Risk:** with little data the model overfits and gets worse at everything else. Step 6 is what guards against this.

"Trained and updated with every conversation" therefore means: **memory updates instantly, weights update in gated batches.** Continuous weight updates from raw chats would let one bad or poisoned conversation damage the model with no way to notice.

## 7. Storage

- All app state is one JSON file, rewritten in full on every message. Fine at today's size; at about a million tokens of history (~4 MB) each message rewrites megabytes.
- Target: threads and messages in SQLite with a full-text index. The Rust sidecar already runs a SQLite write-ahead log for the queue. **Not migrated.**

## 8. What this design cannot deliver

- A real 1M-token window or a single 1M-token reply on this laptop.
- Frontier-model quality from a 1.7B or 4B model. The harness raises reliability on narrow, well-defined tasks; it does not raise the ceiling.
- "AGI" or unattended automation of everything. Irreversible actions stay behind approval by design.
- Work while the laptop is asleep or off.

## 9. Build order

1. Role-scoped tool sets (cuts ~1,000 tokens per turn and stops small models over-calling tools). Measure with the evaluation set before and after.
2. Embedding recall on CPU, with keyword recall as fallback.
3. Long-output job (section 4).
4. SQLite for threads.
5. Training loop (section 6), starting with the install check and a dry run on the 17 existing examples purely to measure VRAM and time — not to ship the result.
