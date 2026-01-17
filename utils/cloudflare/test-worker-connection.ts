export async function testWorkerConnection(
  workerUrl: string,
  cloudflareId: string,
  origin: string,
  timeoutMs: number = 15000
): Promise<void> {
  const urlObj = new URL(workerUrl)
  urlObj.searchParams.append('cloudflareId', cloudflareId.trim())
  const testUrl = urlObj.toString()

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const testResponse = await fetch(testUrl, {
      method: 'GET',
      headers: { Origin: origin },
      signal: controller.signal,
    })

    if (!testResponse.ok) {
      let errorDetail = ''
      try {
        const responseText = await testResponse.text()
        errorDetail = responseText ? ` - ${responseText.substring(0, 100)}` : ''
      } catch (e) {
        console.error('Failed to read response body:', e)
      }

      throw new Error(`Connection failed: ${testResponse.status} ${testResponse.statusText}${errorDetail}`)
    }

    const responseText = await testResponse.text()
    try {
      const responseJson = JSON.parse(responseText)
      console.log('Test successful, response:', responseJson)

      if (responseJson.workerInfo?.idValidation) {
        const idValidation = responseJson.workerInfo.idValidation
        if (!idValidation.valid) {
          throw new Error('Connection failed, try again or change settings')
        }
      }
    } catch (e) {
      console.log('Test response processing error:', e)
      if (e instanceof Error) throw e
      console.log('Test successful, but response is not JSON format')
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
