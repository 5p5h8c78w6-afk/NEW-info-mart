/* Infomart six-column screenshot reader. Pixel geometry precedes all OCR. */
(function(scope){
  'use strict';
  const fields=['code','name','specification','vendorDisplay'];
  function clusters(values,gap=1){const out=[];for(const n of values){const a=out[out.length-1];if(a&&n-a[a.length-1]<=gap)a.push(n);else out.push([n])}return out;}
  function detect(image){
    const {width:w,height:h,data:d}=image;
    const green=(x,y)=>{const i=(y*w+x)*4;return d[i]>170&&d[i]<245&&d[i+1]>235&&d[i+2]>140&&d[i+2]<225&&d[i+1]-d[i]>12&&d[i]-d[i+2]>10};
    const gray=(x,y)=>{const i=(y*w+x)*4;return d[i]>=155&&d[i]<=225&&Math.abs(d[i]-d[i+1])<6&&Math.abs(d[i]-d[i+2])<6};
    const bands=[];
    for(let y=1;y<h-1;y++){let start=-1;for(let x=0;x<=w;x++){if(x<w&&green(x,y)){if(start<0)start=x;}else if(start>=0){if(x-start>=35)bands.push({y,left:start,right:x});start=-1}}}
    // A quantity column is a repeated pale green rectangular cell, not a numeric guess.
    const groups=new Map();for(const b of bands){const key=Math.round(b.left/4)+':'+Math.round(b.right/4);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b)}
    const candidates=[...groups.values()].filter(g=>g.length>=8).sort((a,b)=>b.length*(b[0].right-b[0].left)-a.length*(a[0].right-a[0].left));
    const rows=[],seen=new Set();
    for(const group of candidates){
      const ql=group[0].left-1,qr=group[0].right;
      const greenYs=[];for(let y=0;y<h;y++)if(green(ql+2,y)&&green(qr-2,y))greenYs.push(y);const ys=clusters(greenYs,2);
      for(const yy of ys){
        let top=yy[0]-1,bottom=yy[yy.length-1]+1;
        const line=y=>{let n=0;for(let x=ql+2;x<qr-2;x++)if(gray(x,y))n++;return n/(qr-ql-4)>.92};
        for(let k=0;k<8&&top>0&&!line(top);k++)top--;
        for(let k=0;k<8&&bottom<h-1&&!line(bottom);k++)bottom++;
        if(!line(top)||!line(bottom)||bottom-top<24||bottom-top>(qr-ql)*2)continue;
        const verts=[];
        for(let x=0;x<w;x++){let n=0;for(let y=top+2;y<bottom-2;y++)if(gray(x,y))n++;if(n/(bottom-top-4)>.94)verts.push(x)}
        const edges=clusters(verts,2).map(g=>Math.round((g[0]+g[g.length-1])/2));
        const qi=edges.findIndex(x=>Math.abs(x-ql)<=3);
        if(qi<4||qi+2>=edges.length||Math.abs(edges[qi+1]-qr)>3)continue;
        const xs=edges.slice(qi-4,qi+3),cw=xs.slice(1).map((x,i)=>x-xs[i]),unit=cw[4];
        // Observed six-cell contract: code, name, specification, price, quantity, supplier.
        if(!(cw[0]/unit>.42&&cw[0]/unit<.85&&cw[1]/unit>1.3&&cw[1]/unit<2.3&&cw[2]/unit>.6&&cw[2]/unit<1.2&&cw[3]/unit>.35&&cw[3]/unit<.85&&cw[5]/unit>1&&cw[5]/unit<1.9))continue;
        let border=true;for(let i=0;i<6;i++){for(const y of [top,bottom]){let count=0;for(let x=xs[i]+2;x<xs[i+1]-2;x++)if(gray(x,y))count++;if(count/(cw[i]-4)<.90)border=false}}
        if(!border)continue;
        const key=top+':'+xs[0];if(seen.has(key))continue;seen.add(key);
        rows.push({x:xs[0],y:top,width:xs[6]-xs[0]+1,height:bottom-top+1,cells:[0,1,2,5].map(i=>({x:xs[i]+3,y:top+3,width:cw[i]-6,height:bottom-top-6})),contract:'six-cells-green-quantity/v1'});
      }
    }
    return rows.sort((a,b)=>a.y-b.y);
  }
  function codeResult(first,second){
    const a=String(first.text??'').trim(),b=String(second.text??'').trim();
    return {text:a,confidence:Math.min(Number(first.confidence)||0,Number(second.confidence)||0),valid:/^\d{7,13}$/.test(a)&&a===b,reason:!/^\d{7,13}$/.test(a)?'数字7〜13桁以外・空欄':a!==b?'2回の読取結果が不一致':''};
  }
  function classify(items,existing=[]){
    const counts=new Map();items.forEach(x=>counts.set(x.code,(counts.get(x.code)||0)+1));
    return items.map(x=>{
      if(!/^\d{7,13}$/.test(x.code)||!x.codeValid)return 'FAIL-CLOSED：商品コード不明・不一致';
      const peers=items.filter(p=>p.code===x.code);
      if(counts.get(x.code)>1&&peers.some(p=>fields.some(k=>p[k]!==x[k])))return 'FAIL-CLOSED：同一コードの表示が不一致';
      if(existing.includes(x.code)||peers[0]!==x)return '重複スキップ';
      return '要確認：元画像と各項目を照合してください';
    });
  }
  function crop(source,box,scale=1){const c=document.createElement('canvas');c.width=Math.round(box.width*scale);c.height=Math.round(box.height*scale);c.getContext('2d').drawImage(source,box.x,box.y,box.width,box.height,0,0,c.width,c.height);return c;}
  scope.InfomartTableOCR={detect,codeResult,classify,crop,fields};
  if(typeof module!=='undefined')module.exports=scope.InfomartTableOCR;
})(typeof window==='undefined'?globalThis:window);

