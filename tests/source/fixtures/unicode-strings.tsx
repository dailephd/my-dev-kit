export function Greeting() {
  return (
    <div aria-label="Héllo Wörld" data-testid="unicode-greet">
      Héllo Wörld
    </div>
  )
}

export function CjkLabel() {
  return <span aria-label="用户名">用户名</span>
}
