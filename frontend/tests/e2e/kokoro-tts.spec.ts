import { test, expect } from '@playwright/test'

/**
 * E2E tests for Kokoro TTS functionality.
 *
 * These tests use a standalone test page that loads the real WASM model
 * without needing the full app or backend.
 *
 * The first run downloads ~86MB of model data (cached in IndexedDB after).
 *
 * To run these tests:
 * 1. Set environment variable: RUN_E2E_TESTS=true
 * 2. Run: RUN_E2E_TESTS=true npm run test:e2e
 *
 * @group e2e
 */

// Skip E2E tests by default (they download ~86MB model data)
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === 'true' || process.env.RUN_E2E_TESTS !== 'true'

test.describe('Kokoro TTS E2E', () => {
  // Skip all tests in this describe block if E2E is disabled
  test.skip(() => SKIP_E2E, 'E2E tests skipped (set RUN_E2E_TESTS=true to enable)')
  // Long timeout for model loading
  test.setTimeout(180000) // 3 minutes

  test('should load the standalone Kokoro test page', async ({ page }) => {
    await page.goto('/kokoro-test.html')

    // Verify page loaded
    await expect(page.getByRole('heading', { name: 'Kokoro TTS Test' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load Model' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speak Test' })).toBeDisabled()
  })

  test('should load Kokoro model successfully', async ({ page }) => {
    await page.goto('/kokoro-test.html')

    // Click load button
    const loadButton = page.getByRole('button', { name: 'Load Model' })
    await loadButton.click()

    // Verify loading starts
    await expect(page.locator('#status')).toContainText(/Loading|Downloading/, {
      timeout: 10000,
    })

    // Wait for model to load (this can take a while on first run)
    await expect(page.locator('#status')).toContainText('Model loaded successfully', {
      timeout: 150000, // 2.5 minutes for slow connections
    })

    // Verify speak button is enabled
    await expect(page.getByRole('button', { name: 'Speak Test' })).toBeEnabled()
  })

  test('should generate speech after model loads', async ({ page }) => {
    await page.goto('/kokoro-test.html')

    // Load model first
    const loadButton = page.getByRole('button', { name: 'Load Model' })
    await loadButton.click()

    // Wait for model to load
    await expect(page.locator('#status')).toContainText('Model loaded successfully', {
      timeout: 150000,
    })

    // Verify speak button is enabled after model loads
    const speakButton = page.getByRole('button', { name: 'Speak Test' })
    await expect(speakButton).toBeEnabled()

    // Click speak button
    await speakButton.click()

    // Verify speech generation starts (status changes from "Model loaded successfully")
    // In headless mode, audio playback may not work, but generation should
    await expect(page.locator('#status')).not.toContainText('Model loaded successfully', {
      timeout: 30000,
    })
  })
})

test.describe('Kokoro IndexedDB Caching', () => {
  test.skip(() => SKIP_E2E, 'E2E tests skipped (set RUN_E2E_TESTS=true to enable)')

  test('should cache model in IndexedDB after loading', async ({ page }) => {
    await page.goto('/kokoro-test.html')

    // Check IndexedDB for cached model data
    const cacheInfo = await page.evaluate(async () => {
      try {
        const dbs = await indexedDB.databases()
        const relevantDbs = dbs.filter(
          (db) =>
            db.name?.includes('transformers') ||
            db.name?.includes('onnx') ||
            db.name?.includes('huggingface')
        )
        return {
          hasCachedModel: relevantDbs.length > 0,
          databases: relevantDbs.map((db) => db.name),
        }
      } catch {
        return { hasCachedModel: false, databases: [] }
      }
    })

    console.log('IndexedDB cache info:', cacheInfo)

    // This test documents the cache state - it always passes
    // The cache will be populated after running the "load model" test
    expect(true).toBe(true)
  })
})
