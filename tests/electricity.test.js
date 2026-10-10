'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const E = require('../lib/electricity');
const T = value => E.parseTime('2026-02-01T' + value + ':00+02:00');
function archive(events, kind='event-log', extra={}) {
  return E.importData({schemaVersion:1,sources:[{id:'test',kind,maxAgeSeconds:120}],points:[{sourceId:'test',id:'home'}],
    events:events.map(([time,state,details]) => ({sourceId:'test',pointId:'home',timestamp:T(time),state,
      ...(kind==='observations'?{evidence:'measured'}:{}),...details})),...extra});
}
function result(data,start='00:00',end='06:00') {return E.analyze(data,{start:T(start),end:T(end)}).groups[0];}
function conservation(g, hours) {assert.ok(Math.abs(g.onHours+g.offHours+g.unknownHours-hours)<1e-9);assert.ok(g.coverage>=0 && g.coverage<=1);}
test('last on is never extended to now',()=>{
  const g=result(archive([['00:00','on'],['02:00','off'],['03:00','on']]));
  assert.equal(g.onHours,2);assert.equal(g.offHours,1);assert.equal(g.unknownHours,3);conservation(g,6);
});
test('state preceding the window is retained, including a window with no transitions',()=>{
  const g=result(archive([['00:00','on'],['05:00','off']]),'01:00','04:00');assert.equal(g.onHours,3);assert.equal(g.totalEvents,0);
});
test('unknown prefix is not backfilled from first off',()=>{
  const g=result(archive([['02:00','off'],['04:00','on']]));assert.equal(g.unknownHours,4);assert.equal(g.offHours,2);assert.equal(g.outageCount,0);
});
test('duplicate imports and duplicate states cannot double count',()=>{
  const a=archive([['00:00','on'],['01:00','on'],['02:00','off'],['03:00','off'],['04:00','on']]);
  const r=E.analyze(E.mergeArchives([a,a]),{start:T('00:00'),end:T('06:00')});const g=r.groups[0];
  assert.equal(g.onHours,2);assert.equal(g.offHours,2);assert.equal(g.outageCount,1);assert.equal(g.longestOutageHours,2);assert.equal(r.diagnostics.duplicates,5);
});
test('same-time contradictory states become unknown independent of import order',()=>{
  const a=archive([['00:00','on'],['02:00','on'],['02:00','off'],['04:00','off'],['05:00','on']]);
  const r=E.analyze(a,{start:T('00:00'),end:T('06:00')});assert.equal(r.diagnostics.conflicts,1);assert.equal(r.groups[0].unknownHours,3);
});
test('measured observations expire and do not carry over outages in connectivity',()=>{
  const g=result(archive([['00:00','on'],['00:04','off'],['00:08','off',{evidence:'connectivity'}]],'observations'),'00:00','01:00');
  assert.ok(Math.abs(g.onHours-2/60)<1e-9);assert.ok(Math.abs(g.offHours-2/60)<1e-9);assert.equal(g.outageCount,0);conservation(g,1);
});
test('explicit validUntil is clipped to the next measurement and selected period',()=>{
  const g=result(archive([['00:00','on',{validUntil:T('05:00')}],['02:00','off',{validUntil:T('05:00')}]],'observations'),'01:00','04:00');
  assert.equal(g.onHours,1);assert.equal(g.offHours,2);assert.equal(g.measuredHours,3);assert.equal(g.outageCount,1);
});
test('explicit unknown events preserve gaps',()=>{
  const g=result(archive([['00:00','on'],['01:00','unknown'],['03:00','off'],['05:00','on']]));
  assert.equal(g.unknownHours,3);conservation(g,6);
});
test('same point id in different sources stays separate',()=>{
  const a=archive([['00:00','on'],['01:00','off']]);
  const b=E.importData({schemaVersion:1,sources:[{id:'other',kind:'event-log'}],events:[{sourceId:'other',pointId:'home',timestamp:T('00:00'),state:'off'},{sourceId:'other',pointId:'home',timestamp:T('01:00'),state:'on'}]});
  const r=E.analyze(E.mergeArchives([a,b]));assert.equal(r.groups.length,2);assert.notEqual(r.groups[0].key,r.groups[1].key);
});
test('Telegram rich text and unix timestamps take precedence over ambiguous local strings',()=>{
  const data=E.importData({id:12,messages:[{id:1,type:'message',date:'bad',date_unixtime:String(T('00:00')/1000),text:['✅ ',{text:'SG30'},' увімкнено']},{id:2,type:'message',date_unixtime:String(T('02:00')/1000),text:'🔴 sg30 02:00:00 вимкнено'}]});
  assert.equal(result(data).onHours,2);assert.equal(data.points[0].id,'sg30');
});
test('invalid matching events are counted as skipped',()=>{
  const a=E.importData({messages:[{type:'message',date:'bad',text:'✅ sg1 увімкнено'},{type:'message',date:'2026-02-01T02:00:00+02:00',text:'✅ sg1 увімкнено'}]});assert.equal(a.warnings.length,1);
});
test('empty or unsupported input fails with an actionable error',()=>{
  assert.throws(()=>E.importData({messages:[]}),/придатних/);assert.throws(()=>E.importData({groups:[]}),/Telegram/);
});
test('archive window anchored at end of archive, not wall clock',()=>{
  const a=archive([['00:00','on'],['06:00','off']]);const w=E.defaultWindow(a,7);assert.equal(w.end,T('06:00'));assert.equal(E.dateKey(w.start),'2026-01-26');
});
test('spring DST day is 23 elapsed hours with nonexistent hour marked',()=>{
  const start=E.parseTime('2026-03-29'),end=E.parseTime('2026-03-30');assert.equal((end-start)/E.HOUR,23);
  const a=E.importData({schemaVersion:1,sources:[{id:'s',kind:'event-log'}],events:[{sourceId:'s',pointId:'p',timestamp:start,state:'on'},{sourceId:'s',pointId:'p',timestamp:end,state:'off'}]});
  const g=E.analyze(a,{start,end}).groups[0];const day=E.calendar(g,start,end)[0];assert.equal(g.onHours,23);assert.equal(day.hours[3].elapsedHours,0);assert.equal(day.onHours,23);
});
test('autumn DST day is 25 elapsed hours and repeated hour retained',()=>{
  const start=E.parseTime('2026-10-25'),end=E.parseTime('2026-10-26');assert.equal((end-start)/E.HOUR,25);
  const a=E.importData({schemaVersion:1,sources:[{id:'s',kind:'event-log'}],events:[{sourceId:'s',pointId:'p',timestamp:start,state:'on'},{sourceId:'s',pointId:'p',timestamp:end,state:'off'}]});
  const g=E.analyze(a,{start,end}).groups[0];const day=E.calendar(g,start,end)[0];assert.equal(g.onHours,25);assert.equal(day.hours[3].elapsedHours,2);assert.equal(day.hours[3].onHours,2);assert.equal(g.avgHoursPerDay,24);
});
test('ambiguous and nonexistent naive wall times rejected; offsets accepted',()=>{
  assert.throws(()=>E.parseTime('2026-10-25T03:30:00'),/Неоднозначний/);assert.throws(()=>E.parseTime('2026-03-29T03:30:00'),/Неоднозначний/);
  assert.equal(E.parseTime('2026-10-25T03:30:00+03:00')+E.HOUR,E.parseTime('2026-10-25T03:30:00+02:00'));
});
test('invalid date, reversed range, and invalid freshness rejected',()=>{
  assert.throws(()=>E.parseTime('2026-02-31'));
  assert.throws(()=>E.analyze(archive([['00:00','on']]),{start:T('05:00'),end:T('04:00')}));
  assert.throws(()=>E.importData({schemaVersion:1,sources:[{id:'s',kind:'observations',maxAgeSeconds:-1}],events:[]}));
});
test('schedules cannot create factual power intervals',()=>{
  const a=archive([['00:00','unknown'],['06:00','unknown']],'event-log',{schedules:[{state:'off',start:T('00:00'),end:T('06:00')}]});
  const g=result(a);assert.equal(g.offHours,0);assert.equal(g.unknownHours,6);
});
test('browser and CLI module produce identical statistics',()=>{
  const context=vm.createContext({Intl,Date});vm.runInContext(fs.readFileSync(path.join(__dirname,'../lib/electricity.js'),'utf8'),context);
  const a=archive([['00:00','on'],['02:00','off'],['05:00','on']]);
  const browser=context.LightStat.analyze(a,{start:T('00:00'),end:T('06:00')});const node=E.analyze(a,{start:T('00:00'),end:T('06:00')});
  assert.deepEqual(JSON.parse(JSON.stringify(browser.groups)),node.groups);
});
test('CLI writes same results, rejects invalid arguments and protects input',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'light-stat-test-'));
  try {
    const input=path.join(dir,'input.json'),output=path.join(dir,'out.json');
    fs.writeFileSync(input,JSON.stringify({id:1,messages:[{type:'message',date_unixtime:String(T('00:00')/1000),text:'✅ sg1 увімкнено'},{type:'message',date_unixtime:String(T('02:00')/1000),text:'🔴 sg1 вимкнено'}]}));
    const script=path.join(__dirname,'../analyze_electricity.js');
    const call=spawnSync(process.execPath,[script,input,'--days','7','--output',output],{encoding:'utf8'});assert.equal(call.status,0,call.stderr);
    const actual=JSON.parse(fs.readFileSync(output));const expected=E.analyze(E.importData(JSON.parse(fs.readFileSync(input))),{days:7});assert.deepEqual(actual.groups,expected.groups);
    assert.equal(spawnSync(process.execPath,[script,input,'--days','0']).status,1);
    assert.equal(spawnSync(process.execPath,[script,input,'--output',input]).status,1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('existing archive obeys conservation and has no impossible normalized averages',()=>{
  const file=path.join(__dirname,'../data/events.json');if (!fs.existsSync(file)) return;
  const a=E.importData(JSON.parse(fs.readFileSync(file,'utf8')));
  for (const days of [undefined,7,30]) {
    const r=E.analyze(a,{days});const duration=(Date.parse(r.dateRange.to)-Date.parse(r.dateRange.from))/E.HOUR;
    for (const g of r.groups) {conservation(g,duration);assert.ok(g.avgHoursPerDay<=24);assert.ok(g.intervals.every(i=>i.end>i.start));}
  }
});

test('ISO dates with explicit offset must still be valid calendar dates',()=>{
  assert.throws(()=>E.parseTime('2026-02-31T08:00:00+02:00'));
  assert.throws(()=>E.parseTime('2026-02-01T24:00:00Z'));
});
test('final observed off can count as a transition without inventing its duration',()=>{
  const g=result(archive([['00:00','on'],['02:00','off']]));assert.equal(g.outageCount,1);assert.equal(g.offHours,0);assert.equal(g.unknownHours,4);
});
test('separate anonymous Telegram files with same display name do not merge',()=>{
  const input={name:'Світло',messages:[{type:'message',date:'2026-02-01T08:00:00+02:00',text:'✅ sg1 увімкнено'}]};
  const a=E.importData(input,'a.json'),b=E.importData(input,'b.json');assert.notEqual(a.sources[0].id,b.sources[0].id);
});
