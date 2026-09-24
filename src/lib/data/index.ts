/**
 * The data layer — the "backend" box in docs/architecture.
 *
 * Everything above this line reaches storage through these three namespaces.
 * Nothing above `lib/data/` imports `cloudflare:workers`, names a binding, or
 * writes SQL. Moving off D1 and R2 means rewriting this directory and nothing
 * else.
 */

export * as posts from './posts';
export * as projects from './projects';
export * as assets from './assets';
export * as comments from './comments';
export * as members from './members';
export { storageConfigured } from './bindings';
export type { Post, Project } from './types';
export type { Comment } from './comments';
