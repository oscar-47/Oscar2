import { PricingPage } from '@/components/pricing/PricingPage'
import { Suspense } from 'react'

export default function PricingRoute() {
  return (
    <Suspense>
      <PricingPage />
    </Suspense>
  )
}
