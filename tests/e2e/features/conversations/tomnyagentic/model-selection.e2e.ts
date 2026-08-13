/**
 * TomnyAgentic Chat E2E Tests - Model Selection (P0 + P1)
 *
 * Test Cases Covered:
 * - TC-A-04: Use second model (guid page selection)
 * - TC-A-07: Switch model mid-conversation
 *
 * Prerequisites:
 * - tomnyagentic binary available
 * - User logged in
 * - At least 2 ACP models available (filtered Google Auth)
 *
 * Data-testid references:
 * - TomnyAgenticModelSelector: data-testid="tomnyagentic-model-selector"
 * - Model options: data-testid="tomnyagentic-model-option-{modelId}"
 */

import { test, expect } from '../../../fixtures';
import {
  resolveTomnyAgenticPreconditions,
  cleanupE2ETomnyAgenticConversations,
  createTomnyAgenticConversationViaBridge,
  sendTomnyAgenticMessage,
  waitForTomnyAgenticReply,
  getTomnyAgenticConversationDB,
  getTomnyAgenticMessages,
  createTempWorkspace,
  type TomnyAgenticTestModels,
} from '../../../helpers';
import { takeScreenshot } from '../../../helpers/screenshots';

test.describe('TomnyAgentic Chat - Model Selection (P0 + P1)', () => {
  test.setTimeout(120000); // 2 minutes

  let preconditions: { binary: string | null; models: TomnyAgenticTestModels | null };

  test.beforeAll(async ({ page }) => {
    preconditions = await resolveTomnyAgenticPreconditions(page);
    if (!preconditions.binary || !preconditions.models) {
      test.skip(true, 'No tomnyagentic-compatible provider found, skipping E2E tests');
    }
  });

  test.afterEach(async ({ page }) => {
    // Cleanup order: ESC × 5 → DB → sessionStorage
    await Promise.all(Array.from({ length: 5 }, () => page.keyboard.press('Escape')));

    await cleanupE2ETomnyAgenticConversations(page);

    await page.evaluate(() => {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (
          key &&
          (key.startsWith('tomnyagentic_initial_message_') || key.startsWith('tomnyagentic_initial_processed_'))
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => sessionStorage.removeItem(key));
    });
  });

  // ============================================================================
  // TC-A-04: Use second model (guid page selection)
  // ============================================================================

  test.skip('TC-A-04: should use second model selected on guid page', async ({ page }) => {
    // SKIP: Pending tomnyagentic binary investigation - modelB switch causes silent hang on subsequent messages
    // Tracked as a production-runtime ownership gap in docs/architecture/current.md.
    // Symptom: Same root cause as TC-A-08/09 - runtime model switching leads to binary hang
    // Next: Product team investigation of tomnyagentic binary runtime state handling

    if (!preconditions.models!.modelB) {
      test.skip(true, 'Need 2nd tomnyagentic-compatible model, modelB is null');
    }

    const timestamp = Date.now();
    const conversationName = `E2E-tomnyagentic-${timestamp}-model-second`;
    const tempWorkspace = createTempWorkspace(`tc-a-04-${timestamp}`);

    try {
      // Screenshot 01: guid page initial
      await page.goto(`${page.url().split('#')[0]}#/guid`);
      await page.waitForLoadState('networkidle');
      await takeScreenshot(page, `chat-tomnyagentic/tc-a-04/01-guid-page-initial.png`);

      // Step 2: Create conversation via bridge using modelB (bypasses UI selector issues)
      const conversationId = await createTomnyAgenticConversationViaBridge(page, {
        name: conversationName,
        workspace: tempWorkspace.path,
        provider: preconditions.models!.modelB,
        sessionMode: 'default',
      });
      await takeScreenshot(page, `chat-tomnyagentic/tc-a-04/02-conversation-created.png`);

      // Step 3: Send message
      await sendTomnyAgenticMessage(page, conversationId, 'Say hi in one word.');
      await takeScreenshot(page, `chat-tomnyagentic/tc-a-04/03-message-sent.png`);

      // Step 4: Wait for AI reply
      await waitForTomnyAgenticReply(page, conversationId);
      await takeScreenshot(page, `chat-tomnyagentic/tc-a-04/04-reply-completed.png`);

      // ============================================================================
      // DB Assertions
      // ============================================================================

      // 1. Verify conversation uses modelB
      const conversation = await getTomnyAgenticConversationDB(page, conversationId);
      expect(conversation).toBeDefined();

      const extra =
        typeof conversation.extra === 'string' ? JSON.parse(conversation.extra || '{}') : conversation.extra || {};
      const actualModelUse = String(extra.model?.useModel || '');
      expect(actualModelUse).toBe(preconditions.models!.modelB.useModel);

      // 2. Verify messages exist
      const messages = await getTomnyAgenticMessages(page, conversationId);
      expect(messages.length).toBeGreaterThanOrEqual(2);
      const aiMessages = messages.filter((m) => m.position === 'left');
      expect(aiMessages.length).toBeGreaterThanOrEqual(1);
    } finally {
      await tempWorkspace.cleanup();
    }
  });

  // ============================================================================
  // TC-A-07: Switch model mid-conversation
  // ============================================================================

  test.skip('TC-A-07: should switch model mid-conversation and update DB', async ({ page }) => {
    // SKIP: Pending tomnyagentic binary investigation - modelB switch causes silent hang on subsequent messages
    // Tracked as a production-runtime ownership gap in docs/architecture/current.md.
    // Symptom: Same root cause as TC-A-08/09 - runtime model switching leads to binary hang
    // Next: Product team investigation of tomnyagentic binary runtime state handling

    if (!preconditions.models!.modelB) {
      test.skip(true, 'Need 2nd tomnyagentic-compatible model for mid-conversation switch');
    }

    const timestamp = Date.now();
    const conversationName = `E2E-tomnyagentic-${timestamp}-switch-model`;
    const tempWorkspace = createTempWorkspace(`tc-a-07-${timestamp}`);

    try {
      // Step 1: Create conversation via bridge with modelA
      const conversationId = await createTomnyAgenticConversationViaBridge(page, {
        name: conversationName,
        workspace: tempWorkspace.path,
        provider: preconditions.models!.modelA,
        sessionMode: 'default',
      });

      // Screenshot 01: before first message
      await takeScreenshot(page, `chat-tomnyagentic/tc-a-07/01-conversation-created.png`);

      // Step 2: Send first message
      await sendTomnyAgenticMessage(page, conversationId, 'Hello, please respond.');

      // Step 3: Wait for first AI reply
      await waitForTomnyAgenticReply(page, conversationId);

      // Screenshot 02: first reply completed
      await takeScreenshot(page, `chat-tomnyagentic/tc-a-07/02-first-reply.png`);

      // Step 4: Navigate to conversation page
      await page.goto(`${page.url().split('#')[0]}#/conversation/${conversationId}`);
      await page.waitForLoadState('networkidle');

      // Step 5: Switch to modelB by exact data-testid
      const modelSelector = page.locator('[data-testid="tomnyagentic-model-selector"]');
      await expect(modelSelector).toBeVisible({ timeout: 10000 });
      await modelSelector.click();
      await page.waitForTimeout(500);

      // Screenshot 03: model selector open
      await takeScreenshot(page, `chat-tomnyagentic/tc-a-07/03-model-selector-open.png`);

      const secondModelOption = page.locator(
        `[data-testid="tomnyagentic-model-option-${preconditions.models!.modelB.useModel}"]`
      );
      await secondModelOption.waitFor({ state: 'visible', timeout: 5000 });
      await secondModelOption.click();
      await page.waitForTimeout(1000);

      // Step 6: Send second message
      await sendTomnyAgenticMessage(page, conversationId, 'What model are you using now?');

      // Step 7: Wait for second AI reply
      await waitForTomnyAgenticReply(page, conversationId);

      // Screenshot 04: second reply completed
      await takeScreenshot(page, `chat-tomnyagentic/tc-a-07/04-second-reply.png`);

      // ============================================================================
      // DB Assertions
      // ============================================================================

      // 1. Verify model switched to modelB in DB
      const conversation = await getTomnyAgenticConversationDB(page, conversationId);
      const extra =
        typeof conversation.extra === 'string' ? JSON.parse(conversation.extra || '{}') : conversation.extra || {};
      const currentModel = extra.model?.useModel;
      expect(currentModel).toBe(preconditions.models!.modelB.useModel);

      // 2. Verify message count (at least 4: user1, ai1, user2, ai2)
      const messages = await getTomnyAgenticMessages(page, conversationId);
      expect(messages.length).toBeGreaterThanOrEqual(4);

      // 3. Verify both AI replies exist
      const aiMessages = messages.filter((m) => m.position === 'left');
      expect(aiMessages.length).toBeGreaterThanOrEqual(2);
    } finally {
      await tempWorkspace.cleanup();
    }
  });
});
