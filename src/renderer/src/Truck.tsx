/** The small box truck shown on the dashboard's shipment cards. */
export function MiniContainer() {
  return (
    <svg className="mini" viewBox="0 0 120 46" aria-hidden="true">
      <rect x="30" y="3" width="86" height="30" rx="2" fill="#f2f3f6" stroke="#d6d9df" />
      {Array.from({ length: 8 }, (_, i) => (
        <circle key={i} cx={34 + i * 11} cy="5.5" r=".8" fill="#b4b9c0" />
      ))}
      <path d="M12 14 Q14 10 20 9 L29 9 L29 33 L4 33 L4 18 Q4 14 8 14 Z" fill="#fff" stroke="#d6d9df" />
      <rect x="10" y="15" width="11" height="8" rx="1.5" fill="#2a2e35" />
      <rect x="3" y="31" width="27" height="5" rx="1.5" fill="#23262b" />
      <rect x="20" y="33" width="98" height="3" rx="1.5" fill="#2b2e34" />
      {[16, 98].map((x) => (
        <g key={x}>
          <circle cx={x} cy="38" r="5.5" fill="#16181c" />
          <circle cx={x} cy="38" r="2.4" fill="#d6d9de" />
        </g>
      ))}
    </svg>
  )
}
