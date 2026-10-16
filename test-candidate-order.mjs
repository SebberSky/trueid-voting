import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./client.js',import.meta.url),'utf8');
const start=source.indexOf('function candidateOptionsFor('),end=source.indexOf('function renderCandidateOptions(',start);
const scope=vm.createContext({});vm.runInContext(source.slice(start,end),scope);
const candidates=[
  {id:'ch',name:'Chawapon'},{id:'z',name:'Zossawat'},{id:'a',name:'Aekkawin'},
  {id:'b1',name:'bob'},{id:'b2',name:'Bob'},{id:'self',name:'Aaron',isSelf:true}
];
const original=JSON.stringify(candidates);
const sorted=scope.candidateOptionsFor(candidates);
assert.deepEqual(Array.from(sorted,c=>c.name),['Aekkawin','bob','Bob','Chawapon','Zossawat']);
assert.deepEqual(Array.from(sorted,c=>c.id),['a','b1','b2','ch','z']);
assert.equal(JSON.stringify(candidates),original,'Original activity snapshot is unchanged');
assert.deepEqual(Array.from(scope.candidateOptionsFor(candidates,' BO '),c=>c.id),['b1','b2']);
const thai=scope.candidateOptionsFor([{id:'j',name:'จิรา'},{id:'k',name:'กานต์'},{id:'kh',name:'ขวัญ'}]);
assert.deepEqual(Array.from(thai,c=>c.name),['กานต์','ขวัญ','จิรา']);
assert.equal(scope.candidateOptionsFor(candidates,'not found').length,0);
console.log('PASS: alphabetical English/Thai order, case-insensitive search, stable duplicate identities, self exclusion and immutable original candidates.');
