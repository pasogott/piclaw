/** @jsxImportSource preact */
import {render} from 'preact';
import {html,render as classicRender,useState as classicState} from '../../../web/src/vendor/preact-htm.js';
import {AgentStatus} from '../../../web/src/components/status';
import {AgentStatusPanel} from '../../../web/static/visual/frontend/src/components/AgentStatusPanel';
const skin=new URLSearchParams(location.search).get('skin');
let setClassic:(value:unknown)=>void=()=>{};
(window as any).delegateFixture={emit(detail:unknown){setClassic(detail);window.dispatchEvent(new CustomEvent('piclaw:agent-status',{detail}));},clear(){setClassic(null);window.dispatchEvent(new CustomEvent('piclaw:agent-turn-end'));}};
function Classic(){const[status,setStatus]=classicState<any>(null);setClassic=setStatus;return html`<${AgentStatus} status=${status} turnId="delegate-fixture"/>`;}
if(skin==='classic')classicRender(html`<${Classic}/>`,document.getElementById('app')!);
else render(<AgentStatusPanel/>,document.getElementById('app')!);
