export const SETUP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Overleaf connection</title>
<style>body{font:17px/1.55 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 24px;color:#1b2930;background:#fafcfb}h1{line-height:1.2}h2{font-size:1.15em}section,details{background:white;border:1px solid #dce5df;border-radius:12px;padding:20px;margin:20px 0}label{display:block;margin:16px 0 6px}input,button{font:inherit;padding:10px;box-sizing:border-box}input{width:100%}button,.button{display:inline-block;margin:12px 8px 0 0;cursor:pointer;border:1px solid #27764d;border-radius:6px;background:#fff;color:#185333;text-decoration:none}.primary{background:#185333;color:white}button:disabled{opacity:.5;cursor:default}.button{padding:10px}pre{white-space:pre-wrap;background:#edf3ef;padding:18px;border-radius:8px}small{display:block;color:#52606a}a{color:#216a4f}[hidden]{display:none!important}summary{cursor:pointer}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:9px 6px;border-bottom:1px solid #dbe3dd}#usage-table{overflow-x:auto}</style>
</head><body><h1>Connect your Overleaf account</h1>
<p>You are signed into this private setup page. Connect or refresh your Overleaf login using the browser helper. No cloud browser or timer is used.</p>
<p><strong>Overleaf connection</strong> checks whether the service can read your selected project. The remote MCP server is available after setup. Editing stays locked until the disposable project test below passes. ChatGPT must then be connected separately.</p>
<section><h2>1. Choose a project</h2>
<label for="project">Overleaf project URL</label><input id="project" type="url" placeholder="https://www.overleaf.com/project/...">
<small>Paste the URL from your open Overleaf project. The connection test does not change its documents.</small>
<h2>2. Connect your existing login (no timer)</h2>
<p>The browser helper transfers your existing Overleaf session directly to this private service. It uses zero cloud-browser minutes. Install it once in Edge or Chrome, then click Connect inside the helper.</p>
<a class="button primary" href="/connect/extension.zip" download="overleaf-connection-helper.zip">Download browser helper 0.1.2 (ZIP)</a>
<p>Helper 0.1.1 still works; no update is required. Version 0.1.2 only clarifies the instructions. If the helper is already installed, enable it when needed instead of installing it again.</p>
<ol><li>Extract the ZIP. Open <strong>edge://extensions</strong> or <strong>chrome://extensions</strong>, enable Developer mode, choose Load unpacked, and select the extracted folder containing manifest.json.</li><li>Keep this setup tab signed in. In the same browser window, open your signed-in Overleaf project and open Overleaf connection helper - Fanurs from the Extensions menu.</li><li>Check the project URL, then click Connect this Overleaf session. Return here and click Test connection when the helper says Session saved.</li></ol>
<small>The helper needs cookie and script permissions for Overleaf and this private setup site only. It does not read your passwords or Google/university cookies, save cookies on disk, or send them to chat. Saved cookies grant an Overleaf account session. A successful transfer still needs the read-only connection test below.</small>
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
<section><h2>Past cloud-browser usage</h2>
<p>Timed cloud-browser sign-in was retired on November 25, 2026. This service can no longer launch cloud browsers. The records below are from earlier attempts; current connections use 0 cloud-browser seconds.</p>
<p id="usage-summary">No past timed attempts are recorded.</p>
<small>Earlier completed attempts were logged privately, including failures and cancellations. Times labeled Cloudflare come from its session history. Estimates include startup and shutdown and are not billing measurements. Older attempts before this update have no duration record.</small>
<div id="usage-table"><table><thead><tr><th>Started</th><th>Browser time</th><th>Measurement</th><th>Result</th></tr></thead><tbody id="usage"></tbody></table></div>
<a href="/api/login/history" download="overleaf-login-usage.json">Download complete time log (JSON)</a>
<small>The latest 20 attempts are shown. The download contains every recorded attempt for this setup account. This history is retained when the saved Overleaf session is removed.</small></section>
<details><summary>Advanced fallback - upload an existing session file</summary>
<p>Use this only if you already have a session file from the local login helper. It is optional.</p>
<label for="session">Saved Overleaf session file</label><input id="session" type="file" accept=".txt">
<small>Upload only here, never into chat or GitHub.</small><button id="link">Save uploaded session</button></details>
<p>The read-only test reports success flags, document length, and protocol. It does not display or store document text. Signing out of this setup page and revoking the saved Overleaf session are separate actions.</p>
<script src="/setup.js" defer></script></body></html>`

export const SETUP_JS = `const result=document.querySelector('#result');
let busy=false;
const messages={
 SESSION_REQUIRED:'Connect your Overleaf account before testing.',
 AUTH_EXPIRED:'Overleaf no longer accepts the saved session. Sign into Overleaf and use the browser helper to reconnect.',
 HISTORY_UNAVAILABLE:'The saved time log could not be read. No records were changed.',
 PROBE_FAILED:'The connection test failed. Share this error code with the assistant; do not share session files.',
 NO_READABLE_DOCUMENT:'The service signed in and joined your project, but its file tree contained no readable text document. Your saved session is still connected. Code NO_READABLE_DOCUMENT.'
};
const outcomes={connected:'Connected',cancelled:'Cancelled',expired:'Time limit reached',not_opened:'Login window not opened',failed:'Failed',launch_failed:'Launch failed'};
function duration(ms){return (Math.max(0,ms)/1000).toFixed(1)+' s'}
function renderUsage(records){
 const body=document.querySelector('#usage');body.replaceChildren();
 document.querySelector('#usage-summary').textContent=records.length?'Last historical attempt used '+(records[0].browserMs===undefined?(records[0].timing==='unavailable'?'an unknown amount of browser time ('+duration(records[0].elapsedMs)+' elapsed)':duration(records[0].elapsedMs)+' estimated'):duration(records[0].browserMs)+' reported by Cloudflare')+'.':'No past timed attempts are recorded.';
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
async function refresh(announce=false){
 const value=await call('/api/status');if(!value)return;
 if(value.projectId&&!document.querySelector('#project').value)document.querySelector('#project').value='https://www.overleaf.com/project/'+value.projectId;
 document.querySelector('#edit-result').textContent=value.editTest?JSON.stringify(value.editTest,null,2):'Not run yet.';
 renderUsage(value.usage||[]);
 if(announce)result.textContent=value.linked?(value.editTest&&value.editTest.status==='passed'?'Overleaf reading and editing test passed. If ChatGPT is already connected, return there to continue.':value.verifiedAt?'Overleaf read connection verified. Run the disposable editing test next.':'Overleaf session saved. Click Test connection to verify it.'):'Overleaf is not connected yet. Paste your project URL, then use the browser helper.';
}
async function act(run){busy=true;const buttons=document.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);result.textContent='Working...';try{await run()}catch{result.textContent='The request failed. Reload the page if needed.'}finally{try{await refresh()}catch{}busy=false;buttons.forEach(b=>b.disabled=false)}}
function projectId(){
 let url;try{url=new URL(document.querySelector('#project').value)}catch{result.textContent='Paste your Overleaf project URL first.';return null}
 const match=/^\\/project\\/([a-f0-9]{24})\\/?$/.exec(url.pathname);
 if(url.origin!=='https://www.overleaf.com'||!match){result.textContent='Use a project URL from https://www.overleaf.com/project/.';return null}
 return match[1];
}
window.addEventListener('focus',()=>{if(!busy)void act(()=>refresh(true))});
document.querySelector('#link').onclick=()=>act(async()=>{
 const file=document.querySelector('#session').files[0];
 if(!file||file.size>65536){result.textContent='Choose an existing Overleaf session file (maximum 64 KiB).';return}
 const id=projectId();if(!id)return;
 if(await call('/api/link',{cookies:await file.text(),projectId:id})){document.querySelector('#session').value='';result.textContent='Session saved. Click Test connection next.'}
});
document.querySelector('#probe').onclick=()=>act(async()=>{const value=await call('/api/probe',{});if(value)result.textContent='Connection verified. The service signed into Overleaf, joined your project, and read a text document without editing it.'+(value.documentSelection==='project_document'?' Overleaf did not report a usable configured main document, so the test read another existing text document.':'')+'\\n\\n'+JSON.stringify(value,null,2)});
document.querySelector('#edit-test').onclick=()=>act(async()=>{result.textContent='Testing a separate disposable project. No cloud browser is running.';const value=await call('/api/edit-test',{});if(value){document.querySelector('#edit-result').textContent=JSON.stringify(value,null,2);result.textContent=value.status==='passed'?'Editing test passed. The temporary project is in Trash. Cloud-browser time used: 0 seconds.':'Editing test did not complete. The result below identifies the completed steps. Do not repeat it blindly.'}});
document.querySelector('#unlink').onclick=()=>act(async()=>{if(await call('/api/unlink',{})){result.textContent='Saved Overleaf session removed.'}});
act(()=>refresh(true));
`
