/* ======================================================
 * 🕹️ Hidden Mini Game: ゴジカ 2Pick（Draft）
 *  - Trigger: 画面上で "g2pick"（or "2pick"）とタイプ
 *  - 怪獣：等級 I/II/III/IV を各1枚（各回2択）
 *  - メイン：25回ドラフト（各回「2枚セット」の2択）= 合計50枚
 *  - 2進攻(advance=2) は 10回のプレミア回でのみ提示（=最大10枚）
 *  - 同名上限4枚（MAX_DUP_PER_NAME）
 *  - card_meta.js に登録がないカード（metaなし）は提示しない
 * ====================================================== */
(function(){
  if(typeof IS_SPECTATOR!=='undefined' && IS_SPECTATOR) return;

  // ---------- utilities ----------
  const __dEsc = (s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const __sum = (o)=>Object.values(o||{}).reduce((a,b)=>a+(Number(b)||0),0);
  const __randInt = (n)=>Math.floor(Math.random()*n);
  const __pick = (arr)=>arr && arr.length ? arr[__randInt(arr.length)] : null;

  function __hasMeta(id){
    try{ return !!(typeof getMetaById==='function' && getMetaById(id)); }catch(e){ return false; }
  }
  function __metaOf(id){
    try{ return (typeof getMetaById==='function' ? getMetaById(id) : null); }catch(e){ return null; }
  }
  function __isTokenMeta(m){
    if(!m) return false;
    const t = String(m.type||'');
    if(t.includes('トークン')) return true;
    const feats = Array.isArray(m.features) ? m.features : [];
    const raw = String(m.features_raw||'');
    return feats.includes('トークン') || raw.includes('トークン');
  }
  function __cardObjById(id){
    try{ return CARD_DB.find(c=>c.id===id) || {id, srcGuess: (typeof CARD_FOLDER!=='undefined' ? `${CARD_FOLDER}/${id}.png` : ''), name:id}; }
    catch(e){ return {id, srcGuess:'', name:id}; }
  }

  // ---------- modal / UI ----------
  let __modal=null, __panel=null;
  let __sub=null, __msg=null;
  let __optA=null, __optB=null;
  let __btnPick=null, __btnReroll=null, __btnExit=null, __btnApply=null, __btnCopy=null;

  function __ensureModal(){
    if(__modal) return;

    // style (inject once)
    if(!document.getElementById('draft2pickStyle')){
      const st=document.createElement('style');
      st.id='draft2pickStyle';
      st.textContent = `
#draft2pick.hidden{display:none !important;}
#draft2pick{position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;padding:18px;}
#draft2pickPanel{width:min(1040px,96vw);max-height:92vh;background:rgba(28,28,28,.96);border:1px solid rgba(255,255,255,.14);border-radius:22px;box-shadow:0 16px 60px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden;}
#draft2pickPanel .dHdr{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.12);}
#draft2pickPanel .dTitle{font-weight:900;font-size:18px;letter-spacing:.2px;}
#draft2pickPanel .dSub{opacity:.85;font-size:12px;line-height:1.2;white-space:pre-line;margin-left:auto;text-align:right;}
#draft2pickPanel .dClose{all:unset;cursor:pointer;font-size:18px;padding:6px 10px;border-radius:10px;opacity:.9;}
#draft2pickPanel .dClose:hover{background:rgba(255,255,255,.08);}
#draft2pickPanel .dBody{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px 14px;overflow:auto;}
#draft2pickPanel .dOpt{border:1px solid rgba(255,255,255,.14);border-radius:18px;background:rgba(255,255,255,.05);padding:10px;cursor:pointer;min-height:280px;display:flex;flex-direction:column;gap:10px;outline:none;}
#draft2pickPanel .dOpt:hover{background:rgba(255,255,255,.08);}
#draft2pickPanel .dOpt.selected{outline:3px solid rgba(255,214,10,.85);}
#draft2pickPanel .dOptHdr{display:flex;align-items:center;justify-content:space-between;gap:10px;}
#draft2pickPanel .dOptTag{font-weight:900;opacity:.95;}
#draft2pickPanel .dOptHint{opacity:.7;font-size:12px;}
#draft2pickPanel .dCards{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;}
#draft2pickPanel .dCard{flex:1 1 220px;min-width:220px;max-width:calc(50% - 6px);display:flex;gap:10px;align-items:flex-start;}
#draft2pickPanel .dCard img{width:86px;height:auto;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);cursor:zoom-in;}
#draft2pickPanel .dCard .dTxt{display:flex;flex-direction:column;gap:4px;min-width:0;}
#draft2pickPanel .dCard .dName{font-weight:900;line-height:1.2;font-size:14px;word-break:break-word;}
#draft2pickPanel .dCard .dMeta{opacity:.75;font-size:12px;line-height:1.2;}
#draft2pickPanel .dFooter{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-top:1px solid rgba(255,255,255,.12);}
#draft2pickPanel .dMsg{opacity:.9;font-size:12px;white-space:pre-line;}
#draft2pickPanel .dBtns{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;}
#draft2pickPanel button{cursor:pointer;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;padding:8px 12px;border-radius:12px;font-weight:800;}
#draft2pickPanel button:hover{background:rgba(255,255,255,.10);}
#draft2pickPanel button.primary{background:rgba(255,214,10,.15);border-color:rgba(255,214,10,.35);}
#draft2pickPanel button:disabled{opacity:.45;cursor:not-allowed;}
      `;
      document.head.appendChild(st);
    }

    __modal=document.createElement('div');
    __modal.id='draft2pick';
    __modal.className='hidden';
    __modal.innerHTML=`
      <div id="draft2pickPanel" role="dialog" aria-modal="true" aria-label="ゴジカ 2Pick">
        <div class="dHdr">
          <div class="dTitle">🕹️ ゴジカ 2Pick（隠しミニゲーム）</div>
          <div class="dSub" id="draft2pickSub"></div>
          <button class="dClose" id="draft2pickClose" type="button" aria-label="閉じる">✕</button>
        </div>
        <div class="dBody">
          <div class="dOpt" id="draft2pickA" tabindex="0" role="button" aria-label="Aを選ぶ"></div>
          <div class="dOpt" id="draft2pickB" tabindex="0" role="button" aria-label="Bを選ぶ"></div>
        </div>
        <div class="dFooter">
          <div class="dMsg" id="draft2pickMsg"></div>
          <div class="dBtns">
            <button id="draft2pickReroll" type="button">リロール</button>
            <button id="draft2pickPick" type="button" class="primary">選択して進む</button>
            <button id="draft2pickCopy" type="button">デッキコードコピー</button>
            <button id="draft2pickApply" type="button">構築画面へ反映</button>
            <button id="draft2pickExit" type="button">終了</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(__modal);

    __panel=document.getElementById('draft2pickPanel');
    __sub=document.getElementById('draft2pickSub');
    __msg=document.getElementById('draft2pickMsg');
    __optA=document.getElementById('draft2pickA');
    __optB=document.getElementById('draft2pickB');
    __btnPick=document.getElementById('draft2pickPick');
    __btnReroll=document.getElementById('draft2pickReroll');
    __btnExit=document.getElementById('draft2pickExit');
    __btnApply=document.getElementById('draft2pickApply');
    __btnCopy=document.getElementById('draft2pickCopy');

    const btnClose=document.getElementById('draft2pickClose');
    btnClose.onclick=()=>__closeDraft();

    // click outside to close
    __modal.addEventListener('pointerdown',(e)=>{
      if(e.target===__modal) __closeDraft();
    });

    // keyboard inside modal
    __panel.addEventListener('keydown',(e)=>{
      if(e.key==='Escape'){
        const pv=document.getElementById('preview');
        if(pv && !pv.classList.contains('hidden')) return;
        e.preventDefault(); __closeDraft(); return;
      }
      if(e.key==='1' || e.key==='a' || e.key==='A'){ e.preventDefault(); __selectOpt('A'); return; }
      if(e.key==='2' || e.key==='b' || e.key==='B'){ e.preventDefault(); __selectOpt('B'); return; }
      if(e.key==='Enter'){ e.preventDefault(); __confirmPick(); return; }
      if(e.key==='r' || e.key==='R'){ e.preventDefault(); __doReroll(); return; }
    });

    __optA.addEventListener('click',()=>__selectOpt('A'));
    __optB.addEventListener('click',()=>__selectOpt('B'));
    __btnPick.addEventListener('click',()=>__confirmPick());
    __btnReroll.addEventListener('click',()=>__doReroll());
    __btnExit.addEventListener('click',()=>__closeDraft());
    __btnApply.addEventListener('click',()=>__applyToBuilder());
    __btnCopy.addEventListener('click',()=>__copyDeckCode());
  }

  // ---------- pools (metaありのみ) ----------
  let __poolsBuilt=false;
  let __monByGrade={1:[],2:[],3:[],4:[]};
  let __mainNormal=[], __mainAdv2=[];
  function __buildPools(){
    if(__poolsBuilt) return;
    __poolsBuilt=true;

    try{
      (CARD_DB||[]).forEach(c=>{
        const m = c.meta || __metaOf(c.id);
        if(!m) return; // ここが重要：metaがないカードは一切提示しない
        if(__isTokenMeta(m)) return;

        if(String(m.type||'')==='怪獣'){
          const g=Number(m.grade||0);
          if(__monByGrade[g]) __monByGrade[g].push(c);

          // ★メインデッキ候補にも怪獣を含める（この2Pickモードは色/特徴縛りなし）
          const adv=Number(m.advance||0);
          if(adv===2) __mainAdv2.push(c);
          else __mainNormal.push(c);
        }else{
          const adv=Number(m.advance||0);
          if(adv===2) __mainAdv2.push(c);
          else __mainNormal.push(c);
        }
      });
    }catch(e){}
  }

  // ---------- draft session ----------
  const CFG = {
    mainRounds: 25,
    premiumRounds: 10,
    rerollMonster: 1,
    rerollMain: 2,
    maxDup: (typeof MAX_DUP_PER_NAME!=='undefined' ? MAX_DUP_PER_NAME : 4),
  };

  let __ds=null;     // session
  let __offer=null;  // {A:[ids], B:[ids]}
  let __selected=null;

  function __newSession(){
    __buildPools();

    // プレミア回（=2進攻枠）をランダムで10回
    const prem = new Set();
    while(prem.size < Math.min(CFG.premiumRounds, CFG.mainRounds)){
      prem.add(__randInt(CFG.mainRounds));
    }

    __ds = {
      phase: 'monster',   // monster -> main -> done
      grade: 1,
      round: 0,
      premiumIdx: prem,
      rerollM: CFG.rerollMonster,
      rerollMain: CFG.rerollMain,
      main: {},
      monster: {},
    };
    __offer = null;
    __selected = null;
  }

  function __countOf(map,id){ return Number(map && map[id])||0; }
  function __canTake(map,id){ return __countOf(map,id) < CFG.maxDup; }

  function __pickOne(list, map, excludeSet){
    if(!Array.isArray(list) || !list.length) return null;
    const ex = excludeSet || new Set();
    // try random a bit
    for(let t=0;t<250;t++){
      const c = __pick(list);
      if(!c) break;
      const id=c.id;
      if(ex.has(id)) continue;
      if(!__canTake(map,id)) continue;
      return c;
    }
    // fallback linear
    for(const c of list){
      if(!c) continue;
      const id=c.id;
      if(ex.has(id)) continue;
      if(!__canTake(map,id)) continue;
      return c;
    }
    return null;
  }

  function __pickDistinct(list, map, n, excludeIds){
    const ex = excludeIds || new Set();
    const out=[];
    const used=new Set(ex);
    for(let i=0;i<n;i++){
      const c = __pickOne(list, map, used);
      if(!c) break;
      out.push(c);
      used.add(c.id);
    }
    return out;
  }

  function __pairNormal(map){
    const a = __pickDistinct(__mainNormal, map, 2, new Set());
    if(a.length===2) return a.map(x=>x.id);
    // fallback: allow 1 card option (shouldn't happen)
    return a.map(x=>x.id);
  }

  function __pairPremium(map){
    const ex = new Set();
    const adv = __pickOne(__mainAdv2, map, ex);
    if(adv) ex.add(adv.id);
    const nor = __pickOne(__mainNormal, map, ex);
    const ids = [];
    if(adv) ids.push(adv.id);
    if(nor) ids.push(nor.id);
    // fallback: if missing normal, fill from normal pool ignoring distinct within pair
    if(ids.length<2){
      const fill = __pickOne(__mainNormal, map, new Set(ids));
      if(fill) ids.push(fill.id);
    }
    return ids;
  }

  function __makeOffer(){
    if(!__ds) return;
    __selected=null;

    let offerA=[], offerB=[];
    let hintA='A', hintB='B';

    if(__ds.phase==='monster'){
      const g = __ds.grade;
      const list = __monByGrade[g] || [];
      const ca = __pickOne(list, __ds.monster, new Set());
      const cb = __pickOne(list, __ds.monster, new Set(ca? [ca.id] : []));
      if(!ca || !cb){
        // metaが薄い場合の最終フォールバック
        offerA = ca ? [ca.id] : [];
        offerB = cb ? [cb.id] : [];
      }else{
        offerA=[ca.id]; offerB=[cb.id];
      }
      hintA=`等級${g}：A`;
      hintB=`等級${g}：B`;
    }else if(__ds.phase==='main'){
      const isPrem = __ds.premiumIdx.has(__ds.round);
      if(isPrem){
        offerA = __pairPremium(__ds.main);
        offerB = __pairPremium(__ds.main);
        // まったく同じになったら少しだけ引き直し
        let guard=0;
        while(guard++<30 && offerA.join('|')===offerB.join('|')){
          offerB = __pairPremium(__ds.main);
        }
        hintA='プレミア枠：A';
        hintB='プレミア枠：B';
      }else{
        offerA = __pairNormal(__ds.main);
        offerB = __pairNormal(__ds.main);
        let guard=0;
        while(guard++<30 && offerA.join('|')===offerB.join('|')){
          offerB = __pairNormal(__ds.main);
        }
        hintA='通常：A';
        hintB='通常：B';
      }
    }

    __offer = { A: offerA, B: offerB, hintA, hintB };
    __renderOffer();
  }

  function __cardLine(id){
    const c = __cardObjById(id);
    const m = c.meta || __metaOf(id) || {};
    const name = (m && m.name) ? m.name : (c && c.name ? c.name : id);
    const type = String(m.type||'—');
    const grade = (m.grade!=null && m.grade!=='') ? `等級${m.grade}` : '';
    const adv = (m.advance!=null && m.advance!=='') ? `進攻${m.advance}` : '';
    const color = String(m.color||'');
    const feats = Array.isArray(m.features) ? m.features : [];
    const feat = feats.length ? feats.slice(0,3).join(' / ') : '';
    const metaBits = [color, type, grade, adv].filter(Boolean).join(' / ');
    return `
      <div class="dCard" data-cardid="${__dEsc(id)}">
        <img src="${__dEsc(c.srcGuess||'')}" alt="${__dEsc(name)}" onerror="this.onerror=null;this.src='${WHITE_BACK}';">
        <div class="dTxt">
          <div class="dName">${__dEsc(name)}</div>
          <div class="dMeta">${__dEsc(metaBits || '—')}${feat?`<br>${__dEsc(feat)}`:''}</div>
        </div>
      </div>
    `;
  }

  // --- 2Pick内でもカード拡大（preview）を使えるようにする ---
  const __previewEl = document.getElementById('preview');
  function __openPreview2Pick(cardId){
    if(typeof openPreviewByCardId!=='function') return;
    // 2Pickモーダル(z-index:20000)より上に出す
    if(__previewEl && __previewEl.dataset){
      if(__previewEl.dataset._zRestore==null){
        __previewEl.dataset._zRestore = (__previewEl.style && __previewEl.style.zIndex!=null) ? __previewEl.style.zIndex : '';
      }
      __previewEl.style.zIndex = '26000';
    }
    openPreviewByCardId(cardId);
  }
  function __wireCardPreviewClicks(){
    const bind = (root)=>{
      if(!root) return;
      root.querySelectorAll('.dCard[data-cardid] img').forEach(img=>{
        img.addEventListener('click',(e)=>{
          e.preventDefault();
          e.stopPropagation(); // A/B選択とは別で拡大を開く
          const wrap = img.closest('.dCard');
          const id = wrap && wrap.dataset ? wrap.dataset.cardid : '';
          if(id) __openPreview2Pick(id);
        }, {passive:false});
      });
    };
    bind(__optA);
    bind(__optB);
  }

  function __renderOffer(){
    if(!__modal || !__offer) return;

    const mCnt = __sum(__ds.main);
    const kCnt = __sum(__ds.monster);

    const phaseText = (__ds.phase==='monster')
      ? `怪獣ドラフト：等級${__ds.grade}（${__ds.grade}/4）`
      : (__ds.phase==='main')
        ? `メインドラフト：${__ds.round+1}/${CFG.mainRounds}（${mCnt}/50）`
        : `完了（メイン${mCnt}/50・怪獣${kCnt}/4）`;

    const premLeft = (__ds.phase==='main')
      ? Array.from(__ds.premiumIdx).filter(i=>i>=__ds.round).length
      : CFG.premiumRounds;

    const rr = (__ds.phase==='monster')
      ? `リロール：怪獣 ${__ds.rerollM} / メイン ${__ds.rerollMain}`
      : `リロール：メイン ${__ds.rerollMain}`;

    __sub.textContent = `${phaseText}\n同名上限：${CFG.maxDup}枚 / 2進攻枠：最大${CFG.premiumRounds}回（残り目安 ${premLeft}）\n${rr}`;

    const isPremNow = (__ds.phase==='main' && __ds.premiumIdx.has(__ds.round));
    __msg.textContent = (__ds.phase==='done')
      ? `ドラフト完了！\nこのまま「構築画面へ反映」すると、デッキ構築に反映されます。`
      : (isPremNow
          ? `プレミア回：この選択で「進攻2」が1枚増えます（最大${CFG.premiumRounds}枚）。\n[1]でA / [2]でB / Enterで確定 / Rでリロール`
          : `[1]でA / [2]でB / Enterで確定 / Rでリロール`);

    const aCards = (__offer.A||[]).map(__cardLine).join('');
    const bCards = (__offer.B||[]).map(__cardLine).join('');

    __optA.innerHTML = `
      <div class="dOptHdr"><div class="dOptTag">A</div><div class="dOptHint">${__dEsc(__offer.hintA||'')}</div></div>
      <div class="dCards">${aCards || '<div style="opacity:.7">カードが見つかりません</div>'}</div>
    `;
    __optB.innerHTML = `
      <div class="dOptHdr"><div class="dOptTag">B</div><div class="dOptHint">${__dEsc(__offer.hintB||'')}</div></div>
      <div class="dCards">${bCards || '<div style="opacity:.7">カードが見つかりません</div>'}</div>
    `;

    __wireCardPreviewClicks();

    // selection UI
    __optA.classList.toggle('selected', __selected==='A');
    __optB.classList.toggle('selected', __selected==='B');

    // buttons
    const canPick = (__selected==='A' || __selected==='B') && __ds.phase!=='done';
    __btnPick.disabled = !canPick;

    const canReroll = (__ds.phase==='monster' ? (__ds.rerollM>0) : (__ds.phase==='main' ? (__ds.rerollMain>0) : false));
    __btnReroll.disabled = !canReroll;

    const done = (__ds.phase==='done');
    __btnApply.disabled = !done;
    __btnCopy.disabled = !done;
  }

  function __selectOpt(side){
    if(!__ds || __ds.phase==='done') return;
    if(side!=='A' && side!=='B') return;
    __selected = side;
    __optA.classList.toggle('selected', __selected==='A');
    __optB.classList.toggle('selected', __selected==='B');
    __btnPick.disabled = !(__selected==='A' || __selected==='B');
    try{ __panel.focus(); }catch(e){}
  }

  function __applyPick(ids){
    if(!Array.isArray(ids) || !ids.length) return false;

    if(__ds.phase==='monster'){
      const id = ids[0];
      if(!id || !__hasMeta(id)) return false;
      // 同名上限（ほぼ効かないが一応）
      if(!__canTake(__ds.monster,id)) return false;
      __ds.monster[id] = (__countOf(__ds.monster,id) + 1);
      __ds.grade++;
      if(__ds.grade>4){
        __ds.phase='main';
        __ds.round=0;
      }
      return true;
    }

    if(__ds.phase==='main'){
      // 2枚セット
      for(const id of ids){
        if(!id || !__hasMeta(id)) continue;
        if(!__canTake(__ds.main,id)) continue;
        __ds.main[id] = (__countOf(__ds.main,id) + 1);
      }
      __ds.round++;
      if(__ds.round>=CFG.mainRounds){
        __ds.phase='done';
      }
      return true;
    }

    return false;
  }

  function __confirmPick(){
    if(!__ds || __ds.phase==='done') return;
    if(!__selected) return;
    const ids = (__offer && __offer[__selected]) ? __offer[__selected] : [];
    const ok = __applyPick(ids);
    if(!ok){
      alert('この選択を反映できませんでした（カード情報が不足している可能性があります）');
      return;
    }
    __makeOffer();
  }

  function __doReroll(){
    if(!__ds || __ds.phase==='done') return;

    if(__ds.phase==='monster'){
      if(__ds.rerollM<=0) return;
      __ds.rerollM--;
      __makeOffer();
      return;
    }
    if(__ds.phase==='main'){
      if(__ds.rerollMain<=0) return;
      __ds.rerollMain--;
      __makeOffer();
      return;
    }
  }

  function __copyDeckCode(){
    if(!__ds || __ds.phase!=='done') return;
    let code='';
    try{
      if(typeof encodeDeck==='function'){
        code = encodeDeck({main:__ds.main, monster:__ds.monster});
      }
    }catch(e){}
    if(!code){ alert('デッキコード生成に失敗しました'); return; }

    (async ()=>{
      try{
        await navigator.clipboard.writeText(code);
        const old = __btnCopy.textContent;
        __btnCopy.textContent='コピー済み';
        setTimeout(()=>{ __btnCopy.textContent = old; }, 650);
      }catch(err){
        const ta=document.createElement('textarea');
        ta.value=code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        const old = __btnCopy.textContent;
        __btnCopy.textContent='コピー済み';
        setTimeout(()=>{ __btnCopy.textContent = old; }, 650);
      }
    })();
  }

  function __applyToBuilder(){
    if(!__ds || __ds.phase!=='done') return;
    try{
      if(typeof applyDeckToBuilder==='function'){
        applyDeckToBuilder({main:__ds.main, monster:__ds.monster});
      }
      if(typeof openBuilder==='function') openBuilder();
      __closeDraft();
    }catch(e){
      alert('構築画面への反映に失敗しました: '+e.message);
    }
  }

  function __openDraft(){
    __ensureModal();
    __newSession();

    // 最初の提示
    __makeOffer();

    __modal.classList.remove('hidden');
    try{ __panel.focus(); }catch(e){}
  }

  function __closeDraft(){
    if(!__modal) return;
    __modal.classList.add('hidden');
    __ds=null; __offer=null; __selected=null;
  }

  // ---------- secret trigger ----------
  const SECRET_WORDS=['g2pick','2pick'];
  let __buf='', __last=0;
  function __canTrigger(){
    if(typeof IS_SPECTATOR!=='undefined' && IS_SPECTATOR) return false;

    // 入力中は無効
    const ae=document.activeElement;
    if(ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.isContentEditable)) return false;

    // モーダル/ビルダー中は誤爆防止（draft以外）
    try{
      if(startModal && startModal.style.display!=='none') return false;
      if(viewer && !viewer.classList.contains('hidden')) return false;
      if(reveal && !reveal.classList.contains('hidden')) return false;
      if(tokenModal && !tokenModal.classList.contains('hidden')) return false;
      if(counterModal && !counterModal.classList.contains('hidden')) return false;
      if(stackModal && !stackModal.classList.contains('hidden')) return false;
      if(preview && !preview.classList.contains('hidden')) return false;
      if(builder && !builder.classList.contains('hidden')) return false;
    }catch(e){}
    return true;
  }

  window.openDraft2Pick = __openDraft;

  document.addEventListener('keydown',(e)=>{
    if(e.defaultPrevented || e.repeat) return;
    if(!__canTrigger()) return;

    const k=e.key;
    if(!k || k.length!==1) return;

    const now=Date.now();
    if(now-__last>1100) __buf='';
    __last=now;

    __buf = (__buf + k.toLowerCase()).slice(-12);
    if(SECRET_WORDS.some(w=>__buf.endsWith(w))){
      e.preventDefault();
      __buf='';
      __openDraft();
    }
  }, true);

})();