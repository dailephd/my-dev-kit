export function Button({ label }: { label: string }) {
  return (
    <button
      data-testid="submit-btn"
      aria-label="Submit the form"
      className="btn-primary"
    >
      Click here
    </button>
  )
}

export function Alert({ message }: { message: string }) {
  return (
    <div
      data-testid="alert-box"
      role="alert"
      aria-label="Alert message"
    >
      {message}
    </div>
  )
}

export function DuplicateTestId() {
  return (
    <div data-testid="submit-btn">
      <span>Duplicate testid</span>
    </div>
  )
}
