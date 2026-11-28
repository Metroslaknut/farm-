import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildKnowledge } from '../modules/assistant/build-index';

/** Rebuild the assistant's knowledge index from the help articles (run after editing help content). */
const out = join(import.meta.dirname, '../modules/assistant/help-index.json');
const chunks = buildKnowledge();
writeFileSync(out, `${JSON.stringify(chunks, null, 1)}\n`);
console.log(`assistant index: ${chunks.length} chunks → ${out}`);
