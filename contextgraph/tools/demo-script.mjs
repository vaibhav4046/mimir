// The live-demo segment of the video: real clicks in the real app, each with its narration.
// The tasks were chosen by running the held-out set: the first is a hit, the second misses one tool,
// and after one correction a differently worded version of the same job is covered.
const TASK_A = 'Do the competitor watch and note what is new';
const TASK_B = 'Handle the outage: dig into the errors and post an update';
const TASK_C = 'Something broke after the release, investigate and tell everyone';

async function glide(page, selector) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
}
async function click(page, selector) {
  await glide(page, selector);
  await page.waitForTimeout(250);
  await page.locator(selector).first().click();
}
async function ask(page, text) {
  await click(page, '#q');
  await page.locator('#q').fill('');
  await page.keyboard.type(text, { delay: 42 });
  await page.waitForTimeout(350);
  const prev = await page.locator('#meta').textContent();
  await click(page, '#go');
  await page.waitForFunction(p => document.querySelector('#meta').textContent !== p && document.querySelector('#out .tool'), prev, { timeout: 30000 });
  await page.waitForTimeout(700);
}

export function demoSteps() {
  return [
    {
      id: 'd1a',
      say: `I'll start with a job it has never seen: "${TASK_A}."`,
      run: async page => ask(page, TASK_A),
    },
    {
      id: 'd1b',
      say: `It pulls back six tools out of two hundred sixty-four, and each one tells you why it was picked. On the right is the path it followed, from the words in my sentence, through a skill, to the tools. And up here is the part I care about: all the instructions it didn't have to carry.`,
      run: async (page, { sleep }) => {
        await glide(page, '.graph');
        await sleep(2.5);
        await glide(page, '#n2');
      },
    },
    {
      id: 'd2a',
      say: `Now a harder one: "${TASK_B}."`,
      run: async page => ask(page, TASK_B),
    },
    {
      id: 'd2b',
      say: `It found three of the four tools this job needs. It missed the one for reading logs. That's a real miss, and that's fine, because now I can tell it. I pick the four tools the job actually needed, and teach it.`,
      run: async (page, { sleep }) => {
        await click(page, '#no');
        await page.waitForSelector('#ps');
        for (const id of ['slack__post_message', 'sentry__list_errors', 'sentry__get_error_details']) {
          await click(page, `.pick[data-id="${id}"]`);
          await sleep(0.4);
        }
        await click(page, '#ps');
        await page.keyboard.type('cloudwatch', { delay: 70 });
        await sleep(0.5);
        await click(page, '.pick[data-id="aws__cloudwatch_get_logs"]');
        await sleep(0.6);
        await click(page, '#teach');
        await page.waitForSelector('.learned', { timeout: 30000 });
        await sleep(0.8);
      },
    },
    {
      id: 'd2c',
      say: `That's all it takes. It just adjusted a few connections inside HydraDB. If I ask the same thing again, all four come back.`,
      run: async (page, { sleep }) => {
        await glide(page, '.learned');
        await sleep(2);
        await glide(page, '.diff');
      },
    },
    {
      id: 'd3a',
      say: `Here's the test that matters. I'll ask for the same kind of job in completely different words: "${TASK_C}."`,
      run: async page => ask(page, TASK_C),
    },
    {
      id: 'd3b',
      say: `All four tools again, even though I never taught it that sentence. It didn't memorize my words. It learned the connection.`,
      run: async (page, { sleep }) => {
        await glide(page, '.tool:nth-of-type(2)');
        await sleep(2);
        await glide(page, '.graph');
      },
    },
    {
      id: 'd4',
      say: `Behind the scenes, each of these requests is a handful of quick lookups in HydraDB, and each correction is a few small updates. There is no extra AI call and no retraining.`,
      run: async (page, { sleep }) => {
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        await sleep(2.5);
      },
    },
  ];
}
