/** Downloaded entrypoint for the independently installable Document Studio app. */

import React from 'react';
import DocumentStudioPage from './DocumentStudioPage';
import { createDocumentPackageMount, type DocumentPackageMountOptions } from './documentRuntime';

const DocumentStudioPackageApp: React.FC<{ options: DocumentPackageMountOptions }> = ({ options }) => (
  <DocumentStudioPage options={options} />
);

export const mount = createDocumentPackageMount(DocumentStudioPackageApp);
