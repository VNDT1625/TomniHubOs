/**
 * @license
 * Copyright 2025 Tomni
 * SPDX-License-Identifier: Apache-2.0
 */

export { startTomniGateway, type TomniGatewayServer } from './server';

export {
  getTomniGatewayEndpoint,
  resetProductionTomniGatewayForTests,
  startProductionTomniGateway,
  stopProductionTomniGateway,
  type ProductionTomniGatewayDeps,
  type TomniGatewayEndpoint,
} from './lifecycle';
export { TOMNI_GATEWAY_PROTOCOL } from './types';
export type {
  TomniGatewayAuthConfig,
  TomniGatewayCollection,
  TomniGatewayCollectionName,
  TomniGatewayEvent,
  TomniGatewayMcpDiscoveryGroup,
  TomniGatewayMcpService,
  TomniGatewayOptions,
  TomniGatewayServices,
} from './types';
