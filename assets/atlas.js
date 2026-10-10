/* global LightStat */
'use strict';
(() => {
  const E = LightStat;
  const $ = id => document.getElementById(id);
  const state = {archives:[], archive:null, result:null, groups:[], selected:null, view:'analytics', tablePage:0, calendarOffset:0, imports:0};
  const number = new Intl.NumberFormat('uk-UA',{maximumFractionDigits:1});
  const fullTime = new Intl.DateTimeFormat('uk-UA',{timeZone:E.ZONE,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'});
  const shortDate = new Intl.DateTimeFormat('uk-UA',{timeZone:E.ZONE,day:'2-digit',month:'short'});
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => number.format(value);
  const hours = value => fmt(value) + ' год';
  const pct = value => fmt(value * 100) + '%';
  const evidenceName = {measured:'вимірювання датчика',reconstructed:'реконструкція журналу',connectivity:'лише стан зв’язку',conflict:'суперечливі події',missing:'немає підтверджених меж'};
  const statusName = {on:'Є світло',off:'Немає світла',unknown:'Немає даних'};
  const sourceName = id => state.archive.sources.find(s => s.id === id)?.name || id;
  function notice(text,error=false) { $('notice').textContent=text; $('notice').hidden=!text; $('notice').classList.toggle('error',error); }
  function download(name,text,type) {
    const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function reset() {
    state.imports++;state.archives=[];state.archive=null;state.result=null;state.groups=[];state.selected=null;
    $('workspace').hidden=true;$('emptyState').hidden=false;$('exportBtn').disabled=true;$('archiveBadge').textContent='Локальний аналіз';notice('');
  }
  function commitArchives(archives) {
    const merged=E.mergeArchives(archives.map(a=>a.data));
    state.archives=archives;state.archive=merged;
    const prior=$('sourceFilter').value;
    $('sourceFilter').innerHTML='<option value="all">Усі джерела</option>'+merged.sources.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');
    if ([...$('sourceFilter').options].some(o=>o.value===prior)) $('sourceFilter').value=prior;
    const range=E.extent(merged);
    $('dateFrom').value=E.dateKey(range.start);$('dateTo').value=E.dateKey(range.end);
    $('archiveBadge').textContent='Архів · до '+shortDate.format(range.end);
    $('workspace').hidden=false;$('emptyState').hidden=true;$('exportBtn').disabled=false;
    recalculate();
  }
  async function importFiles(files) {
    const sequence=++state.imports;
    const additions=[],errors=[];
    notice('Читаємо архіви…');
    for (const file of files) {
      try {
        if (file.size>50*1024*1024) throw new Error('Максимальний розмір файлу — 50 МБ');
        const data=E.importData(JSON.parse((await file.text()).replace(/^\uFEFF/,'')),file.name);
        additions.push({name:file.name,data});
      } catch(error) {errors.push(file.name+': '+error.message);}
    }
    if (sequence!==state.imports) return;
    try {
      if (additions.length) {
        const names=new Set(additions.map(a=>a.name));
        commitArchives([...state.archives.filter(a=>!names.has(a.name)),...additions]);
      }
      notice(errors.length?errors.join(' · '):'Архіви додано. Обробка локальна; файли не надсилалися на сервер.',!!errors.length);
    } catch(error) {notice(error.message,true);}
    $('fileInput').value='';
  }
  async function loadBundled() {
    const sequence=++state.imports;
    try {
      notice('Відкриваємо архів проєкту…');
      const response=await fetch('data/events.json');
      if (!response.ok) throw new Error('Архів недоступний');
      const data=E.importData(await response.json(),'events.json');
      if(sequence!==state.imports)return;
      commitArchives([{name:'events.json',data}]);notice('');
    } catch(error) {
      if(sequence!==state.imports)return;
      if(!state.archive){$('emptyState').hidden=false;$('workspace').hidden=true;}
      notice('Оберіть JSON-файл для локального аналізу. Архів проєкту автоматично відкривається через npm start.');
    }
  }
  function recalculate() {
    if(!state.archive)return;
    try {
      const period=$('period').value;const options={};
      $('customDates').hidden=period!=='custom';
      if(period==='custom') {
        if(!$('dateFrom').value||!$('dateTo').value)throw new Error('Оберіть обидві дати');
        options.start=E.parseTime($('dateFrom').value);options.end=E.parseTime(E.addDays($('dateTo').value,1));
      } else if(period!=='all') options.days=Number(period);
      const result=E.analyze(state.archive,options);
      state.result=result;state.tablePage=0;state.calendarOffset=0;
      $('periodNote').textContent=shortDate.format(Date.parse(result.dateRange.from))+' — '+shortDate.format(Date.parse(result.dateRange.to))+' · час Києва';
      filterGroups();renderSources();
    } catch(error){notice(error.message,true);}
  }
  function filterGroups() {
    if(!state.result)return;
    const source=$('sourceFilter').value;const query=$('search').value.trim().toLocaleLowerCase('uk');
    state.groups=state.result.groups.filter(g=>(source==='all'||g.sourceId===source)&&
      [g.name,g.id,g.address,g.district,g.supplyLine,sourceName(g.sourceId)].filter(Boolean).join(' ').toLocaleLowerCase('uk').includes(query));
    const sort=$('sort').value;
    state.groups.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'uk',{numeric:true}):
      (sort==='coverage'?b.coverage-a.coverage:b.offHours-a.offHours)||a.name.localeCompare(b.name,'uk',{numeric:true}));
    if(!state.groups.some(g=>g.key===state.selected))state.selected=(state.groups.find(g=>g.id==='sg30')||state.groups[0])?.key||null;
    $('pointSelect').innerHTML=state.groups.map(g=>'<option value="'+esc(g.key)+'">'+esc(g.name.toUpperCase())+' · '+esc(sourceName(g.sourceId))+'</option>').join('');
    if(state.selected)$('pointSelect').value=state.selected;
    renderMetrics();renderPoint();renderTable();if(state.view==='coverage')renderCoverage();
  }
  function renderMetrics() {
    const groups=state.groups;const known=groups.filter(g=>g.coverage>0);
    const off=known.map(g=>g.offHours).sort((a,b)=>a-b);
    const median=off.length?(off[Math.floor((off.length-1)/2)]+off[Math.ceil((off.length-1)/2)])/2:null;
    const coverage=groups.length?groups.reduce((s,g)=>s+g.coverage,0)/groups.length:0;
    const mapped=groups.filter(g=>g.coordinates).length;
    const cards=[['Точки спостереження',String(groups.length),'','у вибраному наборі даних'],
      ['Без світла · медіана',median===null?'—':fmt(median),'год','за період · серед точок з даними'],
      ['Час із відомим станом',fmt(coverage*100),'%','вимірювання + реконструкція'],
      ['Точки на карті',String(mapped),'','лише підтверджені координати']];
    $('metrics').innerHTML=cards.map((c,i)=>'<article class="metric"><div class="metric-label">'+c[0]+'<span class="metric-index">0'+(i+1)+'</span></div><div class="metric-value">'+c[1]+'<small>'+c[2]+'</small></div><div class="metric-note">'+c[3]+'</div></article>').join('');
  }
  function renderPoint() {
    const g=state.groups.find(g=>g.key===state.selected);
    if(!g){$('pointName').textContent='Немає збігів';$('pointAddress').textContent='Спробуйте інший пошук або джерело.';$('pointSummary').innerHTML='';$('heatmap').innerHTML='<p class="no-results">Немає локацій за цими фільтрами.</p>';$('calendarRange').textContent='';$('cellDetail').textContent='';$('pointSource').textContent='';$('qualityLabel').textContent='Немає вибраної точки';$('qualityText').textContent='';$('calendarPrev').disabled=true;$('calendarNext').disabled=true;return;}
    $('pointName').textContent=g.name.toUpperCase();
    $('pointAddress').textContent=[g.address||'Адресу не вказано',g.supplyLine?'Ввід: '+g.supplyLine:null].filter(Boolean).join(' · ');
    const stats=[['Є світло',hours(g.onHours),''],['Немає світла',hours(g.offHours),'off-stat'],['Немає даних',hours(g.unknownHours),'unknown-stat'],['Початків вимкнень',g.outageCount,''],['Найдовший відомий відрізок без світла',hours(g.longestOutageHours),''],['Повнота історії',pct(g.coverage),'']];
    $('pointSummary').innerHTML=stats.map(c=>'<div class="detail-stat '+c[2]+'"><span>'+esc(c[0])+'</span><strong>'+esc(c[1])+'</strong></div>').join('');
    $('qualityLabel').textContent=g.measuredHours>0?'Є прямі вимірювання':'Історія за журналом подій';
    $('qualityText').textContent=g.measuredHours>0?hours(g.measuredHours)+' виміряно; '+hours(g.reconstructedHours)+' реконструйовано. Решта часу може бути невідомою.':'Стан відновлено між подіями. Повнота журналу між ними не перевірена. Невідомі межі не продовжуються.';
    $('pointSource').innerHTML='<strong>Джерело</strong><br>'+esc(sourceName(g.sourceId))+'<br><strong>Остання подія архіву</strong><br>'+esc(g.lastEvent?fullTime.format(Date.parse(g.lastEvent)):'—');
    renderCalendar(g);
  }
  function renderCalendar(g) {
    const start=Date.parse(state.result.dateRange.from),end=Date.parse(state.result.dateRange.to);
    const firstKey=E.dateKey(start),lastKey=E.dateKey(end-1);
    const days=Math.round((Date.parse(lastKey+'T12:00:00Z')-Date.parse(firstKey+'T12:00:00Z'))/(24*E.HOUR))+1;
    state.calendarOffset=Math.max(0,Math.min(state.calendarOffset,Math.max(0,days-1)));
    const last=E.addDays(lastKey,-state.calendarOffset),first=E.addDays(last,-29)<firstKey?firstKey:E.addDays(last,-29);
    const from=Math.max(start,E.parseTime(first)),to=Math.min(end,E.parseTime(E.addDays(last,1)));
    const calendar=E.calendar(g,from,to);
    $('calendarRange').textContent=shortDate.format(from)+' — '+shortDate.format(to-1)+' · '+calendar.length+' дн.';
    $('calendarPrev').disabled=first===firstKey;$('calendarNext').disabled=state.calendarOffset===0;
    $('cellDetail').textContent='Оберіть годину для деталей. Стрілки переміщують фокус по календарю.';
    const cells=[];
    let markup='<div class="heat-row" role="row"><span role="columnheader"></span>'+Array.from({length:24},(_,h)=>'<span class="hour-label" role="columnheader">'+(h%3===0?String(h).padStart(2,'0'):'·')+'</span>').join('')+'</div>';
    for(const day of calendar) {
      markup+='<div class="heat-row" role="row"><span class="day-label" role="rowheader">'+esc(day.date.slice(8)+'.'+day.date.slice(5,7))+(day.elapsedHours!==24?'*':'')+'</span>';
      for(const cell of day.hours){
        const duration=cell.onHours+cell.offHours+cell.unknownHours;
        let kind=cell.elapsedHours===0?'dst-gap':!duration?'outside':cell.onHours===duration?'on':cell.offHours===duration?'off':cell.unknownHours===duration?'unknown':'mixed';
        let style='';
        if(kind==='mixed') {
          let cursor=0;const stops=[];
          for(const interval of cell.intervals){const next=cursor+(interval.end-interval.start)/(duration*E.HOUR)*100;const color=interval.state==='on'?'#93c6a6':interval.state==='off'?'#d28d64':'#e3e7e8';stops.push(color+' '+cursor.toFixed(2)+'%',color+' '+next.toFixed(2)+'%');cursor=next;}
          style=' style="background:linear-gradient(90deg,'+stops.join(',')+')"';
        }
        const label=day.date+' '+String(cell.hour).padStart(2,'0')+':00 — '+(cell.elapsedHours===0?'година відсутня через переведення годинника':!duration?'поза вибраним періодом':'є '+hours(cell.onHours)+', немає '+hours(cell.offHours)+', невідомо '+hours(cell.unknownHours))+(cell.elapsedHours===2?'; година повторюється двічі':'');
        const index=cells.length;cells.push({cell,day,label});
        markup+='<button role="gridcell" tabindex="'+(index===0?'0':'-1')+'" class="heat-cell '+kind+(cell.measuredHours>0?' measured':'')+'" data-cell="'+index+'" aria-label="'+esc(label)+'" title="'+esc(label)+'"'+style+'></button>';
      }markup+='</div>';
    }
    $('heatmap').innerHTML=markup;
    function showCell(button){
      const entry=cells[Number(button.dataset.cell)];if(!entry)return;
      $('cellDetail').innerHTML='<strong>'+esc(entry.label)+'</strong><br>'+esc(sourceName(g.sourceId))+' · '+esc(g.name)+'<ul>'+entry.cell.intervals.map(i=>'<li>'+esc(fullTime.format(i.start))+' → '+esc(fullTime.format(i.end))+': '+esc(statusName[i.state])+' · '+esc(evidenceName[i.evidence]||i.evidence)+'</li>').join('')+'</ul>';
    }
    $('heatmap').onclick=event=>{const b=event.target.closest('[data-cell]');if(b)showCell(b);};
    if(state.focusHandler)$('heatmap').removeEventListener('focusin',state.focusHandler);
    state.focusHandler=event=>{const b=event.target.closest('[data-cell]');if(b){$('heatmap').querySelector('[tabindex="0"]')?.setAttribute('tabindex','-1');b.tabIndex=0;showCell(b);}};
    $('heatmap').addEventListener('focusin',state.focusHandler);
    $('heatmap').onkeydown=event=>{
      const b=event.target.closest('[data-cell]');if(!b)return;
      const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-24,ArrowDown:24}[event.key];if(delta==null)return;
      event.preventDefault();const index=Math.max(0,Math.min(cells.length-1,Number(b.dataset.cell)+delta));$('heatmap').querySelector('[data-cell="'+index+'"]')?.focus();
    };
  }
  function selectPoint(key,scroll=false) {
    state.selected=key;$('pointSelect').value=key;state.calendarOffset=0;
    if(state.view!=='analytics')setView('analytics');
    renderPoint();if(scroll)$('pointSelect').scrollIntoView({behavior:'smooth',block:'center'});
  }
  function renderTable() {
    const groups=state.groups;state.tablePage=Math.min(state.tablePage,Math.max(0,Math.ceil(groups.length/10)-1));
    const page=groups.slice(state.tablePage*10,state.tablePage*10+10);
    const duration=(Date.parse(state.result.dateRange.to)-Date.parse(state.result.dateRange.from))/E.HOUR;
    $('comparisonBody').innerHTML=page.length?page.map(g=>'<tr><td><button class="point-button" data-point="'+esc(g.key)+'">'+esc(g.name.toUpperCase())+'</button><span class="point-sub">'+esc(g.address||sourceName(g.sourceId))+'</span></td><td><div class="stack" role="img" aria-label="'+esc('Є '+hours(g.onHours)+', немає '+hours(g.offHours)+', невідомо '+hours(g.unknownHours))+'"><span class="on" style="width:'+100*g.onHours/duration+'%"></span><span class="off" style="width:'+100*g.offHours/duration+'%"></span><span class="unknown" style="width:'+100*g.unknownHours/duration+'%"></span></div></td><td>'+hours(g.offHours)+'</td><td>'+g.outageCount+'</td><td><span class="coverage-pill '+(g.coverage<.8?'low':'')+'">'+pct(g.coverage)+'</span></td></tr>').join(''):'<tr><td colspan="5" class="no-results">Немає локацій за цими фільтрами.</td></tr>';
    $('tableCount').textContent=groups.length?(state.tablePage*10+1)+'–'+Math.min(groups.length,state.tablePage*10+10)+' із '+groups.length+' точок':'0 точок';
    $('tablePrev').disabled=state.tablePage===0;$('tableNext').disabled=(state.tablePage+1)*10>=groups.length;
  }
  function renderSources() {
    $('sourcesList').innerHTML=state.archive.sources.map(s=>{
      const groups=state.result.groups.filter(g=>g.sourceId===s.id);const dates=groups.filter(g=>g.lastEvent).map(g=>Date.parse(g.lastEvent));
      return '<div class="source-row"><div><strong>'+esc(s.name)+'</strong><p>'+esc(s.kind==='event-log'?'Журнал подій · реконструкція':'Спостереження · термін актуальності '+s.maxAgeSeconds+' с')+' · '+groups.length+' точок</p><code>'+esc(s.id)+'</code></div><div><p>Остання подія: '+esc(dates.length?fullTime.format(Math.max(...dates)):'—')+'</p><p>'+esc(state.archives.filter(a=>a.data.sources.some(x=>x.id===s.id)).map(a=>a.name).join(', '))+'</p></div></div>';
    }).join('');
    const d=state.result.diagnostics;
    $('diagnostics').textContent='Дублікатів: '+d.duplicates+' · Суперечливих часових міток: '+d.conflicts+' · Пропущених записів: '+d.skipped+(state.archive.schedules.length?' · Графіки збережено окремо, у фактичні години не включено.':'')+(state.archive.warnings.length?'\n'+state.archive.warnings.slice(0,8).join(' · '):'');
  }
  function setView(view) {
    state.view=view;
    for(const key of ['analytics','coverage','sources'])$(key+'View').hidden=key!==view;
    document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    $('viewTitle').textContent={analytics:'Аналітика',coverage:'Покриття',sources:'Джерела й методика'}[view];
    if(view==='coverage'&&state.archive)renderCoverage();
  }
  const mapState={zoom:11,center:null,points:[]};
  function project(lat,lon,zoom){const size=256*2**zoom;const sin=Math.sin(Math.max(-85,Math.min(85,lat))*Math.PI/180);return{x:(lon+180)/360*size,y:(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*size};}
  function unproject(x,y,zoom){const size=256*2**zoom;return{lon:x/size*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*y/size)))*180/Math.PI};}
  function renderCoverage(){
    mapState.points=state.groups.filter(g=>g.coordinates);
    $('mappedCount').textContent=mapState.points.length+' / '+state.groups.length+' з координатами';
    $('mapEmpty').hidden=mapState.points.length>0;$('map').hidden=!mapState.points.length;
    $('mapNote').textContent=mapState.points.length?'Підкладка OpenStreetMap завантажується з інтернету. Сірі точки мають менше 80% відомого часу. Перетягуйте карту або використовуйте стрілки.':'Відсутність точки на карті означає відсутність геоприв’язки, а не наявність або відсутність електрики.';
    $('coverageList').innerHTML=state.groups.map(g=>'<div class="coverage-item"><button class="point-button" data-point="'+esc(g.key)+'">'+esc(g.name)+'</button><small>'+esc(g.address||'Адреса невідома')+'</small><small>'+esc(g.coordinates?g.coordinates.lat.toFixed(5)+', '+g.coordinates.lon.toFixed(5):'Координат немає')+' · '+pct(g.coverage)+' часу відомо</small></div>').join('');
    if(mapState.points.length){
      mapState.center={lat:mapState.points.reduce((s,g)=>s+g.coordinates.lat,0)/mapState.points.length,lon:mapState.points.reduce((s,g)=>s+g.coordinates.lon,0)/mapState.points.length};
      mapState.zoom=12;while(mapState.zoom>3){const coords=mapState.points.map(g=>project(g.coordinates.lat,g.coordinates.lon,mapState.zoom));if(Math.max(...coords.map(p=>p.x))-Math.min(...coords.map(p=>p.x))<$('map').clientWidth-70&&Math.max(...coords.map(p=>p.y))-Math.min(...coords.map(p=>p.y))<$('map').clientHeight-70)break;mapState.zoom--;}
      drawMap();
    }
  }
  function drawMap(){
    if(!mapState.center||$('map').hidden)return;
    const map=$('map'),w=map.clientWidth,h=map.clientHeight,z=mapState.zoom,c=project(mapState.center.lat,mapState.center.lon,z),left=c.x-w/2,top=c.y-h/2,n=2**z;
    const tiles=[];
    for(let x=Math.floor(left/256);x<=Math.floor((left+w)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+h)/256);y++){
      if(y<0||y>=n)continue;
      tiles.push('<img alt="" draggable="false" src="https://tile.openstreetmap.org/'+z+'/'+((x%n+n)%n)+'/'+y+'.png" style="left:'+(x*256-left)+'px;top:'+(y*256-top)+'px">');
    }
    $('mapTiles').innerHTML=tiles.join('');
    $('mapPoints').innerHTML=mapState.points.map(g=>{const p=project(g.coordinates.lat,g.coordinates.lon,z);return '<button class="map-point '+(g.coverage<.8?'low':'')+'" data-point="'+esc(g.key)+'" style="left:'+(p.x-left)+'px;top:'+(p.y-top)+'px" title="'+esc(g.name+' · '+pct(g.coverage)+' часу відомо')+'" aria-label="'+esc(g.name+' · '+pct(g.coverage)+' часу відомо')+'"></button>';}).join('');
  }
  function moveMap(dx,dy){if(!mapState.center)return;const p=project(mapState.center.lat,mapState.center.lon,mapState.zoom);mapState.center=unproject(p.x+dx,p.y+dy,mapState.zoom);drawMap();}
  let drag=null;
  $('map').addEventListener('pointerdown',e=>{if(e.target.closest('button,a'))return;drag={x:e.clientX,y:e.clientY};$('map').setPointerCapture(e.pointerId);});
  $('map').addEventListener('pointerup',e=>{if(!drag)return;moveMap(drag.x-e.clientX,drag.y-e.clientY);drag=null;});
  $('map').addEventListener('pointercancel',()=>drag=null);
  $('map').addEventListener('keydown',e=>{if(e.target!==$('map'))return;const delta={ArrowLeft:[-100,0],ArrowRight:[100,0],ArrowUp:[0,-100],ArrowDown:[0,100]}[e.key];if(delta){e.preventDefault();moveMap(...delta);}});
  $('zoomIn').onclick=()=>{mapState.zoom=Math.min(18,mapState.zoom+1);drawMap();};$('zoomOut').onclick=()=>{mapState.zoom=Math.max(3,mapState.zoom-1);drawMap();};
  window.addEventListener('resize',()=>{if(state.view==='coverage')drawMap();});
  function exportCsv(){
    if(!state.result)return;
    const cell=v=>'"'+String(v==null?'':v).replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
    const rows=[['Точка','Джерело','Адреса','Від','До (не включно)','Є світло, год','Немає світла, год','Невідомо, год','Покриття, %','Початків вимкнень','Найдовше, год','Виміряно, год','Реконструйовано, год']];
    for(const g of state.groups)rows.push([g.name,sourceName(g.sourceId),g.address,state.result.dateRange.from,state.result.dateRange.to,g.onHours,g.offHours,g.unknownHours,g.coverage*100,g.outageCount,g.longestOutageHours,g.measuredHours,g.reconstructedHours]);
    download('light-stat.csv','\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
  }
  function schemaExample(){
    const example={schemaVersion:1,sources:[{id:'my-channel',name:'Назва вашого джерела',kind:'event-log',method:'telegram'}],
      points:[{sourceId:'my-channel',id:'home',name:'Мій будинок',address:null,district:null,supplyLine:null,coordinates:null}],
      events:[{sourceId:'my-channel',pointId:'home',timestamp:'2026-02-01T08:00:00+02:00',state:'on'},{sourceId:'my-channel',pointId:'home',timestamp:'2026-02-01T12:00:00+02:00',state:'off'},{sourceId:'my-channel',pointId:'home',timestamp:'2026-02-01T16:00:00+02:00',state:'on'}]};
    download('light-stat-format-example.json',JSON.stringify(example,null,2),'application/json');
  }
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
  $('fileInput').onchange=e=>importFiles([...e.target.files]);$('emptyImport').onclick=()=>$('fileInput').click();$('loadBundled').onclick=loadBundled;
  $('period').onchange=()=>{notice('');recalculate();};$('applyDates').onclick=()=>{notice('');recalculate();};
  $('sourceFilter').onchange=()=>{state.tablePage=0;filterGroups();};$('search').oninput=()=>{state.tablePage=0;filterGroups();};$('sort').onchange=()=>{state.tablePage=0;filterGroups();};
  $('pointSelect').onchange=()=>selectPoint($('pointSelect').value);
  $('calendarPrev').onclick=()=>{state.calendarOffset+=30;renderPoint();};$('calendarNext').onclick=()=>{state.calendarOffset=Math.max(0,state.calendarOffset-30);renderPoint();};
  $('tablePrev').onclick=()=>{state.tablePage--;renderTable();};$('tableNext').onclick=()=>{state.tablePage++;renderTable();};
  for(const container of ['comparisonBody','coverageList','mapPoints'])$(container).addEventListener('click',event=>{const button=event.target.closest('[data-point]');if(button)selectPoint(button.dataset.point,true);});
  $('exportBtn').onclick=exportCsv;$('clearBtn').onclick=reset;
  $('jsonExport').onclick=()=>download('light-stat-analysis.json',JSON.stringify(state.result,null,2),'application/json');
  $('normalizedExport').onclick=()=>{
    const a=state.archive;const data={schemaVersion:1,sources:a.sources,points:a.points.map(({key,...point})=>point),events:a.events.map(({eventId,...event})=>({...event,id:eventId})),schedules:a.schedules};
    download('light-stat-archive.json',JSON.stringify(data,null,2),'application/json');
  };
  $('schemaBtn').onclick=schemaExample;$('schemaBtn2').onclick=schemaExample;
  if(location.protocol==='file:'){reset();$('loadBundled').hidden=true;}else loadBundled();
})();
