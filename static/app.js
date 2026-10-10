const $ = s => document.querySelector(s);
let key = localStorage.getItem('field-notes-key') || '';
const api = (path, options = {}) => fetch('/api' + path, {headers:{'Content-Type':'application/json','X-Tracker-Token':key,...options.headers}, ...options}).then(async r => {const d=await r.json();if(!r.ok)throw new Error(d.detail||'Something went wrong');return d});
const fmtTime = stamp => stamp ? new Intl.DateTimeFormat([], {hour:'numeric',minute:'2-digit'}).format(new Date(stamp)) : '—';
const fmtDay = day => new Intl.DateTimeFormat([], {month:'short',day:'numeric'}).format(new Date(day+'T12:00:00'));
const fmtHours = mins => `${Math.floor(mins/60)}h ${String(Math.round(mins%60)).padStart(2,'0')}m`;
const esc = value => {const e=document.createElement('div');e.textContent=value;return e.innerHTML};
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800)}
function minutesBetween(a,b){return a&&b?Math.max(0,(new Date(b)-new Date(a))/60000):0}

function renderAttendance(a){
  const mins=a?.check_in?minutesBetween(a.check_in,a.check_out||new Date().toISOString()):0;
  const mode=a?.work_mode||'office';
  $('#check-in').textContent=mode==='office'?fmtTime(a?.check_in):mode==='wfh'?'Working from home':'On leave';
  $('#check-out').textContent=mode==='office'?fmtTime(a?.check_out):'No office time';
  $('#check-in-label').textContent=mode==='office'?'Arrival':'Today';$('#check-out-label').textContent=mode==='office'?'Departure':'Attendance';
  const state=$('#attendance-state');
  state.textContent=mode==='wfh'?'WFH':mode==='leave'?'ON LEAVE':a?.check_out?(mins>=480?'8H REACHED':'DAY COMPLETE'):a?.check_in?'ON THE CLOCK':'NOT STARTED';
  state.classList.toggle('live',!!a?.check_in&&!a?.check_out);
  $('#in-button').disabled=mode==='office'&&!!a?.check_in;$('#out-button').disabled=mode!=='office'||!a?.check_in||!!a?.check_out;
  $('#wfh-button').disabled=mode==='wfh';$('#leave-button').disabled=mode==='leave';
}
function renderEntries(entries){
  $('#entries').innerHTML=entries.length?entries.map(e=>`<article class="entry"><time>${fmtDay(e.day)}</time><div><h3>${esc(e.title)}</h3><p>${esc(e.body)}</p></div><button class="quiet-button" data-delete-entry="${e.id}">Delete</button></article>`).join(''):'<p class="chart-empty">No notes yet. Capture one thought before the day gets away.</p>';
  document.querySelectorAll('[data-delete-entry]').forEach(b=>b.onclick=async()=>{try{await api('/work-logs/'+b.dataset.deleteEntry,{method:'DELETE'});toast('Note removed');load()}catch(e){toast(e.message)}});
}
function renderTasks(tasks){
  const remaining=tasks.filter(t=>!t.completed).length;$('#task-count').textContent=tasks.length?`${remaining} open`:'';
  $('#tasks').innerHTML=tasks.length?tasks.map(t=>`<div class="task ${t.completed?'done':''}"><input class="task-check" type="checkbox" id="task-${t.id}" data-toggle-task="${t.id}" ${t.completed?'checked':''}><label for="task-${t.id}">${esc(t.title)}</label><button class="quiet-button" data-delete-task="${t.id}" aria-label="Delete task">×</button></div>`).join(''):'<p class="chart-empty">A short list leaves more room to think.</p>';
  document.querySelectorAll('[data-toggle-task]').forEach(b=>b.onchange=async()=>{try{await api('/tasks/'+b.dataset.toggleTask+'/toggle',{method:'PATCH'});load()}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-delete-task]').forEach(b=>b.onclick=async()=>{try{await api('/tasks/'+b.dataset.deleteTask,{method:'DELETE'});load()}catch(e){toast(e.message)}});
}
function renderLedger(records){
  $('#attendance-list').innerHTML=records.length?records.map(x=>{const mode=x.work_mode||'office',mins=minutesBetween(x.check_in,x.check_out),target=mins>=480,manual=x.manually_overridden||x.source==='manual_override',office=mode==='office';const detail=office?`${fmtHours(mins)} · ${target?'goal met':'under 8h'}`:mode==='wfh'?'Working from home':'On leave';return `<div class="ledger-row"><strong><small>Date</small>${fmtDay(x.day)}</strong><span><small>${office?'In':'Mode'}</small>${office?fmtTime(x.check_in):mode.toUpperCase()}</span><span><small>${office?'Out':'Office time'}</small>${office?fmtTime(x.check_out):'—'}</span><span class="duration-cell ${office?(target?'on-target':'below-target'):''}"><small>${office?'Office hours':'Status'}</small>${detail}${manual?'<em class="manual-mark">MANUAL</em>':''}</span>${office?`<button class="quiet-button edit-attendance" data-edit-attendance="${x.day}">Edit</button>`:'<span></span>'}</div>`}).join(''):'<p class="chart-empty">Your attendance record will appear here.</p>';
  document.querySelectorAll('[data-edit-attendance]').forEach(button=>button.onclick=()=>openOverride(records.find(record=>record.day===button.dataset.editAttendance)));
}
function renderChart(analysis){
  const {days,summary,target_hours:target}=analysis;
  $('#analysis-summary').innerHTML=[
    ['Average day',summary.completed_days?`${summary.average_hours}h`:'—'],
    ['Days at 8h+',summary.target_days],
    ['Time recorded',summary.completed_days?`${summary.total_hours}h`:'—']
  ].map(([label,value])=>`<div class="summary"><span>${label}</span><strong>${value}</strong></div>`).join('');
  if(!days.length){$('#attendance-chart').innerHTML='<p class="chart-empty">Finish a check-in and check-out to see your time trend here.</p>';return}
  const W=720,H=250,L=48,R=12,T=20,B=42,innerW=W-L-R,innerH=H-T-B,max=Math.max(target+1,...days.map(d=>Number(d.hours)+.5)),y=h=>T+innerH-(h/max)*innerH,x=i=>L+(i+.5)*(innerW/days.length),bar=Math.max(7,innerW/days.length*.58),targetY=y(target);
  const grid=[0,4,8,Math.ceil(max)].filter((v,i,a)=>a.indexOf(v)===i&&v<=max);
  const gridSvg=grid.map(v=>`<g><line class="chart-grid" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="${L-8}" y="${y(v)+4}" text-anchor="end">${v}h</text></g>`).join('');
  const bars=days.map((d,i)=>{const h=Number(d.hours),yy=y(h),met=h>=target,label=fmtDay(d.day);return `<g><rect class="chart-bar ${met?'':'below'}" x="${x(i)-bar/2}" y="${yy}" width="${bar}" height="${Math.max(1,T+innerH-yy)}" rx="1"><title>${label}: ${h.toFixed(1)} hours${met?' · 8h goal met':''}</title></rect>${(i===0||i===days.length-1||days.length<=7)?`<text class="chart-axis" x="${x(i)}" y="${H-16}" text-anchor="middle">${label}</text>`:''}</g>`}).join('');
  $('#attendance-chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Completed hours per office day, compared with an eight-hour daily goal"><title>Daily recorded office hours</title><desc>Each bar is a completed office day. The dotted line is the flexible eight hour goal.</desc>${gridSvg}<line class="chart-target" x1="${L}" x2="${W-R}" y1="${targetY}" y2="${targetY}"/><text class="chart-label" x="${W-R}" y="${targetY-7}" text-anchor="end">8h goal</text>${bars}<text class="chart-label" x="${L}" y="12">Recorded hours</text></svg>`;
}
function render(data,analysis){
  $('#today-label').textContent=new Intl.DateTimeFormat([], {weekday:'long',month:'long',day:'numeric'}).format(new Date(data.today+'T12:00:00'));
  $('#office-days').textContent=data.office_days_month;renderAttendance(data.attendance);renderEntries(data.entries);renderTasks(data.tasks);renderLedger(data.recent_attendance);renderChart(analysis);
}
async function load(){
  if(!key){key=prompt('Enter your personal Field Notes access key. It stays only in this browser.')||'';localStorage.setItem('field-notes-key',key)}
  try{const [data,analysis]=await Promise.all([api('/dashboard'),api('/analysis')]);render(data,analysis)}catch(e){toast(e.message)}
}
function toLocalInput(value){const d=new Date(value),pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function openOverride(record){
  if(!record)return;
  $('#override-day').value=record.day;
  $('#override-in').value=record.check_in?toLocalInput(record.check_in):`${record.day}T09:00`;
  $('#override-out').value=record.check_out?toLocalInput(record.check_out):`${record.day}T17:00`;
  $('#override-dialog').showModal();
}
$('#in-button').onclick=async()=>{try{const r=await api('/manual/check-in',{method:'POST'});toast(r.status==='already_checked_in'?'Already checked in':'Check-in saved');load()}catch(e){toast(e.message)}};
$('#out-button').onclick=async()=>{try{const r=await api('/manual/check-out',{method:'POST'});toast(r.status==='already_checked_out'?'Already checked out':'Check-out saved');load()}catch(e){toast(e.message)}};
async function setWorkMode(work_mode){try{await api('/work-mode',{method:'POST',body:JSON.stringify({work_mode})});toast(work_mode==='wfh'?'Marked as working from home':'Marked as leave');load()}catch(e){toast(e.message)}}
$('#wfh-button').onclick=()=>setWorkMode('wfh');$('#leave-button').onclick=()=>setWorkMode('leave');
$('#entry-form').onsubmit=async e=>{e.preventDefault();try{await api('/work-logs',{method:'POST',body:JSON.stringify({title:$('#entry-title').value,body:$('#entry-body').value})});e.target.reset();toast('Note saved');load()}catch(e){toast(e.message)}};
$('#task-form').onsubmit=async e=>{e.preventDefault();try{await api('/tasks',{method:'POST',body:JSON.stringify({title:$('#task-title').value})});e.target.reset();$('#task-title').focus();load()}catch(e){toast(e.message)}};
$('#override-form').onsubmit=async e=>{e.preventDefault();const day=$('#override-day').value;try{await api('/attendance/'+day,{method:'PUT',body:JSON.stringify({check_in:$('#override-in').value,check_out:$('#override-out').value})});$('#override-dialog').close();toast('Attendance correction saved');load()}catch(e){toast(e.message)}};
$('#report-button').onclick=async()=>{const end=new Date(),start=new Date();start.setDate(end.getDate()-6);const iso=d=>d.toISOString().slice(0,10);try{const r=await api('/reports',{method:'POST',body:JSON.stringify({start_date:iso(start),end_date:iso(end),report_type:'weekly'})});$('#report-output').textContent=r.content;$('#report-dialog').showModal()}catch(e){toast(e.message)}};
$('.close').onclick=()=>$('#report-dialog').close();load();
document.querySelector('[data-close-override]').onclick=()=>$('#override-dialog').close();
