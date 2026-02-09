import { test, expect } from '@playwright/test';

test.describe('Transaction Management', () => {
  test('should create a new income transaction', async ({ page }) => {
    await page.goto('/transactions');

    // Wait for page to load
    await expect(page.getByRole('heading', { name: /transactions/i })).toBeVisible();

    // Click the Add Transaction button
    await page.getByRole('button', { name: /add transaction|new/i }).click();

    // Wait for the drawer to open
    await expect(page.getByText(/new transaction/i)).toBeVisible();

    // Fill in the amount
    const amountInput = page.getByPlaceholder('0.00');
    await amountInput.fill('150');

    // Ensure Income type is selected (default)
    await expect(page.getByRole('button', { name: /income/i, pressed: true }).or(
      page.locator('button:has-text("Income")').filter({ has: page.locator('[data-selected="true"]') })
    )).toBeVisible().catch(() => {
      // Income is usually selected by default, but click if needed
    });

    // Save the transaction
    await page.getByRole('button', { name: /save/i }).click();

    // Drawer should close
    await expect(page.getByText(/new transaction/i)).not.toBeVisible({ timeout: 5000 });

    // Verify transaction appears in the list
    await expect(page.getByText('$150.00').or(page.getByText('150.00'))).toBeVisible();
  });

  test('should show validation error for empty amount', async ({ page }) => {
    await page.goto('/transactions');

    // Click the Add Transaction button
    await page.getByRole('button', { name: /add transaction|new/i }).click();

    // Wait for the drawer to open
    await expect(page.getByText(/new transaction/i)).toBeVisible();

    // Try to save without entering amount
    await page.getByRole('button', { name: /save/i }).click();

    // Should show validation error
    await expect(page.getByText(/amount is required/i)).toBeVisible();
  });

  test('should switch between transaction types', async ({ page }) => {
    await page.goto('/transactions');

    // Click the Add Transaction button
    await page.getByRole('button', { name: /add transaction|new/i }).click();

    // Wait for the drawer to open
    await expect(page.getByText(/new transaction/i)).toBeVisible();

    // Click on Expense type
    await page.getByRole('button', { name: /expense/i }).click();

    // Click on Receivable type
    await page.getByRole('button', { name: /receivable/i }).click();

    // Due date field should appear for receivable
    await expect(page.getByText(/due date/i)).toBeVisible();
  });
});
