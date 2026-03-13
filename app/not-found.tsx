export default function NotFound() {
  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: '1rem' }}>
          <h2>404 - Page Not Found</h2>
          <a href="/">Go home</a>
        </div>
      </body>
    </html>
  )
}
