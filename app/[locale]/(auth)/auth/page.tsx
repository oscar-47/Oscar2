import { AuthForm } from '@/components/auth/AuthForm'
import { Suspense } from 'react'

export default function AuthPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  )
}
