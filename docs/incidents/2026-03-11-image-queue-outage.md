# 2026-03-11 IMAGE_GEN / STYLE_REPLICATE Enqueue Outage

## Summary

- Incident window used for this report: from `2026-03-11 11:00:00 UTC` (`2026-03-11 19:00:00 HKT`) onward.
- Confirmed root cause: `public.enqueue_paid_generation_job()` accepted `p_trace_id text`, while `public.generation_jobs.trace_id` is `uuid`. The insert path failed during enqueue.
- Confirmed platform symptom: from `2026-03-11 11:00:00 UTC` onward, there were `0` successfully created `IMAGE_GEN` or `STYLE_REPLICATE` jobs in `generation_jobs`.
- Confirmed user list below is based on `generation_attempt_events` rows with:
  - `stage = image_queue`
  - `status = failed`
  - `error_code = IMAGE_JOB_CREATE_FAILED`

## Confirmed Affected Users

| Email | User ID | Failed At (UTC) | Failed At (HKT) | Trace ID | Studio | Model | Failed Submissions | Recommended Compensation |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: |
| `1027588424@qq.com` | `032f35b4-ce32-4d6e-924a-cae91db550eb` | `2026-03-11T13:10:58Z` | `2026-03-11 21:10:58 HKT` | `e0331059-15a9-4b5e-8c98-1b30af6b597a` | `ecom-detail` | `or-gemini-3.1-flash` | 4 | 120 credits |
| `951454612@qq.com` | `739ab7d6-29d4-46c9-9fb9-8cba8b99f9fc` | `2026-03-11T13:16:13Z` | `2026-03-11 21:16:13 HKT` | `27fd5f70-8094-4062-8f49-fe58e9844ae6` | `ecom-detail` | `or-gemini-3.1-flash` | 1 | 30 credits |

## Compensation Recommendation

- Recommended rule for confirmed users: `failed_submission_count x 30 credits`.
- Reasoning:
  - the failed attempts used `or-gemini-3.1-flash` at `1K`
  - current unit cost is `30 credits`
  - this gives each user one full retry for the exact number of images that failed to enqueue
- Operational note:
  - the failed enqueue did not create any `generation_jobs`
  - this should mean the credit deduction transaction did not commit
  - the proposed credits are goodwill compensation, not a refund

## Observability Caveat

- This is a list of **confirmed** affected users, not necessarily the full list.
- `generation_attempt_events` is currently only instrumented for the `ecom-detail` flow.
- If users attempted `IMAGE_GEN` or `STYLE_REPLICATE` through other flows during the outage window, they may not appear here.
- If you need a broader outbound list, cross-check API or edge logs before sending a site-wide incident mail.

## Email Draft

### Subject

`关于 3 月 11 日图片生成失败的说明与补偿`

### Body

```text
你好，

我们在 2026 年 3 月 11 日晚间发现 Shopix 的图片任务入队出现异常，导致你在 {{FAILED_AT_HKT}} 发起的一次生成请求没有成功创建任务。

这次异常不会扣除你当次尝试的额度。为表达歉意，我们已向你的账户额外补偿 {{CREDIT_AMOUNT}} credits，你现在可以直接重新发起生成。

如果你希望我们帮你核对本次失败请求，或者希望我们协助优先处理后续生成，直接回复这封邮件即可，我们会跟进。

对这次影响表示抱歉。

Shopix 团队
```

## Optional Shorter Version

```text
你好，

由于 3 月 11 日晚间的系统异常，你在 {{FAILED_AT_HKT}} 的一次图片生成请求未能成功创建任务。

本次异常不会扣除你当次尝试的额度。我们已向你的账户补偿 {{CREDIT_AMOUNT}} credits，供你重新生成使用。

抱歉给你带来影响。如需我们协助处理，直接回复此邮件即可。

Shopix 团队
```
