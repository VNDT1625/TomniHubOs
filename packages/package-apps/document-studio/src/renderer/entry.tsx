/** Downloaded entrypoint for the independently installable Document Studio app. */

import React from 'react';
import DocumentStudioPage from '@package-apps/document-studio/renderer/DocumentStudioPage';
import {
  createDocumentPackageMount,
  type DocumentPackageMountOptions,
} from '@package-apps/document-studio/renderer/documentRuntime';

const DocumentStudioPackageApp: React.FC<{ options: DocumentPackageMountOptions }> = ({ options }) => (
  <DocumentStudioPage options={options} />
);

export const mount = createDocumentPackageMount(DocumentStudioPackageApp);
