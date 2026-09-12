/// <reference types="astro/client" />

import type { Viewer, Audience } from './lib/visibility';
import type { MemberStatus } from './lib/data/members';

declare global {
  namespace App {
    interface Locals {
      /** Populated by src/middleware.ts. Null when signed out. */
      viewer: Viewer | null;
      /** Resolved per request from the env lists and the members table. */
      audience: Audience;
      /** Absent for anonymous visitors and anyone covered by the env lists. */
      memberStatus?: MemberStatus;
    }
  }
}

export {};
