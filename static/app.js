const $ = s => document.querySelector(s);
let key = localStorage.getItem('field-notes-key') || '';
const api = (path, options = {}) => fetch('/api' + path, {headers:{'Content-Type':'application/json','X-Tracker-Token':key,...options.headers}, ...options}).then(async r => {const d=await r.json();if(!r.ok)throw new Error(d.detail||'Something went wrong');return d});
const fmtTime = stamp => stamp ? new Intl.DateTimeFormat([], {hour:'numeric',minute:'2-digit'}).format(new Date(stamp)) : '—';
const fmtDay = day => new Intl.DateTimeFormat([], {month:'short',day:'numeric'}).format(new Date(day+'T12:00:00'));
const fmtHours = mins => `${Math.floor(mins/60)}h ${String(Math.round(mins%60)).padStart(2,'0')}m`;
const esc = value => {const e=document.createElement('div');e.textContent=value;return e.innerHTML};
const localDay = d => {const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const fromDay = day => new Date(day+'T12:00:00');
const addDays = (day, amount) => {const next=new Date(day);next.setDate(next.getDate()+amount);return next};
function mondayOf(date){const day=new Date(date);day.setHours(12,0,0,0);day.setDate(day.getDate()-((day.getDay()+6)%7));return day}
let selectedWeek=mondayOf(new Date());
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
  const days=Array.from({length:7},(_,index)=>localDay(addDays(selectedWeek,index))),lookup=new Map(records.map(record=>[record.day,record]));
  $('#week-label').textContent=`${fmtDay(days[0])} – ${fmtDay(days[6])}`;
  $('#next-week').disabled=selectedWeek>=mondayOf(new Date());
  $('#attendance-list').innerHTML=days.map(day=>{const x=lookup.get(day);if(!x)return `<div class="ledger-row empty-day"><strong><small>Date</small>${fmtDay(day)}</strong><span><small>Mode</small>—</span><span><small>Office time</small>—</span><span class="duration-cell"><small>Status</small>No entry</span><span class="attendance-actions"><button class="quiet-button add-day" data-add-day="${day}">Add</button></span></div>`;const mode=x.work_mode||'office',mins=minutesBetween(x.check_in,x.check_out),target=mins>=480,manual=x.manually_overridden||x.source==='manual_override',office=mode==='office';const detail=office?`${fmtHours(mins)} · ${target?'goal met':'under 8h'}`:mode==='wfh'?'Working from home':'On leave';return `<div class="ledger-row"><strong><small>Date</small>${fmtDay(x.day)}</strong><span><small>${office?'In':'Mode'}</small>${office?fmtTime(x.check_in):mode.toUpperCase()}</span><span><small>${office?'Out':'Office time'}</small>${office?fmtTime(x.check_out):'—'}</span><span class="duration-cell ${office?(target?'on-target':'below-target'):''}"><small>${office?'Office hours':'Status'}</small>${detail}${manual?'<em class="manual-mark">MANUAL</em>':''}</span><span class="attendance-actions"><button class="quiet-button edit-attendance" data-edit-attendance="${x.day}">Edit</button><button class="quiet-button delete-attendance" data-delete-attendance="${x.day}">Delete</button></span></div>`}).join('');
  document.querySelectorAll('[data-edit-attendance]').forEach(button=>button.onclick=()=>openOverride(records.find(record=>record.day===button.dataset.editAttendance)));
  document.querySelectorAll('[data-add-day]').forEach(button=>button.onclick=()=>openOverride({day:button.dataset.addDay},true));
  document.querySelectorAll('[data-delete-attendance]').forEach(button=>button.onclick=async()=>{if(!confirm(`Delete attendance for ${fmtDay(button.dataset.deleteAttendance)}?`))return;try{await api('/attendance/'+button.dataset.deleteAttendance,{method:'DELETE'});toast('Attendance entry deleted');load()}catch(e){toast(e.message)}});
}
function renderChart(analysis){
  const {days,summary}=analysis;
  $('#analysis-summary').innerHTML=[
    ['Office days',summary.office_days],
    ['WFH days',summary.wfh_days],
    ['Leave days',summary.leave_days]
  ].map(([label,value])=>`<div class="summary"><span>${label}</span><strong>${value}</strong></div>`).join('');
  if(!days.length){$('#attendance-chart').innerHTML='<p class="chart-empty">Add Office, WFH, or Leave attendance to see your work pattern here.</p>';return}
  const label={office:'Office',wfh:'WFH',leave:'Leave'};
  $('#attendance-chart').innerHTML=`<div class="presence-legend"><span><i class="office-dot"></i>Office</span><span><i class="wfh-dot"></i>WFH</span><span><i class="leave-dot"></i>Leave</span></div><div class="presence-grid" role="list" aria-label="Last 30 recorded attendance days">${days.map(day=>`<div class="presence-day ${day.work_mode}" role="listitem" data-label="${fmtDay(day.day)} · ${label[day.work_mode]}"><span>${fmtDay(day.day)}</span><strong>${label[day.work_mode]}</strong></div>`).join('')}</div>`;
}
function render(data,analysis,weekRecords){
  $('#today-label').textContent=new Intl.DateTimeFormat([], {weekday:'long',month:'long',day:'numeric'}).format(new Date(data.today+'T12:00:00'));
  $('#office-days').textContent=data.office_days_month;renderAttendance(data.attendance);renderEntries(data.entries);renderTasks(data.tasks);renderLedger(weekRecords);renderChart(analysis);
}
async function load(){
  if(!key){key=prompt('Enter your personal Field Notes access key. It stays only in this browser.')||'';localStorage.setItem('field-notes-key',key)}
  const start=localDay(selectedWeek),end=localDay(addDays(selectedWeek,6));
  try{const [data,analysis,weekRecords]=await Promise.all([api('/dashboard'),api('/analysis'),api(`/attendance?start_date=${start}&end_date=${end}`)]);render(data,analysis,weekRecords)}catch(e){toast(e.message)}
}
function toLocalInput(value){const d=new Date(value),pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function openOverride(record,isNew=false){
  const day=record?.day||new Date().toISOString().slice(0,10),mode=record?.work_mode||'office';
  $('#override-title').textContent=isNew||!record?'Add past attendance':'Edit attendance';
  $('#override-day').value=day;$('#override-mode').value=mode;
  $('#override-in').value=record?.check_in?toLocalInput(record.check_in):`${day}T09:00`;
  $('#override-out').value=record?.check_out?toLocalInput(record.check_out):`${day}T17:00`;
  toggleOverrideTimes();
  $('#override-dialog').showModal();
}
function toggleOverrideTimes(){const office=$('#override-mode').value==='office';$('#override-times').hidden=!office;$('#override-in').required=office;$('#override-out').required=office}
$('#in-button').onclick=async()=>{try{const r=await api('/manual/check-in',{method:'POST'});toast(r.status==='already_checked_in'?'Already checked in':'Check-in saved');load()}catch(e){toast(e.message)}};
$('#out-button').onclick=async()=>{try{const r=await api('/manual/check-out',{method:'POST'});toast(r.status==='already_checked_out'?'Already checked out':r.status==='ignored_early_checkout'?'Checkout ignored: too soon after check-in':'Check-out saved');load()}catch(e){toast(e.message)}};
async function setWorkMode(work_mode){try{await api('/work-mode',{method:'POST',body:JSON.stringify({work_mode})});toast(work_mode==='wfh'?'Marked as working from home':'Marked as leave');load()}catch(e){toast(e.message)}}
$('#wfh-button').onclick=()=>setWorkMode('wfh');$('#leave-button').onclick=()=>setWorkMode('leave');
$('#entry-form').onsubmit=async e=>{e.preventDefault();try{await api('/work-logs',{method:'POST',body:JSON.stringify({title:$('#entry-title').value,body:$('#entry-body').value})});e.target.reset();toast('Note saved');load()}catch(e){toast(e.message)}};
$('#task-form').onsubmit=async e=>{e.preventDefault();try{await api('/tasks',{method:'POST',body:JSON.stringify({title:$('#task-title').value})});e.target.reset();$('#task-title').focus();load()}catch(e){toast(e.message)}};
$('#override-form').onsubmit=async e=>{e.preventDefault();const day=$('#override-day').value,work_mode=$('#override-mode').value;try{await api('/attendance/'+day,{method:'PUT',body:JSON.stringify({work_mode,check_in:work_mode==='office'?$('#override-in').value:null,check_out:work_mode==='office'?$('#override-out').value:null})});$('#override-dialog').close();toast('Attendance saved as a manual entry');load()}catch(e){toast(e.message)}};
$('#report-button').onclick=async()=>{const end=new Date(),start=new Date();start.setDate(end.getDate()-6);const iso=d=>d.toISOString().slice(0,10);try{const r=await api('/reports',{method:'POST',body:JSON.stringify({start_date:iso(start),end_date:iso(end),report_type:'weekly'})});$('#report-output').textContent=r.content;$('#report-dialog').showModal()}catch(e){toast(e.message)}};
$('.close').onclick=()=>$('#report-dialog').close();load();
document.querySelector('[data-close-override]').onclick=()=>$('#override-dialog').close();
$('#override-mode').onchange=toggleOverrideTimes;$('#add-attendance').onclick=()=>openOverride();
$('#previous-week').onclick=()=>{selectedWeek=addDays(selectedWeek,-7);load()};
$('#next-week').onclick=()=>{const next=addDays(selectedWeek,7);if(next<=mondayOf(new Date())){selectedWeek=next;load()}};
