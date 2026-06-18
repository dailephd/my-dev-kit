import { test, expect } from '@playwright/test'

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('shows login form', async ({ page }) => {
    await expect(page.getByRole('heading')).toContainText('Sign In')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByPlaceholder('Enter your email')).toBeVisible()
  })

  test('logs in successfully', async ({ page }) => {
    await page.getByLabel('Email').fill('user@example.com')
    await page.getByLabel('Password').fill('secret')
    await page.getByRole('button', { name: 'Sign In' }).click()
    await page.goto('/dashboard')
    await expect(page.getByTestId('welcome-message')).toHaveText('Welcome!')
  })

  test.skip('forgot password flow', async ({ page }) => {
    await page.goto('/forgot-password')
  })
})

test('home page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toBeVisible()
})
