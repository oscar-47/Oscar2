import { expect, test } from '@playwright/test'

test('profile page highlights paid member identity', async ({ page }) => {
  await page.route('**/rest/v1/profiles**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'gold.member@example.com',
        full_name: 'Oscar Gold',
        subscription_plan: 'quarterly',
        subscription_status: 'active',
        current_period_end: '2026-09-30T00:00:00.000Z',
        subscription_credits: 1280,
        purchased_credits: 320,
        stripe_customer_id: 'cus_gold',
        invite_code: 'GOLD8888',
        invited_by_user_id: null,
        invite_bound_at: null,
      }),
    })
  })

  await page.route('**/rest/v1/referral_bindings**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { reward_credits: 50 },
        { reward_credits: 50 },
      ]),
    })
  })

  await page.route('**/rest/v1/redeem_code_claims**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  await page.route('**/rest/v1/transactions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'txn_1',
          plan: 'topup_30',
          amount: 30,
          credits: 900,
          created_at: '2026-03-01T10:00:00.000Z',
        },
      ]),
    })
  })

  await page.goto('/zh/profile', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: '个人中心' })).toBeVisible()
  await expect(page.getByText('季订阅').first()).toBeVisible()
  await expect(page.getByText('积分账本')).toBeVisible()
  await expect(page.getByText('SHOPIX SIGNATURE').first()).toBeVisible()

  await page.getByRole('button', { name: 'User menu' }).click()
  await expect(page.getByText('付费用户')).toBeVisible()
})
