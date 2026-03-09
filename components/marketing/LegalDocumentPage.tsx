import { getLocaleSeoContent, type LegalDocumentKind, type SiteLocale } from '@/lib/site'

export function LegalDocumentPage({
  locale,
  kind,
}: {
  locale: SiteLocale
  kind: LegalDocumentKind
}) {
  const document = getLocaleSeoContent(locale).legal[kind]

  return (
    <section className="bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] py-16 sm:py-24">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-5 sm:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Shopix AI
          </p>
          <h1 className="mt-4 text-[36px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground sm:text-[48px]">
            {document.heading}
          </h1>
          <p className="mt-5 text-base leading-8 text-muted-foreground sm:text-lg sm:leading-9">
            {document.intro}
          </p>
        </div>

        <div className="space-y-10">
          {document.sections.map((section) => (
            <article
              key={section.title}
              className="rounded-2xl border border-border bg-background p-6 shadow-lg sm:p-8"
            >
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {section.title}
              </h2>
              <div className="mt-5 space-y-4 text-sm leading-7 text-muted-foreground sm:text-base">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
