export default async function MaintenancePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const isZh = locale === 'zh'

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(250,204,21,0.18),_transparent_34%),linear-gradient(180deg,_#fffdf7_0%,_#f6f0e6_48%,_#efe7d8_100%)] px-6 py-10 text-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl items-center justify-center">
        <section className="w-full rounded-[2rem] border border-black/10 bg-white/85 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-12">
          <div className="max-w-2xl space-y-6">
            <div className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-4 py-1 text-sm font-semibold text-amber-900">
              {isZh ? '站点维护中' : 'Site Maintenance'}
            </div>

            <div className="space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                {isZh ? '由于网站太过于火爆，服务升级中，暂时维护中。' : 'Traffic is surging. We are upgrading capacity and the site is temporarily under maintenance.'}
              </h1>
              <p className="max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
                {isZh
                  ? '我们正在扩容并升级核心服务，普通访问会暂时关闭。请稍后再回来，感谢你的耐心等待。'
                  : 'We are scaling core services to handle unusually high demand. Public access is temporarily paused. Please check back soon.'}
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
              {isZh ? '维护完成后网站会自动恢复访问。' : 'Access will reopen automatically once the maintenance window is over.'}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
