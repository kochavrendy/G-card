// ===== Remake: React migration bridge (non-breaking) =====
(function attachLegacyBridge(){
  if(typeof window==='undefined') return;
  const api = {
    version: 'remake-1',
    getStateSnapshot(){
      return {
        rageCount: (typeof rageCount!=='undefined') ? rageCount : null,
        cardCount: (typeof state!=='undefined' && Array.isArray(state?.order)) ? state.order.length : null,
        selectedIds: (typeof selection!=='undefined' && selection instanceof Set)
          ? Array.from(selection)
          : []
      };
    },
    forceRender(){
      try{
        if(typeof renderAllCards==='function') renderAllCards();
        if(typeof updateCounters==='function') updateCounters();
        if(typeof updateDeckCounter==='function') updateDeckCounter();
      }catch(e){
        console.warn('legacy forceRender failed', e);
      }
    }
  };
  window.GCardLegacyAPI = api;
  window.dispatchEvent(new CustomEvent('gcard:legacy-ready', { detail: { version: api.version } }));
})();