import { redirect } from 'next/navigation'

interface StudioGenesis2PageProps {
  params: Promise<{ locale: string }>
}

export default async function StudioGenesis2Page({ params }: StudioGenesis2PageProps) {
  const { locale } = await params
  redirect(`/${locale}/studio-genesis`)
}
