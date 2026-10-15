/**
 * Stores user-selected workspace choices for the renderer UI. This record is
 * inspectable and revocable, but never grants an agent capability by itself.
 */
export type WorkspaceApproval = { path: string; approvedAt: number };

const WORKSPACE_APPROVALS_KEY = 'tomni.workspace.approvals.v1';
const MAX_WORKSPACE_APPROVALS = 100;

const isWorkspaceApproval = (value: unknown): value is WorkspaceApproval => {
  if (!value || typeof value !== 'object') return false;
  const approval = value as Record<string, unknown>;
  return (
    typeof approval.path === 'string' &&
    approval.path.trim().length > 0 &&
    approval.path.length <= 2048 &&
    !/[\u0000-\u001f]/.test(approval.path) &&
    typeof approval.approvedAt === 'number' &&
    Number.isFinite(approval.approvedAt)
  );
};

export const getApprovedWorkspaces = (): WorkspaceApproval[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACE_APPROVALS_KEY) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter(isWorkspaceApproval) : [];
  } catch {
    return [];
  }
};

export const rememberApprovedWorkspace = (path: string): void => {
  const normalized = path.trim();
  if (!normalized || normalized.length > 2048 || /[\u0000-\u001f]/.test(normalized)) return;
  try {
    const approvals = getApprovedWorkspaces();
    const next = [
      { path: normalized, approvedAt: Date.now() },
      ...approvals.filter((item) => item.path !== normalized),
    ].slice(0, MAX_WORKSPACE_APPROVALS);
    localStorage.setItem(WORKSPACE_APPROVALS_KEY, JSON.stringify(next));
  } catch {
    // Workspace choices remain usable when local persistence is unavailable.
  }
};

export const revokeApprovedWorkspace = (path: string): void => {
  try {
    localStorage.setItem(
      WORKSPACE_APPROVALS_KEY,
      JSON.stringify(getApprovedWorkspaces().filter((item) => item.path !== path))
    );
  } catch {
    // Storage is optional; the caller still updates its current view.
  }
};
