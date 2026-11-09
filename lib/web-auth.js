/** Local browser access is constrained by the listener Host and same-origin POST checks. */
import { serveWeb } from './web-app.js'

/** Serve the local management page without a separate browser credential. */
export function createWebHandler(dispatch) {
  return async (request, response, authority) => {
    response.setHeader('cache-control', 'no-store')
    if (request.method === 'POST' && request.headers.origin !== `http://${authority}`) {
      response.writeHead(403); response.end(); return
    }
    await serveWeb(request, response, { basePath: '/', dispatch })
  }
}
