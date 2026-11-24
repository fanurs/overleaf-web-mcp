export const SETUP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Overleaf connection test</title>
<style>body{font:17px/1.55 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 24px;color:#1b2930;background:#fafcfb}h1{line-height:1.2}h2{font-size:1.15em}section,details{background:white;border:1px solid #dce5df;border-radius:12px;padding:20px;margin:20px 0}label{display:block;margin:16px 0 6px}input,button{font:inherit;padding:10px;box-sizing:border-box}input{width:100%}button,.button{display:inline-block;margin:12px 8px 0 0;cursor:pointer;border:1px solid #27764d;border-radius:6px;background:#fff;color:#185333;text-decoration:none}.primary{background:#185333;color:white}button:disabled{opacity:.5;cursor:default}.button{padding:10px}pre{white-space:pre-wrap;background:#edf3ef;padding:18px;border-radius:8px}small{display:block;color:#52606a}a{color:#216a4f}[hidden]{display:none!important}summary{cursor:pointer}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:9px 6px;border-bottom:1px solid #dbe3dd}#usage-table{overflow-x:auto}#elapsed{font-size:1.15rem;font-weight:bold}#login-panel{border-left:4px solid #27764d;padding-left:16px}</style>
</head><body><h1>Connect your Overleaf account</h1>
<p>You are signed into this private setup page. Choose how to connect below. Opening this setup page does not start a cloud browser or a timer.</p>
<p><strong>Overleaf connection test</strong> checks whether the service can read your selected project. The remote MCP server is available after setup. Editing stays locked until the disposable project test below passes. ChatGPT must then be connected separately.</p>
<section><h2>1. Choose a project</h2>
<label for="project">Overleaf project URL</label><input id="project" type="url" placeholder="https://www.overleaf.com/project/...">
<small>Paste the URL from your open Overleaf project. The connection test does not change its documents.</small>
<h2>2. Connect your existing login (no timer)</h2>
<p>The browser helper transfers your existing Overleaf session directly to this private service. It uses zero cloud-browser minutes. Install it once in Edge or Chrome, then click Connect inside the helper.</p>
<a class="button primary" href="/connect/extension.zip" download="overleaf-connection-helper.zip">Download browser helper 0.1.1 (ZIP)</a>
<p>Already installed version 0.1.0? Replace the files in the same extracted folder with this ZIP, then click Reload on its extension card. The popup should show Helper version 0.1.1.</p>
<ol><li>Extract the ZIP. Open <strong>edge://extensions</strong> or <strong>chrome://extensions</strong>, enable Developer mode, choose Load unpacked, and select the extracted folder containing manifest.json.</li><li>Keep this setup tab signed in. In the same browser window, open your signed-in Overleaf project and open Overleaf connection helper - Fanurs from the Extensions menu.</li><li>Check the project URL, then click Connect this Overleaf session. Return here and click Test connection when the helper says Session saved.</li></ol>
<small>The helper needs cookie and script permissions for Overleaf and this private setup site only. It does not read your passwords or Google/university cookies, save cookies on disk, or send them to chat. Saved cookies grant an Overleaf account session. A successful transfer still needs the read-only connection test below.</small>
<details><summary>Alternative - temporary cloud sign-in (60-second deadline)</summary>
<p>Open the preparation page first. It uses no cloud-browser time and can be left open. Only your click on Start 60-second sign-in there starts a temporary browser. That same tab becomes the Overleaf login window, so there is no running browser waiting for you to open a link.</p>
<small>The cloud browser sees the login pages you use. Only Overleaf session cookies are saved, encrypted, by this service. No session recording is requested. Keep the temporary login link private.</small>
<button id="start" class="primary">Prepare cloud sign-in (no timer)</button>
<div id="login-panel" hidden>
<p id="elapsed" role="timer"></p><p id="deadline"></p>

<p>Sign in, then wait for the cloud browser to close automatically. The button below is available if automatic completion has not happened.</p>
<button id="finish">Finish connecting</button><button id="cancel">Cancel sign-in</button>
</div>
<small>The server requests shutdown after 60 seconds total, including startup, or sooner on success. An unfinished handoff is cancelled after 20 seconds. Switching away after login opens does not pause usage. Network or provider delays may delay closure and are reflected in the time log. At most two attempts per account identity per UTC day. Cloudflare Free also caps all cloud-browser use at ten minutes per day. A limit stops the attempt; this service never upgrades your plan.</small>
</details>
<h2>3. Test the connection</h2>
<button id="probe">Test connection</button><button id="unlink">Remove saved session</button>
<pre id="result" role="status" aria-live="polite">Checking connection...</pre>
<h2>4. Verify editing on a disposable project</h2>
<p>This test creates a separate temporary project, verifies reading, editing, conflict protection and compilation, then moves it to Trash. It does not edit your selected project. It uses zero cloud-browser seconds and one Overleaf compile.</p>
<button id="edit-test">Run disposable editing test</button><pre id="edit-result">Not run yet.</pre>
<h2>5. Connect ChatGPT</h2><p>Use this MCP server URL with OAuth authentication after the editing test passes and OAuth is configured.</p>
<p><a href="https://overleaf-mcp.fanurs.com/mcp">https://overleaf-mcp.fanurs.com/mcp</a></p>
<p>Sign in with the same identity used for this setup page. Tools can access only the connected project. Unlinking below revokes access to its saved Overleaf login.</p>
</section>
<section><h2>Cloud-browser time</h2>
<p id="usage-summary">No timed attempts recorded yet.</p>
<small>Each completed attempt is logged privately, including failures and cancellations. Times labeled Cloudflare come from its session history. Estimates include startup and shutdown and are not billing measurements. Older attempts before this update have no duration record.</small>
<div id="usage-table"><table><thead><tr><th>Started</th><th>Browser time</th><th>Measurement</th><th>Result</th></tr></thead><tbody id="usage"></tbody></table></div>
<a href="/api/login/history" download="overleaf-login-usage.json">Download complete time log (JSON)</a>
<small>The latest 20 attempts are shown. The download contains every recorded attempt for this setup account. Cloudflare's daily allowance is shared across the whole Cloudflare account.</small></section>
<details><summary>Advanced fallback - upload an existing session file</summary>
<p>Use this only if you already have a session file from the local login helper. It is optional.</p>
<label for="session">Saved Overleaf session file</label><input id="session" type="file" accept=".txt">
<small>Upload only here, never into chat or GitHub.</small><button id="link">Save uploaded session</button></details>
<p>The read-only test reports success flags, document length, and protocol. It does not display or store document text. Signing out of this setup page and revoking the saved Overleaf session are separate actions.</p>
<script src="/setup.js" defer></script></body></html>`

export const SETUP_JS = `const result=document.querySelector('#result');
const panel=document.querySelector('#login-panel');
let pending=null, elapsedBase=0, elapsedAt=0, pollTimer=null, clockTimer=null, busy=false;
const messages={
 LOGIN_NOT_FINISHED:'Overleaf is not signed in yet. Complete the login in the cloud window. Automatic checks will continue.',
 LOGIN_REQUIRED:'The temporary browser has closed. Start a new sign-in attempt when ready.',
 LOGIN_DAILY_LIMIT:'The two sign-in attempts for this account identity have been used. Try after the next 00:00 UTC. No paid fallback is used.',
 LOGIN_PROJECT_CHANGED:'Cancel the active sign-in before choosing a different project.',
 LOGIN_CLOSE_PENDING:'Closing the cloud browser. Cleanup will retry automatically; the timer continues until closure is confirmed.',
 HOSTED_LOGIN_UNAVAILABLE:'Cloud sign-in is not available in this deployment yet.',
 SESSION_REQUIRED:'Connect your Overleaf account before testing.',
 LOGIN_FAILED:'Cloud sign-in could not complete. Check the time log below. No new browser was automatically launched.',
 AUTH_EXPIRED:'Overleaf no longer accepts the saved session. Sign into Overleaf again.',
 PROBE_FAILED:'The connection test failed. Share this error code with the assistant; do not share session files.',
 NO_READABLE_DOCUMENT:'The service signed in and joined your project, but its file tree contained no readable text document. Your saved session is still connected. Code NO_READABLE_DOCUMENT.'
};
const outcomes={connected:'Connected',cancelled:'Cancelled',expired:'Time limit reached',not_opened:'Login window not opened',failed:'Failed',launch_failed:'Launch failed'};
function duration(ms){return (Math.max(0,ms)/1000).toFixed(1)+' s'}
function clearLogin(){pending=null;panel.hidden=true;clearTimeout(pollTimer);pollTimer=null;clearInterval(clockTimer);clockTimer=null}
function startClock(){if(!clockTimer)clockTimer=setInterval(drawTimer,1000)}
function drawTimer(){
 if(!pending)return;
 const elapsed=elapsedBase+Math.max(0,performance.now()-elapsedAt);
 document.querySelector('#elapsed').textContent='Elapsed '+duration(elapsed)+' (estimate)'+(pending.closing?' · Closing browser':'');
 document.querySelector('#deadline').textContent=pending.closing?'Cleanup is being retried automatically.':pending.watching?'Automatic login checks are active. Absolute cutoff '+new Date(pending.expiresAt).toLocaleTimeString()+'.':'Sign-in is starting in the preparation tab. The 60-second deadline includes startup.';
}
function renderUsage(records){
 const body=document.querySelector('#usage');body.replaceChildren();
 document.querySelector('#usage-summary').textContent=records.length?'Latest attempt used '+(records[0].browserMs===undefined?(records[0].timing==='unavailable'?'an unknown amount of browser time ('+duration(records[0].elapsedMs)+' elapsed)':duration(records[0].elapsedMs)+' estimated'):duration(records[0].browserMs)+' reported by Cloudflare')+'.':'No timed attempts recorded yet.';
 for(const item of records){
  const row=document.createElement('tr');
  const cells=[new Date(item.startedAt).toLocaleString(),item.browserMs===undefined?(item.timing==='unavailable'?'Unknown ('+duration(item.elapsedMs)+' elapsed)':duration(item.elapsedMs)):duration(item.browserMs),{cloudflare:'Cloudflare',estimated:'Estimated',unavailable:'Unavailable'}[item.timing],(outcomes[item.outcome]||item.outcome)+(item.completion?' ('+item.completion+')':'')];
  for(const text of cells){const cell=document.createElement('td');cell.textContent=text;row.append(cell)}
  body.append(row);
 }
}
async function call(path,body){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Overleaf-Setup':'1'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Sign in again by reloading this page.');
 const value=await response.json();
 if(!response.ok||value.code){result.textContent=messages[value.code]||'The request failed ('+(value.code||response.status)+').';return null}
 return value;
}
function scheduleRefresh(){clearTimeout(pollTimer);pollTimer=pending?setTimeout(async()=>{try{if(!busy)await refresh(true)}catch{result.textContent='Status refresh failed. Server-side cleanup remains active. Reload this page to reconnect.'}finally{scheduleRefresh()}},3000):null}
async function refresh(announce=false){
 const value=await call('/api/status');if(!value)return;
 const wasPending=!!pending;
 if(value.projectId&&!document.querySelector('#project').value)document.querySelector('#project').value='https://www.overleaf.com/project/'+value.projectId;
 document.querySelector('#edit-result').textContent=value.editTest?JSON.stringify(value.editTest,null,2):'Not run yet.';
 renderUsage(value.usage||[]);
 if(value.login){pending=value.login;elapsedBase=pending.elapsedMs;elapsedAt=performance.now();panel.hidden=false;startClock();drawTimer();scheduleRefresh();if(announce)result.textContent=pending.closing?'Closing the cloud browser. Cleanup is automatic.':pending.watching?'Waiting for Overleaf sign-in. Automatic completion is active.':'Sign-in is starting in the preparation tab. Cancel below if you have stepped away.'}
 else{clearLogin();if(announce||wasPending){const last=(value.usage||[])[0];result.textContent=value.linked?(value.editTest&&value.editTest.status==='passed'?'Overleaf reading and editing test passed. Ready for the separate ChatGPT OAuth connection.':value.verifiedAt?'Overleaf read connection verified. Run the disposable editing test next.':'Overleaf session saved. Click Test connection to verify it.'):last&&wasPending?'Cloud browser closed. '+(outcomes[last.outcome]||last.outcome)+'. See the time log below.':'Overleaf is not connected yet. Paste your project URL, then choose a connection method.'}}
}
async function act(run){busy=true;const buttons=document.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);result.textContent='Working...';try{await run()}catch{result.textContent='The request failed. Reload the page if needed; server-side cleanup remains active.'}finally{try{await refresh()}catch{}busy=false;buttons.forEach(b=>b.disabled=false)}}
function projectId(){
 let url;try{url=new URL(document.querySelector('#project').value)}catch{result.textContent='Paste your Overleaf project URL first.';return null}
 const match=/^\\/project\\/([a-f0-9]{24})\\/?$/.exec(url.pathname);
 if(url.origin!=='https://www.overleaf.com'||!match){result.textContent='Use a project URL from https://www.overleaf.com/project/.';return null}
 return match[1];
}
document.querySelector('#start').onclick=()=>{
 const id=projectId();if(!id)return;
 window.open('/connect/login?project='+id,'_blank','noopener');
 result.textContent='Preparation page opened. No cloud browser starts until you personally click Start 60-second sign-in there.';
};
window.addEventListener('focus',()=>{if(!busy)void act(()=>refresh(true))});
document.querySelector('#finish').onclick=()=>act(async()=>{
 const value=await call('/api/login/finish',{});if(!value)return;clearLogin();
 result.textContent='Overleaf session saved. The cloud browser is closed. Click Test connection next.';
});
document.querySelector('#cancel').onclick=()=>act(async()=>{if(await call('/api/login/cancel',{})){clearLogin();result.textContent='Temporary sign-in browser closed.'}});
document.querySelector('#link').onclick=()=>act(async()=>{
 const file=document.querySelector('#session').files[0];
 if(!file||file.size>65536){result.textContent='Choose an existing Overleaf session file (maximum 64 KiB).';return}
 const id=projectId();if(!id)return;
 if(await call('/api/link',{cookies:await file.text(),projectId:id})){document.querySelector('#session').value='';clearLogin();result.textContent='Session saved. Click Test connection next.'}
});
document.querySelector('#probe').onclick=()=>act(async()=>{const value=await call('/api/probe',{});if(value)result.textContent='Connection verified. The service signed into Overleaf, joined your project, and read a text document without editing it.'+(value.documentSelection==='project_document'?' Overleaf did not report a usable configured main document, so the test read another existing text document.':'')+'\\n\\n'+JSON.stringify(value,null,2)});
document.querySelector('#edit-test').onclick=()=>act(async()=>{result.textContent='Testing a separate disposable project. No cloud browser is running.';const value=await call('/api/edit-test',{});if(value){document.querySelector('#edit-result').textContent=JSON.stringify(value,null,2);result.textContent=value.status==='passed'?'Editing test passed. The temporary project is in Trash. Cloud-browser time used: 0 seconds.':'Editing test did not complete. The result below identifies the completed steps. Do not repeat it blindly.'}});
document.querySelector('#unlink').onclick=()=>act(async()=>{if(await call('/api/unlink',{})){clearLogin();result.textContent='Saved Overleaf session removed.'}});
act(()=>refresh(true));
`
