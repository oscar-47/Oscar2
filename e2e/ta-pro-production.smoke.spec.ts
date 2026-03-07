import { expect, test } from '@playwright/test'
import {
  TaProApiClient,
  TaProReportCollector,
  loadTaProManifest,
  runFlowSample,
  type TaProFlowManifest,
} from './helpers/ta-pro-smoke'

test.describe.configure({ mode: 'serial' })

const manifest = loadTaProManifest()
const report = new TaProReportCollector()
let api: TaProApiClient

test.beforeAll(async () => {
  api = await TaProApiClient.create()
})

test.afterAll(async () => {
  await report.writeReport(manifest)
})

for (const flow of manifest.flows as TaProFlowManifest[]) {
  test(`${flow.id} all 3 samples pass`, async ({ page }, testInfo) => {
    const failures: string[] = []

    for (const sample of flow.samples) {
      const result = await runFlowSample(
        page,
        api,
        flow,
        sample,
        testInfo,
        manifest.locale ?? 'zh',
      )
      report.add(result)
      if (result.finalStatus !== 'pass') {
        failures.push(`${sample.id}: ${result.failureReason}`)
      }
    }

    expect(
      failures,
      failures.length > 0 ? `Flow ${flow.id} failed:\n${failures.join('\n')}` : undefined,
    ).toHaveLength(0)
  })
}
