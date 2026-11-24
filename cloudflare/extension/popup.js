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
  let returnedCookies = 0
  try {
    const projectId = parseProject(input.value)
    const origins = ['https://overleaf.com/*', 'https://www.overleaf.com/*', 'https://overleaf-mcp.fanurs.com/*']
    if (!(await chrome.permissions.contains({ origins }))) throw new Error('SITE_ACCESS_REQUIRED')
    const projectTabs = await chrome.tabs.query({ url: 'https://www.overleaf.com/project/*', currentWindow: true })
    const projectTab = projectTabs.find(item => {
      try {
        return parseProject(item.url) === projectId
      } catch {
        return false
      }
    })
    if (!Number.isInteger(projectTab?.id)) throw new Error('PROJECT_TAB_REQUIRED')
    const store = (await chrome.cookies.getAllCookieStores()).find(item => item.tabIds.includes(projectTab.id))
    if (!store) throw new Error('COOKIE_STORE_REQUIRED')
    status.textContent = 'Checking the private setup page. No cloud browser is started.'
    const tabs = await chrome.tabs.query({ url: 'https://overleaf-mcp.fanurs.com/connect*', currentWindow: true })
    const tab = tabs.find(item => new URL(item.url).pathname === '/connect')
    if (!Number.isInteger(tab?.id)) throw new Error('SETUP_REQUIRED')
    const checked = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inspectSetup })
    if (checked[0]?.result !== true) throw new Error('SETUP_REQUIRED')
    // The popup's default store can differ from the signed-in project tab's store.
    // Chromium also checks each cookie's own domain against host permissions.
    const projectUrl = 'https://www.overleaf.com/project/' + projectId
    const selectedCookies = await chrome.cookies.getAll({ url: projectUrl, storeId: store.id })
    returnedCookies = selectedCookies.length
    if (returnedCookies === 0) throw new Error('COOKIES_NOT_VISIBLE')
    cookies = sessionText(selectedCookies)
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
      SITE_ACCESS_REQUIRED:
        'The helper needs site access to overleaf.com, www.overleaf.com, and overleaf-mcp.fanurs.com. Enable these in its extension details, then reopen the helper. Code SITE_ACCESS_REQUIRED.',
      PROJECT_TAB_REQUIRED:
        'Open this Overleaf project in the same browser window, then reopen the helper from that tab. Code PROJECT_TAB_REQUIRED.',
      COOKIE_STORE_REQUIRED:
        'The browser did not expose a cookie store for this project tab. No cookies were read or uploaded. Code COOKIE_STORE_REQUIRED.',
      SETUP_REQUIRED:
        'Open https://overleaf-mcp.fanurs.com/connect in this browser window and sign into it. Then reopen this popup.',
      COOKIES_NOT_VISIBLE:
        'The browser returned no Overleaf cookies for the selected project tab. Check that the tab is signed in and the helper has site access. No upload was attempted. Code COOKIES_NOT_VISIBLE.',
      SESSION_EMPTY:
        'The browser returned ' +
        returnedCookies +
        ' cookies, but none passed the session format checks. No upload was attempted. Code SESSION_FORMAT_EMPTY.',
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
