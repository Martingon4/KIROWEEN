import { readFileSync, statSync } from 'node:fs';

export const MIN_SECRET_LENGTH = 16;

/**
 * Reads a secret from a file kept outside the repository and outside the environment the agent
 * sources. Refuses files readable by group or others (POSIX) so the secret is not world-readable.
 */
export function readSecretFile(path: string, platform: string = process.platform): string {
  const st = statSync(path);
  if (!st.isFile()) throw new Error('DASHBOARD_ADMIN_SECRET_FILE no es un archivo');
  if (platform !== 'win32' && (st.mode & 0o077) !== 0) {
    throw new Error('DASHBOARD_ADMIN_SECRET_FILE debe tener permisos 600 (chmod 600)');
  }
  const value = readFileSync(path, 'utf8').trim();
  if (value.length < MIN_SECRET_LENGTH || value === 'change-me') {
    throw new Error('El secreto del archivo es demasiado corto o es el valor de ejemplo');
  }
  return value;
}
