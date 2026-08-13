/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';

export type Build0CommandContextValue = {
  rootPath: string;
};

const Build0CommandContext = createContext<Build0CommandContextValue | null>(null);

export const Build0CommandProvider = Build0CommandContext.Provider;

/**
 * Return the IDE-local Build0 command availability, or null outside the IDE surface.
 */
export const useBuild0CommandSafe = (): Build0CommandContextValue | null => useContext(Build0CommandContext);
