// Embedding-only models (all-minilm, nomic-embed-text, bge, ...) answer /api/embed but refuse /api/chat.
// They must never be offered or chosen as a chat model. Ollama's tag list has no capability field, so match by name.
const EMBEDDING = /embed|minilm|(^|[-_/:])bge([-_:]|$)|(^|[-_/:])e5([-_:]|$)|(^|[-_/:])gte([-_:]|$)|mxbai|nomic|snowflake-arctic|paraphrase-|sentence-|bert/i;

export const isEmbeddingModel = name => EMBEDDING.test(String(name || ''));
export const chatModelsOnly = names => names.filter(n => !isEmbeddingModel(n));
