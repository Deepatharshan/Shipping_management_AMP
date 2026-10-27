/** The invoice HTML → PDF, in a hidden window (webContents.printToPDF). Temp files go in the app-data folder. */
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { safeWriteFile } from '../safety'

export async function renderPdf(html: string, workDir: string): Promise<{ pdf: Buffer; pages: number }> {
  const file = join(workDir, 'invoice-render.html')
  await safeWriteFile(file, html)
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, contextIsolation: true, javascript: true } })
  try {
    await win.loadFile(file)
    const started = Date.now()
    while (!(await win.webContents.executeJavaScript('window.__paginated === true'))) {
      if (Date.now() - started > 60_000) throw new Error('The invoice layout did not finish.')
      await new Promise((r) => setTimeout(r, 50))
    }
    const pages = (await win.webContents.executeJavaScript('window.__pageCount')) as number
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      landscape: false,
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    return { pdf, pages }
  } finally {
    win.destroy()
  }
}
