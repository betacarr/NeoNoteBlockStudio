import path from 'node:path';

/** Explicit isolated profiles win; an installed legacy profile keeps recovery data. */
export function applicationProfile(explicit: string, testing: string | undefined, legacy: string, legacyExists: boolean): string | undefined {
  if (explicit) return path.resolve(explicit);
  if (testing) return path.resolve(testing);
  return legacyExists ? legacy : undefined;
}
