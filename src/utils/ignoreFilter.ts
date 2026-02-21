import ignore, { Ignore } from 'ignore';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

/**
 * Patterns that are ALWAYS excluded for security and efficiency.
 * These apply even if no .gitignore exists.
 */
const ALWAYS_IGNORED = [
  // Environment files (secrets) - ALWAYS excluded
  '.env',
  '.env.*',
  '.env.local',
  '.env.*.local',

  // Database files - local dev data must not be deployed to production
  '*.db',
  '*.sqlite',
  '*.sqlite3',

  // Version control - never needed in deployment
  '.git',

  // Build outputs - builds happen server-side now
  // Excluding these prevents uploading large build artifacts
  '.next',           // Next.js build output
  '.output',         // Nuxt 3 / Nitro output
  '.svelte-kit',     // SvelteKit build output
  '.nuxt',           // Nuxt build cache
  '.astro',          // Astro build cache
  'dist',            // Common build output
  'build',           // Common build output (CRA, etc.)
  'out',             // Next.js static export
  '.vercel',         // Vercel build output
  '.netlify',        // Netlify build output

  // Dependencies - will be installed server-side
  'node_modules',
];

/**
 * Create an ignore filter for a directory.
 * Priority: security defaults > vtp.yaml ignore > .gitignore
 */
export async function createIgnoreFilter(
  rootPath: string,
  configIgnore?: string[]
): Promise<Ignore> {
  const ig = ignore().add(ALWAYS_IGNORED);

  // Add patterns from vtp.yaml ignore field
  if (configIgnore && configIgnore.length > 0) {
    ig.add(configIgnore);
  }

  // Load .gitignore if present
  try {
    const gitignorePath = join(rootPath, '.gitignore');
    const content = await readFile(gitignorePath, 'utf-8');
    ig.add(content);
  } catch {
    // No .gitignore file, that's fine
  }

  return ig;
}

/**
 * Get all files to include in the archive, respecting ignore patterns.
 * Returns relative paths from the root.
 */
export async function getFilesToInclude(
  rootPath: string,
  configIgnore?: string[],
  ig?: Ignore,
  basePath: string = ''
): Promise<string[]> {
  // Initialise ignore filter at root level
  if (!ig) {
    ig = await createIgnoreFilter(rootPath, configIgnore);
  }

  const files: string[] = [];
  const entries = await readdir(join(rootPath, basePath));

  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry}` : entry;
    const fullPath = join(rootPath, relativePath);

    // Check if this path should be ignored
    if (ig.ignores(relativePath)) {
      continue;
    }

    const entryStat = await stat(fullPath);

    if (entryStat.isDirectory()) {
      // Check if directory itself is ignored (with trailing slash)
      if (ig.ignores(relativePath + '/')) {
        continue;
      }

      // Recurse into directory
      const subFiles = await getFilesToInclude(rootPath, configIgnore, ig, relativePath);
      files.push(...subFiles);
    } else {
      files.push(relativePath);
    }
  }

  return files;
}
