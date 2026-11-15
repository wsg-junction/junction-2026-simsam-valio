// Run from the repository root after updating data/products.json or the translated shared dataset.
const fs=require('fs');
const raw=JSON.parse(fs.readFileSync('data/products.json')).products, shared=JSON.parse(fs.readFileSync('packages/shared/data/products.json'));const byid=new Map(shared.map(p=>[p.id,p]));
const rows=raw.map(p=>{const s=byid.get(p.id);return {id:p.code,name:s?.names?.find(n=>n.language==='en')?.value??p.name,names:s?.names?.map(n=>n.value)??[],image:s?.image,category:p.categories.filter(c=>/^\d+$/.test(c.code)&&c.code!=='0').sort((a,b)=>a.code.length-b.code.length).map(c=>c.name).join(' / '),supplier:p.vendor.name,price:p.price.value,origin:p.countriesOfOrigin?.[0]?.name??'Unknown',unit:p.unit.name}});
fs.writeFileSync('apps/mcp/src/catalog-data.json',JSON.stringify(rows));
