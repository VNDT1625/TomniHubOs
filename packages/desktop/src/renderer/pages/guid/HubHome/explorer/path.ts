export type ExplorerCrumb = { label: string; path: string };

/** Build navigable breadcrumbs without Node path APIs in the renderer. */
export const explorerCrumbs = (path: string): ExplorerCrumb[] => {
  const windows = /^[A-Za-z]:/.test(path) || path.startsWith('\\\\');
  const separator = windows ? '\\' : '/';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (path.startsWith('\\\\')) {
    const server = parts.shift();
    const share = parts.shift();
    if (!server || !share) return [];
    const root = `\\\\${server}\\${share}\\`;
    return [
      { label: `\\\\${server}\\${share}`, path: root },
      ...parts.map((label, index) => ({ label, path: root + parts.slice(0, index + 1).join(separator) })),
    ];
  }
  if (windows) {
    const drive = parts.shift();
    if (!drive) return [];
    const root = `${drive}\\`;
    return [
      { label: drive, path: root },
      ...parts.map((label, index) => ({ label, path: root + parts.slice(0, index + 1).join(separator) })),
    ];
  }
  return [
    { label: '/', path: '/' },
    ...parts.map((label, index) => ({ label, path: '/' + parts.slice(0, index + 1).join(separator) })),
  ];
};

export const explorerSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export const explorerFileType = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : '';
};

export const explorerAbsolutePath = (root: string, relativePath: string): string => {
  if (!relativePath || relativePath === '.') return root;
  const separator = root.includes('\\') || /^[A-Za-z]:/.test(root) ? '\\' : '/';
  return root.replace(/[\\/]+$/, '') + separator + relativePath.split(/[\\/]+/).join(separator);
};

/** Only a path below the granted root can reuse its sender-bound session. */
export const explorerRelativePath = (root: string, absolute: string): string | null => {
  const windows = root.includes('\\') || /^[A-Za-z]:/.test(root);
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedPath = absolute.replace(/\\/g, '/').replace(/\/+$/, '');
  const comparedRoot = windows ? normalizedRoot.toLocaleLowerCase() : normalizedRoot;
  const comparedPath = windows ? normalizedPath.toLocaleLowerCase() : normalizedPath;
  if (comparedPath === comparedRoot) return '';
  if (!comparedPath.startsWith(comparedRoot + '/')) return null;
  const relative = normalizedPath.slice(normalizedRoot.length + 1);
  if (relative.split('/').some((part) => part === '..' || part === '.')) return null;
  return relative;
};
