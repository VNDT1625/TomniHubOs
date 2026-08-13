import {
  createStudioPackageGateNavigationState,
  isStudioCompatibilityLegacyFallback,
  isStudioSplitRouteRedirectBootstrapEnabled,
  LEGACY_STUDIO_MODULE_ID,
  LEGACY_STUDIO_PACKAGE_ID,
  resolveStudioCompatibilityNavigation,
  type StudioCompatibilityEntryPoint,
  type StudioCompatibilityNavigation,
} from '@/common/packages/studioCompatibility';
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import HubWorkspacePage from './HubWorkspacePage';
import { packageClient } from './packageClient';

type LegacyStudioRedirectProps = {
  source: StudioCompatibilityEntryPoint;
  packageId: string;
  moduleId: string;
  navigationSearch: string;
  navigationState: unknown;
  redirectEnabled: boolean;
};

const legacyRuntimeDecision: StudioCompatibilityNavigation = {
  kind: 'legacy-runtime',
  reason: 'target-unavailable',
};

const LegacyStudioRedirect: React.FC<LegacyStudioRedirectProps> = ({
  source,
  packageId,
  moduleId,
  navigationSearch,
  navigationState,
  redirectEnabled,
}) => {
  const [decision, setDecision] = useState<StudioCompatibilityNavigation>();

  useEffect(() => {
    let disposed = false;
    void packageClient
      .list()
      .then((packages) => {
        if (disposed) return;
        setDecision(
          resolveStudioCompatibilityNavigation(
            source,
            packages.map(({ manifest, state, enabled, compatible }) => ({
              id: manifest.id,
              state,
              enabled,
              compatible,
            })),
            redirectEnabled,
          )
        );
      })
      .catch(() => {
        if (!disposed) setDecision(legacyRuntimeDecision);
      });
    return () => {
      disposed = true;
    };
  }, [redirectEnabled, source]);

  if (!decision) return null;
  if (decision.kind === 'target-runtime') {
    return (
      <Navigate
        replace
        state={navigationState}
        to={`/store/app/${encodeURIComponent(decision.target.packageId)}/${encodeURIComponent(decision.target.moduleId)}${navigationSearch}`}
      />
    );
  }
  if (decision.kind === 'package-gate') {
    return (
      <Navigate
        replace
        state={createStudioPackageGateNavigationState(navigationSearch, navigationState)}
        to={`/store/package/${encodeURIComponent(decision.target.packageId)}${navigationSearch}`}
      />
    );
  }
  return <HubWorkspacePage kind='store' packageId={packageId} moduleId={moduleId} />;
};

const StorePage: React.FC = () => {
  const { packageId, moduleId } = useParams();
  const location = useLocation();
  const redirectEnabled = isStudioSplitRouteRedirectBootstrapEnabled(window.__studioSplitRouteRedirectEnabled);
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const legacySource = searchParams.get('legacySource');
  const legacyFallback = searchParams.get('legacyFallback');
  const source = useMemo<StudioCompatibilityEntryPoint>(
    () =>
      legacySource === 'route'
        ? { kind: 'route', pathname: '/studio', mode }
        : { kind: 'package-module', packageId: packageId ?? '', moduleId: moduleId ?? '', mode },
    [legacySource, mode, moduleId, packageId]
  );
  const isLegacyStudio = packageId === LEGACY_STUDIO_PACKAGE_ID && moduleId === LEGACY_STUDIO_MODULE_ID;
  if (!isLegacyStudio || !packageId || !moduleId) {
    return <HubWorkspacePage kind='store' packageId={packageId} moduleId={moduleId} />;
  }
  if (isStudioCompatibilityLegacyFallback(legacyFallback)) {
    return <HubWorkspacePage kind='store' packageId={packageId} moduleId={moduleId} />;
  }
  return (
    <LegacyStudioRedirect
      source={source}
      packageId={packageId}
      moduleId={moduleId}
      navigationSearch={location.search}
      navigationState={location.state}
      redirectEnabled={redirectEnabled}
    />
  );
};

export default StorePage;
