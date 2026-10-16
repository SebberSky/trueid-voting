import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./client.js',import.meta.url),'utf8');
const start=source.indexOf('function rankingPreview('),end=source.indexOf('function renderRankings(',start);
const scope=vm.createContext({});vm.runInContext(source.slice(start,end),scope);
const results=Array.from({length:48},(_,i)=>({id:'person-'+i,rank:i<2?1:i+1,votes:48-i}));
const original=JSON.stringify(results);
const collapsed=scope.rankingPreview(results,false),expanded=scope.rankingPreview(results,true);
assert.deepEqual(Array.from(collapsed.rows,r=>r.id),results.slice(0,5).map(r=>r.id));
assert.equal(collapsed.hasMore,true);assert.equal(expanded.rows.length,48);
assert.equal(JSON.stringify(results),original);assert.notEqual(expanded.rows,results);
for(const size of [0,1,5]){const view=scope.rankingPreview(results.slice(0,size),false);assert.equal(view.rows.length,size);assert.equal(view.hasMore,false);}
assert.equal(scope.rankingPreview(results.slice(0,6),false).hasMore,true);
assert.deepEqual(Array.from(collapsed.rows,r=>r.rank),[1,1,3,4,5]);
console.log('PASS: first five rows, full expansion, short/empty lists, unchanged tie ranks, scores and source data.');
