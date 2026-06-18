import { test, expect } from '@playwright/test'

test.describe('User login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('shows login form', async ({ page }) => {
    await expect(page.getByTestId('submit-btn')).toBeVisible()
    await expect(page.getByLabel('Submit the form')).toBeVisible()
  })

  test.skip('skipped test', async ({ page }) => {
    await page.goto('/dashboard')
  })
})
