import { loader } from 'fumadocs-core/source';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { defineDocs } from 'fumadocs-mdx/macro';

// content/docs is generated from the repo's markdown by scripts/sync-content.mjs.
const docs = defineDocs({
  dir: 'content/docs',
  docs: { schema: pageSchema },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});
