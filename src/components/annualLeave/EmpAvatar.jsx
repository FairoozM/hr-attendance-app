export function EmpAvatar({ name, photoUrl, size = 36 }) {
  const initial = (name || '?')[0].toUpperCase()
  return (
    <div className="al-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {photoUrl ? <img src={photoUrl} alt="" /> : initial}
    </div>
  )
}
