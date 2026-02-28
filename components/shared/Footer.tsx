import Link from 'next/link'

export function Footer() {
  return (
    <footer className="mt-16 bg-[#111318] py-8">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 text-sm text-[#afb3bf]">
        <p>© 2026 PicSet AI. All rights reserved.</p>
        <div className="flex gap-6">
          <Link href="/terms" className="transition-colors hover:text-white">
              Terms
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-white">
              Privacy
          </Link>
        </div>
      </div>
    </footer>
  )
}
