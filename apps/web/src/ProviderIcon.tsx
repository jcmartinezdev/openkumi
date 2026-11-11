// The mark of each thing a bot can run on, for the model picker and wherever a provider is named.
// The marks themselves are shared with the phone app (@openbot/client/marks).
import type { ProviderInfo } from '@openbot/shared'
import { markOf } from '@openbot/client/marks'

export function ProviderIcon({ provider, size = 16 }: { provider: Pick<ProviderInfo, 'id' | 'detail'>; size?: number }) {
  const mark = markOf(provider)
  // A mark without a colour of its own takes the colour of the text around it.
  const color = mark.color ?? 'currentColor'
  return (
    <svg
      className="provider-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={mark.stroke ? 'none' : color}
      stroke={mark.stroke ? color : undefined}
      strokeWidth={mark.stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={mark.d} />
    </svg>
  )
}
