import { source } from '@/lib/source';
import { flexsearchFromSource } from 'fumadocs-core/search/flexsearch';

// This is a static export (next.config.mjs's `output: 'export'`), so there is
// no server at request time to answer a search query — `staticGET` instead
// pre-builds the whole index at BUILD time into a static JSON response,
// which the client fetches once and searches in-browser (see
// components/search.tsx). `revalidate = false` is required for Next to
// treat this route as static rather than dynamic during export.
export const revalidate = false;
export const { staticGET: GET } = flexsearchFromSource(source);
