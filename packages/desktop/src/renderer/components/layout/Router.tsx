import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import RouteErrorBoundary from '@renderer/components/layout/RouteErrorBoundary';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { MUSIC_STUDIO_ENABLED, TEAM_MODE_ENABLED } from '@/common/config/constants';
import { createStudioCompatibilityRouteDestination } from '@/common/packages/studioCompatibility';
const Conversation = React.lazy(() => import('@renderer/pages/conversation'));
const Guid = React.lazy(() => import('@renderer/pages/guid'));
const Manager = React.lazy(() => import('@renderer/pages/manager'));
const ManagementPage = React.lazy(() => import('@renderer/pages/hub/ManagementPage'));
const StorePage = React.lazy(() => import('@renderer/pages/hub/StorePage'));
const PackageAppPage = React.lazy(() => import('@renderer/pages/hub/PackageAppPage'));
const HistoryPage = React.lazy(() => import('@renderer/pages/hub/HistoryPage'));
const NotificationsPage = React.lazy(() => import('@renderer/pages/notifications/NotificationsPage'));
const CompanyRoute = React.lazy(() => import('@renderer/pages/guid/shell/CompanyRoute'));
const ArtifactsPage = React.lazy(() => import('@renderer/pages/guid/shell/ArtifactsPage'));
const AgentSettings = React.lazy(() => import('@renderer/pages/settings/AgentSettings'));
const PersonalSettings = React.lazy(() => import('@renderer/pages/settings/PersonalSettings'));
const AccountPage = React.lazy(() => import('@renderer/pages/account/AccountPage'));
const AssistantSettings = React.lazy(() => import('@renderer/pages/settings/AssistantSettings'));
const CapabilitiesSettings = React.lazy(() => import('@renderer/pages/settings/CapabilitiesSettings'));
const DisplaySettings = React.lazy(() => import('@renderer/pages/settings/DisplaySettings'));
const ProfileSettings = React.lazy(() => import('@renderer/pages/settings/ProfileSettings'));
const BillingSettings = React.lazy(() => import('@renderer/pages/settings/BillingSettings'));
const PipelineChatSettings = React.lazy(() => import('@renderer/pages/settings/PipelineChatSettings'));
const AiConfigSettings = React.lazy(() => import('@renderer/pages/settings/AiConfigSettings'));
const NotificationSettings = React.lazy(() => import('@renderer/pages/settings/NotificationSettings'));
const PrivacySecuritySettings = React.lazy(() => import('@renderer/pages/settings/PrivacySecuritySettings'));
const ModeSettings = React.lazy(() => import('@renderer/pages/settings/ModeSettings'));
const SystemSettings = React.lazy(() => import('@renderer/pages/settings/SystemSettings'));
const WebuiSettings = React.lazy(() => import('@renderer/pages/settings/WebuiSettings'));

const ResourceSettings = React.lazy(() => import('@renderer/pages/settings/ResourceSettings'));

const GitSettings = React.lazy(() => import('@renderer/pages/git'));

const ExtensionSettingsPage = React.lazy(() => import('@renderer/pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('@renderer/pages/login'));
const ComponentsShowcase = React.lazy(() => import('@renderer/pages/TestShowcase'));
const ScheduledTasksPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage'));
const TaskDetailPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'));
const DefaultPackageRoute = React.lazy(() => import('@renderer/pages/guid/shell/DefaultPackageRoute'));
const TeamIndex = React.lazy(() => import('@renderer/pages/team'));
const SocialHubPage = React.lazy(() => import('@renderer/pages/social'));
const RealtimePage = React.lazy(() => import('@renderer/pages/realtime'));

const FileViewerPage = React.lazy(() => import('@renderer/pages/integrations/fileViewer'));
const LibraryPage = React.lazy(() => import('@renderer/pages/integrations/library'));

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <RouteErrorBoundary>
    <Suspense fallback={<AppLoader />}>
      <Component />
    </Suspense>
  </RouteErrorBoundary>
);

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return React.cloneElement(layout);
};

const LegacyStudioRoute: React.FC = () => {
  const location = useLocation();
  return <Navigate replace state={location.state} to={createStudioCompatibilityRouteDestination(location.search)} />;
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  return (
    <HashRouter>
      <Routes>
        <Route
          path='/login'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)}
        />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          <Route path='/guid' element={withRouteFallback(Guid)} />
          <Route path='/studio' element={<LegacyStudioRoute />} />
          <Route path='/manager' element={withRouteFallback(ManagementPage)} />
          <Route path='/manager/workspace' element={withRouteFallback(Manager)} />

          <Route path='/apps/:packageId/:moduleId' element={withRouteFallback(PackageAppPage)} />
          <Route path='/store/app/:packageId/:moduleId' element={withRouteFallback(StorePage)} />
          <Route path='/store/package/:packageId' element={withRouteFallback(StorePage)} />
          <Route path='/store/*' element={withRouteFallback(StorePage)} />
          <Route path='/products' element={<Navigate to='/store' replace />} />
          <Route path='/history' element={withRouteFallback(HistoryPage)} />
          <Route path='/notifications' element={withRouteFallback(NotificationsPage)} />
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          {/* Optional default apps: the base owns only this signed-package install gate. */}
          <Route path='/ide' element={<Suspense fallback={<AppLoader />}><DefaultPackageRoute app='ide' /></Suspense>} />
          <Route path='/browser' element={<Suspense fallback={<AppLoader />}><DefaultPackageRoute app='browser' /></Suspense>} />
          <Route path='/company' element={withRouteFallback(CompanyRoute)} />
          {/* Artifacts render natively in the shell centre; no Store redirect. */}
          <Route path='/artifacts' element={withRouteFallback(ArtifactsPage)} />
          <Route path='/social' element={withRouteFallback(SocialHubPage)} />

          <Route path='/library' element={withRouteFallback(LibraryPage)} />
          <Route path='/file-viewer' element={withRouteFallback(FileViewerPage)} />

          <Route path='/monitor' element={<Navigate to='/store/package/com.tomni.monitor' replace />} />

          <Route path='/knowledge' element={<Navigate to='/store/package/com.tomni.knowledge' replace />} />

          <Route path='/git' element={withRouteFallback(GitSettings)} />
          <Route
            path='/team/:id'
            element={TEAM_MODE_ENABLED ? withRouteFallback(TeamIndex) : <Navigate to='/guid' replace />}
          />
          <Route
            path='/music'
            element={MUSIC_STUDIO_ENABLED ? <Navigate to='/studio' replace /> : <Navigate to='/guid' replace />}
          />
          <Route path='/settings/profile' element={withRouteFallback(ProfileSettings)} />
          <Route path='/settings/billing' element={withRouteFallback(BillingSettings)} />
          <Route path='/settings/pipeline' element={withRouteFallback(PipelineChatSettings)} />
          <Route path='/settings/aiconfig' element={withRouteFallback(AiConfigSettings)} />
          <Route path='/settings/notification' element={withRouteFallback(NotificationSettings)} />
          <Route path='/settings/privacy' element={withRouteFallback(PrivacySecuritySettings)} />
          <Route path='/settings/model' element={withRouteFallback(ModeSettings)} />
          <Route path='/settings/assistants' element={withRouteFallback(AssistantSettings)} />
          <Route path='/settings/agent' element={withRouteFallback(AgentSettings)} />
          <Route path='/settings/personal' element={withRouteFallback(PersonalSettings)} />
          <Route path='/account' element={withRouteFallback(AccountPage)} />
          <Route path='/settings/capabilities' element={withRouteFallback(CapabilitiesSettings)} />
          {/* Legacy routes — redirect to the merged /settings/capabilities page */}
          <Route path='/settings/skills-hub' element={<Navigate to='/settings/capabilities?tab=skills' replace />} />
          <Route path='/settings/tools' element={<Navigate to='/settings/capabilities?tab=tools' replace />} />
          <Route path='/settings/display' element={withRouteFallback(DisplaySettings)} />
          <Route path='/settings/webui' element={withRouteFallback(WebuiSettings)} />
          <Route path='/settings/pet' element={<Navigate to='/store/package/com.tomni.pet' replace />} />
          <Route path='/settings/resource' element={withRouteFallback(ResourceSettings)} />
          <Route path='/settings/company' element={<Navigate to='/store/package/com.tomni.company' replace />} />
          <Route path='/settings/knowledge' element={<Navigate to='/store/package/com.tomni.knowledge' replace />} />
          <Route path='/settings/browser' element={<Navigate to='/browser' replace />} />

          <Route path='/settings/monitor' element={<Navigate to='/store/package/com.tomni.monitor' replace />} />

          <Route path='/settings/git' element={withRouteFallback(GitSettings)} />

          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings/realtime' element={<Navigate to='/guid' replace />} />
          <Route path='/realtime' element={withRouteFallback(RealtimePage)} />
          <Route path='/settings' element={<Navigate to='/settings/model' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
          <Route path='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />
          <Route path='/scheduled/:job_id' element={withRouteFallback(TaskDetailPage)} />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
