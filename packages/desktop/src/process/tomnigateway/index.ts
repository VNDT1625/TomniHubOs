/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

export { startTomniGateway, type TomniGatewayServer } from './server';

export {
  getTomniGatewayEndpoint,
  getTomniGatewayPort,
  resetProductionTomniGatewayForTests,
  startProductionTomniGateway,
  stopProductionTomniGateway,
  type ProductionTomniGatewayDeps,
  type TomniGatewayEndpoint,
} from './lifecycle';
export { TOMNI_GATEWAY_PROTOCOL } from './types';
export { createBrokerBackedTomniModelService, type TomniGatewayModelConsumer } from './modelService';
export {
  createModelRequestHistory,
  type ModelRequestHistory,
  type ModelRequestRecord,
  type ModelRequestUsage,
  type ModelUsageSource,
} from './modelRequestHistory';
export {
  createModelQuotaSnapshotStore,
  type ModelQuotaSnapshotRecord,
  type ModelQuotaSnapshotStore,
} from './modelQuotaSnapshots';
export {
  createModelReplayStore,
  type ModelReplayCodec,
  type ModelReplaySample,
  type ModelReplayStore,
} from './modelReplayStore';
export {
  createModelConsumerVault,
  createTomniGatewayModelConsumerRegistry,
  type ModelConsumerVaultCodec,
  type ModelConsumerVault,
  type TomniGatewayModelConsumerRecord,
  type TomniGatewayModelConsumerRegistry,
} from './modelConsumerVault';
export {
  registerTomniModelConsumerBridge,
  TOMNI_MODEL_CONSUMER_CHANNELS,
  tomniModelConsumerChannels,
  type TomniModelConsumerResult,
  type TomniModelConsumerSummary,
} from './modelConsumerBridge';
export type {
  TomniGatewayAuthConfig,
  TomniGatewayCollection,
  TomniGatewayCollectionName,
  TomniGatewayEvent,
  TomniGatewayMcpDiscoveryGroup,
  TomniGatewayMcpService,
  TomniGatewayModelService,
  TomniGatewayQuotaSnapshot,
  TomniGatewayOptions,
  TomniGatewayServices,
} from './types';
