// Tokenizing shared by the graph, the baselines and the tests.

const STOP = new Set(
  'a an the and or but if then than so of to in on at by for from with without into onto over under about as is are was were be been being do does did done have has had will would can could should may might must i me my mine we our ours us you your yours he she it its they them their this that these those there here what which who whom whose how when where why not no yes all any each every some more most other such only own same too very just also please show tell give get make let put take need want like find look keep check up out off again further once both few much many via per etc one two three four five new latest recent last next first today tomorrow yesterday now'
    .split(' '),
);

/** Very light stemmer: joins plurals ("invoices"/"invoice", "logs"/"log"). It does not handle "-ing" forms. */
export function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('es') && /(ss|x|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

/** Lowercased, stemmed content words. Underscores and double underscores split tool names. */
export function tokens(text) {
  return String(text || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** Stable 52-bit id from a label and name, so no id table has to be stored or synced. */
let NS = '';
/** Several independent graphs can share one database by giving each its own namespace salt. */
export function setNamespace(ns) {
  NS = ns ? `${ns}|` : '';
}

export function nodeId(label, name) {
  const s = `${NS}${label}:${name}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  // 52 bits: safe in a JSON number and a u64. Offset keeps ids clear of tiny hand-made ones.
  return (h1 >>> 0) * 0x100000 + (h2 >>> 12) + 1_000_000;
}
