// Drives the REAL analyse() from pocket-rta/index.html with synthetic spectra.
const fs=require('fs'), vm=require('vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const code=html.match(/<script>([\s\S]*)<\/script>/)[1];

function mkCtx2d(){
  const noop=()=>{};
  return new Proxy({}, { get:(t,k)=>{
    if(k==='createLinearGradient') return ()=>({addColorStop:noop});
    if(k==='measureText') return ()=>({width:10});
    return noop;
  }, set:()=>true });
}
function mkEl(){
  const cls={add(){},remove(){},toggle(){return false},contains(){return false}};
  return {textContent:'',value:'100',dataset:{},style:{},classList:cls,
    addEventListener(){}, getContext:()=>mkCtx2d(),
    getBoundingClientRect:()=>({width:320,height:420})};
}
const els={};
const store={};
const sandbox={
  console,
  performance:{now:()=>{ sandbox.__t=(sandbox.__t||0)+16.7; return sandbox.__t; }},
  requestAnimationFrame:()=>0,
  devicePixelRatio:2,
  addEventListener(){},
  localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v}},
  location:{protocol:'https:'},
  navigator:{mediaDevices:{getUserMedia:async()=>{throw new Error('no mic');}}},
  document:{
    getElementById:id=>els[id]||(els[id]=mkEl()),
    querySelectorAll:()=>[],
    addEventListener(){},
    hidden:false,
  },
};
sandbox.window=sandbox;
sandbox.AudioContext=function(){ this.sampleRate=48000; this.resume=async()=>{}; };
vm.createContext(sandbox);
vm.runInContext(code,sandbox,{filename:'pocket-rta.js'});

const app=sandbox.window.__pocketRTA;
if(!app) throw new Error('debug hook missing');
const {S,analyse,CENTERS,A_W}=app;
S.ctx={sampleRate:48000};
const NB=CENTERS.length;

// swap the input signal without clearing any meter state
function feed(dbfs, freq){
  const binHz=48000/8192, buf=new Float32Array(4096).fill(-160);
  if(freq) buf[Math.round(freq/binHz)]=dbfs;
  else for(let k=1;k<4096;k++) buf[k]=dbfs;
  S.analyser={fftSize:8192,frequencyBinCount:4096,smoothingTimeConstant:0,
    getFloatFrequencyData:(out)=>{out.set(buf);}};
  S.buf=new Float32Array(4096);
}
function setSpectrum(dbfs, freq){
  feed(dbfs, freq);
  S.db=new Float32Array(NB).fill(-200);
  S.peaks=new Float32Array(NB).fill(-200);
  S.spl=0; S.splPow=0; S.maxSpl=0; S.leqSum=0; S.leqT=0;
  S.lastT=0;
}
const shown=id=>parseFloat(els[id].textContent);
function run(frames=90){ for(let i=0;i<frames;i++) analyse(); }
function idxFor(f){let b=0,best=1e9;for(let i=0;i<NB;i++){const d=Math.abs(CENTERS[i]-f);if(d<best){best=d;b=i;}}return b;}

let pass=0,fail=0;
const chk=(n,g,e,t)=>{const ok=Math.abs(g-e)<=t;ok?pass++:fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${g.toFixed(2)} (expected ~${e.toFixed(2)} ±${t})`)};

console.log('== flat band level across frequency (real code) ==');
for(const f of [63,250,1000,4000,10000]){
  S.weighting='Z'; setSpectrum(-30,f); run();
  chk(`band @${f} Hz reads ${-30+100} dB`, S.db[idxFor(f)], 70, 1.0);
}

console.log('\n== A-weighting in the real code ==');
S.weighting='A';
for(const f of [63,1000,4000]){
  setSpectrum(-30,f); run();
  chk(`A-weighted SPL @${f} Hz`, S.spl, 70+A_W[idxFor(f)], 1.5);
}

console.log('\n== level tracking (Z-weighted, 1 kHz) ==');
S.weighting='Z';
for(const d of [-24,-40,-60,-80]){
  setSpectrum(d,1000); run();
  chk(`input ${d} dBFS`, S.spl, d+100, 1.0);
}

console.log('\n== broadband noise ==');
S.weighting='Z'; setSpectrum(-80,null); run();
console.log(`   broadband SPL: ${S.spl.toFixed(1)} dB, finite=${Number.isFinite(S.spl)}`);

console.log('\n== silence floor ==');
setSpectrum(-160,null); run();
console.log(`   silence SPL: ${S.spl.toFixed(1)} dB, finite=${Number.isFinite(S.spl)}`);

console.log('\n== response time: fast vs slow reach the same value ==');
S.response='fast'; setSpectrum(-40,1000); run(60); const fFast=S.spl;
S.response='slow'; setSpectrum(-40,1000); run(200); const fSlow=S.spl;
chk('fast settles to 60 dB', fFast, 60, 1.0);
chk('slow settles to 60 dB', fSlow, 60, 1.0);

console.log('\n== loudest band detection ==');
setSpectrum(-30,2000); run();
let bi=0; for(let i=1;i<NB;i++) if(S.db[i]>S.db[bi]) bi=i;
chk('loudest band reported as 2 kHz', CENTERS[bi], 2000, 60);

console.log('\n== Leq and Max ==');
S.weighting='Z'; S.response='fast';
setSpectrum(-30,1000); run(200);
chk('Leq of a steady 70 dB tone', shown('leq'), 70, 0.2);
chk('Max of a steady 70 dB tone', shown('maxspl'), 70, 0.2);

// equal time at 90 dB and 70 dB: energy average is 10*log10((1e9+1e7)/2) = 87.04
setSpectrum(-10,1000); run(120); feed(-30,1000); run(120);
chk('Leq of 90 dB then 70 dB, equal time', shown('leq'), 87.04, 0.3);
chk('Max holds the 90 dB section', shown('maxspl'), 90, 0.2);

// Leq must not depend on the Fast/Slow display setting
S.response='slow'; setSpectrum(-10,1000); run(120); feed(-30,1000); run(120);
chk('Leq is the same on Slow', shown('leq'), 87.04, 0.3);
S.response='fast';

// a 100 ms burst to 90 dB over a 60 dB bed. Fast weighting (125 ms) averages
// sound power, so the peak is 10*log10(1e6 + (1e9-1e6)*(1-exp(-0.1/0.125))) = 87.41
setSpectrum(-40,1000); run(120); feed(-10,1000); run(6); feed(-40,1000); run(60);
chk('Fast Max of a 100 ms 90 dB burst', shown('maxspl'), 87.41, 0.3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
