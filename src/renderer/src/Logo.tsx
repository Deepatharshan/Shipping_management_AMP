import { useId } from 'react'

/** The app's mark: a container ship with "AMP" on the hull, white on navy. */
export function AmpLogo({ size = 36 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className="amplogo" width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="AMP Ceylon shipping">
      <defs>
        <linearGradient id={`bg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f3b63" />
          <stop offset="1" stopColor="#0d1f38" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#bg${id})`} />
      <rect x=".5" y=".5" width="47" height="47" rx="11.5" fill="none" stroke="#fff" strokeOpacity=".12" />
      {/* containers on deck and the bridge */}
      <rect x="11" y="18.5" width="6.2" height="5.5" rx=".8" fill="#fff" fillOpacity=".55" />
      <rect x="18" y="18.5" width="6.2" height="5.5" rx=".8" fill="#fff" fillOpacity=".8" />
      <rect x="25" y="18.5" width="6.2" height="5.5" rx=".8" fill="#fff" fillOpacity=".55" />
      <rect x="18" y="13" width="6.2" height="5.5" rx=".8" fill="#fff" fillOpacity=".35" />
      <path d="M33 24V13.6a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1V24z" fill="#fff" />
      <rect x="34.4" y="14.4" width="2.9" height="1.7" rx=".4" fill="#1f3b63" />
      {/* hull with the name */}
      <path d="M6.5 25h35l-4.6 8.6a1.4 1.4 0 0 1-1.2.8H12.3a1.4 1.4 0 0 1-1.2-.8z" fill="#fff" />
      <text x="24" y="32.2" textAnchor="middle" fontFamily="Inter Variable, Segoe UI, Arial, sans-serif" fontSize="7.6" fontWeight="800" letterSpacing=".9" fill="#1f3b63">
        AMP
      </text>
      {/* water */}
      <path d="M8 39.2c2.2-1.6 4.2-1.6 6.4 0s4.2 1.6 6.4 0 4.2-1.6 6.4 0 4.2 1.6 6.4 0 4.2-1.6 6.4 0" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
