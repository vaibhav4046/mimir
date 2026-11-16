// The spoken script, in plain talking language. Numbers come from results.json so the voice
// can never disagree with the screen.
const n = x => Number(x).toLocaleString('en-US');

export function narration(R) {
  const lc = R.learningCurve;
  const last = lc.testCompleteMean.length - 1;
  const bl = R.baselines;
  const llm = R.llm?.methods || {};
  const all = llm['All tools preloaded'];
  const learned = llm['Graph, after learning'];
  const J = R.jargon;
  const small = R.scale[0];
  const mid = R.scale.find(s => s.catalogTools >= 5000) || R.scale.at(-1);
  const big = R.scale.at(-1);
  const model = all && learned
    ? ` With a real small model running on my own laptop, the instructions it has to read drop from about ${n(all.avgPromptTokens)} tokens to about ${n(learned.avgPromptTokens)}, an answer takes ${n(learned.avgMs)} milliseconds instead of ${n(all.avgMs)}, and the first tool it reaches for was right ${learned.firstCallHitPct} percent of the time, against ${all.firstCallHitPct} with everything loaded. So on that tiny model I saved the cost and the time, but I did not improve accuracy, and I'll say so plainly.`
    : '';
  return {
    1: `Here's the problem. When you connect an AI agent to your apps, like your email, your calendar, your payments, it doesn't just use them. Every single time you ask it something, it first reads the instruction manual for every one of those apps. Five apps is already around fifty-five thousand tokens of reading, before it even sees your question. So the more you connect, the slower, more expensive, and more confused it gets.`,
    2: `I didn't make that number up. Anthropic measured it themselves, and they've seen it go as high as a hundred and thirty-four thousand. A research paper called RAG-MCP found that when you only give the agent the tools it actually needs, it picks the right one more than three times as often. And Simon Willison pointed out that one single popular server eats about fifty-five thousand tokens on its own. So this is real, and people are already trying to work around it.`,
    3: `It costs real money too, because that manual gets paid for on every call. Fifty-five thousand tokens, a thousand calls a day, comes out to about one point six five billion tokens a month, just for the instructions. At an example price of three dollars per million, that's close to five thousand dollars a month for one team. Caching makes it cheaper, but it doesn't fix the confusion. And on a small local model it's worse: my test catalog of two hundred sixty-four tools is bigger than that model's whole memory window.`,
    4: `So who is this for? Priya runs an online shop, she's not technical, and her assistant touches her store, her payments, her email and her calendar. A developer building agents for five different clients, with sixty-plus tools. And Lee, who runs a small private model at home, where the tool list doesn't even fit. If your agent has more than a handful of apps, this is you.`,
    5: `Here's my fix. Instead of handing the agent every manual, I keep its tools in a graph database, HydraDB. The graph remembers how things connect: which words point to which tools, which jobs need which steps, and which client uses which app. When you ask for something, the agent follows those connections and picks up only the few tools that job needs. And then it learns. You tell it what worked, and it remembers for next time.`,
    6: `Let me show you how it actually works. This is the live app, running on a real HydraDB server, with two hundred sixty-four tools in it.`,
    7: `Now the numbers, and I'll be straight about them. I tested it on ${R.config.test} tasks worded differently from anything it was trained on. Before it learned anything, it covered ${lc.testCompleteMean[0]} percent of them. After one pass of learning, about ${Math.round(lc.testCompleteMean[1])}. A keyword search that also knows my skills gets ${bl.bm25ToolsAndSkills.complete}, and plain keyword search gets ${bl.bm25Tools.complete}.${model} Jobs about a specific client went from ${lc.byKindMean.E[0]} to ${lc.byKindMean.E[last]} percent, because the graph links a client to their apps.${J ? ` And private team words, like a made-up word, bluebird, go from ${J.heldOut.cold} percent to ${J.heldOut.afterOneExample} after a single example, and ${J.heldOut.afterTwoExamples} after two, without hurting anything else it knew.` : ''}`,
    8: `The design is simple on purpose. The agent sends the task to a small service. The service walks the graph in HydraDB and sends back a handful of tool definitions. All the memory lives in HydraDB, and each step is one request. Learning is a few small updates after a task. Neither one calls an AI model.`,
    9: `Now the limits, because I'd rather you hear them from me. On everyday wording, learning helps by about ten points, not a miracle. A keyword search that knows my skills isn't far behind on simple jobs. And it gets slower as the catalog grows: a lookup takes about ${Math.round(small.load[0].p50ms)} milliseconds at ${n(small.catalogTools)} tools, ${Math.round(mid.load[0].p50ms)} at ${n(mid.catalogTools)}, and nearly a second at ${n(big.catalogTools)}. Also, I wrote the tasks and labels myself, and most of the tools are modelled on real servers rather than real ones. So this is a controlled test, and the next steps are real agent logs and a faster lookup.`,
    10: `Why me? I already ship the agent this plugs into. Mimir is a local-first workspace for Windows, with a scheduler, workflows, a model library and a public installer. For this hackathon I built HydraDB from source, hit its quirks, fixed them, and wired the result straight into Mimir's agent loop, switched off by default and safe if anything fails. Who would pay? Teams running agents across lots of apps, and local-first products with small memory windows. The core stays open source.`,
  };
}

export const mimirLines = {
  0: `Hi, I'm Vaibhav. I've been building an AI agent app called Mimir, and I ran into a problem that I think most people building with agents hit sooner or later. For this hackathon I tried to fix it using HydraDB.`,
  11: `Everything is open source and linked below: the live demo, the code, and the benchmark. I'm Vaibhav, and thanks to the HydraDB team for the hackathon.`,
};
