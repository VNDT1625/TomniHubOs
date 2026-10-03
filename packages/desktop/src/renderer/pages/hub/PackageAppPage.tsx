import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import HubWorkspacePage from './HubWorkspacePage';

/**
 * Installed packages run in the Hub workspace. Store routes remain limited to
 * discovery, installation, updates, and package management.
 */
const PackageAppPage: React.FC = () => {
  const { packageId, moduleId } = useParams();

  if (!packageId || !moduleId) {
    return <Navigate to='/store' replace />;
  }

  return <HubWorkspacePage kind='package-app' packageId={packageId} moduleId={moduleId} />;
};

export default PackageAppPage;
