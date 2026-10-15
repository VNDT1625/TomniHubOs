/**
 * T2.5: required env-values are satisfied only through Main's package-scoped vault.
 * This module returns missing field names, never handles, token values or decrypted material.
 */
/* oxlint-disable no-await-in-loop -- must stop at the first accessible matching handle; never bulk-resolve secrets */
import type { AdapterDocument, AdapterConnection } from '@/common/packages/adapter';
import type { PackageSecretPort } from '@process/resources/packageSecrets/packageSecretPort';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;

/** Required variables declared by this connection, deduplicated by field name. */
export const requiredConnectionEnv = (adapter: AdapterDocument, connection: AdapterConnection): readonly string[] => {
  const id = connection.kind === 'skill' ? undefined : connection.id;
  // An unscoped env item may be needed by executable connections, not inert data-only
  // skills/agents/commands/rules/knowledge. Do not block instructions on unrelated setup.
  const usesUnscopedEnv = !['skill', 'agent', 'command', 'rules', 'knowledge'].includes(connection.kind);
  return [
    ...new Set(
      (adapter.openItems ?? [])
        .filter(
          (item) =>
            item.kind === 'env-value' &&
            item.name &&
            item.required !== false &&
            ((item.connection === undefined && usesUnscopedEnv) || (id !== undefined && item.connection === id)) &&
            ENV_NAME.test(item.name)
        )
        .map((item) => item.name as string)
    ),
  ];
};

/** Only check one package's own or explicitly granted sets. Even malformed vault data fails closed. */
export const missingPackageEnv = async (
  port: Pick<PackageSecretPort, 'list' | 'resolve'>,
  names: readonly string[]
): Promise<readonly string[]> => {
  const required = [...new Set(names.filter((name) => ENV_NAME.test(name)))].slice(0, 100);
  if (required.length === 0) return [];
  let available: Awaited<ReturnType<PackageSecretPort['list']>>;
  try {
    available = await port.list();
  } catch {
    return required;
  }
  const missing: string[] = [];
  for (const name of required) {
    let filled = false;
    for (const set of available) {
      if (!set.fields.includes(name)) continue;
      try {
        // The value stays inside Main, is only inspected for non-emptiness and never logged or returned.
        const values = await port.resolve(set.handle, [name]);
        if (typeof values[name] === 'string' && values[name].length > 0) {
          filled = true;
          break;
        }
      } catch {
        // Invalid, revoked or ungranted handles must not satisfy the requirement.
      }
    }
    if (!filled) missing.push(name);
  }
  return missing;
};
