/* Infomart six-column screenshot reader. Pixel geometry precedes all OCR.
   v1.5.2: field-specific image preprocessing + multi-pass consensus confidence. */
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
        if(!(cw[0]/unit>.42&&cw[0]/unit<.85&&cw[1]/unit>1.3&&cw[1]/unit<2.3&&cw[2]/unit>.6&&cw[2]/unit<1.2&&cw[3]/unit>.35&&cw[3]/unit<.85&&cw[5]/unit>1&&cw[5]/unit<1.9))continue;
        let border=true;for(let i=0;i<6;i++){for(const y of [top,bottom]){let count=0;for(let x=xs[i]+2;x<xs[i+1]-2;x++)if(gray(x,y))count++;if(count/(cw[i]-4)<.90)border=false}}
        if(!border)continue;
        const key=top+':'+xs[0];if(seen.has(key))continue;seen.add(key);
        rows.push({x:xs[0],y:top,width:xs[6]-xs[0]+1,height:bottom-top+1,cells:[0,1,2,5].map(i=>({x:xs[i]+3,y:top+3,width:cw[i]-6,height:bottom-top-6})),contract:'six-cells-green-quantity/v2'});
      }
    }
    return rows.sort((a,b)=>a.y-b.y);
  }
  function crop(source,box,scale=1){
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(box.width*scale));c.height=Math.max(1,Math.round(box.height*scale));
    const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,box.x,box.y,box.width,box.height,0,0,c.width,c.height);return c;
  }
  function otsu(gray){
    const hist=new Uint32Array(256);for(const g of gray)hist[g]++;
    let total=gray.length,sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
    let sumB=0,wB=0,best=160,max=-1;
    for(let t=0;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=t*hist[t];const mB=sumB/wB,mF=(sum-sumB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>max){max=v;best=t}}
    return best;
  }
  function thicken(data,w,h){
    const src=new Uint8ClampedArray(data);const black=(x,y)=>src[(y*w+x)*4]<40;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(black(x,y)){
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=((y+dy)*w+(x+dx))*4;data[i]=data[i+1]=data[i+2]=0;data[i+3]=255}
    }
  }
  function preprocess(source,box,def={}){
    const scale=def.scale||4,mode=def.mode||'gray',c=crop(source,box,scale),ctx=c.getContext('2d'),im=ctx.getImageData(0,0,c.width,c.height),d=im.data;
    if(mode==='original')return c;
    if(mode==='blue'){
      for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];const blue=(b-r>34&&b-g>18&&g-r>12&&b>75&&r<185);const v=blue?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255}
      thicken(d,c.width,c.height);ctx.putImageData(im,0,0);return c;
    }
    const gray=new Uint8Array(c.width*c.height);for(let p=0,i=0;i<d.length;i+=4,p++)gray[p]=Math.max(0,Math.min(255,Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2])));
    let t=otsu(gray);if(mode==='contrast')t=Math.min(220,Math.max(120,t+18));else t=Math.min(205,Math.max(105,t));
    for(let p=0,i=0;i<d.length;i+=4,p++){const v=gray[p]<t?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255}
    if(def.thicken!==false)thicken(d,c.width,c.height);ctx.putImageData(im,0,0);return c;
  }
  function variants(field){
    if(field==='code')return [
      {mode:'gray',scale:5,psm:'7',label:'数字強調A'},
      {mode:'contrast',scale:5,psm:'7',label:'数字強調B'},
      {mode:'gray',scale:4,psm:'8',label:'単語読取'}
    ];
    if(field==='name')return [
      {mode:'blue',scale:5,psm:'6',label:'商品名の青文字抽出'},
      {mode:'gray',scale:4,psm:'6',label:'白黒強調'},
      {mode:'original',scale:4,psm:'6',label:'原画像再読取'}
    ];
    if(field==='specification')return [
      {mode:'gray',scale:5,psm:'6',label:'規格白黒強調'},
      {mode:'contrast',scale:4,psm:'7',label:'規格1行強調'},
      {mode:'original',scale:4,psm:'6',label:'原画像再読取'}
    ];
    return [
      {mode:'gray',scale:5,psm:'6',label:'取引先白黒強調'},
      {mode:'contrast',scale:4,psm:'6',label:'取引先コントラスト'},
      {mode:'original',scale:4,psm:'11',label:'取引先疎文字読取'}
    ];
  }
  function normalizeText(s){return String(s??'').normalize('NFKC').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim()}
  function cleanField(field,s){
    let t=normalizeText(s);
    if(field==='name'){
      t=t.replace(/(?:^|\s)(予定|規格書不要)(?=\s|$)/g,' ').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').trim();
    }
    if(field==='vendorDisplay')t=t.replace(/\(\s*(\d{1,2}:\d{2})\s*締\s*(\d+)\s*日後\s*\)/g,'($1締 $2日後)');
    return t;
  }
  function lev(a,b){
    a=String(a);b=String(b);if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;
    const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
    for(let i=1;i<=a.length;i++){cur[0]=i;for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));for(let j=0;j<=b.length;j++)prev[j]=cur[j]}
    return prev[b.length];
  }
  function similarity(a,b){a=cleanField('x',a);b=cleanField('x',b);const m=Math.max(a.length,b.length);return m?1-lev(a,b)/m:1}
  function plausibility(field,t){
    if(!t)return 0;if(field==='code')return /^\d{7,13}$/.test(t)?100:0;
    const chars=[...t].filter(c=>!/\s/.test(c)),ok=chars.filter(c=>/[\p{L}\p{N}()（）「」『』・×xX+＋\-ー／/%:.]/u.test(c)).length,ratio=chars.length?ok/chars.length:0;
    let s=Math.round(ratio*75)+Math.min(20,Math.round(t.length/2));
    if(field==='name'){
      if(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(t))s+=8;
      if(/\)\s*[A-Z0-9]{1,3}$/.test(t))s-=8;
    }else if(field==='specification'){
      if(/\d/.test(t))s+=8;if(/[kgKg箱本個枚袋PCpcCScs×xX／/]/.test(t))s+=8;
    }else if(field==='vendorDisplay'){
      if(/[株有]\)?|株式会社|有限会社|食品|物流|商事|締|日後/.test(t))s+=10;if(/\d{1,2}:\d{2}/.test(t))s+=5;
    }
    return Math.max(0,Math.min(100,s));
  }
  function consensus(field,attempts){
    const arr=(attempts||[]).map(a=>({...a,text:cleanField(field,a.text),confidence:Math.max(0,Math.min(100,Number(a.confidence)||0))})).filter(a=>a.text);
    if(!arr.length)return {text:'',confidence:0,agreement:0,valid:false,reason:'文字を読み取れませんでした',attempts:[]};
    if(field==='code'){
      const valid=arr.filter(a=>/^\d{7,13}$/.test(a.text)),counts=new Map();for(const a of valid)counts.set(a.text,(counts.get(a.text)||0)+1);
      const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||Math.max(...valid.filter(x=>x.text===b[0]).map(x=>x.confidence))-Math.max(...valid.filter(x=>x.text===a[0]).map(x=>x.confidence)));
      if(!ranked.length)return {text:arr[0].text,confidence:Math.min(59,arr[0].confidence),agreement:0,valid:false,reason:'数字7〜13桁として安定して読めません',attempts:arr};
      const [text,count]=ranked[0],same=valid.filter(a=>a.text===text),avg=same.reduce((n,a)=>n+a.confidence,0)/same.length,agreement=count/Math.max(2,arr.length);
      const ok=count>=2;return {text,confidence:Math.round(ok?Math.min(99,90+avg*.07+agreement*3):Math.min(74,avg)),agreement,valid:ok,reason:ok?'':'複数回の読取結果が一致しません',attempts:arr};
    }
    let best=null;
    for(const a of arr){
      const sims=arr.filter(x=>x!==a).map(x=>similarity(a.text,x.text)),agree=sims.length?sims.reduce((n,x)=>n+x,0)/sims.length:1,pl=plausibility(field,a.text),modeBonus=(field==='name'&&String(a.mode).includes('青文字'))?10:0;
      const score=a.confidence*.48+agree*100*.34+pl*.18+modeBonus;
      if(!best||score>best.score)best={a,score,agree,pl};
    }
    let conf=Math.round(best.a.confidence*.48+best.agree*100*.34+best.pl*.18);
    if(best.agree<.58)conf=Math.min(conf,76);else if(best.agree<.72)conf=Math.min(conf,84);else if(best.agree>.90&&best.a.confidence>86)conf=Math.max(conf,91);
    return {text:best.a.text,confidence:Math.max(0,Math.min(99,conf)),agreement:best.agree,valid:true,reason:'',attempts:arr};
  }
  function codeResult(first,second){return consensus('code',[{text:first?.text,confidence:first?.confidence,mode:'A'},{text:second?.text,confidence:second?.confidence,mode:'B'}])}
  function classify(items,existing=[]){
    const counts=new Map();items.forEach(x=>counts.set(x.code,(counts.get(x.code)||0)+1));
    return items.map(x=>{
      if(!/^\d{7,13}$/.test(x.code)||!x.codeValid)return 'FAIL-CLOSED：商品コード不明・複数読取不一致';
      const peers=items.filter(p=>p.code===x.code);
      if(counts.get(x.code)>1&&peers.some(p=>fields.some(k=>p[k]!==x[k])))return 'FAIL-CLOSED：同一コードの表示が不一致';
      if(existing.includes(x.code)||peers[0]!==x)return '重複スキップ';
      return '要確認：元画像と各項目を照合してください';
    });
  }
  scope.InfomartTableOCR={detect,codeResult,classify,crop,preprocess,variants,consensus,cleanField,similarity,fields};
  if(typeof module!=='undefined')module.exports=scope.InfomartTableOCR;
})(typeof window==='undefined'?globalThis:window);
