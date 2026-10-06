const $ = s => document.querySelector(s);
let key = localStorage.getItem('field-notes-key') || '';
const api = (path, options = {}) => fetch('/api' + path, {headers:{'Content-Type':'application/json','X-Tracker-Token':key,...options.headers}, ...options}).then(async r => {const d=await r.json(); if(!r.ok) throw new Error(d.detail || 'Something went wrong'); return d});
const fmtTime = stamp => stamp ? new Intl.DateTimeFormat([], {hour:'numeric',minute:'2-digit'}).format(new Date(stamp)) : '—';
const fmtDay = day => new Intl.DateTimeFormat([], {month:'short',day:'numeric'}).format(new Date(day+'T12:00:00'));
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800)}
function render(data){$('#today-label').textContent=new Intl.DateTimeFormat([], {weekday:'long',month:'long',day:'numeric'}).format(new Date(data.today+'T12:00:00'));
 const a=data.attendance;$('#check-in').textContent=fmtTime(a?.check_in);$('#check-out').textContent=fmtTime(a?.check_out);const state=$('#attendance-state');state.textContent=a?.check_out?'COMPLETE':a?.check_in?'ON THE CLOCK':'NOT STARTED';state.classList.toggle('live',!!a?.check_in);
 $('#in-button').disabled=!!a?.check_in; $('#out-button').disabled=!a?.check_in||!!a?.check_out;
 $('#entries').innerHTML=data.entries.length?data.entries.map(e=>`<article class="entry"><time>${fmtDay(e.day)}</time><div><h3>${escapeHtml(e.title)}</h3><p>${escapeHtml(e.body)}</p></div><button data-delete="${e.id}">Delete</button></article>`).join(''):'<p style="color:var(--muted);padding:22px 0">No notes yet. Capture one thought before the day gets away.</p>';
 $('#attendance-list').innerHTML=data.recent_attendance.length?data.recent_attendance.map(x=>`<div class="ledger-row"><strong>${fmtDay(x.day)}</strong><span>${fmtTime(x.check_in)}</span><span>${fmtTime(x.check_out)}</span><span>${duration(x.check_in,x.check_out)}</span></div>`).join(''):'<p style="color:var(--muted)">Your attendance record will appear here.</p>';
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{await api('/work-logs/'+b.dataset.delete,{method:'DELETE'});toast('Note removed');load()});}
function duration(a,b){if(!a||!b)return '—';let mins=(new Date(b)-new Date(a))/60000;return `${Math.floor(mins/60)}h ${Math.round(mins%60)}m`}
function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
async function load(){if(!key){key=prompt('Enter your personal Field Notes access key. It stays only in this browser.') || '';localStorage.setItem('field-notes-key',key)}try{render(await api('/dashboard'))}catch(e){toast(e.message)}}
$('#in-button').onclick=async()=>{try{const r=await api('/manual/check-in',{method:'POST'});toast(r.status==='already_checked_in'?'Already checked in':'Check-in saved');load()}catch(e){toast(e.message)}};
$('#out-button').onclick=async()=>{try{const r=await api('/manual/check-out',{method:'POST'});toast(r.status==='already_checked_out'?'Already checked out':'Check-out saved');load()}catch(e){toast(e.message)}};
$('#entry-form').onsubmit=async e=>{e.preventDefault();try{await api('/work-logs',{method:'POST',body:JSON.stringify({title:$('#entry-title').value,body:$('#entry-body').value})});e.target.reset();toast('Note saved');load()}catch(e){toast(e.message)}};
$('#report-button').onclick=async()=>{let end=new Date(),start=new Date();start.setDate(end.getDate()-6);const iso=d=>d.toISOString().slice(0,10);try{const r=await api('/reports',{method:'POST',body:JSON.stringify({start_date:iso(start),end_date:iso(end),report_type:'weekly'})});$('#report-output').textContent=r.content;$('#report-dialog').showModal()}catch(e){toast(e.message)}};
$('.close').onclick=()=>$('#report-dialog').close();load();
