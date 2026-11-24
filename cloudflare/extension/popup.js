import { inspectSetup, parseProject, sessionText, uploadSession } from './session.js'

const input = document.querySelector('#project')
const status = document.querySelector('#status')
const connect = document.querySelector('#connect')

// Looking at the active tab's URL does not read cookies or send a request.
chrome.tabs
  .query({ active: true, currentWindow: true })
  .then(tabs => {
    try {
      const url = tabs[0]?.url || ''
      parseProject(url)
      input.value = url
    } catch {
      // A user can paste the project URL instead.
    }
  })
  .catch(() => {})

connect.onclick = async event => {
  if (!event.isTrusted || connect.disabled) return
  connect.disabled = true
  let cookies = ''
  try {
    const projectId = parseProject(input.value)
    status.textContent = 'Checking the private setup page. No cloud browser is started.'
    const tabs = await chrome.tabs.query({ url: 'https://overleaf-mcp.fanurs.com/connect*', currentWindow: true })
    const tab = tabs.find(item => new URL(item.url).pathname === '/connect')
    if (!Number.isInteger(tab?.id)) throw new Error('SETUP_REQUIRED')
    const checked = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inspectSetup })
    if (checked[0]?.result !== true) throw new Error('SETUP_REQUIRED')
    cookies = sessionText(await chrome.cookies.getAll({ url: 'https://www.overleaf.com/project' }))
    status.textContent = 'Saving your Overleaf session directly to your private service...'
    const saved = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: uploadSession,
      args: [cookies, projectId],
    })
    if (saved[0]?.result !== true) throw new Error('TRANSFER_FAILED')
    status.textContent =
      'Session saved, not yet verified. Return to the setup page and click Test connection. Cloud-browser time used by this method: 0 seconds.'
  } catch (error) {
    const messages = {
      PROJECT_INVALID: 'Paste the exact Overleaf project URL first.',
      SETUP_REQUIRED:
        'Open https://overleaf-mcp.fanurs.com/connect in this browser window and sign into it. Then reopen this popup.',
      SESSION_EMPTY: 'No usable Overleaf cookies were found. Sign into Overleaf in this browser, then try again.',
      SESSION_TOO_LARGE: 'The session is too large to transfer. Nothing was saved.',
    }
    status.textContent =
      messages[error.message] ||
      'The transfer did not complete. Check that both Overleaf and the private setup page are signed in. No automatic retry was made.'
  } finally {
    cookies = ''
    connect.disabled = false
  }
}
