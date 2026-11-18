export default function TestimonialCard({ quote, name, role, initials }) {
  return (
    <figure className="flex h-full flex-col rounded-2xl border border-ink/10 bg-white p-6 shadow-[0_1px_2px_rgba(48,50,52,0.06)]">
      <span className="inline-flex self-start rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-ink">
        Illustrative sample
      </span>
      <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-ink-soft">
        “{quote}”
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-ink text-xs font-bold text-white">
          {initials}
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink">{name}</span>
          <span className="block text-xs text-ink-soft">{role}</span>
        </span>
      </figcaption>
    </figure>
  )
}
