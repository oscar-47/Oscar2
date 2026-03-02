import { ImageEditorPage } from '@/components/editor/ImageEditorPage'

interface PageProps {
  searchParams: Promise<{ sid?: string }>
}

export default async function EditorRoute({ searchParams }: PageProps) {
  const { sid } = await searchParams
  return <ImageEditorPage sid={sid} />
}
