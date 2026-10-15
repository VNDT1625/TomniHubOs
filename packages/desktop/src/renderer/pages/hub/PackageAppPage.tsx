import React from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PackageAppHost } from './PackageAppHost';

/**
 * An installed package is a Hub shell surface: its app frame fills the shell
 * centre while the shared sidebar, rail and footer stay in place.
 */
const PackageAppPage: React.FC = () => {
  const { packageId, moduleId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const focusSession = (location.state as { focusSession?: unknown } | null)?.focusSession;

  if (!packageId || !moduleId || packageId.length > 256 || moduleId.length > 256) {
    return <Navigate to='/store' replace />;
  }

  return (
    <PackageAppHost
      key={`${packageId}:${moduleId}`}
      packageId={packageId}
      moduleId={moduleId}
      onBack={() => void navigate('/guid')}
      allowSandboxedWeb
      focusSession={typeof focusSession === 'string' ? focusSession : undefined}
      focusNonce={location.key}
    />
  );
};

export default PackageAppPage;
