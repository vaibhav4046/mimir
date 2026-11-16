# Full voice script (natural, in order)

Read at an easy pace. The recording and the screen are timed to this order.

## Opening
Hi, I'm Vaibhav. I've been building an AI agent app called Mimir, and I ran into a problem that I think most people building with agents hit sooner or later. For this hackathon I tried to fix it using HydraDB.

## 1. The problem
Here's the problem. When you connect an AI agent to your apps, like your email, your calendar, your payments, it doesn't just use them. Every single time you ask it something, it first reads the instruction manual for every one of those apps. Five apps is already around fifty-five thousand tokens of reading, before it even sees your question. So the more you connect, the slower, more expensive, and more confused it gets.

## 2. The proof it is real
I didn't make that number up. Anthropic measured it themselves, and they've seen it go as high as a hundred and thirty-four thousand. A research paper called RAG-MCP found that when you only give the agent the tools it actually needs, it picks the right one more than three times as often. And Simon Willison pointed out that one single popular server eats about fifty-five thousand tokens on its own. So this is real, and people are already trying to work around it.

## 3. What it costs
It costs real money too, because that manual gets paid for on every call. Fifty-five thousand tokens, a thousand calls a day, comes out to about one point six five billion tokens a month, just for the instructions. At an example price of three dollars per million, that's close to five thousand dollars a month for one team. Caching makes it cheaper, but it doesn't fix the confusion. And on a small local model it's worse: my test catalog of two hundred sixty-four tools is bigger than that model's whole memory window.

## 4. Who it is for
So who is this for? Priya runs an online shop, she's not technical, and her assistant touches her store, her payments, her email and her calendar. A developer building agents for five different clients, with sixty-plus tools. And Lee, who runs a small private model at home, where the tool list doesn't even fit. If your agent has more than a handful of apps, this is you.

## 5. The idea
Here's my fix. Instead of handing the agent every manual, I keep its tools in a graph database, HydraDB. The graph remembers how things connect: which words point to which tools, which jobs need which steps, and which client uses which app. When you ask for something, the agent follows those connections and picks up only the few tools that job needs. And then it learns. You tell it what worked, and it remembers for next time.

## 6. Into the live app
Let me show you how it actually works. This is the live app, running on a real HydraDB server, with two hundred sixty-four tools in it.

## Live demo
I'll start with a job it has never seen: "Do the competitor watch and note what is new."

It pulls back six tools out of two hundred sixty-four, and each one tells you why it was picked. On the right is the path it followed, from the words in my sentence, through a skill, to the tools. And up here is the part I care about: all the instructions it didn't have to carry.

Now a harder one: "Handle the outage: dig into the errors and post an update."

It found three of the four tools this job needs. It missed the one for reading logs. That's a real miss, and that's fine, because now I can tell it. I pick the four tools the job actually needed, and teach it.

That's all it takes. It just adjusted a few connections inside HydraDB. If I ask the same thing again, all four come back.

Here's the test that matters. I'll ask for the same kind of job in completely different words: "Something broke after the release, investigate and tell everyone."

All four tools again, even though I never taught it that sentence. It didn't memorize my words. It learned the connection.

Behind the scenes, each of these requests is a handful of quick lookups in HydraDB, and each correction is a few small updates. There is no extra AI call and no retraining.

## 7. The numbers
Now the numbers, and I'll be straight about them. I tested it on 80 tasks worded differently from anything it was trained on. Before it learned anything, it covered 60 percent of them. After one pass of learning, about 70. A keyword search that also knows my skills gets 58.8, and plain keyword search gets 30. With a real small model running on my own laptop, the instructions it has to read drop from about 15,522 tokens to about 504, an answer takes 541 milliseconds instead of 1,061, and the first tool it reaches for was right 32.5 percent of the time, against 42.5 with everything loaded. So on that tiny model I saved the cost and the time, but I did not improve accuracy, and I'll say so plainly. Jobs about a specific client went from 70 to 94 percent, because the graph links a client to their apps. And private team words, like a made-up word, bluebird, go from 0 percent to 90 after a single example, and 100 after two, without hurting anything else it knew.

## 8. How it is built
The design is simple on purpose. The agent sends the task to a small service. The service walks the graph in HydraDB and sends back a handful of tool definitions. All the memory lives in HydraDB, and each step is one request. Learning is a few small updates after a task. Neither one calls an AI model.

## 9. The limits
Now the limits, because I'd rather you hear them from me. On everyday wording, learning helps by about ten points, not a miracle. A keyword search that knows my skills isn't far behind on simple jobs. And it gets slower as the catalog grows: a lookup takes about 33 milliseconds at 264 tools, 178 at 5,000, and nearly a second at 20,000. Also, I wrote the tasks and labels myself, and most of the tools are modelled on real servers rather than real ones. So this is a controlled test, and the next steps are real agent logs and a faster lookup.

## 10. Why me
Why me? I already ship the agent this plugs into. Mimir is a local-first workspace for Windows, with a scheduler, workflows, a model library and a public installer. For this hackathon I built HydraDB from source, hit its quirks, fixed them, and wired the result straight into Mimir's agent loop, switched off by default and safe if anything fails. Who would pay? Teams running agents across lots of apps, and local-first products with small memory windows. The core stays open source.

## Closing
Everything is open source and linked below: the live demo, the code, and the benchmark. I'm Vaibhav, and thanks to the HydraDB team for the hackathon.
