export const LOGIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Prepare Overleaf sign-in</title>
<style>body{font:18px/1.6 system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 24px;color:#1b2930;background:#fafcfb}section{background:white;padding:24px;border:1px solid #dce5df;border-radius:12px}button{font:inherit;padding:12px 16px;margin:12px 8px 0 0;cursor:pointer}#begin{background:#185333;color:white;border:0;border-radius:6px}button:disabled{opacity:.5;cursor:default}#status{white-space:pre-wrap}a{color:#216a4f}</style>
</head><body><h1>Prepare Overleaf sign-in</h1>
<section><p><strong>No cloud browser is running from opening this page. No timer has started.</strong> You can leave this page open and come back later.</p>
<p>Have your Overleaf login and any university or Google verification ready. Your saved login in your usual browser does not carry into this temporary cloud browser.</p>
<p>Only click the button when you are ready to sign in now. This tab will become the login window. The service requests shutdown after <strong>60 seconds total, including startup</strong>, or sooner when it detects successful sign-in.</p>
<p>Switching away does not pause Cloudflare usage. Do not start if you need to step away. Provider or network delays can delay shutdown; the actual duration or estimate is recorded.</p>
<button id="begin">Start 60-second sign-in</button><button id="cancel" disabled>Cancel startup</button>
<p id="status" role="status" aria-live="polite">Ready when you are. Opening this page uses zero cloud-browser time.</p>
</section><p>After the login browser closes, return to the setup page for <strong>Finish connecting</strong>, <strong>Cancel sign-in</strong>, the time log, or <strong>Test connection</strong>.</p>
<a href="/connect">https://overleaf-mcp.fanurs.com/connect</a>
<script src="/login.js" defer></script></body></html>`

export const LOGIN_JS = `const begin=document.querySelector('#begin'), cancel=document.querySelector('#cancel'), status=document.querySelector('#status');
const projectId=new URL(location.href).searchParams.get('project');
let starting=false, abandoned=false, handedOff=false, clock=null, startedAt=0;
async function post(path,body){
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Overleaf-Setup':'1'},body:JSON.stringify(body),keepalive:true});
 if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('ACCESS_REQUIRED');
 const value=await response.json();if(!response.ok||value.code)throw new Error(value.code||'LOGIN_FAILED');return value;
}
async function stop(){
 abandoned=true;
 if(!starting||handedOff)return;
 status.textContent='Cancelling startup. The time log will confirm closure.';
 try{await post('/api/login/cancel',{});status.textContent='Cloud browser closed. Return to setup to see the time log.'}catch{status.textContent='Closure has not been confirmed. Server-side cleanup remains active. Check the setup time log.'}
}
if(!/^[a-f0-9]{24}$/.test(projectId||'')){begin.disabled=true;status.textContent='Choose a project on the setup page first.'}
begin.onclick=async event=>{
 if(starting||!event.isTrusted||document.visibilityState!=='visible'||!document.hasFocus())return;
 starting=true;abandoned=false;begin.disabled=true;cancel.disabled=false;startedAt=performance.now();
 const draw=()=>{if(!abandoned)status.textContent='Starting sign-in. '+((performance.now()-startedAt)/1000).toFixed(1)+' s elapsed (estimate). The 60-second deadline includes startup.'};
 draw();clock=setInterval(draw,1000);
 try{
  const value=await post('/api/login/start',{projectId,ready:true});
  if(abandoned||document.visibilityState!=='visible'||!document.hasFocus()){await stop();return}
  const url=new URL(value.loginUrl);
  if(url.origin!=='https://live.browser.run'||!url.pathname.startsWith('/ui/')||url.username||url.password)throw new Error('LOGIN_VIEW_INVALID');
  await post('/api/login/watch',{});
  if(abandoned||document.visibilityState!=='visible'||!document.hasFocus()){await stop();return}
  handedOff=true;location.replace(url.href);
 }catch(error){
  await stop();
  const messages={LOGIN_DAILY_LIMIT:'The daily attempt limit has been reached. No new browser was started. Use the untimed session-transfer option or try another day.',ACCESS_REQUIRED:'Sign into the private setup page again before starting.',LOGIN_REQUIRED:'Startup took too long or the browser closed. Check the time log. No retry was started.'};
  status.textContent=messages[error.message]||'Sign-in could not start. Cleanup was requested. Check the setup time log before retrying.';
 }finally{clearInterval(clock);cancel.disabled=true}
};
cancel.onclick=stop;
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'&&starting&&!handedOff)void stop()});
window.addEventListener('blur',()=>{if(starting&&!handedOff)void stop()});
window.addEventListener('pagehide',()=>{if(starting&&!handedOff)void stop()});
`
