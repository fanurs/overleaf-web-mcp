export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

export function validSetupRequest(request: Request): boolean {
  return (
    request.headers.get('Origin') === new URL(request.url).origin &&
    request.headers.get('X-Overleaf-Setup') === '1' &&
    request.headers.get('Content-Type')?.split(';')[0]?.trim() === 'application/json'
  )
}

export async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('BODY_REQUIRED')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 70000) {
      await reader.cancel()
      throw new Error('BODY_TOO_LARGE')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result)) as unknown
}
