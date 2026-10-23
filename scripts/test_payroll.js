// Run with: node --test scripts/test_payroll.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const tax=require('../payroll-tax.js');
const table=require('../data/income-tax-2026.js');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

function context(){
  const ctx=vm.createContext({ShiftPayrollTax:tax,console});
  const defaults=html.match(/const SALARY_DEF=\{[\s\S]*?\n\};/)[0];
  vm.runInContext(defaults+`
    const today=new Date(2026,9,21);
    const pad2=n=>String(n).padStart(2,'0');
    let SAL={...SALARY_DEF};
    let CUSTOM_SALARY_ITEMS=[];
    let salOvr={};
    let ACTUAL_INSURANCE_HISTORY=[];
    const store={set(){}};
    const INSURANCE_DATA={
      health:[{from:'2026-01-01',employeeRate:3.595,totalRate:7.19,longTermCareIncomeRate:.9448}],
      nps:[{from:'2026-07-01',employeeRate:4.75,minIncome:410000,maxIncome:6590000}]
    };
    function salarySettingsForPayMonth_(){return {...SAL};}
    function calcHoursForMonth(){return {
      extend:0,weekly:8,weeklyExt:4,holiday:8,holidayExt:4,
      festBase:0,festExt:0,night:8,shiftOT:2,
      shiftApplicableDays:7,workDays:3,attendanceDays:3
    };}
    function calculateAnnualAllowanceForPayMonth_(){return {amount:0};}
    function retroPayForMonth_(){return 0;}
    function encouragementBonusForMonth_(){return 0;}
  `,ctx);
  for(const name of [
    'monthKey_','createCustomSalaryItemId_','normalizeCustomSalaryItems_',
    'customSalaryItemsForPayMonth_','roundMoneyByMode_',
    'calculateFixedBonusRaw_','calculateFixedBonus_','calculateFestivalBonus_',
    'festivalBonusForPayMonth_','calculateAutoHourly_',
    'getAppliedHourly_','wageAgreementHourlyPair_','autoUnion','roundPay','nextMonthYear_',
    'findRule','getActualInsuranceRule_','holidayAllowanceParts_','calcSalary','calcDeductions'
  ]){
    const expression=new RegExp('^function '+name+'\\([\\s\\S]*?^\\}','m');
    const match=html.match(expression);
    assert.ok(match,`missing function ${name}`);
    vm.runInContext(match[0],ctx);
  }
  return {run:code=>vm.runInContext(code,ctx)};
}

test('every inline script parses and all external scripts exist',()=>{
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
    new vm.Script(match[1]);
  }
  for(const match of html.matchAll(/<script[^>]+src="(\.[^"]+)"/gi)){
    assert.ok(fs.existsSync(path.join(root,match[1])));
  }
});

test('official tax brackets are contiguous, complete and monotone',()=>{
  assert.equal(table.rows.length,646);
  assert.equal(table.rows[0][0],770);
  assert.equal(table.rows.at(-1)[1],10000);
  table.rows.forEach((row,index)=>{
    assert.equal(row.length,13);
    if(index){assert.equal(table.rows[index-1][1],row[0]);}
    for(let family=1;family<=11;family++){
      const expected=row[family+1];
      assert.equal(tax.calculate(row[0]*1000,{familyCount:family}),expected);
      assert.equal(tax.calculate(row[1]*1000-1,{familyCount:family}),expected);
      if(index){assert.ok(expected>=table.rows[index-1][family+1]);}
    }
  });
});

test('tax table handles children, 80/100/120%, and zero tax',()=>{
  assert.equal(tax.calculate(3500000,{familyCount:4,childCount:2}),3510);
  assert.equal(tax.calculate(3500000,{familyCount:4,childCount:2,withholdingPercent:80}),2800);
  assert.equal(tax.calculate(3500000,{familyCount:4,childCount:2,withholdingPercent:120}),4210);
  assert.equal(tax.calculate(1000000,{familyCount:4,childCount:2}),0);
  assert.equal(tax.calculate(-1),0);
});

test('ten-million boundary and every high-income formula',()=>{
  const cases=[
    [10000000,1507400],[10000001,1532400],[14000000,2904400],
    [14000001,2904400],[28000000,8118000],[28000001,8118000],
    [30000000,8902000],[30000001,8902000],[45000000,14902000],
    [45000001,14902000],[87000000,32542000],[87000001,32542000],
    [90000000,33892000]
  ];
  for(const [income,expected] of cases){assert.equal(tax.calculate(income),expected);}
  assert.equal(tax.calculate(10000000,{familyCount:12}),930840);
  assert.equal(tax.calculate(14000000,{familyCount:50}),1187840);
});

test('prepaid items affect taxable pay only when selected and are never paid twice',()=>{
  const c=context();
  c.run('Object.assign(SAL,{base1:4000000,meal:180000,pensionSup:80000,hourlyMode:"manual",manualHourly:20000});');
  const salary=c.run('calcSalary(2026,9)');
  assert.equal(salary.totalExtra,260000);
  assert.equal(salary.totalA,Object.values(salary.pay).reduce((a,b)=>a+b,0));
  assert.equal(salary.taxablePay,salary.totalA+80000);
  assert.equal(c.run('SAL.taxablePensionSup=false;calcSalary(2026,9).taxablePay'),salary.totalA);
  assert.equal(c.run('SAL.taxableMeal=true;SAL.nonTaxablePay=50000;calcSalary(2026,9).taxablePay'),salary.totalA+130000);
});

test('one-time and recurring items use pay month, including year rollover and ordinary wage',()=>{
  const c=context();
  c.run(`CUSTOM_SALARY_ITEMS=[
    {name:'legacy',amount:17900,includeOrdinary:true},
    {name:'once',amount:35800,includeOrdinary:true,fromMonth:'2027-01',recurring:false},
    {name:'repeat',amount:53700,includeOrdinary:true,fromMonth:'2027-01',recurring:true}
  ];normalizeCustomSalaryItems_();`);
  const before=c.run('calcSalary(2026,11)');
  const selected=c.run('calcSalary(2026,12)');
  const after=c.run('calcSalary(2027,1)');
  assert.equal(before.pay.legacy,17900);
  assert.equal(before.pay.once,undefined);
  assert.equal(before.pay.repeat,undefined);
  assert.equal(selected.pay.once,35800);
  assert.equal(selected.autoHr,600);
  assert.equal(after.pay.once,undefined);
  assert.equal(after.pay.repeat,53700);
  assert.equal(after.autoHr,400);
  assert.equal(c.run('CUSTOM_SALARY_ITEMS[0].recurring'),true);
  c.run(`var agreement={paymentMonth:'2027-01',before:{base1:179000,base3:0},
    after:{base1:196900,base3:0},salarySnapshotBefore:{...SAL},salarySnapshotAfter:{...SAL}};`);
  assert.equal(c.run('wageAgreementHourlyPair_(agreement).before'),2100);
  assert.equal(c.run('agreement.paymentMonth="2027-02";wageAgreementHourlyPair_(agreement).before'),1900);
});

test('monthly actual payments, including zero, change tax and net only in their month',()=>{
  const c=context();
  c.run('Object.assign(SAL,{base1:4000000,hourlyMode:"manual",manualHourly:20000});');
  const before=c.run('calcSalary(2026,9)');
  c.run('salOvr["2026-10"]={pay:{"휴일수당":123456,"교대조수당":0}};');
  const changed=c.run('calcSalary(2026,9)');
  assert.equal(changed.autoPay['휴일수당'],before.pay['휴일수당']);
  assert.equal(changed.pay['휴일수당'],123456);
  assert.equal(changed.pay['교대조수당'],0);
  assert.equal(changed.totalA,before.totalA-before.pay['휴일수당']-before.pay['교대조수당']+123456);
  assert.equal(changed.taxablePay,changed.totalA);
  assert.equal(c.run('calcSalary(2026,10).totalA'),before.totalA);
});

test('festival bonus pay and taxable treatment are independent, opt-in and monthly',()=>{
  const c=context();
  c.run('Object.assign(SAL,{base1:4000000,base3:100000,hourlyMode:"manual",manualHourly:20000});');
  const before=c.run('calcSalary(2026,11)');
  assert.equal(before.pay['설추석상여'],undefined);
  for(const includeInPay of [false,true]){
    for(const includeInTax of [false,true]){
      c.run(`salOvr['2026-12']={festivalBonus:{includeInPay:${includeInPay},includeInTax:${includeInTax},amount:250000}};`);
      const result=c.run('calcSalary(2026,11)');
      assert.equal(result.totalA,before.totalA+(includeInPay?250000:0));
      assert.equal(result.taxablePay,before.taxablePay+(includeInTax?250000:0));
      assert.equal(c.run('calcSalary(2026,12).totalA'),before.totalA);
    }
  }
  c.run(`salOvr['2026-12']={festivalBonus:{includeInPay:true,includeInTax:true}};`);
  assert.equal(c.run('calcSalary(2026,11).pay["설추석상여"]'),4100000);
  c.run(`salOvr['2026-12'].pay={'설추석상여':150000};`);
  assert.equal(c.run('calcSalary(2026,11).taxablePay'),before.taxablePay+150000);
  c.run(`salOvr['2026-12'].festivalBonus.includeInTax=false;`);
  assert.equal(c.run('calcSalary(2026,11).taxablePay'),before.taxablePay);
  c.run(`salOvr['2026-12'].pay['설추석상여']=0;`);
  assert.equal(c.run('calcSalary(2026,11).totalA'),before.totalA);
});

test('deduction priorities, combined health, 10-won truncation and net remainder',()=>{
  const c=context();
  c.run(`Object.assign(SAL,{prevAnnual:100000000,base1:4000000,unionRate:1.234,netRoundingUnit:1000});
    ACTUAL_INSURANCE_HISTORY=[{from:'2026-01',healthOnly:220000,longTermCare:28000,nps:300000,healthIncludesCare:true}];`);
  const d=c.run('calcDeductions(6123456,2026,10,6200000)');
  assert.equal(d.ded['건강보험료(장기요양 포함)'],220000);
  assert.equal(d.ded['노인장기요양보험'],0);
  assert.equal(d.autoNpsVal,313020);
  assert.equal(d.ded['국민연금'],300000);
  assert.equal(d.ded['고용보험'],55800);
  assert.equal(d.ded['지방소득세'],tax.floor10(d.ded['소득세']*.1));
  assert.equal(d.ded['노조비'],49360);
  assert.equal(d.netPay%1000,0);
  c.run('salOvr["2026-10"]={nps:0,incomeTax:123450,union:17,smallChange:426,healthIncludesCare:false,longTermCare:100};');
  const actual=c.run('calcDeductions(6123456,2026,10,6200000)');
  assert.equal(actual.ded['국민연금'],0);
  assert.equal(actual.ded['소득세'],123450);
  assert.equal(actual.ded['지방소득세'],12340);
  assert.equal(actual.ded['노인장기요양보험'],100);
  assert.equal(actual.ded['노조비'],17);
  assert.equal(actual.ded['우수리'],426);
  assert.equal(actual.netPay,6123456-actual.totalDed);
});

test('main salary save persists combined health so reopening cannot restore double care',()=>{
  const c=context();
  c.run(`
    const savedValues={};
    store.set=(key,value)=>savedValues[key]=JSON.parse(JSON.stringify(value));
    let actualInsuranceFormSnapshot_='before edit';
    const inputs={
      'sal-insuranceFrom':{value:'2026-09'},
      'sal-healthOnlyActual':{value:'220000'},
      'sal-longTermCareActual':{value:'28000',disabled:true},
      'sal-npsActual':{value:'300000'},
      'sal-healthIncludesCare':{checked:true}
    };
    Object.values(inputs).forEach(input=>input.checkValidity=()=>true);
    const document={getElementById:id=>inputs[id]};
    const salaryInputChecked_=id=>inputs[id]?.checked===true;
    const alerts=[];const alert=text=>alerts.push(text);
    const renderActualInsuranceHistoryList_=()=>{};
    const renderCurrent=()=>{};
    const renderSalaryFields=()=>{};
    const readSalaryForm_=()=>{SAL.taxFamilyCount=4;};
    const saveSalaryBtn={};
  `);
  for(const name of ['readActualInsuranceForm_','normalizeActualInsuranceHistory_','saveActualInsuranceRule_']){
    c.run(html.match(new RegExp('^function '+name+'\\([\\s\\S]*?^\\}','m'))[0]);
  }
  c.run(html.match(/^saveSalaryBtn\.onclick=\(\)=>\{[\s\S]*?^\};/m)[0]);
  c.run('saveSalaryBtn.onclick();');
  assert.equal(c.run('savedValues.actualInsuranceHistory[0].healthIncludesCare'),true);
  assert.equal(c.run('savedValues.salarySettings.taxFamilyCount'),4);
  c.run('ACTUAL_INSURANCE_HISTORY=JSON.parse(JSON.stringify(savedValues.actualInsuranceHistory));');
  assert.equal(c.run('calcDeductions(6000000,2026,10).ded["노인장기요양보험"]'),0);
  assert.equal(c.run('calcDeductions(6000000,2026,10).ded["건강보험료(장기요양 포함)"]'),220000);
  assert.equal(c.run('alerts.length'),1);
  c.run(`inputs['sal-insuranceFrom'].value='';saveSalaryBtn.onclick();`);
  assert.equal(c.run('savedValues.actualInsuranceHistory.length'),1);
  assert.equal(c.run('savedValues.actualInsuranceHistory[0].healthIncludesCare'),true);
});

test('rate mode uses the selected taxable amount and still honors monthly actual tax',()=>{
  const c=context();
  c.run('Object.assign(SAL,{incomeTaxMode:"rate",incomeTaxRate:10});');
  assert.equal(c.run('calcDeductions(6000000,2026,10,6100000).ded["소득세"]'),610000);
  c.run('salOvr["2026-10"]={incomeTax:0,localTax:0};');
  assert.equal(c.run('calcDeductions(6000000,2026,10,6100000).ded["소득세"]'),0);
});

test('tax assets are required offline resources',()=>{
  const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
  assert.ok(sw.includes("'./data/income-tax-2026.js'"));
  assert.ok(sw.includes("'./payroll-tax.js'"));
});

test('festival premiums include regular day/night shifts and preserve attendance hours',()=>{
  const ctx=vm.createContext({});
  vm.runInContext(`
    let displayCode='주',scheduledCode='주',major=true,holiday=true;
    const toPayCode=code=>code;
    const getMyDisplayShift=()=>displayCode;
    const getScheduledShift_=()=>scheduledCode;
    const isMajorDay=()=>major;
    const isPayHoliday=()=>holiday;
    const getCallWork=()=>({start:'17:00',end:'19:00'});
    const calculateCallWorkHours_=()=>({total:2,night:1});
  `,ctx);
  for(const name of ['createDailyHoursBucket_','addOffDayOtHours_',
    'addRegularShiftHours_','addDayWorkHours_','isDayWorkCode_','calculateHoursForDate_']){
    vm.runInContext(html.match(new RegExp('^function '+name+'\\([\\s\\S]*?^\\}','m'))[0],ctx);
  }
  const daily=code=>vm.runInContext(`displayCode=${JSON.stringify(code)};calculateHoursForDate_(new Date(2030,0,1))`,ctx);
  for(const code of ['주','야','주+반OT','야+반OT','호출']){
    const h=daily(code);
    assert.equal(h.festBase,8,code);
    assert.equal(h.festExt,4,code);
    assert.equal(h.holiday+h.holidayExt,0,code);
    assert.equal(h.normal,12,code);
    assert.equal(h.workDays,1,code);
    assert.equal(h.attendanceDays,1,code);
  }
  assert.equal(daily('야').night,8);
  assert.equal(daily('주+반OT').extend,4);
  assert.equal(daily('주+반OT').night,1);
  assert.equal(daily('야+반OT').night,8);
  assert.equal(daily('호출').extend,2);
  for(const code of ['주간반차','야간반차']){
    const h=daily(code);
    assert.equal(h.festBase,8);
    assert.equal(h.festExt,0);
    assert.equal(h.holiday,0);
    assert.equal(h.annualUsedUnits,.5);
  }
  const off=daily('주OT');
  assert.equal(off.festBase,8);
  assert.equal(off.festExt,4);
  vm.runInContext('major=false',ctx);
  const ordinaryHoliday=daily('주');
  assert.equal(ordinaryHoliday.holiday,8);
  assert.equal(ordinaryHoliday.holidayExt,4);
  assert.equal(ordinaryHoliday.festBase+ordinaryHoliday.festExt,0);
  vm.runInContext('holiday=false',ctx);
  const ordinaryDay=daily('주');
  assert.equal(ordinaryDay.holiday+ordinaryDay.holidayExt+ordinaryDay.festBase+ordinaryDay.festExt,0);
  assert.equal(ordinaryDay.normal,12);
});

function dayWorkContext(){
  const c=context();
  c.run(`
    const records=new Map();
    store.get=(key,fallback)=>records.has(key)?records.get(key):fallback;
    store.set=(key,value)=>records.set(key,JSON.parse(JSON.stringify(value)));
    store.remove=key=>records.delete(key);
    const dateKey=d=>d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
    let shifts={};
    const getMyDisplayShift=d=>shifts[dateKey(d)]||'휴';
    const getScheduledShift_=()=> '일근08~17';
    const toPayCode=code=>code;
    const isMajorDay=()=>false;
    const isPayHoliday=()=>false;
    const isInDayWorkPeriod_=()=>true;
    const getCallWork=()=>null;
    Object.assign(SAL,{hourlyMode:'manual',manualHourly:20000,shiftOtMode:'manual',shiftH:0});
  `);
  for(const name of ['isDayWorkCode_','getDayWorkOt_','setDayWorkOt_',
    'timeToMinutes_','overlapMinutes_','calculateCallWorkHours_',
    'calculateDayWorkOt_','dayWorkOtForDate_','createDailyHoursBucket_',
    'addDayWorkHours_','calculateHoursForDate_','calcHoursForMonth',
    'countShiftApplicableDays_','calculateShiftOtHours_','weeklyWorkHoursForDate_']){
    const match=html.match(new RegExp('^function '+name+'\\([\\s\\S]*?^\\}','m'));
    assert.ok(match,`missing ${name}`);
    c.run(match[0]);
  }
  return c;
}

test('day work keeps 08-17 as the default and adds only selected morning and evening OT',()=>{
  const c=dayWorkContext();
  c.run(`const date=new Date(2026,8,15);shifts[dateKey(date)]='일근08~17';`);
  for(const [code,end,extended,weekly,pay] of [
    ['일근08~17','17:00',0,8,0],
    ['일근07~17','17:00',1,9,30000],
    ['일근+1 OT','17:00',1,9,30000],
    ['일근08~17','18:00',1,9,30000],
    ['일근08~17','19:00',2,10,60000],
    ['일근07~17','18:00',2,10,60000],
    ['일근07~17','19:00',3,11,90000]
  ]){
    c.run(`shifts[dateKey(date)]=${JSON.stringify(code)};setDayWorkOt_(date,${JSON.stringify(end)});`);
    const h=c.run('calculateHoursForDate_(date)');
    assert.equal(h.normal,8,code+end);
    assert.equal(h.extend,extended,code+end);
    assert.equal(h.night,0);
    assert.equal(c.run('weeklyWorkHoursForDate_(date)'),weekly);
    assert.equal(c.run('calcSalary(2026,9).pay["연장수당"]'),pay);
    assert.equal(c.run('calcHoursForMonth(2026,9).extend'),extended);
  }
});

test('evening OT counts 22-06 night premiums and belongs to its starting attendance month',()=>{
  const c=dayWorkContext();
  c.run(`const date=new Date(2026,8,30);shifts[dateKey(date)]='일근07~17';setDayWorkOt_(date,'02:00');`);
  const h=c.run('calculateHoursForDate_(date)');
  assert.equal(h.normal,8);
  assert.equal(h.extend,10);
  assert.equal(h.night,4);
  assert.equal(c.run('weeklyWorkHoursForDate_(date)'),18);
  const pay=c.run('calcSalary(2026,9).pay');
  assert.equal(pay['연장수당'],300000);
  assert.equal(pay['심야수당'],40000);
  assert.equal(c.run('calcSalary(2026,10).pay["연장수당"]'),0);
  assert.equal(c.run('calculateDayWorkOt_("일근08~17","00:00").night'),2);
  assert.equal(c.run('calculateDayWorkOt_("일근08~17","19:30").after'),2.5);
  assert.equal(c.run('calculateDayWorkOt_("일근08~17","17:00").after'),0);
  for(const end of ['16:00','08:00','24:00','bad']){
    assert.equal(c.run(`calculateDayWorkOt_('일근08~17',${JSON.stringify(end)})`),null);
  }
  c.run(`shifts[dateKey(date)]='휴';`);
  assert.equal(c.run('calculateHoursForDate_(date).extend'),0);
  c.run(`setDayWorkOt_(date,'17:00');`);
  assert.equal(c.run('records.has("dayworkot-2026-09-30")'),false);
});

test('new and existing day-work periods still schedule 08-17 without automatic morning OT',()=>{
  const ctx=vm.createContext({});
  vm.runInContext(`
    const getWorkPeriodForDate_=()=>({start:'2026-09-01',end:'2026-09-30'});
    const isShiftReturnedOnEndDate_=()=>false;
    const isPayHoliday=()=>false;
    const getBaseShiftForDate_=()=> '주간';
  `,ctx);
  vm.runInContext(html.match(/^function getScheduledShift_\([\s\S]*?^\}/m)[0],ctx);
  assert.equal(vm.runInContext('getScheduledShift_(new Date(2026,8,15))',ctx),'일근08~17');
  assert.equal(vm.runInContext('getScheduledShift_(new Date(2026,8,19))',ctx),'휴무');
});

test('ordinary hourly wage uses the selected payable amounts before per-item hourly rounding',()=>{
  const c=context();
  c.run(`Object.assign(SAL,{base1:100101,base3:20101,license:0,meal:0,
    fixedBonusMode:'auto',fixedBonusRate:50,hourlyMode:'auto',roundingMode:'ceil100'});`);
  const salary=c.run('calcSalary(2026,9)');
  assert.equal(salary.pay['기본급1'],100200);
  assert.equal(salary.pay['기본급3'],20200);
  assert.equal(salary.pay['고정상여'],60200);
  assert.equal(salary.autoHr,560+113+336);
  c.run(`SAL.roundingMode='round100';`);
  assert.equal(c.run('calcSalary(2026,9).pay["기본급1"]'),100100);
  assert.equal(c.run('calcSalary(2026,9).autoHr'),559+112+336);
  c.run(`SAL.hourlyMode='manual';SAL.manualHourly=1234;`);
  assert.equal(c.run('calcSalary(2026,9).hr'),1234);
});

test('holiday and festival breakdown preserves a single rounding of each combined payment',()=>{
  const c=context();
  c.run(`Object.assign(SAL,{hourlyMode:'manual',manualHourly:101,roundingMode:'ceil100'});
    calcHoursForMonth=()=>({extend:0,weekly:0,weeklyExt:0,holiday:1,holidayExt:1,festBase:1,festExt:1,night:0,shiftOT:0});`);
  c.run(html.match(/^function allowancePayFromHours_\([\s\S]*?^\}/m)[0]);
  const pay=c.run('calcSalary(2026,9).pay');
  assert.equal(pay['휴일수당'],200);
  assert.equal(pay['휴일수당']+pay['명절기본수당'],400);
  assert.equal(pay['휴일연장수당']+pay['명절연장수당'],500);
  const retro=c.run('allowancePayFromHours_(calcHoursForMonth(),SAL)');
  assert.equal(retro.holiday+retro.festivalBase,400);
  assert.equal(retro.holidayExtension+retro.festivalExtension,500);
});

test('retroactive basic pay uses the same payable rounding as regular monthly payroll',()=>{
  const c=context();
  c.run(`
    const monthIndex_=key=>{const [y,m]=key.split('-').map(Number);return y*12+m-1;};
    const monthPartsFromIndex_=index=>({year:Math.floor(index/12),month:index%12+1,key:'2026-09'});
    const previousPayWorkMonth_=()=>({year:2026,month:8});
    const festivalBonusRetroForPayMonth_=()=>({difference:0,items:[]});
    const settings={...SAL,hourlyMode:'auto',includeBase1:false,includeBase3:false,
      includeFixedBonus:false,fixedBonusMode:'manual',fixedBonusManual:0,roundingMode:'ceil100'};
    const record={paymentMonth:'2026-10',retroStartMonth:'2026-09',
      before:{base1:100001,base3:20101},after:{base1:100151,base3:20101},
      salarySnapshotBefore:settings,salarySnapshotAfter:settings};
  `);
  for(const name of ['allowancePayFromHours_','calculateWageAgreementRetro_']){
    c.run(html.match(new RegExp('^function '+name+'\\([\\s\\S]*?^\\}','m'))[0]);
  }
  const retro=c.run('calculateWageAgreementRetro_(record)');
  assert.equal(retro.monthCount,1);
  assert.equal(retro.baseDifference,100);
  assert.equal(retro.total,100);
});
