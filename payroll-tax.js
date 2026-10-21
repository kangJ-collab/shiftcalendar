/* 소득세법 시행령 별표 2, 2026. 2. 27. 개정표를 사용하는 월 원천징수 예상액. */
(function(root){
  'use strict';
  const table=typeof module==='object'&&module.exports
    ?require('./data/income-tax-2026.js')
    :root.ShiftIncomeTaxTable;

  function floor10(value){
    return Math.floor((Math.max(0,Number(value)||0)+1e-7)/10)*10;
  }

  function familyTax(taxes,count){
    const family=Math.max(1,Math.floor(Number(count)||1));
    return family<=11
      ?taxes[family-1]
      :taxes[10]-(taxes[9]-taxes[10])*(family-11);
  }

  function calculate(monthlyTaxablePay,options={}){
    if(!table){throw new Error('간이세액표를 불러오지 못했습니다. 새로고침해 주세요.');}
    const income=Math.max(0,Number(monthlyTaxablePay)||0);
    const family=Math.max(1,Math.floor(Number(options.familyCount)||1));
    const children=Math.min(family-1,Math.max(0,Math.floor(Number(options.childCount)||0)));
    const percent=[80,100,120].includes(Number(options.withholdingPercent))
      ?Number(options.withholdingPercent):100;
    let tax=0;

    if(income>=10000000){
      tax=familyTax(table.atTenMillion,family);
      if(income>87000000){tax+=31034600+(income-87000000)*.45;}
      else if(income>45000000){tax+=13394600+(income-45000000)*.42;}
      else if(income>30000000){tax+=7394600+(income-30000000)*.40;}
      else if(income>28000000){tax+=6610600+(income-28000000)*.98*.40;}
      else if(income>14000000){tax+=1397000+(income-14000000)*.98*.38;}
      else if(income>10000000){tax+=25000+(income-10000000)*.98*.35;}
    }else{
      const bracket=table.rows.find(row=>income>=row[0]*1000&&income<row[1]*1000);
      if(bracket){tax=familyTax(bracket.slice(2),family);}
    }

    const childCredit=children===0?0:children===1?20830:45830+(children-2)*33330;
    return floor10(Math.max(0,tax-childCredit)*percent/100);
  }

  const api={calculate,floor10,version:table&&table.version};
  if(typeof module==='object'&&module.exports){module.exports=api;}
  else{root.ShiftPayrollTax=api;}
})(globalThis);
