var Ms=Object.defineProperty;var Qs=(n)=>n;function qs(n,i){this[n]=Qs.bind(null,i)}var on=(n,i)=>{for(var r in i)Ms(n,r,{get:i[r],enumerable:!0,configurable:!0,set:qs.bind(i,r)})};var d=(n,i)=>()=>(n&&(i=n(n=0)),i);var nu={};on(nu,{useState:()=>w,useRef:()=>E,useReducer:()=>Q_,useMemo:()=>J,useLayoutEffect:()=>Ni,useImperativeHandle:()=>Js,useErrorBoundary:()=>es,useEffect:()=>X,useDebugValue:()=>ds,useContext:()=>Es,useCallback:()=>U,render:()=>Ln,html:()=>g,h:()=>or,createContext:()=>Os,Component:()=>ui});function hn(n,i){for(var r in i)n[r]=i[r];return n}function gr(n){n&&n.parentNode&&n.parentNode.removeChild(n)}function or(n,i,r){var _,c,s,u={};for(s in i)s=="key"?_=i[s]:s=="ref"?c=i[s]:u[s]=i[s];if(arguments.length>2&&(u.children=arguments.length>3?Pi.call(arguments,2):r),typeof n=="function"&&n.defaultProps!=null)for(s in n.defaultProps)u[s]===void 0&&(u[s]=n.defaultProps[s]);return Hi(n,u,_,c,null)}function Hi(n,i,r,_,c){var s={type:n,props:i,key:r,ref:_,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:c==null?++z_:c,__i:-1,__u:0};return c==null&&nn.vnode!=null&&nn.vnode(s),s}function ji(n){return n.children}function ui(n,i){this.props=n,this.context=i}function In(n,i){if(i==null)return n.__?In(n.__,n.__i+1):null;for(var r;i<n.__k.length;i++)if((r=n.__k[i])!=null&&r.__e!=null)return r.__e;return typeof n.type=="function"?In(n):null}function Ds(n){if(n.__P&&n.__d){var i=n.__v,r=i.__e,_=[],c=[],s=hn({},i);s.__v=i.__v+1,nn.vnode&&nn.vnode(s),$r(n.__P,s,i,n.__n,n.__P.namespaceURI,32&i.__u?[r]:null,_,r==null?In(i):r,!!(32&i.__u),c),s.__v=i.__v,s.__.__k[s.__i]=s,V_(_,s,c),i.__e=i.__=null,s.__e!=r&&U_(s)}}function U_(n){if((n=n.__)!=null&&n.__c!=null)return n.__e=n.__c.base=null,n.__k.some(function(i){if(i!=null&&i.__e!=null)return n.__e=n.__c.base=i.__e}),U_(n)}function sr(n){(!n.__d&&(n.__d=!0)&&Wn.push(n)&&!Wi.__r++||w_!=nn.debounceRendering)&&((w_=nn.debounceRendering)||F_)(Wi)}function Wi(){try{for(var n,i=1;Wn.length;)Wn.length>i&&Wn.sort(T_),n=Wn.shift(),i=Wn.length,Ds(n)}finally{Wn.length=Wi.__r=0}}function j_(n,i,r,_,c,s,u,f,l,o,y){var H,$,v,h,b,F,k,x=_&&_.__k||Ti,N=i.length;for(l=Is(r,i,x,l,N),H=0;H<N;H++)(v=r.__k[H])!=null&&($=v.__i!=-1&&x[v.__i]||Fi,v.__i=H,F=$r(n,v,$,c,s,u,f,l,o,y),h=v.__e,v.ref&&$.ref!=v.ref&&($.ref&&lr($.ref,null,v),y.push(v.ref,v.__c||h,v)),b==null&&h!=null&&(b=h),(k=!!(4&v.__u))||$.__k===v.__k?(l=N_(v,l,n,k),k&&$.__e&&($.__e=null)):typeof v.type=="function"&&F!==void 0?l=F:h&&(l=h.nextSibling),v.__u&=-7);return r.__e=b,l}function Is(n,i,r,_,c){var s,u,f,l,o,y=r.length,H=y,$=0;for(n.__k=Array(c),s=0;s<c;s++)(u=i[s])!=null&&typeof u!="boolean"&&typeof u!="function"?(typeof u=="string"||typeof u=="number"||typeof u=="bigint"||u.constructor==String?u=n.__k[s]=Hi(null,u,null,null,null):Ui(u)?u=n.__k[s]=Hi(ji,{children:u},null,null,null):u.constructor===void 0&&u.__b>0?u=n.__k[s]=Hi(u.type,u.props,u.key,u.ref?u.ref:null,u.__v):n.__k[s]=u,l=s+$,u.__=n,u.__b=n.__b+1,f=null,(o=u.__i=Ys(u,r,l,H))!=-1&&(H--,(f=r[o])&&(f.__u|=2)),f==null||f.__v==null?(o==-1&&(c>y?$--:c<y&&$++),typeof u.type!="function"&&(u.__u|=4)):o!=l&&(o==l-1?$--:o==l+1?$++:(o>l?$--:$++,u.__u|=4))):n.__k[s]=null;if(H)for(s=0;s<y;s++)(f=r[s])!=null&&(2&f.__u)==0&&(f.__e==_&&(_=In(f)),X_(f,f));return _}function N_(n,i,r,_){var c,s;if(typeof n.type=="function"){for(c=n.__k,s=0;c&&s<c.length;s++)c[s]&&(c[s].__=n,i=N_(c[s],i,r,_));return i}n.__e!=i&&(_&&(i&&n.type&&!i.parentNode&&(i=In(n)),r.insertBefore(n.__e,i||null)),i=n.__e);do i=i&&i.nextSibling;while(i!=null&&i.nodeType==8);return i}function Ys(n,i,r,_){var c,s,u,f=n.key,l=n.type,o=i[r],y=o!=null&&(2&o.__u)==0;if(o===null&&f==null||y&&f==o.key&&l==o.type)return r;if(_>(y?1:0)){for(c=r-1,s=r+1;c>=0||s<i.length;)if((o=i[u=c>=0?c--:s++])!=null&&(2&o.__u)==0&&f==o.key&&l==o.type)return u}return-1}function t_(n,i,r){i[0]=="-"?n.setProperty(i,r==null?"":r):n[i]=r==null?"":typeof r!="number"||Zs.test(i)?r:r+"px"}function Ki(n,i,r,_,c){var s,u;n:if(i=="style")if(typeof r=="string")n.style.cssText=r;else{if(typeof _=="string"&&(n.style.cssText=_=""),_)for(i in _)r&&i in r||t_(n.style,i,"");if(r)for(i in r)_&&r[i]==_[i]||t_(n.style,i,r[i])}else if(i[0]=="o"&&i[1]=="n")s=i!=(i=i.replace(W_,"$1")),u=i.toLowerCase(),i=u in n||i=="onFocusOut"||i=="onFocusIn"?u.slice(2):i.slice(2),n.l||(n.l={}),n.l[i+s]=r,r?_?r[si]=_[si]:(r[si]=fr,n.addEventListener(i,s?cr:_r,s)):n.removeEventListener(i,s?cr:_r,s);else{if(c=="http://www.w3.org/2000/svg")i=i.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(i!="width"&&i!="height"&&i!="href"&&i!="list"&&i!="form"&&i!="tabIndex"&&i!="download"&&i!="rowSpan"&&i!="colSpan"&&i!="role"&&i!="popover"&&i in n)try{n[i]=r==null?"":r;break n}catch(f){}typeof r=="function"||(r==null||r===!1&&i[4]!="-"?n.removeAttribute(i):n.setAttribute(i,i=="popover"&&r==1?"":r))}}function y_(n){return function(i){if(this.l){var r=this.l[i.type+n];if(i[Bi]==null)i[Bi]=fr++;else if(i[Bi]<r[si])return;return r(nn.event?nn.event(i):i)}}}function $r(n,i,r,_,c,s,u,f,l,o){var y,H,$,v,h,b,F,k,x,N,M,W,z,p,P,Q,t=i.type;if(i.constructor!==void 0)return null;128&r.__u&&(l=!!(32&r.__u),s=[f=i.__e=r.__e]),(y=nn.__b)&&y(i);n:if(typeof t=="function"){H=u.length;try{if(x=i.props,N=t.prototype&&t.prototype.render,M=(y=t.contextType)&&_[y.__c],W=y?M?M.props.value:y.__:_,r.__c?k=($=i.__c=r.__c).__=$.__E:(N?i.__c=$=new t(x,W):(i.__c=$=new ui(x,W),$.constructor=t,$.render=Cs),M&&M.sub($),$.state||($.state={}),$.__n=_,v=$.__d=!0,$.__h=[],$._sb=[]),N&&$.__s==null&&($.__s=$.state),N&&t.getDerivedStateFromProps!=null&&($.__s==$.state&&($.__s=hn({},$.__s)),hn($.__s,t.getDerivedStateFromProps(x,$.__s))),h=$.props,b=$.state,$.__v=i,v)N&&t.getDerivedStateFromProps==null&&$.componentWillMount!=null&&$.componentWillMount(),N&&$.componentDidMount!=null&&$.__h.push($.componentDidMount);else{if(N&&t.getDerivedStateFromProps==null&&x!==h&&$.componentWillReceiveProps!=null&&$.componentWillReceiveProps(x,W),i.__v==r.__v||!$.__e&&$.shouldComponentUpdate!=null&&$.shouldComponentUpdate(x,$.__s,W)===!1){i.__v!=r.__v&&($.props=x,$.state=$.__s,$.__d=!1),i.__e=r.__e,i.__k=r.__k,i.__k.some(function(j){j&&(j.__=i)}),Ti.push.apply($.__h,$._sb),$._sb=[],$.__h.length&&u.push($);break n}$.componentWillUpdate!=null&&$.componentWillUpdate(x,$.__s,W),N&&$.componentDidUpdate!=null&&$.__h.push(function(){$.componentDidUpdate(h,b,F)})}if($.context=W,$.props=x,$.__P=n,$.__e=!1,z=nn.__r,p=0,N)$.state=$.__s,$.__d=!1,z&&z(i),y=$.render($.props,$.state,$.context),Ti.push.apply($.__h,$._sb),$._sb=[];else do $.__d=!1,z&&z(i),y=$.render($.props,$.state,$.context),$.state=$.__s;while($.__d&&++p<25);$.state=$.__s,$.getChildContext!=null&&(_=hn(hn({},_),$.getChildContext())),N&&!v&&$.getSnapshotBeforeUpdate!=null&&(F=$.getSnapshotBeforeUpdate(h,b)),P=y!=null&&y.type===ji&&y.key==null?G_(y.props.children):y,f=j_(n,Ui(P)?P:[P],i,r,_,c,s,u,f,l,o),$.base=i.__e,i.__u&=-161,$.__h.length&&u.push($),k&&($.__E=$.__=null)}catch(j){if(u.length=H,i.__v=null,l||s!=null){if(j.then){for(i.__u|=l?160:128;f&&f.nodeType==8&&f.nextSibling;)f=f.nextSibling;s!=null&&(s[s.indexOf(f)]=null),i.__e=f}else if(s!=null)for(Q=s.length;Q--;)gr(s[Q])}else i.__e=r.__e;i.__k==null&&(i.__k=r.__k||[]),j.then||R_(i),nn.__e(j,i,r)}}else s==null&&i.__v==r.__v?(i.__k=r.__k,i.__e=r.__e):f=i.__e=Ls(r.__e,i,r,_,c,s,u,l,o);return(y=nn.diffed)&&y(i),128&i.__u?void 0:f}function R_(n){n&&(n.__c&&(n.__c.__e=!0),n.__k&&n.__k.some(R_))}function V_(n,i,r){for(var _=0;_<r.length;_++)lr(r[_],r[++_],r[++_]);nn.__c&&nn.__c(i,n),n.some(function(c){try{n=c.__h,c.__h=[],n.some(function(s){s.call(c)})}catch(s){nn.__e(s,c.__v)}})}function G_(n){return typeof n!="object"||n==null||n.__b>0?n:Ui(n)?n.map(G_):n.constructor!==void 0?null:hn({},n)}function Ls(n,i,r,_,c,s,u,f,l){var o,y,H,$,v,h,b,F=r.props||Fi,k=i.props,x=i.type;if(x=="svg"?c="http://www.w3.org/2000/svg":x=="math"?c="http://www.w3.org/1998/Math/MathML":c||(c="http://www.w3.org/1999/xhtml"),s!=null){for(o=0;o<s.length;o++)if((v=s[o])&&"setAttribute"in v==!!x&&(x?v.localName==x:v.nodeType==3)){n=v,s[o]=null;break}}if(n==null){if(x==null)return document.createTextNode(k);n=document.createElementNS(c,x,k.is&&k),f&&(nn.__m&&nn.__m(i,s),f=!1),s=null}if(x==null)F===k||f&&n.data==k||(n.data=k);else{if(s=x=="textarea"&&k.defaultValue!=null?null:s&&Pi.call(n.childNodes),!f&&s!=null)for(F={},o=0;o<n.attributes.length;o++)F[(v=n.attributes[o]).name]=v.value;for(o in F)v=F[o],o=="dangerouslySetInnerHTML"?H=v:o=="children"||(o in k)||o=="value"&&("defaultValue"in k)||o=="checked"&&("defaultChecked"in k)||Ki(n,o,null,v,c);for(o in k)v=k[o],o=="children"?$=v:o=="dangerouslySetInnerHTML"?y=v:o=="value"?h=v:o=="checked"?b=v:f&&typeof v!="function"||F[o]===v||Ki(n,o,v,F[o],c);if(y)f||H&&(y.__html==H.__html||y.__html==n.innerHTML)||(n.innerHTML=y.__html),i.__k=[];else if(H&&(n.innerHTML=""),j_(i.type=="template"?n.content:n,Ui($)?$:[$],i,r,_,x=="foreignObject"?"http://www.w3.org/1999/xhtml":c,s,u,s?s[0]:r.__k&&In(r,0),f,l),s!=null)for(o=s.length;o--;)gr(s[o]);f&&x!="textarea"||(o="value",x=="progress"&&h==null?n.removeAttribute("value"):h!=null&&(h!==n[o]||x=="progress"&&!h||x=="option"&&h!=F[o])&&Ki(n,o,h,F[o],c),o="checked",b!=null&&b!=n[o]&&Ki(n,o,b,F[o],c))}return n}function lr(n,i,r){try{if(typeof n=="function"){var _=typeof n.__u=="function";_&&n.__u(),_&&i==null||(n.__u=n(i))}else n.current=i}catch(c){nn.__e(c,r)}}function X_(n,i,r){var _,c;if(nn.unmount&&nn.unmount(n),(_=n.ref)&&(_.current&&_.current!=n.__e||lr(_,null,i)),(_=n.__c)!=null){if(_.componentWillUnmount)try{_.componentWillUnmount()}catch(s){nn.__e(s,i)}_.base=_.__P=_.__n=null}if(_=n.__k)for(c=0;c<_.length;c++)_[c]&&X_(_[c],i,r||typeof n.type!="function");r||gr(n.__e),n.__c=n.__=n.__e=void 0}function Cs(n,i,r){return this.constructor(n,r)}function Ln(n,i,r){var _,c,s,u;i==document&&(i=document.documentElement),nn.__&&nn.__(n,i),c=(_=typeof r=="function")?null:r&&r.__k||i.__k,s=[],u=[],$r(i,n=(!_&&r||i).__k=or(ji,null,[n]),c||Fi,Fi,i.namespaceURI,!_&&r?[r]:c?null:i.firstChild?Pi.call(i.childNodes):null,s,!_&&r?r:c?c.__e:i.firstChild,_,u),V_(s,n,u),n.props.children=null}function Os(n){function i(r){var _,c;return this.getChildContext||(_=new Set,(c={})[i.__c]=this,this.getChildContext=function(){return c},this.componentWillUnmount=function(){_=null},this.shouldComponentUpdate=function(s){this.props.value!=s.value&&_.forEach(function(u){u.__e=!0,sr(u)})},this.sub=function(s){_.add(s);var u=s.componentWillUnmount;s.componentWillUnmount=function(){_&&_.delete(s),u&&u.call(s)}}),r.children}return i.__c="__cC"+P_++,i.__=n,i.Provider=i.__l=(i.Consumer=function(r,_){return r.children(_)}).contextType=i,i}function Cn(n,i){_n.__h&&_n.__h(a,n,Yn||i),Yn=0;var r=a.__H||(a.__H={__:[],__h:[]});return n>=r.__.length&&r.__.push({}),r.__[n]}function w(n){return Yn=1,Q_(q_,n)}function Q_(n,i,r){var _=Cn(Pn++,2);if(_.t=n,!_.__c&&(_.__=[r?r(i):q_(void 0,i),function(f){var l=_.__N?_.__N[0]:_.__[0],o=_.t(l,f);l!==o&&(_.__N=[o,_.__[1]],_.__c.setState({}))}],_.__c=a,!a.__f)){var c=function(f,l,o){if(!_.__c.__H)return!0;var y=!1,H=_.__c.props!==f;if(_.__c.__H.__.some(function(v){if(v.__N){y=!0;var h=v.__[0];v.__=v.__N,v.__N=void 0,h!==v.__[0]&&(H=!0)}}),s){var $=s.call(this,f,l,o);return y?$||H:$}return!y||H};a.__f=!0;var{shouldComponentUpdate:s,componentWillUpdate:u}=a;a.componentWillUpdate=function(f,l,o){if(this.__e){var y=s;s=void 0,c(f,l,o),s=y}u&&u.call(this,f,l,o)},a.shouldComponentUpdate=c}return _.__N||_.__}function X(n,i){var r=Cn(Pn++,3);!_n.__s&&wr(r.__H,i)&&(r.__=n,r.u=i,a.__H.__h.push(r))}function Ni(n,i){var r=Cn(Pn++,4);!_n.__s&&wr(r.__H,i)&&(r.__=n,r.u=i,a.__h.push(r))}function E(n){return Yn=5,J(function(){return{current:n}},[])}function Js(n,i,r){Yn=6,Ni(function(){if(typeof n=="function"){var _=n(i());return function(){n(null),_&&typeof _=="function"&&_()}}if(n)return n.current=i(),function(){return n.current=null}},r==null?r:r.concat(n))}function J(n,i){var r=Cn(Pn++,7);return wr(r.__H,i)&&(r.__=n(),r.__H=i,r.__h=n),r.__}function U(n,i){return Yn=8,J(function(){return n},i)}function Es(n){var i=a.context[n.__c],r=Cn(Pn++,9);return r.c=n,i?(r.__==null&&(r.__=!0,i.sub(a)),i.props.value):n.__}function ds(n,i){_n.useDebugValue&&_n.useDebugValue(i?i(n):n)}function es(n){var i=Cn(Pn++,10),r=w();return i.__=n,a.componentDidCatch||(a.componentDidCatch=function(_,c){i.__&&i.__(_,c),r[1](_)}),[r[0],function(){r[1](void 0)}]}function Ss(){for(var n;n=M_.shift();){var i=n.__H;if(n.__P&&i)try{i.__h.some(zi),i.__h.some(ur),i.__h=[]}catch(r){i.__h=[],_n.__e(r,n.__v)}}}function ms(n){var i,r=function(){clearTimeout(_),B_&&cancelAnimationFrame(i),setTimeout(n)},_=setTimeout(r,35);B_&&(i=requestAnimationFrame(r))}function zi(n){var i=a,r=n.__c;typeof r=="function"&&(n.__c=void 0,r()),a=i}function ur(n){var i=a;n.__c=n.__(),a=i}function wr(n,i){return!n||n.length!==i.length||i.some(function(r,_){return r!==n[_]})}function q_(n,i){return typeof i=="function"?i(n):i}function as(n){var i=H_.get(this);return i||(i=new Map,H_.set(this,i)),(i=A_(this,i.get(n)||(i.set(n,i=function(r){for(var _,c,s=1,u="",f="",l=[0],o=function($){s===1&&($||(u=u.replace(/^\s*\n\s*|\s*\n\s*$/g,"")))?l.push(0,$,u):s===3&&($||u)?(l.push(3,$,u),s=2):s===2&&u==="..."&&$?l.push(4,$,0):s===2&&u&&!$?l.push(5,0,!0,u):s>=5&&((u||!$&&s===5)&&(l.push(s,0,u,c),s=6),$&&(l.push(s,$,0,c),s=6)),u=""},y=0;y<r.length;y++){y&&(s===1&&o(),o(y));for(var H=0;H<r[y].length;H++)_=r[y][H],s===1?_==="<"?(o(),l=[l],s=3):u+=_:s===4?u==="--"&&_===">"?(s=1,u=""):u=_+u[0]:f?_===f?f="":u+=_:_==='"'||_==="'"?f=_:_===">"?(o(),s=1):s&&(_==="="?(s=5,c=u,u=""):_==="/"&&(s<5||r[y][H+1]===">")?(o(),s===3&&(l=l[0]),s=l,(l=l[0]).push(2,0,s),s=0):_===" "||_==="\t"||_===`
`||_==="\r"?(o(),s=2):u+=_),s===3&&u==="!--"&&(s=4,l=l[0])}return o(),l}(n)),i),arguments,[])).length>1?i:i[0]}var Pi,nn,z_,As,Wn,w_,F_,T_,ir,Bi,si,W_,fr,_r,cr,P_,Fi,Ti,Zs,Ui,Pn,a,rr,k_,Yn=0,M_,_n,p_,x_,b_,v_,h_,K_,B_,A_=function(n,i,r,_){var c;i[0]=0;for(var s=1;s<i.length;s++){var u=i[s++],f=i[s]?(i[0]|=u?1:2,r[i[s++]]):i[++s];u===3?_[0]=f:u===4?_[1]=Object.assign(_[1]||{},f):u===5?(_[1]=_[1]||{})[i[++s]]=f:u===6?_[1][i[++s]]+=f+"":u?(c=n.apply(f,A_(n,f,r,["",null])),_.push(c),f[0]?i[0]|=2:(i[s-2]=0,i[s]=c)):_.push(f)}return _},H_,g;var rn=d(()=>{Fi={},Ti=[],Zs=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,Ui=Array.isArray;Pi=Ti.slice,nn={__e:function(n,i,r,_){for(var c,s,u;i=i.__;)if((c=i.__c)&&!c.__)try{if((s=c.constructor)&&s.getDerivedStateFromError!=null&&(c.setState(s.getDerivedStateFromError(n)),u=c.__d),c.componentDidCatch!=null&&(c.componentDidCatch(n,_||{}),u=c.__d),u)return c.__E=c}catch(f){n=f}throw n}},z_=0,As=function(n){return n!=null&&n.constructor===void 0},ui.prototype.setState=function(n,i){var r;r=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=hn({},this.state),typeof n=="function"&&(n=n(hn({},r),this.props)),n&&hn(r,n),n!=null&&this.__v&&(i&&this._sb.push(i),sr(this))},ui.prototype.forceUpdate=function(n){this.__v&&(this.__e=!0,n&&this.__h.push(n),sr(this))},ui.prototype.render=ji,Wn=[],F_=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,T_=function(n,i){return n.__v.__b-i.__v.__b},Wi.__r=0,ir=Math.random().toString(8),Bi="__d"+ir,si="__a"+ir,W_=/(PointerCapture)$|Capture$/i,fr=0,_r=y_(!1),cr=y_(!0),P_=0;M_=[],_n=nn,p_=_n.__b,x_=_n.__r,b_=_n.diffed,v_=_n.__c,h_=_n.unmount,K_=_n.__;_n.__b=function(n){a=null,p_&&p_(n)},_n.__=function(n,i){n&&i.__k&&i.__k.__m&&(n.__m=i.__k.__m),K_&&K_(n,i)},_n.__r=function(n){x_&&x_(n),Pn=0;var i=(a=n.__c).__H;i&&(rr===a?(i.__h=[],a.__h=[],i.__.some(function(r){r.__N&&(r.__=r.__N),r.u=r.__N=void 0})):(i.__h.some(zi),i.__h.some(ur),i.__h=[],Pn=0)),rr=a},_n.diffed=function(n){b_&&b_(n);var i=n.__c;i&&i.__H&&(i.__H.__h.length&&(M_.push(i)!==1&&k_===_n.requestAnimationFrame||((k_=_n.requestAnimationFrame)||ms)(Ss)),i.__H.__.some(function(r){r.u&&(r.__H=r.u,r.u=void 0)})),rr=a=null},_n.__c=function(n,i){i.some(function(r){try{r.__h.some(zi),r.__h=r.__h.filter(function(_){return!_.__||ur(_)})}catch(_){i.some(function(c){c.__h&&(c.__h=[])}),i=[],_n.__e(_,r.__v)}}),v_&&v_(n,i)},_n.unmount=function(n){h_&&h_(n);var i,r=n.__c;r&&r.__H&&(r.__H.__.some(function(_){try{zi(_)}catch(c){i=c}}),r.__H=void 0,i&&_n.__e(i,r.__v))};B_=typeof requestAnimationFrame=="function";H_=new Map;g=as.bind(or)});function Un(n){if(typeof window>"u"||!window.localStorage)return null;try{return window.localStorage.getItem(n)}catch{return null}}function $n(n,i){if(typeof window>"u"||!window.localStorage)return;try{window.localStorage.setItem(n,i)}catch{return}}function tr(n,i=!1){let r=Un(n);if(r===null)return i;return r==="true"}function yr(n,i=null){let r=Un(n);if(r===null)return i;let _=parseInt(r,10);return Number.isFinite(_)?_:i}function Z_(n){let i=Un(n);if(!i)return null;try{return JSON.parse(i)}catch{return null}}function Vi(n){let i=String(n??"").trim().toLowerCase().replace(/_/g,"-");if(!i)return On;if(i==="zh-cn"||i==="zh"||i==="zh-hans"||i.startsWith("zh-hans"))return"zh-CN";if(i==="ja"||i.startsWith("ja-"))return"ja";if(i==="en"||i.startsWith("en-"))return"en";return On}function cu(){if(typeof navigator>"u")return On;let n=[...Array.isArray(navigator.languages)?navigator.languages:[],navigator.language].filter((i)=>typeof i==="string"&&i.length>0);for(let i of n){let r=Vi(i);if(r!==On)return r}return On}function su(){let n=Un(Y_);if(n)return Vi(n);return cu()}function uu(n){if(typeof window>"u")return;window.dispatchEvent(new CustomEvent(kr,{detail:{locale:n}}))}function Ri(){if(!pr)fu();return Vn}function fu(){return Vn=su(),pr=!0,Vn}function gu(n,i={}){let r=Vi(n);if(pr=!0,r===Vn&&i.persist===!1)return Vn;if(Vn=r,i.persist!==!1)$n(Y_,r);return uu(r),Vn}function ou(n,i){if(!i)return n;return n.replace(/\{(\w+)\}/g,(r,_)=>{let c=i[_];return c===void 0||c===null?r:String(c)})}function C_(n,i,r=Ri()){let c=_u[r]?.[n]??L_[n]??n;return ou(c,i)}function bn(n,i){return C_(n,i)}function $u(){let[n,i]=w(Ri());return X(()=>{if(typeof window>"u"||typeof window.addEventListener!=="function")return;let r=(_)=>{let c=_.detail,s=Vi(c?.locale??Ri());i(s)};return window.addEventListener(kr,r),i(Ri()),()=>window.removeEventListener(kr,r)},[]),[n,(r)=>gu(r)]}function L(){let[n,i]=$u();return{locale:n,setLocale:i,t:(r,_)=>C_(r,_,n)}}var On="en",D_,I_,Y_="piclaw_locale",kr="piclaw-locale-change",L_,iu,ru,_u,Vn,pr=!1;var un=d(()=>{rn();D_=["en","zh-CN","ja"],I_={en:"English","zh-CN":"简体中文",ja:"日本語"},L_={"compose.placeholder":"Message (Enter to send, Shift+Enter for newline)...","compose.send":"Send","compose.stop":"Stop","compose.searchPlaceholder":"Search (Enter to run)...","compose.clearAll":"Clear all","compose.clearAllTitle":"Clear all attachments and references","compose.scope":"Scope","compose.searchScope":"Search scope","compose.scopeCurrent":"Current","compose.scopeBranchFamily":"Branch family","compose.scopeAll":"All chats","compose.filterImages":"Images","compose.filterAttachments":"Attachments","compose.search":"Search","compose.closeSearch":"Close search","compose.shareLocation":"Share location","compose.attachFile":"Attach file","compose.queueControls":"Queued follow-up controls","compose.moveUp":"Move up","compose.moveUpQueue":"Move up in queue","compose.moveDown":"Move down","compose.moveDownQueue":"Move down in queue","compose.editInCompose":"Edit in compose","compose.returnToEditor":"Return queued message to editor","compose.injectSteer":"Inject queued follow-up as steer","compose.steer":"Steer","compose.cancelQueued":"Cancel queued message","compose.resizeInput":"Resize message input","compose.resizeInputHint":"Drag to resize message input","compose.modelPicker":"Model picker","compose.sessionsAndAgents":"Sessions and agents","compose.openModelPicker":"Open model picker","compose.newBranchTitle":"Create a new branch from this chat","compose.newRootTitle":"Create a clean root session such as web:ops","compose.renameSessionTitle":"Rename the current session","compose.pruneSessionTitle":"Delete (prune) current agent/session branch","compose.filterImagesTitle":"Only show messages with images","compose.filterAttachmentsTitle":"Only show messages with attachments","compose.selectModel":"Select model","compose.loadingModels":"Loading models…","compose.noModels":"No models available.","compose.nextModel":"Next model","compose.manageSessions":"Manage sessions & agents","compose.noSessions":"No other sessions yet.","compose.newBranch":"New branch","compose.newRoot":"New root…","compose.mergeCurrent":"Merge current w/ parent","compose.renameCurrent":"Rename current…","compose.deleteCurrent":"Delete current…","compose.mergeInto":"Merge this branch into {target}","compose.mergeBlocked":"This branch cannot be merged while active or while it has children","workspace.title":"Workspace","workspace.moveConfirm":'Move {entry} "{name}" from {source} to {target}?',"workspace.root":"the workspace root","workspace.file":"file","workspace.folder":"folder","workspace.newFile":"New file","workspace.refresh":"Refresh","workspace.actions":"Workspace actions","workspace.uploadFiles":"Upload files","workspace.reindexing":"Reindexing workspace…","workspace.deleteFile":"Delete file","workspace.download":"Download","workspace.uploadToFolder":"Upload files to this folder","workspace.addFolderHint":"Add folder hint to compose","workspace.downloadZip":"Download folder as zip","workspace.openInTab":"Open in tab","workspace.openInEditor":"Open in editor","workspace.renameSelected":"Rename selected","workspace.downloadSelectedFile":"Download selected file","workspace.downloadSelectedFolder":"Download selected folder (zip)","workspace.deleteSelectedFile":"Delete selected file","shell.settings":"Settings","shell.newChat":"New chat","shell.connecting":"Connecting…","shell.connected":"Connected","language.label":"Language","settings.title":"Settings","settings.close":"Close (Esc)","settings.filter":"Filter…","settings.loading":"Loading settings…","settings.section.general":"General","settings.section.sessions":"Sessions","settings.section.recordings":"Recordings","settings.section.compaction":"Compaction","settings.section.keyboard":"Keyboard","settings.section.workspace":"Workspace","settings.section.environment":"Environment","settings.section.providers":"Providers","settings.section.models":"Models","settings.section.theme":"Appearance","settings.section.scheduled-tasks":"Scheduled Tasks","settings.section.quick-actions":"Quick Actions","settings.section.keychain":"Keychain","settings.section.tools":"Tools","settings.section.addons":"Add-ons","settings.placeholder.recordings":"Filter recordings…","settings.placeholder.keyboard":"Filter shortcuts…","settings.placeholder.environment":"Filter environment…","settings.placeholder.models":"Filter models…","settings.placeholder.scheduled-tasks":"Filter scheduled tasks…","settings.placeholder.quick-actions":"Filter quick actions…","settings.placeholder.keychain":"Filter entries…","settings.placeholder.tools":"Filter tools…","settings.placeholder.addons":"Filter add-ons…","preview.close":"Close","preview.loading":"Loading preview…","preview.files":"Files","preview.folders":"Folders","preview.compressed":"Compressed","preview.uncompressed":"Uncompressed","preview.name":"Name","preview.type":"Type","preview.method":"Method","preview.size":"Size","post.deleteMessage":"Delete message","post.tooLarge":"Message too large to display.","post.previewTruncated":"Preview truncated.","post.submitted":"Submitted","post.discard":"Discard","post.save":"Save","post.cancel":"Cancel","post.addNote":"Add note","post.addNotePlaceholder":"Add a note…","post.restartNotice":"Restarting now — Reason: {reason}","post.restartCompleted":"Restart completed.","post.agentSelfResume":"Agent self-resume","tab.close":"Close","tab.closeOthers":"Close Others","tab.closeAll":"Close All","tab.reattach":"Reattach","tab.openInWindow":"Open in Window","tab.openInNewTab":"Open in New Tab","tab.pinned":"Pinned","tab.detached":"Detached","tab.openSeparateWindow":"Open in separate window","status.trackedVariables":"Tracked variables","status.attachToSession":"Attach to session","status.files":"Files","status.proposedDiff":"Proposed diff","status.copyTmux":"Copy tmux command","status.experimentDuration":"Experiment duration","status.sinceLastActivity":"Since last activity","annotator.title":"Annotate image","annotator.typeLabel":"Type label…","annotator.undo":"Undo","annotator.resetZoom":"Reset zoom","tree.filter":"Filter…","tree.sessionTree":"Session tree","btw.label":"BTW side conversation","btw.close":"Close BTW","btw.thinking":"Thinking","mdpreview.close":"Close preview","mdpreview.unavailable":"Preview unavailable","widget.close":"Close widget","oobe.gettingStarted":"Getting started","oobe.needsSetupTitle":"Instance needs setup","oobe.configuredTitle":"Instance is configured","oobe.needsSetupBody":"This instance is not yet configured. Open Settings and set up AI providers/models to start sending requests.","oobe.configuredBody":"This instance looks configured. Review or update provider and model settings in Settings.","oobe.openSettings":"Open Settings","oobe.dismiss":"Dismiss","oobe.done":"Done","palette.placeholder":"Type to jump to an agent, workspace action, or slash command…","palette.hideWorkspace":"Hide workspace","palette.showWorkspace":"Show workspace","palette.hideWorkspaceDesc":"Hide the workspace sidebar.","palette.showWorkspaceDesc":"Show the workspace sidebar.","palette.exitChatOnly":"Exit chat-only mode","palette.chatOnly":"Chat-only mode","palette.exitChatOnlyDesc":"Return to the split workspace layout.","palette.chatOnlyDesc":"Switch to the chat-only layout.","palette.groupAgents":"Agents","palette.groupWorkspace":"Workspace","palette.groupSlash":"Slash commands","palette.hintMove":"Move","palette.hintSelect":"Select","palette.hintPopOut":"Pop out","palette.hintClose":"Close","settings.appliedNotice":"Settings applied. Changes take effect on the next turn.","settings.sessions.lifecycle":"Session Lifecycle","settings.sessions.autoRotate":"Auto-rotate sessions","settings.sessions.maxSize":"Max session size (MB)","settings.sessions.maxSizeAria":"max session size","settings.sessions.agentBehaviour":"Agent Behaviour","settings.sessions.toolBudget":"Tool use budget","settings.sessions.toolBudgetAria":"tool use budget","settings.sessions.toolBudgetHint":"max completed tool executions per turn","settings.sessions.isolation":"Session isolation","settings.sessions.isolationNone":"None — full cross-session visibility","settings.sessions.isolationSummary":"Summary — tools visible, no arguments","settings.sessions.isolationFull":"Full — sessions cannot see each other","settings.editor.heading":"Editor","settings.editor.vimMode":"Vim mode","settings.editor.showWhitespace":"Show whitespace","settings.editor.livePreview":"Markdown live preview","settings.editor.fontSize":"Font size (px)","settings.editor.fontSizeAria":"editor font size","settings.editor.fontFamily":"Font family","settings.editor.fontFamilyPlaceholder":"monospace (default)","settings.editor.localOnlyHint":"This browser only. Editor changes are stored in local browser storage and take effect when you next open or reload a file tab.","settings.appearance.syncing":"Syncing appearance…","settings.appearance.default":"Default","settings.appearance.autoLightDark":"auto (light/dark)","settings.appearance.tint":"Tint:","settings.appearance.clearTint":"Clear tint","settings.appearance.none":"none","settings.appearance.outputPadding":"Output padding","settings.appearance.outputPaddingHint":"Extra space around messages and thinking panels.","settings.keyboard.heading":"Keyboard","settings.keyboard.hint1":"Customize app-wide shortcuts as comma-separated bindings. Changes apply immediately.","settings.keyboard.hint1b":"is reserved for dismiss/abort and cannot be rebound.","settings.keyboard.hint2mid":"and typing","settings.keyboard.hint2end":"outside the compose box open this pane.","settings.keyboard.resetAll":"Reset all to defaults","settings.keyboard.defaultColon":"Default:","settings.keyboard.save":"Save","settings.keyboard.defaultBtn":"Default","settings.keyboard.noMatch":"No shortcuts match this filter.","settings.keyboard.invalidShortcut":"Invalid shortcut: {token}. Escape is reserved and cannot be rebound.","settings.keyboard.saved":"Keyboard shortcuts saved.","settings.keyboard.resetOne":"Keyboard shortcut reset to default.","settings.keyboard.resetAllDone":"Keyboard shortcuts reset to defaults.","settings.workspace.serverApplied":"Workspace settings applied. Server-side limits affect new workspace requests immediately.","settings.workspace.browserApplied":"Browser workspace settings applied immediately in this tab.","settings.workspace.access":"Access","settings.workspace.enableTerminal":"Enable web terminal","settings.workspace.allowVnc":"Allow direct VNC targets","settings.workspace.accessHint":"Terminal access updates immediately. Direct VNC target policy applies to new VNC requests.","settings.workspace.guardrails":"Server scan guardrails","settings.workspace.maxDepth":"Max tree depth","settings.workspace.maxDepthAria":"workspace tree max depth","settings.workspace.maxDepthHintPre":"caps all","settings.workspace.maxDepthHintPost":"requests","settings.workspace.maxEntries":"Max entries per scan","settings.workspace.maxEntriesAria":"workspace tree max entries","settings.workspace.maxEntriesHint":"truncate oversized tree walks earlier","settings.workspace.thisBrowser":"This browser","settings.workspace.refreshInterval":"Refresh interval (seconds)","settings.workspace.refreshIntervalAria":"workspace refresh interval","settings.workspace.folderDepth":"Folder preview scan depth","settings.workspace.folderDepthAria":"folder preview scan depth","settings.workspace.folderDepthHintPre":"set to","settings.workspace.folderDepthHintPost":"to disable folder size preview scans","settings.workspace.footerHint":"Root and folder-expansion tree loads remain shallow; the folder size preview is the deepest workspace scan in the UI.","settings.models.thinkingLevel":"Thinking level","settings.models.noThinking":"Current model does not support thinking.","settings.models.thinkingLevelLabel":"Thinking level:","settings.models.loading":"Loading models…","settings.models.summary":"Model and provider names may wrap in narrow panes to avoid clipping.","settings.models.scopedOnly":"Scoped models only","settings.models.scopedCheckboxPre":"Use Pi","settings.models.scopedCheckboxPost":"for Piclaw model lists","settings.models.scopedHintPre":"Filters this picker and the","settings.models.scopedHintPost":"tool. TUI model selection remains unchanged.","settings.models.colModel":"Model","settings.models.colProvider":"Provider","settings.models.colContext":"Context","settings.models.colReasoning":"Reasoning","settings.models.noMatch":'No models match "{filter}"',"settings.tools.unavailable":"Tool data not available.","settings.tools.search":"Search","settings.tools.matchMode":"Match mode","settings.tools.orMode":"Any keyword (OR) — results match at least one search term","settings.tools.andMode":"All keywords (AND) — results must match every search term","settings.tools.colEnabled":"Enabled","settings.tools.colTool":"Tool","settings.tools.colCompact":"Result compaction","settings.tools.colKind":"Kind","settings.tools.colSummary":"Summary","settings.tools.colSource":"Source","settings.tools.disableCompaction":"Disable tool-result compaction for this tool","settings.tools.enableCompaction":"Enable tool-result compaction for this tool","settings.tools.noMatch":'No tools match "{filter}"',"settings.tools.footer":"Tool activation is managed by the agent runtime. Group checkboxes collapse/expand; the “Compact” column controls tool-result compaction eligibility.","settings.environment.heading":"Environment","settings.environment.introPre":"Showing non-keychain environment variables only. Overrides are stored in extension KV and applied to","settings.environment.introPost":", so subsequent tool calls inherit them.","settings.environment.refresh":"Refresh","settings.environment.addOverride":"Add override","settings.environment.valuePlaceholder":"value","settings.environment.save":"Save","settings.environment.countLine":"{count} variables visible • {overrides} overrides active • {keychain} keychain-injected variables hidden","settings.environment.overridden":"Overridden in KV","settings.environment.inherited":"Inherited from process environment","settings.environment.kindOverride":"override","settings.environment.kindProcess":"process","settings.environment.clear":"Clear","settings.environment.noMatch":'No environment variables match "{filter}".',"settings.environment.refreshedToast":"Environment refreshed.","settings.environment.savedToast":"Saved environment override for {name}.","settings.environment.clearedToast":"Cleared environment override for {name}.","settings.quickActions.loading":"Loading…","settings.quickActions.heading":"Timeline Quick Actions","settings.quickActions.intro":"Choose which actions appear in the timeline typeahead. Agents are always pinned first, then workspace commands, then slash commands.","settings.quickActions.enableAll":"Enable all","settings.quickActions.saving":"Saving…","settings.quickActions.saveApply":"Save & apply","settings.quickActions.workspaceCommands":"Workspace commands","settings.quickActions.noWorkspaceMatch":"No workspace commands match this filter.","settings.quickActions.slashCommands":"Slash commands","settings.quickActions.slashFallback":"slash command","settings.quickActions.noSlashMatch":"No slash commands match this filter.","settings.quickActions.savingToast":"Saving quick actions…","settings.quickActions.savedToast":"Quick Actions saved.","settings.providers.authApiKey":"API key","settings.providers.authConfigured":"Configured","settings.providers.heading":"Providers","settings.providers.tagCustom":"Custom","settings.providers.logout":"Logout","settings.providers.reconfigure":"Reconfigure","settings.providers.setUp":"Set up","settings.providers.setupHint":"Sign-in flows open in the browser. In narrow panes the setup form stacks vertically to avoid clipping.","settings.providers.starting":"Starting…","settings.providers.signInOAuth":"Sign in with OAuth","settings.providers.apiKeyLabel":"API Key","settings.providers.apiKeyPlaceholder":"Enter API key","settings.providers.save":"Save","settings.providers.configuring":"Configuring…","settings.providers.saveConfig":"Save configuration","settings.providers.apiKeyEmpty":"API key cannot be empty.","settings.providers.configuringToast":"Configuring {provider}…","settings.providers.configured":"{provider} configured.","settings.providers.startingOAuth":"Starting OAuth for {provider}…","settings.providers.oauthOpened":"OAuth window opened. Complete the sign-in flow, then close this message.","settings.providers.oauthStarted":"OAuth flow started for {provider}. Check the chat.","settings.providers.loggingOut":"Logging out {provider}…","settings.providers.loggedOut":"Logged out {provider}. Restart may be needed.","settings.general.identity":"Identity","settings.general.userLabel":"User","settings.general.yourName":"Your name","settings.general.agentLabel":"Agent","settings.general.agentName":"Agent name","settings.general.notifications":"Notifications","settings.general.browserNotifications":"Browser notifications","settings.general.notifSecureHint":"Use the \uD83D\uDD14 bell button in the compose bar to enable/disable notifications. Web Push requires HTTPS or localhost.","settings.general.notifInsecureHint":"⚠ Not available — requires a secure context (HTTPS or localhost). Access via SSH tunnel or reverse proxy with TLS to enable.","settings.general.display":"Display","settings.general.systemMeters":"System meters","settings.general.systemMetersHint":"CPU/memory/network meters in the status bar. This browser only.","settings.general.instanceConfig":"Instance Configuration","settings.general.composeUpload":"Compose upload (MB)","settings.general.composeUploadAria":"compose upload limit","settings.general.composeUploadHint":"chat/media attachments","settings.general.workspaceUpload":"Workspace upload (MB)","settings.general.workspaceUploadAria":"workspace upload limit","settings.general.workspaceUploadHint":"defaults to 256 MB; chunked uploads allow up to 1 GB","settings.general.agentRecovery":"Advanced · Agent recovery","settings.general.automaticRecovery":"Automatic recovery","settings.general.automaticRecoveryHint":"Retry recoverable failed turns automatically.","settings.general.recoveryMaxAttempts":"Maximum attempts","settings.general.recoveryMaxAttemptsAria":"automatic recovery maximum attempts","settings.general.recoveryMaxAttemptsHint":"0 inherits the normal retry limit.","settings.general.recoveryTotalBudget":"Total budget (ms)","settings.general.recoveryTotalBudgetAria":"automatic recovery total budget in milliseconds","settings.general.recoveryTotalBudgetHint":"Caps all automatic recovery work for one turn.","settings.general.authentication":"Authentication","settings.general.widgetToken":"Widget bearer token","settings.general.token":"Token","settings.general.hideToken":"Hide token","settings.general.revealToken":"Reveal token","settings.general.copyToken":"Copy token","settings.general.copied":"Copied","settings.general.regenerating":"Regenerating…","settings.general.regenerate":"Regenerate","settings.general.tokenHintPre":"Read-only token for","settings.general.tokenHintMid":"and","settings.general.tokenHintPost":". Use as","settings.general.tokenHintEnd":".","settings.general.copyFailed":"Could not copy widget token. Select the token field and copy manually.","settings.general.regenConfirm":"Regenerate the widget token? Existing macOS widgets using the old token will stop updating.","settings.general.totpTitle":"TOTP setup QR","settings.general.totpConfiguredHint":"Current web-login authenticator secret. Scan this QR to add another authenticator device.","settings.general.totpUnconfiguredHint":"TOTP is not configured for this instance yet, so no setup QR is available.","settings.general.issuer":"Issuer","settings.general.label":"Label","settings.general.secret":"Secret","settings.general.avatarUpload":"Click to upload","settings.developer.heading":"Developer","settings.developer.devMode":"Developer mode","settings.developer.localHint":"This browser only. Developer-mode toggles and add-on catalog overrides are stored in local browser storage.","settings.developer.addonSources":"Add-on Sources","settings.developer.catalogUrl":"Catalog URL","settings.developer.catalogHint":"Primary add-on catalog URL. Leave empty to use the default","settings.developer.additionalCatalogs":"Additional catalog URLs","settings.developer.additionalHint":"Fetched in addition to the primary/default catalog. One URL per line.","settings.developer.repoUrl":"Repo URL","settings.developer.repoHintPre":"Override the git repo used for","settings.developer.repoHintPost":"installs. Leave empty for default.","settings.developer.debug":"Debug","settings.developer.logSse":"Log SSE events","settings.developer.logToolCalls":"Log tool calls","settings.developer.debugHint":"Debug flags take effect on next page reload.","settings.addons.installing":"Installing {slug}…","settings.addons.removing":"Removing {slug}…","settings.addons.installedToast":"Add-on installed.","settings.addons.removedToast":"Add-on removed.","settings.addons.restarting":"Restarting piclaw…","settings.addons.restartComplete":"Restart complete — add-ons refreshed.","settings.addons.restartTimeout":"Backend did not return in time. Reload the page manually.","settings.addons.fetching":"Fetching add-ons…","settings.addons.loadFailed":"Could not load add-ons.","settings.addons.catalogFromPre":"Catalog from","settings.addons.catalogMerged":"{count} catalog sources merged.","settings.addons.installNote":"Package-first install via Bun; restart required after install/uninstall.","settings.addons.failedFetchSingular":"Failed to fetch {count} catalog source:","settings.addons.failedFetchPlural":"Failed to fetch {count} catalog sources:","settings.addons.activeSources":"Active catalog sources ({count})","settings.addons.windowsWarning":"Native Windows add-on installs are higher risk: Bun package installs, symlink cleanup, locked files, and restart timing can all be less predictable than in Linux/WSL. Prefer WSL or a container when possible.","settings.addons.typeExtSkill":"extension + skill","settings.addons.typeSkill":"skill","settings.addons.typeExt":"extension","settings.addons.update":"Update","settings.addons.remove":"Remove","settings.addons.install":"Install","settings.addons.noMatch":'No add-ons match "{filter}"',"settings.addons.restartNotice":"Extension changes are installed but inactive until piclaw restarts.","settings.addons.restartNow":"Restart Now","settings.recordings.modeFull":"full / trusted","settings.recordings.modeMetadata":"metadata only","settings.recordings.modeRedacted":"redacted","settings.recordings.selectPrompt":"Select a recording to inspect, replay, export, or delete it.","settings.recordings.playback":"Playback","settings.recordings.refresh":"Refresh","settings.recordings.delete":"Delete","settings.recordings.status":"Status","settings.recordings.mode":"Mode","settings.recordings.chat":"Chat","settings.recordings.started":"Started","settings.recordings.ended":"Ended","settings.recordings.events":"Events","settings.recordings.redactions":"Redactions","settings.recordings.exportJson":"Export JSON","settings.recordings.exportJsonl":"Export JSONL","settings.recordings.exportHtml":"Export standalone HTML","settings.recordings.eventSummary":"Event summary","settings.recordings.inspectHint":"Open or refresh details to inspect trace events.","settings.recordings.firstEvents":"First events","settings.recordings.heading":"Session Recording","settings.recordings.intro":"Opt-in trace capture for deterministic playback and screen-recording exports. Playback never calls live agent or tool endpoints.","settings.recordings.chatJid":"Chat JID","settings.recordings.title":"Title","settings.recordings.titlePlaceholder":"Demo recording","settings.recordings.modeLabelField":"Mode","settings.recordings.optRedacted":"Redacted","settings.recordings.optMetadata":"Metadata only","settings.recordings.optFull":"Full / trusted local","settings.recordings.includeSnapshot":"Include timeline snapshot","settings.recordings.extraKeys":"Extra redacted keys","settings.recordings.extraPatterns":"Extra regex patterns","settings.recordings.stopCurrent":"Stop current chat recording","settings.recordings.start":"Start recording","settings.recordings.redactionPreview":"Redaction preview","settings.recordings.previewRedaction":"Preview redaction","settings.recordings.loading":"Loading recordings…","settings.recordings.noneYet":"No recordings yet.","settings.recordings.noneYetHint":"Start a recording above, then use playback/export for deterministic screen capture.","settings.recordings.listLabel":"Session recordings","settings.recordings.eventsCount":"{count} events","settings.recordings.noMatch":"No recordings match “{filter}”.","settings.recordings.startedToast":"Recording started for {chat}.","settings.recordings.startFailed":"Failed to start recording.","settings.recordings.stoppedToast":"Recording stopped for {chat}.","settings.recordings.stopFailed":"Failed to stop recording.","settings.recordings.deleteConfirm":"Delete recording {id}?","settings.recordings.deletedToast":"Recording deleted.","settings.recordings.deleteFailed":"Failed to delete recording.","settings.recordings.loadOneFailed":"Failed to load recording.","settings.recordings.loadFailed":"Failed to load recordings.","settings.recordings.previewFailed":"Preview failed.","settings.keychain.loadFailed":"Failed to load keychain.","settings.keychain.addFailed":"Failed to add entry.","settings.keychain.deleteFailed":"Failed to delete entry.","settings.keychain.saveNotesFailed":"Failed to save notes.","settings.keychain.revealFailed":"Failed to reveal.","settings.keychain.loading":"Loading keychain…","settings.keychain.entryCountSingular":"{count} entry","settings.keychain.entryCountPlural":"{count} entries","settings.keychain.matchingFilter":' matching "{filter}"',"settings.keychain.encryptedSuffix":", encrypted at rest.","settings.keychain.clickPrefix":"Click","settings.keychain.revealSuffix":"to reveal.","settings.keychain.cancel":"Cancel","settings.keychain.addEntry":"+ Add entry","settings.keychain.namePlaceholder":"Entry name (e.g. github/my-token)","settings.keychain.secretPlaceholder":"Secret value","settings.keychain.usernamePlaceholder":"Username (optional)","settings.keychain.saving":"Saving…","settings.keychain.save":"Save","settings.keychain.userNotePlaceholder":"User note (visible in this UI only)","settings.keychain.agentNotePlaceholder":"Agent note (safe to expose to agents)","settings.keychain.noMatchFilter":"No entries match the filter.","settings.keychain.noEntries":"No keychain entries.","settings.keychain.hideSecret":"Hide secret","settings.keychain.revealSecret":"Reveal secret","settings.keychain.deleteQ":"Delete?","settings.keychain.yes":"Yes","settings.keychain.no":"No","settings.keychain.deleteTitle":"Delete","settings.keychain.userNote":"User note","settings.keychain.agentNote":"Agent-readable note","settings.keychain.userNoteHint":"Human/UI note only","settings.keychain.agentNoteHint":"Safe guidance for agents","settings.keychain.saveNotes":"Save notes","settings.keychain.masterPassword":"Master password:","settings.keychain.masterPasswordPlaceholder":"Enter keychain master password","settings.keychain.unlock":"Unlock","settings.keychain.totpCode":"TOTP code:","settings.keychain.verify":"Verify","settings.keychain.username":"Username","settings.keychain.copyUsername":"Copy username","settings.keychain.secret":"Secret","settings.keychain.copySecret":"Copy secret","settings.tasks.internalProtected":"internal/protected","settings.tasks.noRunLogs":"No run logs recorded yet.","settings.tasks.noSummary":"No summary","settings.tasks.selectPrompt":"Select a task to inspect schedule, status, and run history.","settings.tasks.pause":"Pause","settings.tasks.resume":"Resume","settings.tasks.delete":"Delete","settings.tasks.status":"Status","settings.tasks.kind":"Kind","settings.tasks.schedule":"Schedule","settings.tasks.nextRun":"Next run","settings.tasks.lastRun":"Last run","settings.tasks.lastResult":"Last result","settings.tasks.chat":"Chat","settings.tasks.model":"Model","settings.tasks.cwd":"CWD","settings.tasks.timeout":"Timeout","settings.tasks.protection":"Protection","settings.tasks.protectionHint":"Internal task actions require explicit confirmation.","settings.tasks.command":"Command","settings.tasks.prompt":"Prompt","settings.tasks.recentRuns":"Recent runs","settings.tasks.activeLabel":"Active","settings.tasks.pausedLabel":"Paused","settings.tasks.completedLabel":"Completed","settings.tasks.allStatuses":"All statuses","settings.tasks.filterChatPlaceholder":"Filter chat JID…","settings.tasks.refresh":"Refresh","settings.tasks.loading":"Loading scheduled tasks…","settings.tasks.noneFound":"No scheduled tasks found.","settings.tasks.noneFoundHint":"Tasks created with reminders, `/tasks`, or the scheduler tool will appear here.","settings.tasks.listLabel":"Scheduled tasks","settings.tasks.next":"Next","settings.tasks.last":"Last","settings.tasks.noMatch":"No tasks match “{filter}”.","settings.tasks.confirmDelete":"Delete scheduled task {id}?","settings.tasks.confirmPause":"Pause scheduled task {id}?","settings.tasks.confirmResume":"Resume scheduled task {id}?","settings.tasks.confirmProtected":"Task {id} is internal/protected. Continue with {action}?","settings.tasks.deleting":"Deleting {id}…","settings.tasks.pausing":"Pausing {id}…","settings.tasks.resuming":"Resuming {id}…","settings.tasks.deletedToast":"Scheduled task {id} deleted.","settings.tasks.pausedToast":"Scheduled task {id} paused.","settings.tasks.resumedToast":"Scheduled task {id} resumed.","settings.tasks.actionFailed":"Failed to {action} task.","settings.tasks.loadFailed":"Failed to load scheduled tasks.","settings.compaction.appliedNotice":"Compaction settings applied. Existing turns keep their current timers; new turns use the updated values.","settings.compaction.saving":"Saving compaction settings…","settings.compaction.saveFailed":"Failed to save compaction settings.","settings.compaction.saved":"Compaction settings saved.","settings.compaction.clearing":"Clearing compaction suppression for {chat}…","settings.compaction.clearFailed":"Failed to clear compaction suppression.","settings.compaction.cleared":"Cleared compaction suppression for {chat}.","settings.compaction.autoHeading":"Automatic compaction","settings.compaction.enableAutomatic":"Enable automatic compaction","settings.compaction.enableAutomaticHint":"Piclaw-managed pre-prompt/idle compaction. The upstream agent auto-compactor stays suppressed internally.","settings.compaction.processingMethod":"Processing method","settings.compaction.methodSelective":"Selective","settings.compaction.methodSelectiveHint":"Extract high-value continuity excerpts, using complete progressive coverage whenever a bounded prompt cannot represent every discarded source event.","settings.compaction.methodPipelined":"Pipelined","settings.compaction.methodPipelinedHint":"Canonicalize and classify every discarded source event with an auditable coverage ledger before summarizing.","settings.compaction.remoteNative":"Provider-native compaction","settings.compaction.remoteNativeHint":"Opt-in for explicitly supported providers only ({providers}). Any failure falls back atomically to the selected local method.","settings.compaction.remoteTimeout":"Provider-native timeout (sec)","settings.compaction.remoteTimeoutAria":"provider-native compaction timeout","settings.compaction.remoteTimeoutHint":"Deadline for the remote pre-pass before local fallback.","settings.compaction.enableToolResult":"Enable tool-result compaction","settings.compaction.enableToolResultHint":"When disabled, large tool results stay inline and are not externalized into searchable tool-output handles.","settings.compaction.semanticSummaries":"Semantic summaries for compacted tool results","settings.compaction.semanticSummariesHint":"When enabled, compacted outputs include a semantic summary generated with the active model (preview fallback on failure).","settings.compaction.inputLimit":"Semantic summary input limit (chars)","settings.compaction.inputLimitAria":"semantic summary input limit","settings.compaction.inputLimitHint":"Maximum characters sampled from full tool output for semantic summarization.","settings.compaction.maxTokens":"Semantic summary output max tokens","settings.compaction.maxTokensAria":"semantic summary max tokens","settings.compaction.maxTokensHint":"Upper bound for generated summary length.","settings.compaction.summaryTimeout":"Semantic summary timeout (sec)","settings.compaction.summaryTimeoutAria":"semantic summary timeout","settings.compaction.summaryTimeoutHint":"Abort semantic summary generation after this timeout and fall back to preview compaction.","settings.compaction.threshold":"Compaction threshold (%)","settings.compaction.thresholdAria":"compaction threshold","settings.compaction.thresholdHint":"auto-compact when context exceeds this % of window","settings.compaction.timeout":"Compaction timeout (sec)","settings.compaction.timeoutAria":"compaction timeout","settings.compaction.timeoutHint":"Abort a stuck pre-prompt/manual compaction instead of hanging forever.","settings.compaction.backoffBase":"Failure backoff base (min)","settings.compaction.backoffBaseAria":"compaction backoff base","settings.compaction.backoffBaseHint":"First suppression window after a compaction failure.","settings.compaction.backoffMax":"Failure backoff max (min)","settings.compaction.backoffMaxAria":"compaction backoff max","settings.compaction.backoffMaxHint":"Upper bound for exponential suppression after repeated failures.","settings.compaction.decayFactor":"Backoff decay factor","settings.compaction.decayFactorAria":"backoff decay factor","settings.compaction.decayFactorHint":"% — halves backoff after each successful compaction","settings.compaction.watchdogHeading":"Stall watchdog","settings.compaction.enableWatchdog":"Enable watchdog","settings.compaction.enableWatchdogHint":"Disabled by default. When enabled, a helper process terminates the runtime if an active phase stops heartbeating.","settings.compaction.watchdogTimeout":"Watchdog timeout (sec)","settings.compaction.watchdogTimeoutAria":"watchdog timeout","settings.compaction.watchdogTimeoutHint":"How long an active phase can go without a heartbeat before the watchdog kills the runtime.","settings.compaction.suppressionsHeading":"Active compaction suppressions","settings.compaction.noBackoff":"No chats are currently under compaction backoff.","settings.compaction.clear":"Clear","settings.compaction.phasesHeading":"Live watchdog phases","settings.compaction.noPhases":"No active tracked phases right now.","menu.title":"Menu","menu.showWorkspace":"Show workspace","menu.hideWorkspace":"Hide workspace","menu.openExplorer":"Open explorer","menu.chatOnly":"Chat-only mode","menu.exitChatOnly":"Exit chat-only mode","menu.openTerminal":"Open terminal in tab","menu.openVnc":"Open VNC in tab","menu.newFile":"New file","menu.openRecent":"Open Recent","menu.refreshTree":"Refresh tree","menu.reindex":"Reindex workspace","menu.showHidden":"Show hidden files","menu.hideHidden":"Hide hidden files","menu.scale":"Scale","menu.settings":"Settings"},iu={"compose.placeholder":"输入消息（回车发送，Shift+回车换行）...","compose.send":"发送","compose.stop":"停止","compose.searchPlaceholder":"搜索（回车运行）...","compose.clearAll":"清除全部","compose.clearAllTitle":"清除所有附件和引用","compose.scope":"范围","compose.searchScope":"搜索范围","compose.scopeCurrent":"当前","compose.scopeBranchFamily":"分支系列","compose.scopeAll":"所有聊天","compose.filterImages":"图片","compose.filterAttachments":"附件","compose.search":"搜索","compose.closeSearch":"关闭搜索","compose.shareLocation":"分享位置","compose.attachFile":"附加文件","compose.queueControls":"排队后续消息控制","compose.moveUp":"上移","compose.moveUpQueue":"在队列中上移","compose.moveDown":"下移","compose.moveDownQueue":"在队列中下移","compose.editInCompose":"在输入框中编辑","compose.returnToEditor":"将排队消息返回编辑器","compose.injectSteer":"作为引导插入排队的后续消息","compose.steer":"引导","compose.cancelQueued":"取消排队消息","compose.resizeInput":"调整消息输入框大小","compose.resizeInputHint":"拖动以调整消息输入框大小","compose.modelPicker":"模型选择器","compose.sessionsAndAgents":"会话与代理","compose.openModelPicker":"打开模型选择器","compose.newBranchTitle":"从此聊天创建新分支","compose.newRootTitle":"创建一个干净的根会话，例如 web:ops","compose.renameSessionTitle":"重命名当前会话","compose.pruneSessionTitle":"删除（修剪）当前代理/会话分支","compose.filterImagesTitle":"仅显示含图片的消息","compose.filterAttachmentsTitle":"仅显示含附件的消息","compose.selectModel":"选择模型","compose.loadingModels":"正在加载模型…","compose.noModels":"没有可用的模型。","compose.nextModel":"下一个模型","compose.manageSessions":"管理会话与代理","compose.noSessions":"暂无其他会话。","compose.newBranch":"新建分支","compose.newRoot":"新建根会话…","compose.mergeCurrent":"将当前合并到父级","compose.renameCurrent":"重命名当前…","compose.deleteCurrent":"删除当前…","compose.mergeInto":"将此分支合并到 {target}","compose.mergeBlocked":"当此分支处于活动状态或有子分支时无法合并","workspace.title":"工作区","workspace.moveConfirm":"将{entry}“{name}”从{source}移动到{target}？","workspace.root":"工作区根目录","workspace.file":"文件","workspace.folder":"文件夹","workspace.newFile":"新建文件","workspace.refresh":"刷新","workspace.actions":"工作区操作","workspace.uploadFiles":"上传文件","workspace.reindexing":"正在重建索引…","workspace.deleteFile":"删除文件","workspace.download":"下载","workspace.uploadToFolder":"上传文件到此文件夹","workspace.addFolderHint":"将文件夹提示添加到输入框","workspace.downloadZip":"将文件夹下载为 zip","workspace.openInTab":"在标签页打开","workspace.openInEditor":"在编辑器打开","workspace.renameSelected":"重命名所选","workspace.downloadSelectedFile":"下载所选文件","workspace.downloadSelectedFolder":"下载所选文件夹（zip）","workspace.deleteSelectedFile":"删除所选文件","shell.settings":"设置","shell.newChat":"新建对话","shell.connecting":"连接中…","shell.connected":"已连接","language.label":"语言","settings.title":"设置","settings.close":"关闭（Esc）","settings.filter":"筛选…","settings.loading":"加载设置中…","settings.section.general":"常规","settings.section.sessions":"会话","settings.section.recordings":"录制","settings.section.compaction":"压缩","settings.section.keyboard":"键盘","settings.section.workspace":"工作区","settings.section.environment":"环境","settings.section.providers":"提供商","settings.section.models":"模型","settings.section.theme":"外观","settings.section.scheduled-tasks":"计划任务","settings.section.quick-actions":"快捷操作","settings.section.keychain":"密钥串","settings.section.tools":"工具","settings.section.addons":"插件","settings.placeholder.recordings":"筛选录制…","settings.placeholder.keyboard":"筛选快捷键…","settings.placeholder.environment":"筛选环境…","settings.placeholder.models":"筛选模型…","settings.placeholder.scheduled-tasks":"筛选计划任务…","settings.placeholder.quick-actions":"筛选快捷操作…","settings.placeholder.keychain":"筛选条目…","settings.placeholder.tools":"筛选工具…","settings.placeholder.addons":"筛选插件…","preview.close":"关闭","preview.loading":"正在加载预览…","preview.files":"文件","preview.folders":"文件夹","preview.compressed":"压缩后","preview.uncompressed":"未压缩","preview.name":"名称","preview.type":"类型","preview.method":"方法","preview.size":"大小","post.deleteMessage":"删除消息","post.tooLarge":"消息过大，无法显示。","post.previewTruncated":"预览已截断。","post.submitted":"已提交","post.discard":"丢弃","post.save":"保存","post.cancel":"取消","post.addNote":"添加备注","post.addNotePlaceholder":"添加备注…","post.restartNotice":"正在重启 — 原因：{reason}","post.restartCompleted":"重启完成。","post.agentSelfResume":"代理自行恢复","tab.close":"关闭","tab.closeOthers":"关闭其他","tab.closeAll":"全部关闭","tab.reattach":"重新附加","tab.openInWindow":"在窗口中打开","tab.openInNewTab":"在新标签页打开","tab.pinned":"已固定","tab.detached":"已分离","tab.openSeparateWindow":"在独立窗口中打开","status.trackedVariables":"跟踪的变量","status.attachToSession":"附加到会话","status.files":"文件","status.proposedDiff":"建议的差异","status.copyTmux":"复制 tmux 命令","status.experimentDuration":"实验时长","status.sinceLastActivity":"自上次活动以来","annotator.title":"标注图片","annotator.typeLabel":"输入标签…","annotator.undo":"撤销","annotator.resetZoom":"重置缩放","tree.filter":"筛选…","tree.sessionTree":"会话树","btw.label":"BTW 附加对话","btw.close":"关闭 BTW","btw.thinking":"思考中","mdpreview.close":"关闭预览","mdpreview.unavailable":"预览不可用","widget.close":"关闭小部件","oobe.gettingStarted":"入门指南","oobe.needsSetupTitle":"实例需要设置","oobe.configuredTitle":"实例已配置","oobe.needsSetupBody":"此实例尚未配置。请打开“设置”并设置 AI 提供商/模型以开始发送请求。","oobe.configuredBody":"此实例看起来已配置。请在“设置”中查看或更新提供商和模型设置。","oobe.openSettings":"打开设置","oobe.dismiss":"忽略","oobe.done":"完成","palette.placeholder":"输入以跳转到代理、工作区操作或斜杠命令…","palette.hideWorkspace":"隐藏工作区","palette.showWorkspace":"显示工作区","palette.hideWorkspaceDesc":"隐藏工作区侧边栏。","palette.showWorkspaceDesc":"显示工作区侧边栏。","palette.exitChatOnly":"退出仅聊天模式","palette.chatOnly":"仅聊天模式","palette.exitChatOnlyDesc":"返回分屏工作区布局。","palette.chatOnlyDesc":"切换到仅聊天布局。","palette.groupAgents":"代理","palette.groupWorkspace":"工作区","palette.groupSlash":"斜杠命令","palette.hintMove":"移动","palette.hintSelect":"选择","palette.hintPopOut":"弹出","palette.hintClose":"关闭","settings.appliedNotice":"设置已应用。更改将在下一回合生效。","settings.sessions.lifecycle":"会话生命周期","settings.sessions.autoRotate":"自动轮换会话","settings.sessions.maxSize":"最大会话大小（MB）","settings.sessions.maxSizeAria":"最大会话大小","settings.sessions.agentBehaviour":"代理行为","settings.sessions.toolBudget":"工具使用预算","settings.sessions.toolBudgetAria":"工具使用预算","settings.sessions.toolBudgetHint":"每回合最大已完成工具执行次数","settings.sessions.isolation":"会话隔离","settings.sessions.isolationNone":"无 — 完全跨会话可见","settings.sessions.isolationSummary":"摘要 — 工具可见，无参数","settings.sessions.isolationFull":"完全 — 会话之间不可见","settings.editor.heading":"编辑器","settings.editor.vimMode":"Vim 模式","settings.editor.showWhitespace":"显示空白字符","settings.editor.livePreview":"Markdown 实时预览","settings.editor.fontSize":"字号（px）","settings.editor.fontSizeAria":"编辑器字号","settings.editor.fontFamily":"字体","settings.editor.fontFamilyPlaceholder":"monospace（默认）","settings.editor.localOnlyHint":"仅限此浏览器。编辑器更改存储在本地浏览器中，并在下次打开或重新加载文件标签页时生效。","settings.appearance.syncing":"正在同步外观…","settings.appearance.default":"默认","settings.appearance.autoLightDark":"自动（浅色/深色）","settings.appearance.tint":"色调：","settings.appearance.clearTint":"清除色调","settings.appearance.none":"无","settings.appearance.outputPadding":"输出内边距","settings.appearance.outputPaddingHint":"消息和思考面板周围的额外空间。","settings.keyboard.heading":"键盘","settings.keyboard.hint1":"将应用级快捷键自定义为逗号分隔的绑定。更改立即生效。","settings.keyboard.hint1b":"已保留用于关闭/中止，无法重新绑定。","settings.keyboard.hint2mid":"以及键入","settings.keyboard.hint2end":"（在输入框外）可打开此面板。","settings.keyboard.resetAll":"全部重置为默认","settings.keyboard.defaultColon":"默认：","settings.keyboard.save":"保存","settings.keyboard.defaultBtn":"默认","settings.keyboard.noMatch":"没有匹配此筛选的快捷键。","settings.keyboard.invalidShortcut":"无效快捷键：{token}。Escape 已保留，无法重新绑定。","settings.keyboard.saved":"快捷键已保存。","settings.keyboard.resetOne":"快捷键已重置为默认。","settings.keyboard.resetAllDone":"快捷键已全部重置为默认。","settings.workspace.serverApplied":"工作区设置已应用。服务器端限制立即影响新的工作区请求。","settings.workspace.browserApplied":"浏览器工作区设置已在此标签页立即应用。","settings.workspace.access":"访问","settings.workspace.enableTerminal":"启用 Web 终端","settings.workspace.allowVnc":"允许直接 VNC 目标","settings.workspace.accessHint":"终端访问立即更新。直接 VNC 目标策略适用于新的 VNC 请求。","settings.workspace.guardrails":"服务器扫描防护","settings.workspace.maxDepth":"最大树深度","settings.workspace.maxDepthAria":"工作区树最大深度","settings.workspace.maxDepthHintPre":"限制所有","settings.workspace.maxDepthHintPost":"请求","settings.workspace.maxEntries":"每次扫描最大条目数","settings.workspace.maxEntriesAria":"工作区树最大条目数","settings.workspace.maxEntriesHint":"更早截断超大的树遍历","settings.workspace.thisBrowser":"此浏览器","settings.workspace.refreshInterval":"刷新间隔（秒）","settings.workspace.refreshIntervalAria":"工作区刷新间隔","settings.workspace.folderDepth":"文件夹预览扫描深度","settings.workspace.folderDepthAria":"文件夹预览扫描深度","settings.workspace.folderDepthHintPre":"设为","settings.workspace.folderDepthHintPost":"以禁用文件夹大小预览扫描","settings.workspace.footerHint":"根目录和文件夹展开的树加载保持较浅；文件夹大小预览是 UI 中最深的工作区扫描。","settings.models.thinkingLevel":"思考级别","settings.models.noThinking":"当前模型不支持思考。","settings.models.thinkingLevelLabel":"思考级别：","settings.models.loading":"正在加载模型…","settings.models.summary":"在狭窄面板中，模型和提供商名称可能换行以避免裁切。","settings.models.scopedOnly":"仅限范围内模型","settings.models.scopedCheckboxPre":"使用 Pi 的","settings.models.scopedCheckboxPost":"作为 Piclaw 模型列表","settings.models.scopedHintPre":"筛选此选择器和","settings.models.scopedHintPost":"工具。TUI 模型选择保持不变。","settings.models.colModel":"模型","settings.models.colProvider":"提供商","settings.models.colContext":"上下文","settings.models.colReasoning":"推理","settings.models.noMatch":"没有匹配 “{filter}” 的模型","settings.tools.unavailable":"工具数据不可用。","settings.tools.search":"搜索","settings.tools.matchMode":"匹配模式","settings.tools.orMode":"任意关键词（OR）— 结果至少匹配一个搜索词","settings.tools.andMode":"所有关键词（AND）— 结果必须匹配每个搜索词","settings.tools.colEnabled":"已启用","settings.tools.colTool":"工具","settings.tools.colCompact":"结果压缩","settings.tools.colKind":"类型","settings.tools.colSummary":"摘要","settings.tools.colSource":"来源","settings.tools.disableCompaction":"为此工具禁用工具结果压缩","settings.tools.enableCompaction":"为此工具启用工具结果压缩","settings.tools.noMatch":"没有匹配 “{filter}” 的工具","settings.tools.footer":"工具激活由代理运行时管理。组复选框可折叠/展开；“压缩”列控制工具结果压缩资格。","settings.environment.heading":"环境","settings.environment.introPre":"仅显示非 keychain 环境变量。覆盖项存储在扩展 KV 中并应用于","settings.environment.introPost":"，因此后续工具调用会继承它们。","settings.environment.refresh":"刷新","settings.environment.addOverride":"添加覆盖","settings.environment.valuePlaceholder":"值","settings.environment.save":"保存","settings.environment.countLine":"{count} 个变量可见 • {overrides} 个覆盖生效 • {keychain} 个 keychain 注入变量已隐藏","settings.environment.overridden":"在 KV 中覆盖","settings.environment.inherited":"继承自进程环境","settings.environment.kindOverride":"覆盖","settings.environment.kindProcess":"进程","settings.environment.clear":"清除","settings.environment.noMatch":"没有匹配 “{filter}” 的环境变量。","settings.environment.refreshedToast":"环境已刷新。","settings.environment.savedToast":"已保存 {name} 的环境覆盖。","settings.environment.clearedToast":"已清除 {name} 的环境覆盖。","settings.quickActions.loading":"加载中…","settings.quickActions.heading":"时间线快捷操作","settings.quickActions.intro":"选择哪些操作出现在时间线预输入中。代理始终优先固定，然后是工作区命令，再是斜杠命令。","settings.quickActions.enableAll":"全部启用","settings.quickActions.saving":"保存中…","settings.quickActions.saveApply":"保存并应用","settings.quickActions.workspaceCommands":"工作区命令","settings.quickActions.noWorkspaceMatch":"没有匹配此筛选的工作区命令。","settings.quickActions.slashCommands":"斜杠命令","settings.quickActions.slashFallback":"斜杠命令","settings.quickActions.noSlashMatch":"没有匹配此筛选的斜杠命令。","settings.quickActions.savingToast":"正在保存快捷操作…","settings.quickActions.savedToast":"快捷操作已保存。","settings.providers.authApiKey":"API 密钥","settings.providers.authConfigured":"已配置","settings.providers.heading":"提供商","settings.providers.tagCustom":"自定义","settings.providers.logout":"注销","settings.providers.reconfigure":"重新配置","settings.providers.setUp":"设置","settings.providers.setupHint":"登录流程在浏览器中打开。在狭窄面板中，设置表单会垂直堆叠以避免裁切。","settings.providers.starting":"启动中…","settings.providers.signInOAuth":"使用 OAuth 登录","settings.providers.apiKeyLabel":"API 密钥","settings.providers.apiKeyPlaceholder":"输入 API 密钥","settings.providers.save":"保存","settings.providers.configuring":"配置中…","settings.providers.saveConfig":"保存配置","settings.providers.apiKeyEmpty":"API 密钥不能为空。","settings.providers.configuringToast":"正在配置 {provider}…","settings.providers.configured":"{provider} 已配置。","settings.providers.startingOAuth":"正在为 {provider} 启动 OAuth…","settings.providers.oauthOpened":"OAuth 窗口已打开。完成登录流程，然后关闭此消息。","settings.providers.oauthStarted":"已为 {provider} 启动 OAuth 流程。请查看聊天。","settings.providers.loggingOut":"正在注销 {provider}…","settings.providers.loggedOut":"已注销 {provider}。可能需要重启。","settings.general.identity":"身份","settings.general.userLabel":"用户","settings.general.yourName":"你的名字","settings.general.agentLabel":"代理","settings.general.agentName":"代理名称","settings.general.notifications":"通知","settings.general.browserNotifications":"浏览器通知","settings.general.notifSecureHint":"使用输入栏中的 \uD83D\uDD14 铃铛按钮来启用/禁用通知。Web Push 需要 HTTPS 或 localhost。","settings.general.notifInsecureHint":"⚠ 不可用 — 需要安全上下文（HTTPS 或 localhost）。通过 SSH 隐道或带 TLS 的反向代理访问以启用。","settings.general.display":"显示","settings.general.systemMeters":"系统仪表","settings.general.systemMetersHint":"状态栏中的 CPU/内存/网络仪表。仅限此浏览器。","settings.general.instanceConfig":"实例配置","settings.general.composeUpload":"撰写上传（MB）","settings.general.composeUploadAria":"撰写上传限制","settings.general.composeUploadHint":"聊天/媒体附件","settings.general.workspaceUpload":"工作区上传（MB）","settings.general.workspaceUploadAria":"工作区上传限制","settings.general.workspaceUploadHint":"默认为 256 MB；分块上传最多允许 1 GB","settings.general.agentRecovery":"高级 · 代理恢复","settings.general.automaticRecovery":"自动恢复","settings.general.automaticRecoveryHint":"自动重试可恢复的失败回合。","settings.general.recoveryMaxAttempts":"最大尝试次数","settings.general.recoveryMaxAttemptsAria":"自动恢复最大尝试次数","settings.general.recoveryMaxAttemptsHint":"0 表示继承常规重试限制。","settings.general.recoveryTotalBudget":"总预算（毫秒）","settings.general.recoveryTotalBudgetAria":"自动恢复总预算（毫秒）","settings.general.recoveryTotalBudgetHint":"限制单个回合的所有自动恢复工作。","settings.general.authentication":"身份验证","settings.general.widgetToken":"小部件 bearer 令牌","settings.general.token":"令牌","settings.general.hideToken":"隐藏令牌","settings.general.revealToken":"显示令牌","settings.general.copyToken":"复制令牌","settings.general.copied":"已复制","settings.general.regenerating":"正在重新生成…","settings.general.regenerate":"重新生成","settings.general.tokenHintPre":"只读令牌，用于","settings.general.tokenHintMid":"和","settings.general.tokenHintPost":"。用作","settings.general.tokenHintEnd":"。","settings.general.copyFailed":"无法复制小部件令牌。请选择令牌字段并手动复制。","settings.general.regenConfirm":"重新生成小部件令牌？使用旧令牌的现有 macOS 小部件将停止更新。","settings.general.totpTitle":"TOTP 设置二维码","settings.general.totpConfiguredHint":"当前 Web 登录验证器密钥。扫描此二维码以添加另一个验证器设备。","settings.general.totpUnconfiguredHint":"此实例尚未配置 TOTP，因此没有可用的设置二维码。","settings.general.issuer":"颁发者","settings.general.label":"标签","settings.general.secret":"密钥","settings.general.avatarUpload":"点击上传","settings.developer.heading":"开发者","settings.developer.devMode":"开发者模式","settings.developer.localHint":"仅限此浏览器。开发者模式开关和插件目录覆盖存储在本地浏览器存储中。","settings.developer.addonSources":"插件来源","settings.developer.catalogUrl":"目录 URL","settings.developer.catalogHint":"主插件目录 URL。留空以使用默认值","settings.developer.additionalCatalogs":"其他目录 URL","settings.developer.additionalHint":"在主/默认目录之外额外获取。每行一个 URL。","settings.developer.repoUrl":"仓库 URL","settings.developer.repoHintPre":"覆盖用于","settings.developer.repoHintPost":"安装的 git 仓库。留空以使用默认值。","settings.developer.debug":"调试","settings.developer.logSse":"记录 SSE 事件","settings.developer.logToolCalls":"记录工具调用","settings.developer.debugHint":"调试标志在下次页面重新加载时生效。","settings.addons.installing":"正在安装 {slug}…","settings.addons.removing":"正在移除 {slug}…","settings.addons.installedToast":"插件已安装。","settings.addons.removedToast":"插件已移除。","settings.addons.restarting":"正在重启 piclaw…","settings.addons.restartComplete":"重启完成 — 插件已刷新。","settings.addons.restartTimeout":"后端未能及时返回。请手动重新加载页面。","settings.addons.fetching":"正在获取插件…","settings.addons.loadFailed":"无法加载插件。","settings.addons.catalogFromPre":"目录来自","settings.addons.catalogMerged":"已合并 {count} 个目录来源。","settings.addons.installNote":"通过 Bun 优先安装包；安装/卸载后需要重启。","settings.addons.failedFetchSingular":"获取 {count} 个目录来源失败：","settings.addons.failedFetchPlural":"获取 {count} 个目录来源失败：","settings.addons.activeSources":"活动目录来源（{count}）","settings.addons.windowsWarning":"原生 Windows 插件安装风险更高：Bun 包安装、符号链接清理、锁定文件和重启时机都可能不如 Linux/WSL 可预测。如果可能，请优先使用 WSL 或容器。","settings.addons.typeExtSkill":"扩展 + 技能","settings.addons.typeSkill":"技能","settings.addons.typeExt":"扩展","settings.addons.update":"更新","settings.addons.remove":"移除","settings.addons.install":"安装","settings.addons.noMatch":"没有匹配 “{filter}” 的插件","settings.addons.restartNotice":"扩展更改已安装，但在 piclaw 重启之前处于非活动状态。","settings.addons.restartNow":"立即重启","settings.recordings.modeFull":"完整 / 受信任","settings.recordings.modeMetadata":"仅元数据","settings.recordings.modeRedacted":"已脱敏","settings.recordings.selectPrompt":"选择一个录制以检查、回放、导出或删除。","settings.recordings.playback":"回放","settings.recordings.refresh":"刷新","settings.recordings.delete":"删除","settings.recordings.status":"状态","settings.recordings.mode":"模式","settings.recordings.chat":"聊天","settings.recordings.started":"开始","settings.recordings.ended":"结束","settings.recordings.events":"事件","settings.recordings.redactions":"脱敏","settings.recordings.exportJson":"导出 JSON","settings.recordings.exportJsonl":"导出 JSONL","settings.recordings.exportHtml":"导出独立 HTML","settings.recordings.eventSummary":"事件摘要","settings.recordings.inspectHint":"打开或刷新详情以检查跟踪事件。","settings.recordings.firstEvents":"首批事件","settings.recordings.heading":"会话录制","settings.recordings.intro":"选择性加入的跟踪捕获，用于确定性回放和屏幕录制导出。回放绝不会调用实时代理或工具端点。","settings.recordings.chatJid":"聊天 JID","settings.recordings.title":"标题","settings.recordings.titlePlaceholder":"演示录制","settings.recordings.modeLabelField":"模式","settings.recordings.optRedacted":"已脱敏","settings.recordings.optMetadata":"仅元数据","settings.recordings.optFull":"完整 / 受信任本地","settings.recordings.includeSnapshot":"包含时间线快照","settings.recordings.extraKeys":"额外脱敏键","settings.recordings.extraPatterns":"额外正则模式","settings.recordings.stopCurrent":"停止当前聊天录制","settings.recordings.start":"开始录制","settings.recordings.redactionPreview":"脱敏预览","settings.recordings.previewRedaction":"预览脱敏","settings.recordings.loading":"正在加载录制…","settings.recordings.noneYet":"还没有录制。","settings.recordings.noneYetHint":"在上方开始录制，然后使用回放/导出进行确定性屏幕捕获。","settings.recordings.listLabel":"会话录制","settings.recordings.eventsCount":"{count} 个事件","settings.recordings.noMatch":"没有匹配 “{filter}” 的录制。","settings.recordings.startedToast":"已为 {chat} 开始录制。","settings.recordings.startFailed":"开始录制失败。","settings.recordings.stoppedToast":"已为 {chat} 停止录制。","settings.recordings.stopFailed":"停止录制失败。","settings.recordings.deleteConfirm":"删除录制 {id}？","settings.recordings.deletedToast":"录制已删除。","settings.recordings.deleteFailed":"删除录制失败。","settings.recordings.loadOneFailed":"加载录制失败。","settings.recordings.loadFailed":"加载录制失败。","settings.recordings.previewFailed":"预览失败。","settings.keychain.loadFailed":"加载密钥链失败。","settings.keychain.addFailed":"添加条目失败。","settings.keychain.deleteFailed":"删除条目失败。","settings.keychain.saveNotesFailed":"保存备注失败。","settings.keychain.revealFailed":"显示失败。","settings.keychain.loading":"正在加载密钥链…","settings.keychain.entryCountSingular":"{count} 个条目","settings.keychain.entryCountPlural":"{count} 个条目","settings.keychain.matchingFilter":' 匹配 "{filter}"',"settings.keychain.encryptedSuffix":"，静态加密。","settings.keychain.clickPrefix":"点击","settings.keychain.revealSuffix":"以显示。","settings.keychain.cancel":"取消","settings.keychain.addEntry":"+ 添加条目","settings.keychain.namePlaceholder":"条目名称（例如 github/my-token）","settings.keychain.secretPlaceholder":"密钥值","settings.keychain.usernamePlaceholder":"用户名（可选）","settings.keychain.saving":"正在保存…","settings.keychain.save":"保存","settings.keychain.userNotePlaceholder":"用户备注（仅在此界面可见）","settings.keychain.agentNotePlaceholder":"代理备注（可安全暴露给代理）","settings.keychain.noMatchFilter":"没有条目匹配筛选条件。","settings.keychain.noEntries":"没有密钥链条目。","settings.keychain.hideSecret":"隐藏密钥","settings.keychain.revealSecret":"显示密钥","settings.keychain.deleteQ":"删除？","settings.keychain.yes":"是","settings.keychain.no":"否","settings.keychain.deleteTitle":"删除","settings.keychain.userNote":"用户备注","settings.keychain.agentNote":"代理可读备注","settings.keychain.userNoteHint":"仅限人工/界面备注","settings.keychain.agentNoteHint":"给代理的安全指引","settings.keychain.saveNotes":"保存备注","settings.keychain.masterPassword":"主密码：","settings.keychain.masterPasswordPlaceholder":"输入密钥链主密码","settings.keychain.unlock":"解锁","settings.keychain.totpCode":"TOTP 代码：","settings.keychain.verify":"验证","settings.keychain.username":"用户名","settings.keychain.copyUsername":"复制用户名","settings.keychain.secret":"密钥","settings.keychain.copySecret":"复制密钥","settings.tasks.internalProtected":"内部/受保护","settings.tasks.noRunLogs":"尚未记录运行日志。","settings.tasks.noSummary":"无摘要","settings.tasks.selectPrompt":"选择一个任务以查看计划、状态和运行历史。","settings.tasks.pause":"暂停","settings.tasks.resume":"恢复","settings.tasks.delete":"删除","settings.tasks.status":"状态","settings.tasks.kind":"类型","settings.tasks.schedule":"计划","settings.tasks.nextRun":"下次运行","settings.tasks.lastRun":"上次运行","settings.tasks.lastResult":"上次结果","settings.tasks.chat":"聊天","settings.tasks.model":"模型","settings.tasks.cwd":"工作目录","settings.tasks.timeout":"超时","settings.tasks.protection":"保护","settings.tasks.protectionHint":"内部任务操作需要明确确认。","settings.tasks.command":"命令","settings.tasks.prompt":"提示","settings.tasks.recentRuns":"最近运行","settings.tasks.activeLabel":"活动","settings.tasks.pausedLabel":"已暂停","settings.tasks.completedLabel":"已完成","settings.tasks.allStatuses":"所有状态","settings.tasks.filterChatPlaceholder":"筛选聊天 JID…","settings.tasks.refresh":"刷新","settings.tasks.loading":"正在加载计划任务…","settings.tasks.noneFound":"未找到计划任务。","settings.tasks.noneFoundHint":"通过提醒、`/tasks` 或调度工具创建的任务将显示在此处。","settings.tasks.listLabel":"计划任务","settings.tasks.next":"下次","settings.tasks.last":"上次","settings.tasks.noMatch":"没有任务匹配 “{filter}”。","settings.tasks.confirmDelete":"删除计划任务 {id}？","settings.tasks.confirmPause":"暂停计划任务 {id}？","settings.tasks.confirmResume":"恢复计划任务 {id}？","settings.tasks.confirmProtected":"任务 {id} 是内部/受保护的。继续执行 {action}？","settings.tasks.deleting":"正在删除 {id}…","settings.tasks.pausing":"正在暂停 {id}…","settings.tasks.resuming":"正在恢复 {id}…","settings.tasks.deletedToast":"计划任务 {id} 已删除。","settings.tasks.pausedToast":"计划任务 {id} 已暂停。","settings.tasks.resumedToast":"计划任务 {id} 已恢复。","settings.tasks.actionFailed":"执行 {action} 任务失败。","settings.tasks.loadFailed":"加载计划任务失败。","settings.compaction.appliedNotice":"压缩设置已应用。现有回合保留其当前计时器；新回合使用更新后的值。","settings.compaction.saving":"正在保存压缩设置…","settings.compaction.saveFailed":"保存压缩设置失败。","settings.compaction.saved":"压缩设置已保存。","settings.compaction.clearing":"正在清除 {chat} 的压缩抑制…","settings.compaction.clearFailed":"清除压缩抑制失败。","settings.compaction.cleared":"已清除 {chat} 的压缩抑制。","settings.compaction.autoHeading":"自动压缩","settings.compaction.enableAutomatic":"启用自动压缩","settings.compaction.enableAutomaticHint":"由 Piclaw 管理的提示前/空闲压缩。上游代理自动压缩器会继续在内部保持禁用。","settings.compaction.processingMethod":"处理方法","settings.compaction.methodSelective":"选择性","settings.compaction.methodSelectiveHint":"提取高价值的连续性片段；当有界提示无法表示所有被丢弃的源事件时，使用完整的渐进式覆盖。","settings.compaction.methodPipelined":"流水线","settings.compaction.methodPipelinedHint":"在摘要前，对每个被丢弃的源事件进行规范化和分类，并生成可审计的覆盖账本。","settings.compaction.remoteNative":"提供商原生压缩","settings.compaction.remoteNativeHint":"仅对明确支持的提供商启用（{providers}）。任何失败都会自动回退到所选的本地方法。","settings.compaction.remoteTimeout":"提供商原生超时（秒）","settings.compaction.remoteTimeoutAria":"提供商原生压缩超时","settings.compaction.remoteTimeoutHint":"远程预处理在回退到本地方法之前的截止时间。","settings.compaction.enableToolResult":"启用工具结果压缩","settings.compaction.enableToolResultHint":"禁用时，大型工具结果保持内联，不会外部化为可搜索的工具输出句柄。","settings.compaction.semanticSummaries":"压缩工具结果的语义摘要","settings.compaction.semanticSummariesHint":"启用时，压缩输出包含使用活动模型生成的语义摘要（失败时回退到预览）。","settings.compaction.inputLimit":"语义摘要输入限制（字符）","settings.compaction.inputLimitAria":"语义摘要输入限制","settings.compaction.inputLimitHint":"用于语义摘要的完整工具输出采样的最大字符数。","settings.compaction.maxTokens":"语义摘要输出最大令牌数","settings.compaction.maxTokensAria":"语义摘要最大令牌数","settings.compaction.maxTokensHint":"生成摘要长度的上限。","settings.compaction.summaryTimeout":"语义摘要超时（秒）","settings.compaction.summaryTimeoutAria":"语义摘要超时","settings.compaction.summaryTimeoutHint":"在此超时后中止语义摘要生成并回退到预览压缩。","settings.compaction.threshold":"压缩阈值（%）","settings.compaction.thresholdAria":"压缩阈值","settings.compaction.thresholdHint":"当上下文超过窗口的此百分比时自动压缩","settings.compaction.timeout":"压缩超时（秒）","settings.compaction.timeoutAria":"压缩超时","settings.compaction.timeoutHint":"中止卡住的预提示/手动压缩，而不是永远挂起。","settings.compaction.backoffBase":"失败退避基数（分钟）","settings.compaction.backoffBaseAria":"压缩退避基数","settings.compaction.backoffBaseHint":"压缩失败后的首个抑制窗口。","settings.compaction.backoffMax":"失败退避最大值（分钟）","settings.compaction.backoffMaxAria":"压缩退避最大值","settings.compaction.backoffMaxHint":"重复失败后指数抑制的上限。","settings.compaction.decayFactor":"退避衰减系数","settings.compaction.decayFactorAria":"退避衰减系数","settings.compaction.decayFactorHint":"% — 每次成功压缩后退避减半","settings.compaction.watchdogHeading":"停滞监视器","settings.compaction.enableWatchdog":"启用监视器","settings.compaction.enableWatchdogHint":"默认禁用。启用时，如果活动阶段停止心跳，辅助进程将终止运行时。","settings.compaction.watchdogTimeout":"监视器超时（秒）","settings.compaction.watchdogTimeoutAria":"监视器超时","settings.compaction.watchdogTimeoutHint":"活动阶段在监视器终止运行时之前可以无心跳持续多长时间。","settings.compaction.suppressionsHeading":"活动压缩抑制","settings.compaction.noBackoff":"当前没有聊天处于压缩退避状态。","settings.compaction.clear":"清除","settings.compaction.phasesHeading":"实时监视器阶段","settings.compaction.noPhases":"目前没有活动的跟踪阶段。","menu.title":"菜单","menu.showWorkspace":"显示工作区","menu.hideWorkspace":"隐藏工作区","menu.openExplorer":"打开资源管理器","menu.chatOnly":"仅聊天模式","menu.exitChatOnly":"退出仅聊天模式","menu.openTerminal":"在标签页中打开终端","menu.openVnc":"在标签页中打开 VNC","menu.newFile":"新建文件","menu.openRecent":"打开最近文件","menu.refreshTree":"刷新目录树","menu.reindex":"重建工作区索引","menu.showHidden":"显示隐藏文件","menu.hideHidden":"隐藏隐藏文件","menu.scale":"缩放","menu.settings":"设置"},ru={"compose.placeholder":"メッセージ（Enterで送信、Shift+Enterで改行）...","compose.send":"送信","compose.stop":"停止","compose.searchPlaceholder":"検索（Enterで実行）...","compose.clearAll":"すべてクリア","compose.clearAllTitle":"すべての添付と参照をクリア","compose.scope":"範囲","compose.searchScope":"検索範囲","compose.scopeCurrent":"現在","compose.scopeBranchFamily":"ブランチファミリー","compose.scopeAll":"すべてのチャット","compose.filterImages":"画像","compose.filterAttachments":"添付","compose.search":"検索","compose.closeSearch":"検索を閉じる","compose.shareLocation":"位置を共有","compose.attachFile":"ファイルを添付","compose.queueControls":"キュー済みフォローアップの操作","compose.moveUp":"上に移動","compose.moveUpQueue":"キュー内で上に移動","compose.moveDown":"下に移動","compose.moveDownQueue":"キュー内で下に移動","compose.editInCompose":"入力欄で編集","compose.returnToEditor":"キュー済みメッセージを入力欄に戻す","compose.injectSteer":"キュー済みフォローアップをステアとして挿入","compose.steer":"ステア","compose.cancelQueued":"キュー済みメッセージをキャンセル","compose.resizeInput":"メッセージ入力欄のサイズ変更","compose.resizeInputHint":"ドラッグしてメッセージ入力欄のサイズを変更","compose.modelPicker":"モデルピッカー","compose.sessionsAndAgents":"セッションとエージェント","compose.openModelPicker":"モデルピッカーを開く","compose.newBranchTitle":"このチャットから新しいブランチを作成","compose.newRootTitle":"web:ops のようなクリーンなルートセッションを作成","compose.renameSessionTitle":"現在のセッションの名前を変更","compose.pruneSessionTitle":"現在のエージェント/セッションブランチを削除（プルーン）","compose.filterImagesTitle":"画像付きメッセージのみ表示","compose.filterAttachmentsTitle":"添付付きメッセージのみ表示","compose.selectModel":"モデルを選択","compose.loadingModels":"モデルを読み込み中…","compose.noModels":"利用可能なモデルがありません。","compose.nextModel":"次のモデル","compose.manageSessions":"セッションとエージェントを管理","compose.noSessions":"他のセッションはまだありません。","compose.newBranch":"新しいブランチ","compose.newRoot":"新しいルート…","compose.mergeCurrent":"現在を親にマージ","compose.renameCurrent":"現在の名前を変更…","compose.deleteCurrent":"現在を削除…","compose.mergeInto":"このブランチを {target} にマージ","compose.mergeBlocked":"このブランチはアクティブな間または子がある間はマージできません","workspace.title":"ワークスペース","workspace.moveConfirm":"{entry}「{name}」を{source}から{target}へ移動しますか？","workspace.root":"ワークスペースのルート","workspace.file":"ファイル","workspace.folder":"フォルダー","workspace.newFile":"新規ファイル","workspace.refresh":"更新","workspace.actions":"ワークスペース操作","workspace.uploadFiles":"ファイルをアップロード","workspace.reindexing":"ワークスペースを再インデックス中…","workspace.deleteFile":"ファイルを削除","workspace.download":"ダウンロード","workspace.uploadToFolder":"このフォルダにファイルをアップロード","workspace.addFolderHint":"フォルダのヒントを入力欄に追加","workspace.downloadZip":"フォルダをzipでダウンロード","workspace.openInTab":"タブで開く","workspace.openInEditor":"エディタで開く","workspace.renameSelected":"選択項目の名前を変更","workspace.downloadSelectedFile":"選択したファイルをダウンロード","workspace.downloadSelectedFolder":"選択したフォルダをダウンロード（zip）","workspace.deleteSelectedFile":"選択したファイルを削除","shell.settings":"設定","shell.newChat":"新規チャット","shell.connecting":"接続中…","shell.connected":"接続済み","language.label":"言語","settings.title":"設定","settings.close":"閉じる（Esc）","settings.filter":"フィルター…","settings.loading":"設定を読み込み中…","settings.section.general":"一般","settings.section.sessions":"セッション","settings.section.recordings":"録画","settings.section.compaction":"圧縮","settings.section.keyboard":"キーボード","settings.section.workspace":"ワークスペース","settings.section.environment":"環境","settings.section.providers":"プロバイダー","settings.section.models":"モデル","settings.section.theme":"外観","settings.section.scheduled-tasks":"スケジュールタスク","settings.section.quick-actions":"クイックアクション","settings.section.keychain":"キーチェーン","settings.section.tools":"ツール","settings.section.addons":"アドオン","settings.placeholder.recordings":"録画をフィルター…","settings.placeholder.keyboard":"ショートカットをフィルター…","settings.placeholder.environment":"環境をフィルター…","settings.placeholder.models":"モデルをフィルター…","settings.placeholder.scheduled-tasks":"スケジュールタスクをフィルター…","settings.placeholder.quick-actions":"クイックアクションをフィルター…","settings.placeholder.keychain":"エントリをフィルター…","settings.placeholder.tools":"ツールをフィルター…","settings.placeholder.addons":"アドオンをフィルター…","preview.close":"閉じる","preview.loading":"プレビューを読み込み中…","preview.files":"ファイル","preview.folders":"フォルダ","preview.compressed":"圧縮後","preview.uncompressed":"非圧縮","preview.name":"名前","preview.type":"種類","preview.method":"方式","preview.size":"サイズ","post.deleteMessage":"メッセージを削除","post.tooLarge":"メッセージが大きすぎて表示できません。","post.previewTruncated":"プレビューは切り詰められました。","post.submitted":"送信済み","post.discard":"破棄","post.save":"保存","post.cancel":"キャンセル","post.addNote":"メモを追加","post.addNotePlaceholder":"メモを追加…","post.restartNotice":"再起動中 — 理由：{reason}","post.restartCompleted":"再起動が完了しました。","post.agentSelfResume":"エージェントの自己再開","tab.close":"閉じる","tab.closeOthers":"他を閉じる","tab.closeAll":"すべて閉じる","tab.reattach":"再アタッチ","tab.openInWindow":"ウィンドウで開く","tab.openInNewTab":"新しいタブで開く","tab.pinned":"ピン留め済み","tab.detached":"分離済み","tab.openSeparateWindow":"別ウィンドウで開く","status.trackedVariables":"追跡中の変数","status.attachToSession":"セッションにアタッチ","status.files":"ファイル","status.proposedDiff":"提案された差分","status.copyTmux":"tmuxコマンドをコピー","status.experimentDuration":"実験の経過時間","status.sinceLastActivity":"最後のアクティビティから","annotator.title":"画像に注釈","annotator.typeLabel":"ラベルを入力…","annotator.undo":"元に戻す","annotator.resetZoom":"ズームをリセット","tree.filter":"フィルター…","tree.sessionTree":"セッションツリー","btw.label":"BTW サイド会話","btw.close":"BTW を閉じる","btw.thinking":"思考中","mdpreview.close":"プレビューを閉じる","mdpreview.unavailable":"プレビューを利用できません","widget.close":"ウィジェットを閉じる","oobe.gettingStarted":"はじめに","oobe.needsSetupTitle":"インスタンスのセットアップが必要","oobe.configuredTitle":"インスタンスは設定済み","oobe.needsSetupBody":"このインスタンスはまだ設定されていません。設定を開き、AIプロバイダー/モデルを設定してリクエストの送信を開始してください。","oobe.configuredBody":"このインスタンスは設定済みのようです。設定でプロバイダーとモデルの設定を確認または更新してください。","oobe.openSettings":"設定を開く","oobe.dismiss":"閉じる","oobe.done":"完了","palette.placeholder":"入力してエージェント、ワークスペース操作、またはスラッシュコマンドにジャンプ…","palette.hideWorkspace":"ワークスペースを非表示","palette.showWorkspace":"ワークスペースを表示","palette.hideWorkspaceDesc":"ワークスペースサイドバーを非表示にします。","palette.showWorkspaceDesc":"ワークスペースサイドバーを表示します。","palette.exitChatOnly":"チャットのみモードを終了","palette.chatOnly":"チャットのみモード","palette.exitChatOnlyDesc":"分割ワークスペースレイアウトに戻ります。","palette.chatOnlyDesc":"チャットのみのレイアウトに切り替えます。","palette.groupAgents":"エージェント","palette.groupWorkspace":"ワークスペース","palette.groupSlash":"スラッシュコマンド","palette.hintMove":"移動","palette.hintSelect":"選択","palette.hintPopOut":"ポップアウト","palette.hintClose":"閉じる","settings.appliedNotice":"設定を適用しました。変更は次のターンから有効になります。","settings.sessions.lifecycle":"セッションのライフサイクル","settings.sessions.autoRotate":"セッションを自動ローテーション","settings.sessions.maxSize":"最大セッションサイズ（MB）","settings.sessions.maxSizeAria":"最大セッションサイズ","settings.sessions.agentBehaviour":"エージェントの動作","settings.sessions.toolBudget":"ツール使用予算","settings.sessions.toolBudgetAria":"ツール使用予算","settings.sessions.toolBudgetHint":"1ターンあたりの完了済みツール実行回数の上限","settings.sessions.isolation":"セッションの分離","settings.sessions.isolationNone":"なし — セッション間で完全に可視","settings.sessions.isolationSummary":"概要 — ツールは可視、引数は非表示","settings.sessions.isolationFull":"完全 — セッション同士は互いに見えない","settings.editor.heading":"エディター","settings.editor.vimMode":"Vim モード","settings.editor.showWhitespace":"空白文字を表示","settings.editor.livePreview":"Markdown ライブプレビュー","settings.editor.fontSize":"フォントサイズ（px）","settings.editor.fontSizeAria":"エディターのフォントサイズ","settings.editor.fontFamily":"フォントファミリー","settings.editor.fontFamilyPlaceholder":"monospace（デフォルト）","settings.editor.localOnlyHint":"このブラウザーのみ。エディターの変更はローカルブラウザーストレージに保存され、次にファイルタブを開くか再読み込みしたときに有効になります。","settings.appearance.syncing":"外観を同期中…","settings.appearance.default":"デフォルト","settings.appearance.autoLightDark":"自動（ライト/ダーク）","settings.appearance.tint":"色調：","settings.appearance.clearTint":"色調をクリア","settings.appearance.none":"なし","settings.appearance.outputPadding":"出力の余白","settings.appearance.outputPaddingHint":"メッセージと思考パネルの周囲に追加する余白です。","settings.keyboard.heading":"キーボード","settings.keyboard.hint1":"アプリ全体のショートカットをカンマ区切りのバインディングとしてカスタマイズします。変更はすぐに反映されます。","settings.keyboard.hint1b":"は閉じる/中止用に予約されており、再割り当てできません。","settings.keyboard.hint2mid":"と入力","settings.keyboard.hint2end":"を入力欄の外で押すとこのペインが開きます。","settings.keyboard.resetAll":"すべてデフォルトにリセット","settings.keyboard.defaultColon":"デフォルト：","settings.keyboard.save":"保存","settings.keyboard.defaultBtn":"デフォルト","settings.keyboard.noMatch":"このフィルターに一致するショートカットはありません。","settings.keyboard.invalidShortcut":"無効なショートカット：{token}。Escape は予約されており、再割り当てできません。","settings.keyboard.saved":"キーボードショートカットを保存しました。","settings.keyboard.resetOne":"キーボードショートカットをデフォルトにリセットしました。","settings.keyboard.resetAllDone":"キーボードショートカットをすべてデフォルトにリセットしました。","settings.workspace.serverApplied":"ワークスペース設定を適用しました。サーバー側の制限は新しいワークスペースリクエストに直ちに反映されます。","settings.workspace.browserApplied":"ブラウザーのワークスペース設定はこのタブで直ちに適用されました。","settings.workspace.access":"アクセス","settings.workspace.enableTerminal":"Web ターミナルを有効化","settings.workspace.allowVnc":"直接 VNC ターゲットを許可","settings.workspace.accessHint":"ターミナルアクセスは直ちに更新されます。直接 VNC ターゲットポリシーは新しい VNC リクエストに適用されます。","settings.workspace.guardrails":"サーバースキャンのガードレール","settings.workspace.maxDepth":"最大ツリー深度","settings.workspace.maxDepthAria":"ワークスペースツリーの最大深度","settings.workspace.maxDepthHintPre":"すべての","settings.workspace.maxDepthHintPost":"リクエストを制限します","settings.workspace.maxEntries":"スキャンあたりの最大エントリ数","settings.workspace.maxEntriesAria":"ワークスペースツリーの最大エントリ数","settings.workspace.maxEntriesHint":"大きすぎるツリー走査を早めに打ち切ります","settings.workspace.thisBrowser":"このブラウザー","settings.workspace.refreshInterval":"更新間隔（秒）","settings.workspace.refreshIntervalAria":"ワークスペース更新間隔","settings.workspace.folderDepth":"フォルダプレビューのスキャン深度","settings.workspace.folderDepthAria":"フォルダプレビューのスキャン深度","settings.workspace.folderDepthHintPre":"","settings.workspace.folderDepthHintPost":"に設定するとフォルダサイズのプレビュースキャンを無効化します","settings.workspace.footerHint":"ルートおよびフォルダ展開のツリー読み込みは浅いままです。フォルダサイズのプレビューは UI で最も深いワークスペーススキャンです。","settings.models.thinkingLevel":"思考レベル","settings.models.noThinking":"現在のモデルは思考をサポートしていません。","settings.models.thinkingLevelLabel":"思考レベル：","settings.models.loading":"モデルを読み込み中…","settings.models.summary":"狭いペインでは、クリッピングを避けるためにモデル名とプロバイダー名が折り返される場合があります。","settings.models.scopedOnly":"スコープ付きモデルのみ","settings.models.scopedCheckboxPre":"Piclaw のモデル一覧に Pi の","settings.models.scopedCheckboxPost":"を使用","settings.models.scopedHintPre":"このピッカーと","settings.models.scopedHintPost":"ツールをフィルタリングします。TUI のモデル選択は変更されません。","settings.models.colModel":"モデル","settings.models.colProvider":"プロバイダー","settings.models.colContext":"コンテキスト","settings.models.colReasoning":"推論","settings.models.noMatch":"「{filter}」に一致するモデルはありません","settings.tools.unavailable":"ツールデータを利用できません。","settings.tools.search":"検索","settings.tools.matchMode":"マッチモード","settings.tools.orMode":"いずれかのキーワード（OR）— 少なくとも1つの検索語に一致","settings.tools.andMode":"すべてのキーワード（AND）— すべての検索語に一致","settings.tools.colEnabled":"有効","settings.tools.colTool":"ツール","settings.tools.colCompact":"結果圧縮","settings.tools.colKind":"種類","settings.tools.colSummary":"概要","settings.tools.colSource":"ソース","settings.tools.disableCompaction":"このツールのツール結果コンパクションを無効化","settings.tools.enableCompaction":"このツールのツール結果コンパクションを有効化","settings.tools.noMatch":"「{filter}」に一致するツールはありません","settings.tools.footer":"ツールのアクティベーションはエージェントランタイムが管理します。グループのチェックボックスで折りたたみ/展開でき、「コンパクト」列はツール結果コンパクションの対象可否を制御します。","settings.environment.heading":"環境","settings.environment.introPre":"キーチェーン以外の環境変数のみを表示しています。オーバーライドは拡張機能の KV に保存され、","settings.environment.introPost":"に適用されるため、以降のツール呼び出しに継承されます。","settings.environment.refresh":"更新","settings.environment.addOverride":"オーバーライドを追加","settings.environment.valuePlaceholder":"値","settings.environment.save":"保存","settings.environment.countLine":"{count} 個の変数を表示 • {overrides} 個のオーバーライドが有効 • {keychain} 個のキーチェーン注入変数を非表示","settings.environment.overridden":"KV でオーバーライド","settings.environment.inherited":"プロセス環境から継承","settings.environment.kindOverride":"オーバーライド","settings.environment.kindProcess":"プロセス","settings.environment.clear":"クリア","settings.environment.noMatch":"「{filter}」に一致する環境変数はありません。","settings.environment.refreshedToast":"環境を更新しました。","settings.environment.savedToast":"{name} の環境オーバーライドを保存しました。","settings.environment.clearedToast":"{name} の環境オーバーライドをクリアしました。","settings.quickActions.loading":"読み込み中…","settings.quickActions.heading":"タイムラインクイックアクション","settings.quickActions.intro":"タイムラインのタイプアヘッドに表示するアクションを選択します。エージェントは常に最初に固定され、次にワークスペースコマンド、その次にスラッシュコマンドが表示されます。","settings.quickActions.enableAll":"すべて有効化","settings.quickActions.saving":"保存中…","settings.quickActions.saveApply":"保存して適用","settings.quickActions.workspaceCommands":"ワークスペースコマンド","settings.quickActions.noWorkspaceMatch":"このフィルターに一致するワークスペースコマンドはありません。","settings.quickActions.slashCommands":"スラッシュコマンド","settings.quickActions.slashFallback":"スラッシュコマンド","settings.quickActions.noSlashMatch":"このフィルターに一致するスラッシュコマンドはありません。","settings.quickActions.savingToast":"クイックアクションを保存中…","settings.quickActions.savedToast":"クイックアクションを保存しました。","settings.providers.authApiKey":"API キー","settings.providers.authConfigured":"設定済み","settings.providers.heading":"プロバイダー","settings.providers.tagCustom":"カスタム","settings.providers.logout":"ログアウト","settings.providers.reconfigure":"再設定","settings.providers.setUp":"セットアップ","settings.providers.setupHint":"サインインフローはブラウザーで開きます。狭いペインではセットアップフォームが縦に積み重なってクリッピングを防ぎます。","settings.providers.starting":"開始中…","settings.providers.signInOAuth":"OAuth でサインイン","settings.providers.apiKeyLabel":"API キー","settings.providers.apiKeyPlaceholder":"API キーを入力","settings.providers.save":"保存","settings.providers.configuring":"設定中…","settings.providers.saveConfig":"設定を保存","settings.providers.apiKeyEmpty":"API キーを空にすることはできません。","settings.providers.configuringToast":"{provider} を設定中…","settings.providers.configured":"{provider} を設定しました。","settings.providers.startingOAuth":"{provider} の OAuth を開始中…","settings.providers.oauthOpened":"OAuth ウィンドウを開きました。サインインフローを完了してから、このメッセージを閉じてください。","settings.providers.oauthStarted":"{provider} の OAuth フローを開始しました。チャットを確認してください。","settings.providers.loggingOut":"{provider} をログアウト中…","settings.providers.loggedOut":"{provider} をログアウトしました。再起動が必要な場合があります。","settings.general.identity":"アイデンティティ","settings.general.userLabel":"ユーザー","settings.general.yourName":"あなたの名前","settings.general.agentLabel":"エージェント","settings.general.agentName":"エージェント名","settings.general.notifications":"通知","settings.general.browserNotifications":"ブラウザ通知","settings.general.notifSecureHint":"入力バーの \uD83D\uDD14 ベルボタンで通知を有効/無効にします。Web Push には HTTPS または localhost が必要です。","settings.general.notifInsecureHint":"⚠ 利用不可 — セキュアコンテキスト（HTTPS または localhost）が必要です。SSH トンネルまたは TLS 付きリバースプロキシ経由でアクセスして有効化してください。","settings.general.display":"表示","settings.general.systemMeters":"システムメーター","settings.general.systemMetersHint":"ステータスバーの CPU/メモリ/ネットワークメーター。このブラウザのみ。","settings.general.instanceConfig":"インスタンス設定","settings.general.composeUpload":"作成アップロード（MB）","settings.general.composeUploadAria":"作成アップロード上限","settings.general.composeUploadHint":"チャット/メディア添付","settings.general.workspaceUpload":"ワークスペースアップロード（MB）","settings.general.workspaceUploadAria":"ワークスペースアップロード上限","settings.general.workspaceUploadHint":"デフォルトは 256 MB。チャンクアップロードは最大 1 GB まで許可","settings.general.agentRecovery":"詳細 · エージェント復旧","settings.general.automaticRecovery":"自動復旧","settings.general.automaticRecoveryHint":"復旧可能な失敗ターンを自動的に再試行します。","settings.general.recoveryMaxAttempts":"最大試行回数","settings.general.recoveryMaxAttemptsAria":"自動復旧の最大試行回数","settings.general.recoveryMaxAttemptsHint":"0 は通常の再試行上限を継承します。","settings.general.recoveryTotalBudget":"合計予算（ミリ秒）","settings.general.recoveryTotalBudgetAria":"自動復旧の合計予算（ミリ秒）","settings.general.recoveryTotalBudgetHint":"1 ターンのすべての自動復旧処理を制限します。","settings.general.authentication":"認証","settings.general.widgetToken":"ウィジェット bearer トークン","settings.general.token":"トークン","settings.general.hideToken":"トークンを隠す","settings.general.revealToken":"トークンを表示","settings.general.copyToken":"トークンをコピー","settings.general.copied":"コピーしました","settings.general.regenerating":"再生成中…","settings.general.regenerate":"再生成","settings.general.tokenHintPre":"次の読み取り専用トークン：","settings.general.tokenHintMid":"および","settings.general.tokenHintPost":"。次として使用：","settings.general.tokenHintEnd":"。","settings.general.copyFailed":"ウィジェットトークンをコピーできませんでした。トークンフィールドを選択して手動でコピーしてください。","settings.general.regenConfirm":"ウィジェットトークンを再生成しますか？古いトークンを使用している既存の macOS ウィジェットは更新されなくなります。","settings.general.totpTitle":"TOTP セットアップ QR","settings.general.totpConfiguredHint":"現在の Web ログイン認証システムのシークレット。この QR をスキャンして別の認証デバイスを追加します。","settings.general.totpUnconfiguredHint":"このインスタンスにはまだ TOTP が設定されていないため、セットアップ QR は利用できません。","settings.general.issuer":"発行者","settings.general.label":"ラベル","settings.general.secret":"シークレット","settings.general.avatarUpload":"クリックしてアップロード","settings.developer.heading":"開発者","settings.developer.devMode":"開発者モード","settings.developer.localHint":"このブラウザのみ。開発者モードの切り替えとアドオンカタログのオーバーライドはローカルブラウザストレージに保存されます。","settings.developer.addonSources":"アドオンソース","settings.developer.catalogUrl":"カタログ URL","settings.developer.catalogHint":"プライマリアドオンカタログ URL。空のままにするとデフォルトを使用します","settings.developer.additionalCatalogs":"追加カタログ URL","settings.developer.additionalHint":"プライマリ/デフォルトカタログに加えて取得されます。1 行に 1 つの URL。","settings.developer.repoUrl":"リポジトリ URL","settings.developer.repoHintPre":"git リポジトリを上書き（","settings.developer.repoHintPost":"インストール用）。空のままでデフォルト。","settings.developer.debug":"デバッグ","settings.developer.logSse":"SSE イベントをログ記録","settings.developer.logToolCalls":"ツール呼び出しをログ記録","settings.developer.debugHint":"デバッグフラグは次回のページ再読み込み時に有効になります。","settings.addons.installing":"{slug} をインストール中…","settings.addons.removing":"{slug} を削除中…","settings.addons.installedToast":"アドオンをインストールしました。","settings.addons.removedToast":"アドオンを削除しました。","settings.addons.restarting":"piclaw を再起動中…","settings.addons.restartComplete":"再起動完了 — アドオンを更新しました。","settings.addons.restartTimeout":"バックエンドが時間内に応答しませんでした。ページを手動で再読み込みしてください。","settings.addons.fetching":"アドオンを取得中…","settings.addons.loadFailed":"アドオンを読み込めませんでした。","settings.addons.catalogFromPre":"カタログの取得元：","settings.addons.catalogMerged":"{count} 個のカタログソースをマージしました。","settings.addons.installNote":"Bun によるパッケージ優先インストール。インストール/アンインストール後に再起動が必要です。","settings.addons.failedFetchSingular":"{count} 個のカタログソースの取得に失敗しました：","settings.addons.failedFetchPlural":"{count} 個のカタログソースの取得に失敗しました：","settings.addons.activeSources":"アクティブなカタログソース（{count}）","settings.addons.windowsWarning":"ネイティブ Windows のアドオンインストールはリスクが高くなります：Bun パッケージのインストール、シンボリックリンクのクリーンアップ、ロックされたファイル、再起動のタイミングは、Linux/WSL よりも予測しにくい場合があります。可能であれば WSL またはコンテナを優先してください。","settings.addons.typeExtSkill":"拡張機能 + スキル","settings.addons.typeSkill":"スキル","settings.addons.typeExt":"拡張機能","settings.addons.update":"更新","settings.addons.remove":"削除","settings.addons.install":"インストール","settings.addons.noMatch":"「{filter}」に一致するアドオンはありません","settings.addons.restartNotice":"拡張機能の変更はインストールされましたが、piclaw が再起動するまで非アクティブです。","settings.addons.restartNow":"今すぐ再起動","settings.recordings.modeFull":"完全 / 信頼済み","settings.recordings.modeMetadata":"メタデータのみ","settings.recordings.modeRedacted":"編集済み","settings.recordings.selectPrompt":"録画を選択して検査、再生、エクスポート、または削除します。","settings.recordings.playback":"再生","settings.recordings.refresh":"更新","settings.recordings.delete":"削除","settings.recordings.status":"ステータス","settings.recordings.mode":"モード","settings.recordings.chat":"チャット","settings.recordings.started":"開始","settings.recordings.ended":"終了","settings.recordings.events":"イベント","settings.recordings.redactions":"編集","settings.recordings.exportJson":"JSON をエクスポート","settings.recordings.exportJsonl":"JSONL をエクスポート","settings.recordings.exportHtml":"スタンドアロン HTML をエクスポート","settings.recordings.eventSummary":"イベント概要","settings.recordings.inspectHint":"詳細を開くか更新してトレースイベントを検査します。","settings.recordings.firstEvents":"最初のイベント","settings.recordings.heading":"セッション録画","settings.recordings.intro":"決定論的な再生と画面録画エクスポートのためのオプトイントレースキャプチャ。再生でライブエージェントやツールのエンドポイントを呼び出すことはありません。","settings.recordings.chatJid":"チャット JID","settings.recordings.title":"タイトル","settings.recordings.titlePlaceholder":"デモ録画","settings.recordings.modeLabelField":"モード","settings.recordings.optRedacted":"編集済み","settings.recordings.optMetadata":"メタデータのみ","settings.recordings.optFull":"完全 / 信頼済みローカル","settings.recordings.includeSnapshot":"タイムラインスナップショットを含める","settings.recordings.extraKeys":"追加の編集キー","settings.recordings.extraPatterns":"追加の正規表現パターン","settings.recordings.stopCurrent":"現在のチャット録画を停止","settings.recordings.start":"録画を開始","settings.recordings.redactionPreview":"編集プレビュー","settings.recordings.previewRedaction":"編集をプレビュー","settings.recordings.loading":"録画を読み込み中…","settings.recordings.noneYet":"まだ録画がありません。","settings.recordings.noneYetHint":"上で録画を開始し、再生/エクスポートを使用して決定論的な画面キャプチャを行います。","settings.recordings.listLabel":"セッション録画","settings.recordings.eventsCount":"{count} 件のイベント","settings.recordings.noMatch":"「{filter}」に一致する録画はありません。","settings.recordings.startedToast":"{chat} の録画を開始しました。","settings.recordings.startFailed":"録画の開始に失敗しました。","settings.recordings.stoppedToast":"{chat} の録画を停止しました。","settings.recordings.stopFailed":"録画の停止に失敗しました。","settings.recordings.deleteConfirm":"録画 {id} を削除しますか？","settings.recordings.deletedToast":"録画を削除しました。","settings.recordings.deleteFailed":"録画の削除に失敗しました。","settings.recordings.loadOneFailed":"録画の読み込みに失敗しました。","settings.recordings.loadFailed":"録画の読み込みに失敗しました。","settings.recordings.previewFailed":"プレビューに失敗しました。","settings.keychain.loadFailed":"キーチェーンの読み込みに失敗しました。","settings.keychain.addFailed":"エントリの追加に失敗しました。","settings.keychain.deleteFailed":"エントリの削除に失敗しました。","settings.keychain.saveNotesFailed":"メモの保存に失敗しました。","settings.keychain.revealFailed":"表示に失敗しました。","settings.keychain.loading":"キーチェーンを読み込み中…","settings.keychain.entryCountSingular":"{count} 件のエントリ","settings.keychain.entryCountPlural":"{count} 件のエントリ","settings.keychain.matchingFilter":" 「{filter}」に一致","settings.keychain.encryptedSuffix":"、保存時に暗号化。","settings.keychain.clickPrefix":"クリック","settings.keychain.revealSuffix":"で表示。","settings.keychain.cancel":"キャンセル","settings.keychain.addEntry":"+ エントリを追加","settings.keychain.namePlaceholder":"エントリ名（例：github/my-token）","settings.keychain.secretPlaceholder":"シークレット値","settings.keychain.usernamePlaceholder":"ユーザー名（任意）","settings.keychain.saving":"保存中…","settings.keychain.save":"保存","settings.keychain.userNotePlaceholder":"ユーザーメモ（この UI でのみ表示）","settings.keychain.agentNotePlaceholder":"エージェントメモ（エージェントに公開しても安全）","settings.keychain.noMatchFilter":"フィルターに一致するエントリはありません。","settings.keychain.noEntries":"キーチェーンエントリがありません。","settings.keychain.hideSecret":"シークレットを非表示","settings.keychain.revealSecret":"シークレットを表示","settings.keychain.deleteQ":"削除しますか？","settings.keychain.yes":"はい","settings.keychain.no":"いいえ","settings.keychain.deleteTitle":"削除","settings.keychain.userNote":"ユーザーメモ","settings.keychain.agentNote":"エージェント読み取り可能メモ","settings.keychain.userNoteHint":"人間/UI メモのみ","settings.keychain.agentNoteHint":"エージェント向けの安全なガイダンス","settings.keychain.saveNotes":"メモを保存","settings.keychain.masterPassword":"マスターパスワード：","settings.keychain.masterPasswordPlaceholder":"キーチェーンのマスターパスワードを入力","settings.keychain.unlock":"ロック解除","settings.keychain.totpCode":"TOTP コード：","settings.keychain.verify":"検証","settings.keychain.username":"ユーザー名","settings.keychain.copyUsername":"ユーザー名をコピー","settings.keychain.secret":"シークレット","settings.keychain.copySecret":"シークレットをコピー","settings.tasks.internalProtected":"内部/保護済み","settings.tasks.noRunLogs":"まだ実行ログが記録されていません。","settings.tasks.noSummary":"概要なし","settings.tasks.selectPrompt":"タスクを選択してスケジュール、ステータス、実行履歴を確認します。","settings.tasks.pause":"一時停止","settings.tasks.resume":"再開","settings.tasks.delete":"削除","settings.tasks.status":"ステータス","settings.tasks.kind":"種類","settings.tasks.schedule":"スケジュール","settings.tasks.nextRun":"次回実行","settings.tasks.lastRun":"前回実行","settings.tasks.lastResult":"前回の結果","settings.tasks.chat":"チャット","settings.tasks.model":"モデル","settings.tasks.cwd":"作業ディレクトリ","settings.tasks.timeout":"タイムアウト","settings.tasks.protection":"保護","settings.tasks.protectionHint":"内部タスクの操作には明示的な確認が必要です。","settings.tasks.command":"コマンド","settings.tasks.prompt":"プロンプト","settings.tasks.recentRuns":"最近の実行","settings.tasks.activeLabel":"アクティブ","settings.tasks.pausedLabel":"一時停止","settings.tasks.completedLabel":"完了","settings.tasks.allStatuses":"すべてのステータス","settings.tasks.filterChatPlaceholder":"チャット JID をフィルター…","settings.tasks.refresh":"更新","settings.tasks.loading":"スケジュールタスクを読み込み中…","settings.tasks.noneFound":"スケジュールされたタスクが見つかりません。","settings.tasks.noneFoundHint":"リマインダー、`/tasks`、またはスケジューラツールで作成されたタスクがここに表示されます。","settings.tasks.listLabel":"スケジュールされたタスク","settings.tasks.next":"次回","settings.tasks.last":"前回","settings.tasks.noMatch":"「{filter}」に一致するタスクはありません。","settings.tasks.confirmDelete":"スケジュールタスク {id} を削除しますか？","settings.tasks.confirmPause":"スケジュールタスク {id} を一時停止しますか？","settings.tasks.confirmResume":"スケジュールタスク {id} を再開しますか？","settings.tasks.confirmProtected":"タスク {id} は内部/保護済みです。{action} を続行しますか？","settings.tasks.deleting":"{id} を削除中…","settings.tasks.pausing":"{id} を一時停止中…","settings.tasks.resuming":"{id} を再開中…","settings.tasks.deletedToast":"スケジュールタスク {id} を削除しました。","settings.tasks.pausedToast":"スケジュールタスク {id} を一時停止しました。","settings.tasks.resumedToast":"スケジュールタスク {id} を再開しました。","settings.tasks.actionFailed":"{action} タスクに失敗しました。","settings.tasks.loadFailed":"スケジュールタスクの読み込みに失敗しました。","settings.compaction.appliedNotice":"圧縮設定が適用されました。既存のターンは現在のタイマーを保持し、新しいターンは更新された値を使用します。","settings.compaction.saving":"圧縮設定を保存中…","settings.compaction.saveFailed":"圧縮設定の保存に失敗しました。","settings.compaction.saved":"圧縮設定を保存しました。","settings.compaction.clearing":"{chat} の圧縮抑制をクリア中…","settings.compaction.clearFailed":"圧縮抑制のクリアに失敗しました。","settings.compaction.cleared":"{chat} の圧縮抑制をクリアしました。","settings.compaction.autoHeading":"自動圧縮","settings.compaction.enableAutomatic":"自動圧縮を有効化","settings.compaction.enableAutomaticHint":"Piclaw が管理するプロンプト前/アイドル時の圧縮です。上流エージェントの自動圧縮は内部的に抑制されたままです。","settings.compaction.processingMethod":"処理方式","settings.compaction.methodSelective":"選択型","settings.compaction.methodSelectiveHint":"重要な継続情報を抽出し、制限付きプロンプトですべての破棄対象イベントを表現できない場合は完全な段階的カバレッジを使用します。","settings.compaction.methodPipelined":"パイプライン","settings.compaction.methodPipelinedHint":"要約前に、破棄対象の各ソースイベントを正規化・分類し、監査可能なカバレッジ台帳を作成します。","settings.compaction.remoteNative":"プロバイダー・ネイティブ圧縮","settings.compaction.remoteNativeHint":"明示的に対応しているプロバイダー（{providers}）のみオプトインできます。失敗時は選択したローカル方式へアトミックにフォールバックします。","settings.compaction.remoteTimeout":"プロバイダー・ネイティブのタイムアウト（秒）","settings.compaction.remoteTimeoutAria":"プロバイダー・ネイティブ圧縮のタイムアウト","settings.compaction.remoteTimeoutHint":"ローカル方式へフォールバックする前のリモート処理期限です。","settings.compaction.enableToolResult":"ツール結果の圧縮を有効化","settings.compaction.enableToolResultHint":"無効にすると、大きなツール結果はインラインのまま残り、検索可能なツール出力ハンドルに外部化されません。","settings.compaction.semanticSummaries":"圧縮されたツール結果のセマンティック要約","settings.compaction.semanticSummariesHint":"有効にすると、圧縮された出力にアクティブモデルで生成されたセマンティック要約が含まれます（失敗時はプレビューにフォールバック）。","settings.compaction.inputLimit":"セマンティック要約の入力上限（文字）","settings.compaction.inputLimitAria":"セマンティック要約の入力上限","settings.compaction.inputLimitHint":"セマンティック要約のために完全なツール出力からサンプリングする最大文字数。","settings.compaction.maxTokens":"セマンティック要約の出力最大トークン数","settings.compaction.maxTokensAria":"セマンティック要約の最大トークン数","settings.compaction.maxTokensHint":"生成される要約の長さの上限。","settings.compaction.summaryTimeout":"セマンティック要約のタイムアウト（秒）","settings.compaction.summaryTimeoutAria":"セマンティック要約のタイムアウト","settings.compaction.summaryTimeoutHint":"このタイムアウト後にセマンティック要約の生成を中止し、プレビュー圧縮にフォールバックします。","settings.compaction.threshold":"圧縮しきい値（%）","settings.compaction.thresholdAria":"圧縮しきい値","settings.compaction.thresholdHint":"コンテキストがウィンドウのこの％を超えたら自動圧縮","settings.compaction.timeout":"圧縮タイムアウト（秒）","settings.compaction.timeoutAria":"圧縮タイムアウト","settings.compaction.timeoutHint":"スタックした事前プロンプト/手動圧縮を中止し、永久にハングしないようにします。","settings.compaction.backoffBase":"失敗バックオフ基準（分）","settings.compaction.backoffBaseAria":"圧縮バックオフ基準","settings.compaction.backoffBaseHint":"圧縮失敗後の最初の抑制ウィンドウ。","settings.compaction.backoffMax":"失敗バックオフ最大（分）","settings.compaction.backoffMaxAria":"圧縮バックオフ最大","settings.compaction.backoffMaxHint":"繰り返し失敗した後の指数的抑制の上限。","settings.compaction.decayFactor":"バックオフ減衰係数","settings.compaction.decayFactorAria":"バックオフ減衰係数","settings.compaction.decayFactorHint":"% — 圧縮が成功するたびにバックオフを半減","settings.compaction.watchdogHeading":"ストール監視","settings.compaction.enableWatchdog":"監視を有効化","settings.compaction.enableWatchdogHint":"デフォルトで無効。有効にすると、アクティブフェーズがハートビートを停止した場合、ヘルパープロセスがランタイムを終了します。","settings.compaction.watchdogTimeout":"監視タイムアウト（秒）","settings.compaction.watchdogTimeoutAria":"監視タイムアウト","settings.compaction.watchdogTimeoutHint":"監視がランタイムを強制終了するまでに、アクティブフェーズがハートビートなしで継続できる時間。","settings.compaction.suppressionsHeading":"アクティブな圧縮抑制","settings.compaction.noBackoff":"現在、圧縮バックオフ中のチャットはありません。","settings.compaction.clear":"クリア","settings.compaction.phasesHeading":"ライブ監視フェーズ","settings.compaction.noPhases":"現在、追跡中のアクティブなフェーズはありません。","menu.title":"メニュー","menu.showWorkspace":"ワークスペースを表示","menu.hideWorkspace":"ワークスペースを非表示","menu.openExplorer":"エクスプローラーを開く","menu.chatOnly":"チャットのみモード","menu.exitChatOnly":"チャットのみモードを終了","menu.openTerminal":"ターミナルをタブで開く","menu.openVnc":"VNC をタブで開く","menu.newFile":"新規ファイル","menu.openRecent":"最近のファイルを開く","menu.refreshTree":"ツリーを更新","menu.reindex":"ワークスペースを再インデックス","menu.showHidden":"隠しファイルを表示","menu.hideHidden":"隠しファイルを非表示","menu.scale":"拡大縮小","menu.settings":"設定"},_u={en:L_,"zh-CN":iu,ja:ru},Vn=On});function O_({children:n,className:i=""}){let[r,_]=w(null);return X(()=>{if(typeof document>"u")return;let c=document.createElement("div");return c.className=i||"",document.body.appendChild(c),_(c),()=>{try{Ln(null,c)}finally{c.remove()}}},[]),X(()=>{if(!r)return;r.className=i||"";return},[i,r]),Ni(()=>{if(!r)return;Ln(n,r);return},[n,r]),null}var J_=d(()=>{rn()});function xr(n,i){let r=String(n.label||"").localeCompare(String(i.label||""),void 0,{sensitivity:"base"});if(r!==0)return r;return String(n.id||"").localeCompare(String(i.id||""),void 0,{sensitivity:"base"})}function Jn(n){let i=Gn.findIndex((r)=>r.id===n.id);if(i>=0)Gn[i]=n;else Gn.push(n);Gn.sort(xr)}function Mg(n){let i=Gn.findIndex((r)=>r.id===n);if(i>=0)Gn.splice(i,1)}function E_(){return[...Gn]}function Qg(){if(typeof window>"u")return;window.dispatchEvent(new CustomEvent("piclaw:settings-panes-changed"))}var Gn;var gi=d(()=>{Gn=[]});function Gi(n){let i=typeof n==="string"?n.trim():"";return i?i:null}function d_(n={}){if(typeof window>"u")return;let i=Gi(n.section);try{if(window.__piclawSettingsOpenRequested=!0,i)window.__piclawSettingsRequestedSection=i;else delete window.__piclawSettingsRequestedSection}catch(r){console.debug("[settings-dialog-events] failed to record open request flags",r)}window.dispatchEvent(new CustomEvent("piclaw:open-settings",{detail:i?{section:i}:void 0}))}function br(){if(typeof window>"u")return null;return Gi(window.__piclawSettingsRequestedSection)}function e_(){if(typeof window>"u")return{open:!1,section:null};let n=Boolean(window.__piclawSettingsOpenRequested),i=br();try{window.__piclawSettingsOpenRequested=!1,delete window.__piclawSettingsRequestedSection}catch(r){console.debug("[settings-dialog-events] failed to clear open request flags",r)}return{open:n,section:i}}function m_(n=typeof window<"u"?window:null){return n||null}function Xi(){if(typeof performance<"u"&&typeof performance.now==="function")return performance.now();return Date.now()}function li(n,i){return`${n}:${i}`}function a_(n){return`${n}-${Math.random().toString(36).slice(2,10)}-${Date.now().toString(36)}`}function nc(n,i){if(n.length<=i)return;n.splice(0,n.length-i)}function Xn(n){if(!n||typeof n!=="object")return null;return{...n}}function qn(n){if(!n)return null;return Mn.find((i)=>i.id===n)||null}function vr(n,i){if(typeof performance>"u"||typeof performance.mark!=="function")return;try{performance.mark(`piclaw:${n}:${i}`)}catch(r){console.debug("[app-perf] Ignoring performance.mark failure.",r,{traceId:n,phase:i})}}function ic(n){if(typeof performance>"u"||typeof performance.clearMarks!=="function")return;try{performance.clearMarks(`piclaw:${n}:start`);let i=qn(n);if(!i)return;for(let r of i.phases)performance.clearMarks(`piclaw:${n}:${r.phase}`)}catch(i){console.debug("[app-perf] Ignoring performance.clearMarks failure.",i,{traceId:n})}}function S_(n,i,r){let _=Qn.get(li(n,i));if(_&&qn(_)?.status==="active")$i(_,"cancelled","superseded",{replacementType:n,replacementChatJid:i});let c=a_(n),s={id:c,type:n,chatJid:i,startedAt:Xi(),detail:Xn(r),phases:[],status:"active"};return Mn.push(s),nc(Mn,100),Qn.set(li(n,i),c),vr(c,"start"),c}function $i(n,i,r,_,c){let s=qn(n);if(!s||s.status!=="active")return;if(r)s.phases.push({phase:r,at:Xi(),detail:Xn(_)}),vr(s.id,r);if(s.status=i,s.completedAt=Xi(),s.durationMs=s.completedAt-s.startedAt,c!==void 0)s.error=c instanceof Error?c.message:String(c);let u=li(s.type,s.chatJid);if(Qn.get(u)===s.id)Qn.delete(u);ic(s.id)}function lu(n=m_()){let i=n?.__PICLAW_PERF__;if(i)return i;if(n)n.__PICLAW_PERF__=Mi;return Mi}function En(n=m_()){return lu(n)}function Zg(n,i,r){return En().ensureTrace(n,i,r)}function Dg(n,i){return En().getActiveTraceId(n,i)}function Ig(n,i,r){En().markTrace(n,i,r)}function Yg(n,i,r="settled",_){let c=qn(n);if(!c||c.status!=="active")return!1;let s=new Set(c.phases.map((u)=>u.phase));if(!i.every((u)=>s.has(u)))return!1;return $i(n,"completed",r,_),!0}function Lg(n,i,r="failed",_){En().failTrace(n,i,r,_)}function Cg(n,i="cancelled",r){En().cancelTrace(n,i,r)}function hr(n){return En().recordRequest(n)}var Mn,oi,Qn,Mi;var rc=d(()=>{Mn=[],oi=[],Qn=new Map;Mi={startTrace(n,i,r){return S_(n,i,r)},ensureTrace(n,i,r){let _=Qn.get(li(n,i));if(_&&qn(_)?.status==="active")return _;return S_(n,i,r)},getActiveTraceId(n,i){let r=Qn.get(li(n,i));return r&&qn(r)?.status==="active"?r:null},markTrace(n,i,r){let _=qn(n);if(!_||_.status!=="active")return;_.phases.push({phase:i,at:Xi(),detail:Xn(r)}),vr(_.id,i)},completeTrace(n,i="settled",r){$i(n,"completed",i,r)},failTrace(n,i,r="failed",_){$i(n,"failed",r,_,i)},cancelTrace(n,i="cancelled",r){$i(n,"cancelled",i,r)},recordRequest(n){let i=a_("req");return oi.push({...n,id:i,detail:Xn(n.detail)}),nc(oi,300),i},getTraces(){return Mn.map((n)=>({...n,detail:Xn(n.detail),phases:n.phases.map((i)=>({...i,detail:Xn(i.detail)}))}))},getRequests(){return oi.map((n)=>({...n,detail:Xn(n.detail)}))},clear(){Mn.forEach((n)=>ic(n.id)),Mn.splice(0,Mn.length),oi.splice(0,oi.length),Qn.clear()},printSummary(){let n={traces:Mi.getTraces(),requests:Mi.getRequests()};return console.table(n.traces.map((i)=>({id:i.id,type:i.type,chatJid:i.chatJid,status:i.status,durationMs:Number(i.durationMs||0).toFixed(1),lastPhase:i.phases[i.phases.length-1]?.phase||"start"}))),n}}});function dn(n){let i=Number(n||0);return Number.isFinite(i)&&i>0?i:null}function wu(n){try{return Boolean(n?.matchMedia?.("(pointer: coarse)")?.matches)}catch{return!1}}function tu(n){let i=String(n?.navigator?.userAgent||"");return/Android|webOS|iPhone|iPod|Mobile|Windows Phone/i.test(i)}function _c(n){let i=String(n?.navigator?.userAgent||"");return/iPad|Tablet|PlayBook|Silk/i.test(i)}function cc(n=typeof window<"u"?window:null){let i=dn(n?.innerWidth)??dn(n?.screen?.availWidth)??dn(n?.screen?.width)??0,r=dn(n?.innerHeight)??dn(n?.screen?.availHeight)??dn(n?.screen?.height)??0,_=i&&r?Math.min(i,r):i||r,c=i&&r?Math.max(i,r):i||r,s=wu(n),u=Number(n?.navigator?.maxTouchPoints||0),f=s||u>1;if(_>0&&_<=640)return"mobile";if(tu(n)&&!_c(n))return"mobile";if(_c(n))return"tablet";if(f&&_>0&&_<=1100)return"tablet";if(c>0&&c<=1180&&_>0&&_<=900)return"tablet";return"desktop"}var Uf={};on(Uf,{uploadWorkspaceFile:()=>hf,uploadMedia:()=>Eu,updateWorkspaceFile:()=>tf,updateScheduledTask:()=>zr,submitAdaptiveCardAction:()=>eu,streamSidePrompt:()=>Su,stopSessionRecording:()=>Wr,stopAutoresearch:()=>Du,steerAgentQueueItem:()=>Cu,startSessionRecording:()=>Tr,setWorkspaceVisibility:()=>Ff,setAgentThoughtVisibility:()=>nf,sessionRecordingPlaybackUrl:()=>Ur,sessionRecordingExportUrl:()=>wi,sendPeerAgentMessage:()=>Vu,sendAgentMessage:()=>Bn,searchPosts:()=>xu,saveWorkspaceSettings:()=>Xr,saveWebPushSubscription:()=>Xu,saveUiState:()=>Nr,saveQuickActionsSettings:()=>Gr,savePostAnnotations:()=>Pf,saveEnvironmentOverride:()=>qi,restoreChatBranch:()=>Ru,respondToAgentRequest:()=>du,reorderAgentQueueItem:()=>Ou,renameWorkspaceFile:()=>Bf,renameChatJid:()=>Nu,renameChatBranch:()=>Wu,removeAgentQueueItem:()=>Lu,reindexWorkspace:()=>$f,purgeChatBranch:()=>ju,pruneChatBranch:()=>Uu,previewSessionRecordingRedaction:()=>jr,moveWorkspaceEntry:()=>Hf,mergeChatBranchIntoParent:()=>Pu,getWorkspaceTree:()=>ff,getWorkspaceRawUrl:()=>uc,getWorkspaceIndexStatus:()=>of,getWorkspaceFileStat:()=>wf,getWorkspaceFileDownloadUrl:()=>Tf,getWorkspaceFile:()=>lf,getWorkspaceDownloadUrl:()=>Wf,getWorkspaceBranch:()=>gf,getWebPushPublicKey:()=>Gu,getTimeline:()=>ku,getThumbnailUrl:()=>_f,getThread:()=>bu,getSystemMetrics:()=>vu,getSessionRecordings:()=>Fr,getSessionRecording:()=>Qi,getScheduledTasks:()=>Hr,getQuickActionsSettings:()=>Vr,getPostsByHashtag:()=>pu,getMediaUrl:()=>rf,getMediaText:()=>sf,getMediaInfo:()=>cf,getMediaBlob:()=>uf,getEnvironmentSettings:()=>Mr,getChatBranches:()=>zu,getAutoresearchStatus:()=>Zu,getAgents:()=>Qu,getAgentThought:()=>au,getAgentStatus:()=>qu,getAgentQueueState:()=>Yu,getAgentModels:()=>Qr,getAgentContext:()=>Au,getAgentCommands:()=>Rr,getActiveChatAgents:()=>Hu,forkChatBranch:()=>Fu,dismissAutoresearch:()=>Iu,deleteWorkspaceFile:()=>zf,deleteWebPushSubscription:()=>Mu,deleteSessionRecording:()=>Pr,deletePost:()=>Bu,createWorkspaceFile:()=>Kf,createRootChatSession:()=>Tu,createReply:()=>Ku,createPost:()=>hu,completeInstanceOobe:()=>Ju,attachWorkspaceFile:()=>yf,addToWhitelist:()=>mu,SSEClient:()=>fc});function Kn(n,i={}){if(String(i.method||"GET").toUpperCase()!=="GET")return Z(n,i);let _=Kr.get(n);if(_)return _;let c=Z(n,i).finally(()=>{Kr.delete(n)});return Kr.set(n,c),c}async function Z(n,i={}){let r=typeof performance<"u"&&typeof performance.now==="function"?performance.now():Date.now(),_;try{_=await fetch(sn+n,{...i,headers:{"Content-Type":"application/json",...i.headers}})}catch(s){throw hr({method:String(i.method||"GET").toUpperCase(),url:n,startedAt:r,durationMs:(typeof performance<"u"&&typeof performance.now==="function"?performance.now():Date.now())-r,ok:!1,detail:{failedBeforeResponse:!0}}),s}let c=(typeof performance<"u"&&typeof performance.now==="function"?performance.now():Date.now())-r;if(hr({method:String(i.method||"GET").toUpperCase(),url:n,startedAt:r,durationMs:c,status:_.status,ok:_.ok,requestId:_.headers?.get?.("x-request-id")||null,serverTiming:_.headers?.get?.("Server-Timing")||null}),!_.ok){let s=await _.json().catch(()=>({error:"Unknown error"}));throw Error(s.error||`HTTP ${_.status}`)}return _.json()}function sc(n){let i=String(n||"").split(`
`),r="message",_=[];for(let s of i)if(s.startsWith("event:"))r=s.slice(6).trim()||"message";else if(s.startsWith("data:"))_.push(s.slice(5).trim());let c=_.join(`
`);if(!c)return null;try{return{event:r,data:JSON.parse(c)}}catch{return{event:r,data:c}}}async function yu(n,i){if(!n.body)throw Error("Missing event stream body");let r=n.body.getReader(),_=new TextDecoder,c="";while(!0){let{value:u,done:f}=await r.read();if(f)break;c+=_.decode(u,{stream:!0});let l=c.split(`

`);c=l.pop()||"";for(let o of l){let y=sc(o);if(y)i(y.event,y.data)}}c+=_.decode();let s=sc(c);if(s)i(s.event,s.data)}async function ku(n=10,i=null,r=null){let _=`/timeline?limit=${n}`;if(i)_+=`&before=${i}`;if(r)_+=`&chat_jid=${encodeURIComponent(r)}`;return Kn(_)}async function pu(n,i=50,r=0,_=null){let c=_?`&chat_jid=${encodeURIComponent(_)}`:"";return Z(`/hashtag/${encodeURIComponent(n)}?limit=${i}&offset=${r}${c}`)}async function xu(n,i=50,r=0,_=null,c="current",s=null,u=null){let f=_?`&chat_jid=${encodeURIComponent(_)}`:"",l=c?`&scope=${encodeURIComponent(c)}`:"",o=s?`&root_chat_jid=${encodeURIComponent(s)}`:"",y=u?.images?"&images=1":"",H=u?.attachments?"&attachments=1":"";return Z(`/search?q=${encodeURIComponent(n)}&limit=${i}&offset=${r}${f}${l}${o}${y}${H}`)}async function bu(n,i=null){let r=i?`?chat_jid=${encodeURIComponent(i)}`:"";return Z(`/thread/${n}${r}`)}async function vu(){return Z("/agent/system-metrics")}async function Hr(n={}){let i=new URLSearchParams;if(n?.id)i.set("id",String(n.id));if(n?.chatJid)i.set("chat_jid",String(n.chatJid));if(n?.status&&n.status!=="all")i.set("status",String(n.status));if(n?.limit)i.set("limit",String(n.limit));if(n?.includeRunLogs)i.set("include_run_logs","1");if(n?.runLogLimit)i.set("run_log_limit",String(n.runLogLimit));let r=i.toString()?`?${i.toString()}`:"";return Z(`/agent/scheduled-tasks${r}`)}async function zr(n,i,r={}){return Z("/agent/scheduled-tasks/action",{method:"POST",body:JSON.stringify({action:n,id:i,allow_internal:r?.allowInternal===!0})})}async function Fr(){return Z("/agent/recordings")}async function Qi(n){return Z(`/agent/recordings/${encodeURIComponent(n)}`)}async function Tr(n={}){return Z("/agent/recordings/start",{method:"POST",body:JSON.stringify(n||{})})}async function Wr(n={}){return Z("/agent/recordings/stop",{method:"POST",body:JSON.stringify(n||{})})}async function Pr(n){return Z(`/agent/recordings/${encodeURIComponent(n)}`,{method:"DELETE"})}function wi(n,i="json"){return`/agent/recordings/${encodeURIComponent(n)}/export?format=${encodeURIComponent(i)}`}function Ur(n){return`/recordings/playback?id=${encodeURIComponent(n)}`}async function jr(n,i={}){return Z("/agent/recordings/redact-preview",{method:"POST",body:JSON.stringify({payload:n,...i})})}async function Nr(n){return Z("/agent/ui-state",{method:"POST",body:JSON.stringify(n||{})})}async function hu(n,i=[],r=null){let _=r?`?chat_jid=${encodeURIComponent(r)}`:"";return Z(`/post${_}`,{method:"POST",body:JSON.stringify({content:n,media_ids:i})})}async function Ku(n,i,r=[],_=null){let c=_?`?chat_jid=${encodeURIComponent(_)}`:"";return Z(`/post/reply${c}`,{method:"POST",body:JSON.stringify({thread_id:n,content:i,media_ids:r})})}async function Bu(n,i=!1,r=null){let _=r?`&chat_jid=${encodeURIComponent(r)}`:"",c=`/post/${n}?cascade=${i?"true":"false"}${_}`;return Z(c,{method:"DELETE"})}async function Bn(n,i,r=null,_=[],c=null,s=null){let u=s?`?chat_jid=${encodeURIComponent(s)}`:"",f={content:i,thread_id:r,media_ids:_,client_context:{screen_hint:cc()}};if(c==="auto"||c==="queue"||c==="steer")f.mode=c;return Z(`/agent/${n}/message${u}`,{method:"POST",body:JSON.stringify(f)})}async function Rr(n="web:default"){let i=typeof n==="string"&&n.trim()?n.trim():"web:default";return Kn(`/agent/commands?chat_jid=${encodeURIComponent(i)}`)}async function Vr(){return Z("/agent/settings/quick-actions")}async function Gr(n){return Z("/agent/settings/quick-actions",{method:"POST",body:JSON.stringify(n||{})})}async function Xr(n){return Z("/agent/settings/workspace",{method:"POST",body:JSON.stringify(n||{})})}async function Mr(){return Z("/agent/settings/environment")}async function qi(n){return Z("/agent/settings/environment",{method:"POST",body:JSON.stringify(n||{})})}async function Hu(){return Z("/agent/active-chats")}async function zu(n=null,i={}){let r=new URLSearchParams;if(n)r.set("root_chat_jid",String(n));if(i?.includeArchived)r.set("include_archived","1");let _=r.toString()?`?${r.toString()}`:"";return Kn(`/agent/branches${_}`)}async function Fu(n,i={}){return Z("/agent/branch-fork",{method:"POST",body:JSON.stringify({source_chat_jid:n,...i?.agentName?{agent_name:i.agentName}:{}})})}async function Tu(n){return Z("/agent/root-session",{method:"POST",body:JSON.stringify({agent_name:n})})}async function Wu(n,i={}){return Z("/agent/branch-rename",{method:"POST",body:JSON.stringify({chat_jid:n,...i&&Object.prototype.hasOwnProperty.call(i,"agentName")?{agent_name:i.agentName}:{}})})}async function Pu(n){return Z("/agent/branch-merge-parent",{method:"POST",body:JSON.stringify({chat_jid:n})})}async function Uu(n){return Z("/agent/branch-prune",{method:"POST",body:JSON.stringify({chat_jid:n})})}async function ju(n){return Z("/agent/branch-purge",{method:"POST",body:JSON.stringify({chat_jid:n})})}async function Nu(n,i){return Z("/agent/rename-jid",{method:"POST",body:JSON.stringify({old_jid:n,new_jid:i})})}async function Ru(n,i={}){return Z("/agent/branch-restore",{method:"POST",body:JSON.stringify({chat_jid:n,...i&&Object.prototype.hasOwnProperty.call(i,"agentName")?{agent_name:i.agentName}:{}})})}async function Vu(n,i,r,_="auto",c={}){let s={source_chat_jid:n,content:r,mode:_,...c?.sourceAgentName?{source_agent_name:c.sourceAgentName}:{},...c?.targetBy==="agent_name"?{target_agent_name:i}:{target_chat_jid:i}};return Z("/agent/peer-message",{method:"POST",body:JSON.stringify(s)})}async function Gu(){return Z("/agent/push/vapid-public-key")}async function Xu(n,i={}){let r={subscription:n,...i?.deviceId?{device_id:i.deviceId}:{}};return Z("/agent/push/subscription",{method:"POST",body:JSON.stringify(r)})}async function Mu(n,i={}){let r={subscription:n,...i?.deviceId?{device_id:i.deviceId}:{}};return Z("/agent/push/subscription",{method:"DELETE",body:JSON.stringify(r)})}async function Qu(){return Kn("/agent/roster")}async function qu(n=null){let i=n?`?chat_jid=${encodeURIComponent(n)}`:"";return Kn(`/agent/status${i}`)}async function Au(n=null){let i=n?`?chat_jid=${encodeURIComponent(n)}`:"";return Kn(`/agent/context${i}`)}async function Zu(n=null){let i=n?`?chat_jid=${encodeURIComponent(n)}`:"";return Kn(`/agent/autoresearch/status${i}`)}async function Du(n=null,i={}){return Z("/agent/autoresearch/stop",{method:"POST",body:JSON.stringify({chat_jid:n||void 0,generate_report:i?.generateReport!==!1})})}async function Iu(n=null){return Z("/agent/autoresearch/dismiss",{method:"POST",body:JSON.stringify({chat_jid:n||void 0})})}async function Yu(n=null){let i=n?`?chat_jid=${encodeURIComponent(n)}`:"";return Kn(`/agent/queue-state${i}`)}async function Lu(n,i=null){let r=await fetch(sn+"/agent/queue-remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({row_id:n,chat_jid:i||void 0})});if(!r.ok){let _=await r.json().catch(()=>({error:"Failed to remove queued item"}));throw Error(_.error||`HTTP ${r.status}`)}return r.json()}async function Cu(n,i=null){let r=await fetch(sn+"/agent/queue-steer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({row_id:n,chat_jid:i||void 0})});if(!r.ok){let _=await r.json().catch(()=>({error:"Failed to steer queued item"}));throw Error(_.error||`HTTP ${r.status}`)}return r.json()}async function Ou(n,i,r=null){let _=await fetch(sn+"/agent/queue-reorder",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from_index:n,to_index:i,chat_jid:r||void 0})});if(!_.ok){let c=await _.json().catch(()=>({error:"Failed to reorder queued item"}));throw Error(c.error||`HTTP ${_.status}`)}return _.json()}async function Qr(n=null){let i=n?`?chat_jid=${encodeURIComponent(n)}`:"";return Kn(`/agent/models${i}`)}async function Ju(n="provider-ready"){return Z("/agent/oobe/complete",{method:"POST",body:JSON.stringify({kind:n})})}async function Eu(n){let i=new FormData;i.append("file",n);let r=await fetch(sn+"/media/upload",{method:"POST",body:i});if(!r.ok){let _=await r.json().catch(()=>({error:"Upload failed"}));throw Error(_.error||`HTTP ${r.status}`)}return r.json()}async function du(n,i,r=null){let _=await fetch(sn+"/agent/respond",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({request_id:n,outcome:i,chat_jid:r||void 0})});if(!_.ok){let c=await _.json().catch(()=>({error:"Failed to respond"}));throw Error(c.error||`HTTP ${_.status}`)}return _.json()}async function eu(n){let i=await fetch(sn+"/agent/card-action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(n)});if(!i.ok){let r=await i.json().catch(()=>({error:"Adaptive Card action failed"}));throw Error(r.error||`HTTP ${i.status}`)}return i.json()}async function Su(n,i={}){let r=await fetch(sn+"/agent/side-prompt/stream",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:n,system_prompt:i.systemPrompt||void 0,chat_jid:i.chatJid||void 0}),signal:i.signal});if(!r.ok){let s=await r.json().catch(()=>({error:"Side prompt failed"}));throw Error(s.error||`HTTP ${r.status}`)}let _=null,c=null;if(await yu(r,(s,u)=>{if(i.onEvent?.(s,u),s==="side_prompt_thinking_delta")i.onThinkingDelta?.(u?.delta||"");else if(s==="side_prompt_text_delta")i.onTextDelta?.(u?.delta||"");else if(s==="side_prompt_done")_=u;else if(s==="side_prompt_error")c=u}),c){let s=Error(c?.error||"Side prompt failed");throw s.payload=c,s}return _}async function mu(n,i){let r=await fetch(sn+"/agent/whitelist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pattern:n,description:i})});if(!r.ok){let _=await r.json().catch(()=>({error:"Failed to add to whitelist"}));throw Error(_.error||`HTTP ${r.status}`)}return r.json()}async function au(n,i="thought"){let r=`/agent/thought?turn_id=${encodeURIComponent(n)}&panel=${encodeURIComponent(i)}`;return Z(r)}async function nf(n,i,r){return Z("/agent/thought/visibility",{method:"POST",body:JSON.stringify({turn_id:n,panel:i,expanded:Boolean(r)})})}function rf(n){return`${sn}/media/${n}`}function _f(n){return`${sn}/media/${n}/thumbnail`}async function cf(n){let i=await fetch(`${sn}/media/${n}/info`);if(!i.ok)throw Error("Failed to get media info");return i.json()}async function sf(n){let i=await fetch(`${sn}/media/${n}`);if(!i.ok)throw Error("Failed to load media text");return i.text()}async function uf(n){let i=await fetch(`${sn}/media/${n}`);if(!i.ok)throw Error("Failed to load media blob");return i.blob()}async function ff(n="",i=2,r=!1){let _=`/workspace/tree?path=${encodeURIComponent(n)}&depth=${i}&show_hidden=${r?"1":"0"}`;return Z(_)}async function gf(n=""){let i=`/workspace/branch?path=${encodeURIComponent(n||"")}`;return Z(i)}async function of(n="all"){let i=`/workspace/index-status?scope=${encodeURIComponent(n||"all")}`;return Z(i)}async function $f(n="all"){return Z("/workspace/reindex",{method:"POST",body:JSON.stringify({scope:n})})}async function lf(n,i=20000,r=null){let _=r?`&mode=${encodeURIComponent(r)}`:"",c=`/workspace/file?path=${encodeURIComponent(n)}&max=${i}${_}`;return Z(c)}async function wf(n){return Z(`/workspace/stat?path=${encodeURIComponent(n)}`)}async function tf(n,i){return Z("/workspace/file",{method:"PUT",body:JSON.stringify({path:n,content:i})})}async function yf(n){return Z("/workspace/attach",{method:"POST",body:JSON.stringify({path:n})})}function pf(n,i="",r={}){let _=new URLSearchParams;if(i)_.set("path",i);if(r.overwrite)_.set("overwrite","1");let c=_.toString();return c?`${n}?${c}`:n}function xf(){if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();return`upload-${Date.now()}-${Math.random().toString(36).slice(2)}`}function bf(n,i,r,_){return new Promise((c,s)=>{let u=new XMLHttpRequest;u.open("POST",sn+i);for(let[f,l]of Object.entries(r||{}))if(l!==void 0&&l!==null)u.setRequestHeader(f,String(l));u.upload.onprogress=(f)=>{if(typeof _==="function")_({loaded:f.lengthComputable?f.loaded:0,total:f.lengthComputable?f.total:n.size,lengthComputable:f.lengthComputable})},u.onload=()=>{try{let f=u.responseText?JSON.parse(u.responseText):{};if(u.status>=200&&u.status<300)c(f);else{let l=Error(f.error||`HTTP ${u.status}`);l.status=u.status,l.code=f.code,s(l)}}catch{let f=Error(`HTTP ${u.status}`);f.status=u.status,s(f)}},u.onerror=()=>s(Error("Upload failed (network error)")),u.ontimeout=()=>s(Error("Upload timed out")),u.send(n)})}async function vf(n,i="",r={}){let _=xf(),c=pf("/workspace/upload-chunk",i,r),s=Math.max(1,Math.min(Br,Number(r.chunkSize)||kf)),u=Math.max(0,Number(n?.size)||0),f=Math.max(1,Math.ceil(u/s)),l=0,o=null;for(let y=0;y<f;y+=1){let H=y*s,$=Math.min(u,H+s),v=n.slice(H,$),h=v.size;if(o=await bf(v,c,{"X-Upload-Id":_,"X-Chunk-Index":y,"X-Chunk-Total":f,"X-File-Name":n?.name||"upload.bin","X-File-Size":u},(b)=>{if(typeof r.onProgress!=="function")return;let F=Math.min(u,l+(b?.loaded||0)),k=u||1;r.onProgress({loaded:F,total:k,percent:Math.round(F/k*100),chunkIndex:y,chunkTotal:f})}),l+=h,typeof r.onProgress==="function"){let b=u||1,F=u?l:b;r.onProgress({loaded:F,total:b,percent:Math.round(F/b*100),chunkIndex:y+1,chunkTotal:f})}}return o}async function hf(n,i="",r={}){if(n?.size>Br){let _=(n.size/1048576).toFixed(0),c=(Br/1048576).toFixed(0),s=Error(`File too large (${_} MB). Maximum upload size is ${c} MB.`);throw s.code="file_too_large",s}return await vf(n,i,r)}async function Kf(n,i,r=""){let _=await fetch(sn+"/workspace/file",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:n,name:i,content:r})});if(!_.ok){let c=await _.json().catch(()=>({error:"Create failed"})),s=Error(c.error||`HTTP ${_.status}`);throw s.status=_.status,s.code=c.code,s}return _.json()}async function Bf(n,i){let r=await fetch(sn+"/workspace/rename",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:n,name:i})});if(!r.ok){let _=await r.json().catch(()=>({error:"Rename failed"})),c=Error(_.error||`HTTP ${r.status}`);throw c.status=r.status,c.code=_.code,c}return r.json()}async function Hf(n,i){let r=await fetch(sn+"/workspace/move",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:n,target:i})});if(!r.ok){let _=await r.json().catch(()=>({error:"Move failed"})),c=Error(_.error||`HTTP ${r.status}`);throw c.status=r.status,c.code=_.code,c}return r.json()}async function zf(n){let i=`/workspace/file?path=${encodeURIComponent(n||"")}`;return Z(i,{method:"DELETE"})}async function Ff(n,i=!1){return Z("/workspace/visibility",{method:"POST",body:JSON.stringify({visible:Boolean(n),show_hidden:Boolean(i)})})}function uc(n,i={}){let r=new URLSearchParams({path:String(n||"")});if(i.download)r.set("download","1");return`${sn}/workspace/raw?${r.toString()}`}function Tf(n){return uc(n,{download:!0})}function Wf(n,i=!1){let r=`path=${encodeURIComponent(n||"")}&show_hidden=${i?"1":"0"}`;return`${sn}/workspace/download?${r}`}class fc{onEvent;onStatusChange;chatJid;eventSource;reconnectTimeout;reconnectDelay;status;reconnectAttempts;cooldownUntil;connecting;lastActivityAt;staleCheckTimer;staleThresholdMs;constructor(n,i,r={}){this.onEvent=n,this.onStatusChange=i,this.chatJid=typeof r?.chatJid==="string"&&r.chatJid.trim()?r.chatJid.trim():null,this.eventSource=null,this.reconnectTimeout=null,this.reconnectDelay=1000,this.status="disconnected",this.reconnectAttempts=0,this.cooldownUntil=0,this.connecting=!1,this.lastActivityAt=0,this.staleCheckTimer=null,this.staleThresholdMs=70000}markActivity(){this.lastActivityAt=Date.now()}clearStaleMonitor(){if(this.staleCheckTimer)clearInterval(this.staleCheckTimer),this.staleCheckTimer=null}startStaleMonitor(){this.clearStaleMonitor(),this.staleCheckTimer=setInterval(()=>{if(this.status!=="connected")return;if(!this.lastActivityAt)return;if(Date.now()-this.lastActivityAt<=this.staleThresholdMs)return;console.warn("SSE connection went stale; forcing reconnect"),this.forceReconnect()},15000)}forceReconnect(){if(this.connecting=!1,this.eventSource)this.eventSource.close(),this.eventSource=null;this.clearStaleMonitor(),this.status="disconnected",this.onStatusChange("disconnected"),this.reconnectAttempts+=1,this.scheduleReconnect()}connect(){if(this.connecting)return;if(this.eventSource&&this.status==="connected")return;if(this.connecting=!0,this.eventSource)this.eventSource.close();this.clearStaleMonitor();let n=this.chatJid?`?chat_jid=${encodeURIComponent(this.chatJid)}`:"";this.eventSource=new EventSource(sn+"/sse/stream"+n);let i=(r)=>{this.eventSource.addEventListener(r,(_)=>{this.markActivity(),this.onEvent(r,JSON.parse(_.data))})};this.eventSource.onopen=()=>{this.connecting=!1,this.reconnectDelay=1000,this.reconnectAttempts=0,this.cooldownUntil=0,this.status="connected",this.markActivity(),this.startStaleMonitor(),this.onStatusChange("connected")},this.eventSource.onerror=()=>{this.connecting=!1,this.clearStaleMonitor(),this.status="disconnected",this.onStatusChange("disconnected"),this.reconnectAttempts+=1,this.scheduleReconnect()},this.eventSource.addEventListener("connected",()=>{this.markActivity(),console.log("SSE connected"),this.onEvent("connected",{})}),this.eventSource.addEventListener("heartbeat",()=>{this.markActivity()}),i("new_post"),i("new_reply"),i("agent_response"),i("interaction_updated"),i("interaction_deleted"),i("agent_status"),i("agent_steer_queued"),i("agent_followup_queued"),i("agent_followup_consumed"),i("agent_followup_removed"),i("workspace_update"),i("agent_draft"),i("agent_draft_delta"),i("agent_thought"),i("agent_thought_delta"),i("model_changed"),i("ui_theme"),i("ui_meters"),["extension_ui_request","extension_ui_timeout","extension_ui_notify","extension_ui_status","extension_ui_working","extension_ui_working_indicator","extension_ui_working_visible","extension_ui_widget","extension_ui_title","extension_ui_editor_text","extension_ui_error"].forEach(i)}scheduleReconnect(){if(this.reconnectTimeout)clearTimeout(this.reconnectTimeout);let n=10,i=60000,r=Date.now();if(this.reconnectAttempts>=n)this.cooldownUntil=Math.max(this.cooldownUntil,r+i),this.reconnectAttempts=0;let _=Math.max(this.cooldownUntil-r,0),c=Math.max(this.reconnectDelay,_);this.reconnectTimeout=setTimeout(()=>{console.log("Reconnecting SSE..."),this.connect()},c),this.reconnectDelay=Math.min(this.reconnectDelay*2,30000)}reconnectIfNeeded(){let n=Date.now();if(this.status==="connected"){if(this.lastActivityAt&&n-this.lastActivityAt>this.staleThresholdMs)this.forceReconnect();return}if(this.cooldownUntil&&n<this.cooldownUntil)return;if(this.reconnectTimeout)clearTimeout(this.reconnectTimeout),this.reconnectTimeout=null;this.connect()}disconnect(){if(this.connecting=!1,this.clearStaleMonitor(),this.eventSource)this.eventSource.close(),this.eventSource=null;if(this.reconnectTimeout)clearTimeout(this.reconnectTimeout),this.reconnectTimeout=null}}async function Pf(n,i,r){let _=r?`?chat_jid=${encodeURIComponent(r)}`:"";return Z(`/post/${n}/annotations${_}`,{method:"PATCH",body:JSON.stringify({annotations:i})})}var sn="",Kr,Br=1073741824,kf=8388608;var Hn=d(()=>{rc();Kr=new Map});function Nf(n){if(typeof window>"u")return;window.dispatchEvent(new CustomEvent(Zi,{detail:{enabled:Boolean(n)}}))}function $c(n){if(typeof fetch!=="function")return;Nr({ui_meters:n}).catch((i)=>{console.debug("[meters] Failed to persist meters UI state.",i)})}function Rf(n){if(typeof window>"u")return;window.dispatchEvent(new CustomEvent(jf,{detail:{collapsed:Boolean(n)}}))}function qr(n=!1){return tr(gc,n)}function mg(n=!1){return tr(oc,n)}function Ai(n,i={}){let r=i.persist!==!1,_=i.persistServer!==!1,c=Boolean(n);if(r)$n(gc,c?"true":"false");if(_)$c({enabled:c});return Nf(c),c}function Vf(n,i={}){let r=i.persist!==!1,_=i.persistServer!==!1,c=Boolean(n);if(r)$n(oc,c?"true":"false");if(_)$c({collapsed:c});return Rf(c),c}function ag(n){let i=typeof n?.mode==="string"?n.mode.trim().toLowerCase():"";if(typeof n?.enabled==="boolean")Ai(Boolean(n.enabled),{persistServer:!1});else if(i==="toggle"){let r=!qr(!1);Ai(r,{persistServer:!1})}if(typeof n?.collapsed==="boolean")Vf(Boolean(n.collapsed),{persistServer:!1})}var gc="piclaw_system_meters_enabled",oc="piclaw_system_meters_collapsed",Zi="piclaw-meters-change",jf="piclaw-meters-collapsed-change";var lc=d(()=>{Hn()});function wc(n,i){if(n===""||n===null||n===void 0)return i;let r=Number(n);return Number.isFinite(r)?r:i}function tc(n,{min:i=-1/0,max:r=1/0}={}){let _=Number.isFinite(Number(i))?Number(i):-1/0,c=Number.isFinite(Number(r))?Number(r):1/0;return Math.min(c,Math.max(_,Number(n)))}function en(n,{fallback:i=0,min:r=-1/0,max:_=1/0}={}){let c=wc(n,i);return tc(c,{min:r,max:_})}function Gf(n,{direction:i=1,step:r=1,fallback:_=0,min:c=-1/0,max:s=1/0}={}){let u=en(n,{fallback:_,min:c,max:s}),f=Math.abs(wc(r,1))||1,l=Number(i)<0?-1:1;return tc(u+l*f,{min:c,max:s})}function m({value:n,min:i,max:r,step:_=1,fallback:c,width:s="80px",disabled:u=!1,label:f,onChange:l}){let o=Number.isFinite(Number(c))?Number(c):en(n,{fallback:0,min:i,max:r}),[y,H]=w(String(n??o)),$=E(!1);X(()=>{if(!$.current)H(String(n??o))},[n,o]);let v=U((b)=>{$.current=!1;let F=en(b,{fallback:o,min:i,max:r});H(String(F)),l?.(F)},[o,i,r,l]),h=U((b)=>{$.current=!1;let F=Gf(n,{direction:b,step:_,fallback:o,min:i,max:r});H(String(F)),l?.(F)},[o,r,i,l,_,n]);return g`
        <span class="settings-number-stepper">
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Decrease ${f||"value"}`}
                title=${`Decrease ${f||"value"}`}
                disabled=${u}
                onClick=${()=>h(-1)}
            >−</button>
            <input
                class="settings-number-input"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                value=${y}
                disabled=${u}
                style=${`width:${s}`}
                onInput=${(b)=>{$.current=!0,H(b.target.value)}}
                onBlur=${(b)=>v(b.target.value)}
                onKeyDown=${(b)=>{if(b.key==="Enter")b.preventDefault(),v(b.target.value),b.target.blur()}}
            />
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Increase ${f||"value"}`}
                title=${`Increase ${f||"value"}`}
                disabled=${u}
                onClick=${()=>h(1)}
            >+</button>
        </span>
    `}var Sn=d(()=>{rn()});function yc(n,i){let r=String(n||"").trim();if(!r)return"";if(r.startsWith("data:")||r.startsWith("blob:"))return r;return i==="agent"||i==="user"?`/avatar/${i}`:""}function kc({value:n,kind:i,onChange:r}){let{t:_}=L(),c=E(null),[s,u]=w(yc(n,i));X(()=>{u(yc(n,i))},[i,n]);let f=U((l)=>{let o=l.target.files?.[0];if(!o)return;let y=new FileReader;y.onload=()=>{let H=y.result;u(H),r?.(H)},y.readAsDataURL(o)},[r]);return g`
        <div class="settings-avatar-inline" onClick=${()=>c.current?.click()} title=${_("settings.general.avatarUpload")}>
            ${s?g`<img src=${s} alt="avatar" />`:g`<span class="settings-avatar-placeholder">+</span>`}
            <input type="file" accept="image/*" ref=${c} style="display:none" onChange=${f} />
        </div>
    `}function pc(n={}){return{userName:n.userName||"",userAvatar:n.userAvatar||"",assistantName:n.assistantName||"",assistantAvatar:n.assistantAvatar||"",composeUploadLimitMb:n.composeUploadLimitMb??32,workspaceUploadLimitMb:n.workspaceUploadLimitMb??256,automaticRecoveryEnabled:n.automaticRecoveryEnabled??!0,automaticRecoveryMaxAttempts:n.automaticRecoveryMaxAttempts??0,automaticRecoveryTotalBudgetMs:n.automaticRecoveryTotalBudgetMs??360000}}async function Xf(n,i={}){let r=typeof n==="string"?n:"";if(!r)return!1;let _=i.navigator??(typeof navigator<"u"?navigator:null),c=i.document??(typeof document<"u"?document:null);if(_?.clipboard?.writeText)try{return await _.clipboard.writeText(r),!0}catch(s){console.debug("[settings/general] Clipboard API write failed; falling back to execCommand.",s)}try{if(!c?.body||typeof c.createElement!=="function"||typeof c.execCommand!=="function")return!1;let s=c.createElement("textarea");s.value=r,s.setAttribute?.("readonly",""),s.style.position="fixed",s.style.left="-9999px",s.style.top="0",s.style.opacity="0",c.body.appendChild(s),s.focus?.(),s.select?.();let u=Boolean(c.execCommand("copy"));return c.body.removeChild(s),u}catch(s){return!1}}function Ar({settingsData:n,setStatus:i,mergeSettingsData:r}){let{t:_}=L(),[c,s]=w(""),[u,f]=w(""),[l,o]=w(""),[y,H]=w(""),[$,v]=w(32),[h,b]=w(256),[F,k]=w(!0),[x,N]=w(0),[M,W]=w(360000),[z,p]=w(""),[P,Q]=w(!1),[t,j]=w(!1),[B,V]=w(!1),[Y,K]=w(()=>qr(!1)),[A,C]=w(!1),cn=E(""),S=E(null),fn=E(!0);X(()=>{return fn.current=!0,()=>{fn.current=!1}},[]);let xn=U((D)=>{let O=pc(D);s(O.userName),f(O.userAvatar),o(O.assistantName),H(O.assistantAvatar),v(O.composeUploadLimitMb),b(O.workspaceUploadLimitMb),k(O.automaticRecoveryEnabled),N(O.automaticRecoveryMaxAttempts),W(O.automaticRecoveryTotalBudgetMs),p(D?.widgetToken||""),cn.current=JSON.stringify(O)},[]);X(()=>{xn(n||{})},[n,xn]),X(()=>{let D=(O)=>{K(Boolean(O?.detail?.enabled))};return window.addEventListener(Zi,D),()=>window.removeEventListener(Zi,D)},[]);let kn=J(()=>JSON.stringify(pc({userName:c,userAvatar:u,assistantName:l,assistantAvatar:y,composeUploadLimitMb:$,workspaceUploadLimitMb:h,automaticRecoveryEnabled:F,automaticRecoveryMaxAttempts:x,automaticRecoveryTotalBudgetMs:M})),[c,u,l,y,$,h,F,x,M]);X(()=>{if(kn===cn.current)return;if(S.current)clearTimeout(S.current);return S.current=setTimeout(async()=>{if(!fn.current)return;try{let D=await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:kn}),O=await D.json().catch(()=>({}));if(!fn.current)return;if(!D.ok||!O?.ok||!O?.settings)throw Error(O?.error||`Failed to save general settings (${D.status})`);cn.current=kn,r?.(O.settings),i?.(null),C(!0),setTimeout(()=>{if(fn.current)C(!1)},4000)}catch(D){if(console.warn("[settings/general] Failed to persist general settings snapshot.",D),fn.current)i?.(String(D?.message||D),"error")}},800),()=>{if(S.current)clearTimeout(S.current)}},[kn,r,i]);let wn=n?.instanceTotp||{configured:!1,issuer:l||"Piclaw",label:c?`${l||"Piclaw"}:${c}`:l||"Piclaw",secret:"",otpauth:"",qrSvg:""},tn=U(async()=>{if(!z)return;if(await Xf(z))j(!0),setTimeout(()=>{if(fn.current)j(!1)},3000);else i?.(_("settings.general.copyFailed")),console.warn("[settings/general] Failed to copy widget token. Clipboard APIs unavailable or blocked.")},[z,i]),Nn=U(async()=>{if(B)return;if(!confirm(_("settings.general.regenConfirm")))return;V(!0);try{let D=await fetch("/agent/settings/widget-token/regenerate",{method:"POST"}),O=await D.json().catch(()=>({}));if(!D.ok||!O?.ok||!O?.settings)throw Error(O?.error||"Failed to regenerate widget token.");p(O.settings.widgetToken||""),r?.(O.settings),C(!0),setTimeout(()=>{if(fn.current)C(!1)},4000)}catch(D){console.warn("[settings/general] Failed to regenerate widget token.",D)}finally{if(fn.current)V(!1)}},[B,r]),Tn=typeof window<"u"&&window.isSecureContext,R=z?"•".repeat(Math.min(Math.max(z.length,16),48)):"—",e=P?z||"—":R;return g`
        <div class="settings-section">
            ${A&&g`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${_("settings.appliedNotice")}
                </div>
            `}
            <h3>${_("settings.general.identity")}</h3>
            <div class="settings-row">
                <label>${_("settings.general.userLabel")}</label>
                <${kc} kind="user" value=${u} onChange=${f} />
                <input type="text" value=${c} onInput=${(D)=>s(D.target.value)} placeholder=${_("settings.general.yourName")} />
            </div>
            <div class="settings-row">
                <label>${_("settings.general.agentLabel")}</label>
                <${kc} kind="agent" value=${y} onChange=${H} />
                <input type="text" value=${l} onInput=${(D)=>o(D.target.value)} placeholder=${_("settings.general.agentName")} />
            </div>

            <h3 style="margin-top:20px">${_("settings.general.notifications")}</h3>
            ${Tn?g`
                <div class="settings-row">
                    <label>${_("settings.general.browserNotifications")}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0">
                            ${_("settings.general.notifSecureHint")}
                        </span>
                    </div>
                </div>
            `:g`
                <div class="settings-row">
                    <label>${_("settings.general.browserNotifications")}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0; color: var(--error-color, #e55)">
                            ${_("settings.general.notifInsecureHint")}
                        </span>
                    </div>
                </div>
            `}

            <h3 style="margin-top:20px">${_("settings.general.display")}</h3>
            <div class="settings-row">
                <label>${_("settings.general.systemMeters")}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${Y}
                        onChange=${()=>{let D=Ai(!Y);K(D)}} />
                    <span class="settings-hint" style="margin:0">${_("settings.general.systemMetersHint")}</span>
                </div>
            </div>

            <h3 style="margin-top:20px">${_("settings.general.instanceConfig")}</h3>
            <div class="settings-row">
                <label>${_("settings.general.composeUpload")}</label>
                <${m}
                    label=${_("settings.general.composeUploadAria")}
                    value=${$}
                    min=${1}
                    max=${512}
                    fallback=${32}
                    width="80px"
                    onChange=${v}
                />
                <span class="settings-hint" style="margin:0">${_("settings.general.composeUploadHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.general.workspaceUpload")}</label>
                <${m}
                    label=${_("settings.general.workspaceUploadAria")}
                    value=${h}
                    min=${1}
                    max=${1024}
                    fallback=${256}
                    width="80px"
                    onChange=${b}
                />
                <span class="settings-hint" style="margin:0">${_("settings.general.workspaceUploadHint")}</span>
            </div>

            <h3 style="margin-top:20px">${_("settings.general.agentRecovery")}</h3>
            <div class="settings-row">
                <label>${_("settings.general.automaticRecovery")}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${F}
                        onChange=${(D)=>k(Boolean(D.target.checked))} />
                    <span class="settings-hint" style="margin:0">${_("settings.general.automaticRecoveryHint")}</span>
                </div>
            </div>
            <div class="settings-row">
                <label>${_("settings.general.recoveryMaxAttempts")}</label>
                <${m}
                    label=${_("settings.general.recoveryMaxAttemptsAria")}
                    value=${x}
                    min=${0}
                    step=${1}
                    fallback=${0}
                    width="90px"
                    onChange=${N}
                />
                <span class="settings-hint" style="margin:0">${_("settings.general.recoveryMaxAttemptsHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.general.recoveryTotalBudget")}</label>
                <${m}
                    label=${_("settings.general.recoveryTotalBudgetAria")}
                    value=${M}
                    min=${1}
                    step=${1000}
                    fallback=${360000}
                    width="110px"
                    onChange=${W}
                />
                <span class="settings-hint" style="margin:0">${_("settings.general.recoveryTotalBudgetHint")}</span>
            </div>

            <h3 style="margin-top:20px">${_("settings.general.authentication")}</h3>
            <div class="settings-row settings-row-vertical settings-widget-token-row">
                <label>${_("settings.general.widgetToken")}</label>
                <div class="settings-keychain-reveal-panel settings-widget-token-panel">
                    <div class="settings-keychain-reveal-field settings-widget-token-field">
                        <span class="settings-keychain-reveal-label">${_("settings.general.token")}</span>
                        <code class="settings-keychain-reveal-value settings-widget-token-value">${e}</code>
                        <button class=${`settings-keychain-reveal-btn${P?" active":""}`}
                            type="button"
                            onClick=${()=>Q((D)=>!D)}
                            disabled=${!z}
                            title=${P?_("settings.general.hideToken"):_("settings.general.revealToken")}>
                            ${P?g`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`:g`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
                        </button>
                        <button class="settings-keychain-copy-btn" type="button" onClick=${tn} disabled=${!z} title=${_("settings.general.copyToken")}>
                            ${t?g`<span class="settings-widget-token-copied">${_("settings.general.copied")}</span>`:g`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`}
                        </button>
                        <button class="settings-keychain-prompt-submit settings-widget-token-regenerate" type="button" onClick=${Nn} disabled=${B}>${B?_("settings.general.regenerating"):_("settings.general.regenerate")}</button>
                    </div>
                </div>
                <span class="settings-hint" style="margin:6px 0 0 0;">
                    ${_("settings.general.tokenHintPre")} <code>GET /api/state</code> ${_("settings.general.tokenHintMid")} <code>GET /api/state/events</code>${_("settings.general.tokenHintPost")} <code>Authorization: Bearer …</code>${_("settings.general.tokenHintEnd")}
                </span>
            </div>
            <div class="settings-totp-panel">
                <div class="settings-totp-header">
                    <div>
                        <strong>${_("settings.general.totpTitle")}</strong>
                        <div class="settings-hint" style="margin:6px 0 0 0;">
                            ${wn.configured?_("settings.general.totpConfiguredHint"):_("settings.general.totpUnconfiguredHint")}
                        </div>
                    </div>
                </div>
                ${wn.configured?g`
                    <div class="settings-totp-grid">
                        <div class="settings-totp-qr" dangerouslySetInnerHTML=${{__html:wn.qrSvg}}></div>
                        <div class="settings-totp-meta">
                            <div class="settings-row settings-row-vertical">
                                <label>${_("settings.general.issuer")}</label>
                                <input type="text" readonly value=${wn.issuer||""} />
                            </div>
                            <div class="settings-row settings-row-vertical">
                                <label>${_("settings.general.label")}</label>
                                <input type="text" readonly value=${wn.label||""} />
                            </div>
                            <div class="settings-row settings-row-vertical">
                                <label>${_("settings.general.secret")}</label>
                                <input type="text" readonly value=${wn.secret||""} />
                            </div>
                        </div>
                    </div>
                `:null}
            </div>
        </div>
    `}var xc=d(()=>{rn();lc();Sn();un()});var vc={};on(vc,{SessionsSection:()=>Mf});function bc(n={}){return{sessionAutoRotate:n.sessionAutoRotate!==!1,sessionMaxSizeMb:n.sessionMaxSizeMb??16,sessionMaxLines:n.sessionMaxLines??4000,sessionMaxCompactions:n.sessionMaxCompactions??3,sessionIsolation:n.sessionIsolation||"none",toolUseBudget:n.toolUseBudget??64}}function Mf({settingsData:n,setStatus:i,mergeSettingsData:r}){let{t:_}=L(),[c,s]=w(!0),[u,f]=w(16),[l,o]=w(4000),[y,H]=w(3),[$,v]=w(64),[h,b]=w("none"),[F,k]=w(!1),x=E(""),N=E(null),M=E(!0);X(()=>{return M.current=!0,()=>{M.current=!1}},[]);let W=U((p)=>{let P=bc(p);s(P.sessionAutoRotate),f(P.sessionMaxSizeMb),o(P.sessionMaxLines),H(P.sessionMaxCompactions),v(P.toolUseBudget),b(P.sessionIsolation),x.current=JSON.stringify(P)},[]);X(()=>{W(n||{})},[n,W]);let z=J(()=>JSON.stringify(bc({sessionAutoRotate:c,sessionMaxSizeMb:u,sessionMaxLines:l,sessionMaxCompactions:y,toolUseBudget:$,sessionIsolation:h})),[c,u,l,y,$,h]);return X(()=>{if(z===x.current)return;if(N.current)clearTimeout(N.current);return N.current=setTimeout(async()=>{if(!M.current)return;try{let p=await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:z}),P=await p.json().catch(()=>({}));if(!M.current)return;if(!p.ok||!P?.ok||!P?.settings)throw Error(P?.error||`Failed to save session settings (${p.status})`);x.current=z,r?.(P.settings),i?.(null),k(!0),setTimeout(()=>{if(M.current)k(!1)},4000)}catch(p){if(console.warn("[settings/sessions] Failed to persist session settings.",p),M.current)i?.(String(p?.message||p),"error")}},800),()=>{if(N.current)clearTimeout(N.current)}},[z,r,i]),g`
        <div class="settings-section">
            ${F&&g`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${_("settings.appliedNotice")}
                </div>
            `}
            <h3>${_("settings.sessions.lifecycle")}</h3>
            <div class="settings-row">
                <label>${_("settings.sessions.autoRotate")}</label>
                <input type="checkbox" checked=${c} onChange=${(p)=>s(p.target.checked)} />
            </div>
            <div class="settings-row">
                <label>${_("settings.sessions.maxSize")}</label>
                <${m}
                    label=${_("settings.sessions.maxSizeAria")}
                    value=${u}
                    min=${1}
                    max=${256}
                    fallback=${32}
                    width="80px"
                    onChange=${f}
                />
            </div>

            <h3 style="margin-top:20px">${_("settings.sessions.agentBehaviour")}</h3>
            <div class="settings-row">
                <label>${_("settings.sessions.toolBudget")}</label>
                <${m}
                    label=${_("settings.sessions.toolBudgetAria")}
                    value=${$}
                    min=${8}
                    max=${512}
                    fallback=${64}
                    width="80px"
                    onChange=${v}
                />
                <span class="settings-hint" style="margin:0">${_("settings.sessions.toolBudgetHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.sessions.isolation")}</label>
                <select value=${h} onChange=${(p)=>b(p.target.value)}>
                    <option value="none">${_("settings.sessions.isolationNone")}</option>
                    <option value="summary">${_("settings.sessions.isolationSummary")}</option>
                    <option value="full">${_("settings.sessions.isolationFull")}</option>
                </select>
            </div>
        </div>
    `}var hc=d(()=>{rn();Sn();un()});var Kc={};on(Kc,{__recordingsSettingsTest:()=>Zf,RecordingsSection:()=>Af});function Ii(n){if(!n)return"—";let i=new Date(n);if(Number.isNaN(i.getTime()))return n;return i.toLocaleString(void 0,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}function Zr(n){if(n==="full")return bn("settings.recordings.modeFull");if(n==="metadata")return bn("settings.recordings.modeMetadata");return bn("settings.recordings.modeRedacted")}function Di({children:n,type:i="neutral"}){return g`<span class=${`settings-task-pill settings-task-pill-${i}`}>${n}</span>`}function Qf(){if(typeof window>"u")return"web:default";return String(window.__piclawCurrentChatJid||"web:default")}function ti(n){return String(n||"").split(`
`).map((i)=>i.trim()).filter(Boolean)}function qf({recording:n,details:i,onDelete:r,onRefresh:_}){let{t:c}=L();if(!n)return g`<div class="settings-task-detail-empty">${c("settings.recordings.selectPrompt")}</div>`;let s=i?.meta||n,u=Array.isArray(i?.events)?i.events:[],f=u.reduce((o,y)=>o+(Array.isArray(y.redactions)?y.redactions.length:0),0),l=u.reduce((o,y)=>{let H=y.kind||"event";return o[H]=(o[H]||0)+1,o},{});return g`
        <div class="settings-task-detail settings-recording-detail">
            <div class="settings-task-detail-header">
                <div>
                    <h4>${s.title||s.id}</h4>
                    <code>${s.id}</code>
                </div>
                <div class="settings-task-detail-actions">
                    <button onClick=${()=>window.open(Ur(s.id),"_blank","noopener,noreferrer")}>${c("settings.recordings.playback")}</button>
                    <button onClick=${_}>${c("settings.recordings.refresh")}</button>
                    <button class="danger" onClick=${()=>r(s)}>${c("settings.recordings.delete")}</button>
                </div>
            </div>
            <div class="settings-task-detail-grid">
                <span>${c("settings.recordings.status")}</span><strong>${s.status||"—"}</strong>
                <span>${c("settings.recordings.mode")}</span><strong>${Zr(s.mode)}</strong>
                <span>${c("settings.recordings.chat")}</span><code>${s.chatJid||"—"}</code>
                <span>${c("settings.recordings.started")}</span><strong>${Ii(s.startedAt)}</strong>
                <span>${c("settings.recordings.ended")}</span><strong>${Ii(s.endedAt)}</strong>
                <span>${c("settings.recordings.events")}</span><strong>${s.eventCount??u.length}</strong>
                <span>${c("settings.recordings.redactions")}</span><strong>${f}</strong>
            </div>
            <div class="settings-recording-export-row">
                <a href=${wi(s.id,"json")}>${c("settings.recordings.exportJson")}</a>
                <a href=${wi(s.id,"jsonl")}>${c("settings.recordings.exportJsonl")}</a>
                <a href=${wi(s.id,"html")}>${c("settings.recordings.exportHtml")}</a>
            </div>
            <h4>${c("settings.recordings.eventSummary")}</h4>
            ${u.length===0&&g`<p class="settings-hint">${c("settings.recordings.inspectHint")}</p>`}
            ${u.length>0&&g`
                <div class="settings-recording-event-summary">
                    ${Object.entries(l).map(([o,y])=>g`<${Di}>${o}: ${y}<//>`)}
                </div>
                <div class="settings-task-command-block">
                    <strong>${c("settings.recordings.firstEvents")}</strong>
                    <pre>${JSON.stringify(u.slice(0,5),null,2)}</pre>
                </div>
            `}
        </div>
    `}function Af({filter:n="",setStatus:i}){let{t:r}=L(),[_,c]=w([]),[s,u]=w([]),[f,l]=w(!0),[o,y]=w(null),[H,$]=w(null),[v,h]=w(null),[b,F]=w(!1),[k,x]=w(Qf),[N,M]=w(""),[W,z]=w("redacted"),[p,P]=w(!0),[Q,t]=w(""),[j,B]=w(""),[V,Y]=w('{"Authorization":"Bearer abc1234567890","content":"hello"}'),[K,A]=w(null);X(()=>{let R=(e)=>{let D=String(e?.detail?.chatJid||"").trim();if(D)x(D)};return window.addEventListener("piclaw:current-chat-changed",R),()=>window.removeEventListener("piclaw:current-chat-changed",R)},[]);let C=U(async(R=H)=>{l(!0),y(null);try{let e=await Fr(),D=e.recordings||[];c(D),u(e.active||[]);let O=D.find((T)=>T.id===R)||D[0]||null;if($(O?.id||null),O?.id)h(await Qi(O.id));else h(null)}catch(e){y(e?.message||r("settings.recordings.loadFailed"))}finally{l(!1)}},[H]);X(()=>{C()},[C]);let cn=J(()=>_.find((R)=>R.id===H)||null,[_,H]),S=J(()=>s.find((R)=>R.chatJid===k)||null,[s,k]),fn=String(n||"").trim().toLowerCase(),xn=J(()=>{if(!fn)return _;return _.filter((R)=>[R.id,R.title,R.chatJid,R.status,R.mode].some((e)=>String(e||"").toLowerCase().includes(fn)))},[_,fn]),kn=U(async(R)=>{if($(R?.id||null),h(null),!R?.id)return;try{h(await Qi(R.id))}catch(e){i?.(e?.message||r("settings.recordings.loadOneFailed"),"error")}},[i]),wn=U(async()=>{if(b)return;F(!0);try{let R={keys:ti(Q),patterns:ti(j)},e=await Tr({chat_jid:k,title:N||void 0,mode:W,include_timeline_snapshot:p,timeline_snapshot_limit:80,redaction:R});i?.(r("settings.recordings.startedToast",{chat:k}),"success"),await C(e?.recording?.id)}catch(R){i?.(R?.message||r("settings.recordings.startFailed"),"error")}finally{F(!1)}},[b,k,Q,j,p,C,W,i,N]),tn=U(async(R=S)=>{if(!R||b)return;F(!0);try{let e=await Wr({id:R.id});i?.(r("settings.recordings.stoppedToast",{chat:R.chatJid}),"success"),await C(e?.recording?.id)}catch(e){i?.(e?.message||r("settings.recordings.stopFailed"),"error")}finally{F(!1)}},[b,S,C,i]),Nn=U(async(R)=>{if(!R||b)return;if(!window.confirm(r("settings.recordings.deleteConfirm",{id:R.id})+`

${R.title||""}`))return;F(!0);try{await Pr(R.id),i?.(r("settings.recordings.deletedToast"),"success"),await C(null)}catch(e){i?.(e?.message||r("settings.recordings.deleteFailed"),"error")}finally{F(!1)}},[b,C,i]),Tn=U(async()=>{try{let R=JSON.parse(V||"null"),e=await jr(R,{mode:W,redaction:{keys:ti(Q),patterns:ti(j)}});A(e.preview)}catch(R){A({error:R?.message||r("settings.recordings.previewFailed")})}},[Q,j,W,V]);return g`
        <div class="settings-section settings-recordings-section">
            <div class="settings-recording-start-card">
                <h3>${r("settings.recordings.heading")}</h3>
                <p class="settings-hint">${r("settings.recordings.intro")}</p>
                <div class="settings-recording-form-grid">
                    <label>${r("settings.recordings.chatJid")}<input value=${k} onInput=${(R)=>x(R.target.value)} /></label>
                    <label>${r("settings.recordings.title")}<input placeholder=${r("settings.recordings.titlePlaceholder")} value=${N} onInput=${(R)=>M(R.target.value)} /></label>
                    <label>${r("settings.recordings.modeLabelField")}<select value=${W} onChange=${(R)=>z(R.target.value)}><option value="redacted">${r("settings.recordings.optRedacted")}</option><option value="metadata">${r("settings.recordings.optMetadata")}</option><option value="full">${r("settings.recordings.optFull")}</option></select></label>
                    <label class="settings-recording-checkbox"><input type="checkbox" checked=${p} onChange=${(R)=>P(R.target.checked)} /> ${r("settings.recordings.includeSnapshot")}</label>
                </div>
                <div class="settings-recording-form-grid settings-recording-redaction-grid">
                    <label>${r("settings.recordings.extraKeys")}<textarea rows="2" placeholder="customer_id\ninternal_code" value=${Q} onInput=${(R)=>t(R.target.value)} /></label>
                    <label>${r("settings.recordings.extraPatterns")}<textarea rows="2" placeholder="ACME-[0-9]+" value=${j} onInput=${(R)=>B(R.target.value)} /></label>
                </div>
                <div class="settings-task-detail-actions">
                    ${S?g`<button onClick=${()=>tn(S)} disabled=${b}>${r("settings.recordings.stopCurrent")}</button>`:g`<button onClick=${wn} disabled=${b}>${r("settings.recordings.start")}</button>`}
                    <button onClick=${()=>C()} disabled=${f}>${r("settings.recordings.refresh")}</button>
                </div>
                ${s.length>0&&g`<div class="settings-recording-active-row">${s.map((R)=>g`<${Di} type="active">REC ${R.chatJid}<//>`)}</div>`}
            </div>

            <details class="settings-recording-preview">
                <summary>${r("settings.recordings.redactionPreview")}</summary>
                <textarea rows="4" value=${V} onInput=${(R)=>Y(R.target.value)} />
                <div class="settings-task-detail-actions"><button onClick=${Tn}>${r("settings.recordings.previewRedaction")}</button></div>
                ${K&&g`<pre>${JSON.stringify(K,null,2)}</pre>`}
            </details>

            ${f&&g`<div class="settings-loading settings-loading-pane"><span class="settings-spinner"></span><span>${r("settings.recordings.loading")}</span></div>`}
            ${o&&g`<div class="settings-error-state">${o}</div>`}
            ${!f&&!o&&_.length===0&&g`<div class="settings-empty-state"><strong>${r("settings.recordings.noneYet")}</strong><p>${r("settings.recordings.noneYetHint")}</p></div>`}
            ${!f&&!o&&_.length>0&&g`
                <div class="settings-task-layout">
                    <div class="settings-task-list" role="listbox" aria-label=${r("settings.recordings.listLabel")}>
                        ${xn.map((R)=>g`
                            <button class=${`settings-task-row ${R.id===H?"active":""}`} onClick=${()=>kn(R)}>
                                <span class="settings-task-row-main"><strong>${R.title||R.id}</strong><span>${R.chatJid} · ${Ii(R.startedAt)}</span></span>
                                <span class="settings-task-row-meta"><${Di} type=${R.status==="recording"?"active":"completed"}>${R.status}<//><${Di}>${Zr(R.mode)}<//></span>
                                <span class="settings-task-row-times">${r("settings.recordings.eventsCount",{count:R.eventCount||0})}</span>
                            </button>
                        `)}
                        ${xn.length===0&&g`<p class="settings-hint">${r("settings.recordings.noMatch",{filter:n})}</p>`}
                    </div>
                    <${qf} recording=${cn} details=${v} onDelete=${Nn} onRefresh=${()=>cn&&kn(cn)} />
                </div>
            `}
        </div>
    `}var Zf;var Bc=d(()=>{rn();un();Hn();Zf={formatDateTime:Ii,modeLabel:Zr,parseList:ti}});var zc={};on(zc,{CompactionSection:()=>If});function Hc(n){let i=String(n??"").trim().toLowerCase().replace(/[\s-]+/g,"_");return i==="pipelined"||i==="traditional_pipelined"?"pipelined":"selective"}function Df(n={}){return{autoCompactionEnabled:Boolean(n.autoCompactionEnabled??!0),smartCompactionMethod:Hc(n.smartCompactionMethod),remoteCompactionEnabled:Boolean(n.remoteCompactionEnabled??!1),remoteCompactionTimeoutSec:n.remoteCompactionTimeoutSec??300,remoteCompactionSupportedProviders:Array.isArray(n.remoteCompactionSupportedProviders)?n.remoteCompactionSupportedProviders:["openai","openai-codex"],compactionTimeoutSec:n.compactionTimeoutSec??300,compactionBackoffBaseMin:n.compactionBackoffBaseMin??15,compactionBackoffMaxMin:n.compactionBackoffMaxMin??360,compactionThresholdPercent:n.compactionThresholdPercent??80,compactionBackoffDecayFactor:n.compactionBackoffDecayFactor??0.5,toolResultCompactionEnabled:Boolean(n.toolResultCompactionEnabled??!0),toolResultSemanticSummaryEnabled:Boolean(n.toolResultSemanticSummaryEnabled??!0),toolResultSemanticSummaryMaxInputChars:n.toolResultSemanticSummaryMaxInputChars??12000,toolResultSemanticSummaryMaxTokens:n.toolResultSemanticSummaryMaxTokens??320,toolResultSemanticSummaryTimeoutSec:n.toolResultSemanticSummaryTimeoutSec??12,progressWatchdogEnabled:Boolean(n.progressWatchdogEnabled??!1),progressWatchdogTimeoutSec:n.progressWatchdogTimeoutSec??300,compactionBackoffs:Array.isArray(n.compactionBackoffs)?n.compactionBackoffs:[],progressWatchdogPhases:Array.isArray(n.progressWatchdogPhases)?n.progressWatchdogPhases:[]}}function Dr(n){let i=String(n||"").trim();if(!i)return"—";let r=new Date(i);if(Number.isNaN(r.getTime()))return i;return r.toLocaleString()}function If({settingsData:n,setStatus:i,mergeSettingsData:r}){let{t:_}=L(),[c,s]=w(!0),[u,f]=w("selective"),[l,o]=w(!1),[y,H]=w(300),[$,v]=w(["openai","openai-codex"]),[h,b]=w(300),[F,k]=w(15),[x,N]=w(360),[M,W]=w(80),[z,p]=w(0.5),[P,Q]=w(!0),[t,j]=w(!0),[B,V]=w(12000),[Y,K]=w(320),[A,C]=w(12),[cn,S]=w(!1),[fn,xn]=w(300),[kn,wn]=w([]),[tn,Nn]=w([]),[Tn,R]=w(!1),e=E(""),D=E(null),O=E(!0);X(()=>{return O.current=!0,()=>{O.current=!1}},[]);let T=U((I)=>{let G=Df(I);s(G.autoCompactionEnabled),f(G.smartCompactionMethod),o(G.remoteCompactionEnabled),H(G.remoteCompactionTimeoutSec),v(G.remoteCompactionSupportedProviders),b(G.compactionTimeoutSec),k(G.compactionBackoffBaseMin),N(G.compactionBackoffMaxMin),W(G.compactionThresholdPercent),p(G.compactionBackoffDecayFactor),Q(G.toolResultCompactionEnabled),j(G.toolResultSemanticSummaryEnabled),V(G.toolResultSemanticSummaryMaxInputChars),K(G.toolResultSemanticSummaryMaxTokens),C(G.toolResultSemanticSummaryTimeoutSec),S(G.progressWatchdogEnabled),xn(G.progressWatchdogTimeoutSec),wn(G.compactionBackoffs),Nn(G.progressWatchdogPhases),e.current=JSON.stringify({autoCompactionEnabled:G.autoCompactionEnabled,smartCompactionMethod:G.smartCompactionMethod,remoteCompactionEnabled:G.remoteCompactionEnabled,remoteCompactionTimeoutSec:G.remoteCompactionTimeoutSec,compactionTimeoutSec:G.compactionTimeoutSec,compactionBackoffBaseMin:G.compactionBackoffBaseMin,compactionBackoffMaxMin:G.compactionBackoffMaxMin,compactionThresholdPercent:G.compactionThresholdPercent,compactionBackoffDecayFactor:G.compactionBackoffDecayFactor,toolResultCompactionEnabled:G.toolResultCompactionEnabled,toolResultSemanticSummaryEnabled:G.toolResultSemanticSummaryEnabled,toolResultSemanticSummaryMaxInputChars:G.toolResultSemanticSummaryMaxInputChars,toolResultSemanticSummaryMaxTokens:G.toolResultSemanticSummaryMaxTokens,toolResultSemanticSummaryTimeoutSec:G.toolResultSemanticSummaryTimeoutSec,progressWatchdogEnabled:G.progressWatchdogEnabled,progressWatchdogTimeoutSec:G.progressWatchdogTimeoutSec})},[]);X(()=>{T(n||{})},[n,T]);let q=J(()=>JSON.stringify({autoCompactionEnabled:c,smartCompactionMethod:u,remoteCompactionEnabled:l,remoteCompactionTimeoutSec:y,compactionTimeoutSec:h,compactionBackoffBaseMin:F,compactionBackoffMaxMin:x,compactionThresholdPercent:M,compactionBackoffDecayFactor:z,toolResultCompactionEnabled:P,toolResultSemanticSummaryEnabled:t,toolResultSemanticSummaryMaxInputChars:B,toolResultSemanticSummaryMaxTokens:Y,toolResultSemanticSummaryTimeoutSec:A,progressWatchdogEnabled:cn,progressWatchdogTimeoutSec:fn}),[c,u,l,y,h,F,x,M,z,P,t,B,Y,A,cn,fn]);X(()=>{if(q===e.current)return;if(D.current)clearTimeout(D.current);return D.current=setTimeout(async()=>{if(!O.current)return;try{i?.(_("settings.compaction.saving"),"info");let I=await fetch("/agent/settings/compaction",{method:"POST",headers:{"Content-Type":"application/json"},body:q}),G=await I.json().catch(()=>({}));if(!O.current)return;if(!I.ok||!G?.ok||!G?.settings){i?.(G?.error||_("settings.compaction.saveFailed"),"error");return}e.current=q,r?.(G.settings),T({...n||{},...G.settings||{}}),i?.(_("settings.compaction.saved"),"success"),R(!0),setTimeout(()=>{if(O.current)R(!1),i?.(null)},4000)}catch(I){if(console.warn("[settings/compaction] Failed to persist compaction settings.",I),O.current)i?.(_("settings.compaction.saveFailed"),"error")}},800),()=>{if(D.current)clearTimeout(D.current)}},[q,r,i,T,n]);let gn=U(async(I)=>{try{i?.(_("settings.compaction.clearing",{chat:I}),"info");let G=await fetch("/agent/settings/compaction/reset-backoff",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chatJid:I})}),ln=await G.json().catch(()=>({}));if(!G.ok||!ln?.ok||!ln?.settings){i?.(ln?.error||_("settings.compaction.clearFailed"),"error");return}r?.(ln.settings),T({...n||{},...ln.settings||{}}),i?.(_("settings.compaction.cleared",{chat:I}),"success")}catch(G){console.warn("[settings/compaction] Failed to clear compaction suppression.",G),i?.(_("settings.compaction.clearFailed"),"error")}},[T,r,i,n]);return g`
        <div class="settings-section">
            ${Tn&&g`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${_("settings.compaction.appliedNotice")}
                </div>
            `}

            <h3>${_("settings.compaction.autoHeading")}</h3>
            <div class="settings-row">
                <label>${_("settings.compaction.enableAutomatic")}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${c} onChange=${(I)=>s(Boolean(I.target.checked))} />
                    <span class="settings-hint" style="margin:0">${_("settings.compaction.enableAutomaticHint")}</span>
                </div>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.processingMethod")}</label>
                <select id="smartCompactionMethod" value=${u} onChange=${(I)=>f(Hc(I.target.value))}>
                    <option value="selective">${_("settings.compaction.methodSelective")}</option>
                    <option value="pipelined">${_("settings.compaction.methodPipelined")}</option>
                </select>
                <span class="settings-hint" style="margin:0">
                    ${u==="pipelined"?_("settings.compaction.methodPipelinedHint"):_("settings.compaction.methodSelectiveHint")}
                </span>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.remoteNative")}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input id="remoteCompactionEnabled" type="checkbox" checked=${l} onChange=${(I)=>o(Boolean(I.target.checked))} />
                    <span class="settings-hint" style="margin:0">
                        ${_("settings.compaction.remoteNativeHint",{providers:$.join(", ")})}
                    </span>
                </div>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.remoteTimeout")}</label>
                <${m}
                    label=${_("settings.compaction.remoteTimeoutAria")}
                    value=${y}
                    min=${1}
                    max=${300}
                    fallback=${60}
                    width="90px"
                    disabled=${!l}
                    onChange=${H}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.remoteTimeoutHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.enableToolResult")}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${P} onChange=${(I)=>Q(Boolean(I.target.checked))} />
                    <span class="settings-hint" style="margin:0">${_("settings.compaction.enableToolResultHint")}</span>
                </div>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.semanticSummaries")}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${t} onChange=${(I)=>j(Boolean(I.target.checked))} />
                    <span class="settings-hint" style="margin:0">${_("settings.compaction.semanticSummariesHint")}</span>
                </div>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.inputLimit")}</label>
                <${m}
                    label=${_("settings.compaction.inputLimitAria")}
                    value=${B}
                    min=${500}
                    max=${200000}
                    fallback=${12000}
                    width="100px"
                    disabled=${!t}
                    onChange=${V}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.inputLimitHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.maxTokens")}</label>
                <${m}
                    label=${_("settings.compaction.maxTokensAria")}
                    value=${Y}
                    min=${64}
                    max=${4096}
                    fallback=${320}
                    width="90px"
                    disabled=${!t}
                    onChange=${K}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.maxTokensHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.summaryTimeout")}</label>
                <${m}
                    label=${_("settings.compaction.summaryTimeoutAria")}
                    value=${A}
                    min=${1}
                    max=${300}
                    fallback=${12}
                    width="90px"
                    disabled=${!t}
                    onChange=${C}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.summaryTimeoutHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.threshold")}</label>
                <${m}
                    label=${_("settings.compaction.thresholdAria")}
                    value=${M}
                    min=${10}
                    max=${95}
                    fallback=${80}
                    width="80px"
                    onChange=${W}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.thresholdHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.timeout")}</label>
                <${m}
                    label=${_("settings.compaction.timeoutAria")}
                    value=${h}
                    min=${1}
                    max=${3600}
                    fallback=${300}
                    width="90px"
                    onChange=${b}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.timeoutHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.backoffBase")}</label>
                <${m}
                    label=${_("settings.compaction.backoffBaseAria")}
                    value=${F}
                    min=${1}
                    max=${1440}
                    fallback=${15}
                    width="90px"
                    onChange=${k}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.backoffBaseHint")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.backoffMax")}</label>
                <${m}
                    label=${_("settings.compaction.backoffMaxAria")}
                    value=${x}
                    min=${1}
                    max=${10080}
                    fallback=${360}
                    width="90px"
                    onChange=${N}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.backoffMaxHint")}</span>
            </div>

            <div class="settings-row">
                <label>${_("settings.compaction.decayFactor")}</label>
                <${m}
                    label=${_("settings.compaction.decayFactorAria")}
                    value=${Math.round(z*100)}
                    min=${10}
                    max=${100}
                    fallback=${50}
                    width="80px"
                    onChange=${(I)=>p(I/100)}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.decayFactorHint")}</span>
            </div>

            <h3 style="margin-top:20px">${_("settings.compaction.watchdogHeading")}</h3>
            <div class="settings-row">
                <label>${_("settings.compaction.enableWatchdog")}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${cn} onChange=${(I)=>S(Boolean(I.target.checked))} />
                    <span class="settings-hint" style="margin:0">${_("settings.compaction.enableWatchdogHint")}</span>
                </div>
            </div>
            <div class="settings-row">
                <label>${_("settings.compaction.watchdogTimeout")}</label>
                <${m}
                    label=${_("settings.compaction.watchdogTimeoutAria")}
                    value=${fn}
                    min=${0}
                    max=${3600}
                    fallback=${300}
                    width="90px"
                    disabled=${!cn}
                    onChange=${xn}
                />
                <span class="settings-hint" style="margin:0">${_("settings.compaction.watchdogTimeoutHint")}</span>
            </div>

            <h3 style="margin-top:20px">${_("settings.compaction.suppressionsHeading")}</h3>
            ${kn.length===0?g`
                <p class="settings-hint">${_("settings.compaction.noBackoff")}</p>
            `:g`
                <div class="settings-table-wrapper">
                    <table class="settings-table">
                        <thead>
                            <tr>
                                <th>Chat</th>
                                <th>Failures</th>
                                <th>Suppressed until</th>
                                <th>Last error</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${kn.map((I)=>g`
                                <tr>
                                    <td><code>${I.chatJid}</code></td>
                                    <td>${I.failureCount}</td>
                                    <td>${Dr(I.backoffUntil)}</td>
                                    <td title=${I.lastErrorMessage||""}>${I.lastErrorMessage||"—"}</td>
                                    <td>
                                        <button class="settings-secondary-btn" onClick=${()=>gn(I.chatJid)}>
                                            ${_("settings.compaction.clear")}
                                        </button>
                                    </td>
                                </tr>
                            `)}
                        </tbody>
                    </table>
                </div>
            `}

            <h3 style="margin-top:20px">${_("settings.compaction.phasesHeading")}</h3>
            ${tn.length===0?g`
                <p class="settings-hint">${_("settings.compaction.noPhases")}</p>
            `:g`
                <div class="settings-table-wrapper">
                    <table class="settings-table">
                        <thead>
                            <tr>
                                <th>Chat</th>
                                <th>Phase</th>
                                <th>Started</th>
                                <th>Last heartbeat</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tn.map((I)=>g`
                                <tr>
                                    <td><code>${I.chatJid}</code></td>
                                    <td>${I.phase}</td>
                                    <td>${Dr(I.startedAt)}</td>
                                    <td>${Dr(I.lastProgressAt)}</td>
                                </tr>
                            `)}
                        </tbody>
                    </table>
                </div>
            `}
        </div>
    `}var Fc=d(()=>{rn();Sn();un()});function Wc(n){let i=String(n||"").trim().toLowerCase();if(!i)return null;let r=Cf[i]||i;if(/^f(?:[1-9]|1[0-2])$/.test(r))return r;if(Of.has(r))return r;if(r.length===1)return r;if(/^[a-z0-9]+$/.test(r))return r;return null}function mn(n){let i=String(n||"").trim();if(!i)return null;let r=i.split("+").map((s)=>s.trim()).filter(Boolean);if(!r.length)return null;let _={ctrl:!1,meta:!1,alt:!1,shift:!1,key:""};for(let s of r){let u=s.toLowerCase(),f=Lf[u];if(f){_[f]=!0;continue}if(_.key)return null;let l=Wc(s);if(!l||l==="escape")return null;_.key=l}if(!_.key)return null;let c=[];if(_.ctrl)c.push("ctrl");if(_.meta)c.push("meta");if(_.alt)c.push("alt");if(_.shift)c.push("shift");return c.push(_.key),c.join("+")}function Pc(n){return String(n||"").split(/[\n,]/).map((i)=>mn(i)).filter((i)=>Boolean(i))}function jn(n){return n.join(", ")}function Yr(){let n=Z_(Tc);if(!n||typeof n!=="object")return{};let i={};for(let r of yi){let _=n[r.id];if(!Array.isArray(_))continue;let c=_.map((s)=>mn(String(s||""))).filter((s)=>Boolean(s));i[r.id]=[...new Set(c)]}return i}function Ir(n){if($n(Tc,JSON.stringify(n)),typeof window<"u")window.dispatchEvent(new CustomEvent("piclaw:keyboard-shortcuts-changed",{detail:{config:n}}))}function Uc(n){return Yf.get(n)}function ki(n){let i=Yr()[n];if(Array.isArray(i))return i;return[...Uc(n).defaultBindings]}function jc(n,i){let r=Yr(),_=Uc(n).defaultBindings,c=[...new Set(i.map((s)=>mn(s)).filter((s)=>Boolean(s)))];if(c.length===_.length&&c.every((s,u)=>s===_[u]))delete r[n];else r[n]=c;Ir(r)}function Lr(n){if(!n){Ir({});return}let i=Yr();delete i[n],Ir(i)}function Yi(){let n={};for(let i of yi)n[i.id]=ki(i.id);return n}function Jf(n){let i=typeof n==="string"?n:"";if(!i)return"";if(i.length===1)return i.toLowerCase();return Wc(i)||i.toLowerCase()}function Ef(n){let i=mn(n);if(!i)return null;let r={ctrl:!1,meta:!1,alt:!1,shift:!1,key:""};for(let _ of i.split("+")){if(_==="ctrl"||_==="meta"||_==="alt"||_==="shift"){r[_]=!0;continue}r.key=_}return r.key?r:null}function df(n,i){let r=Ef(i);if(!r)return!1;if(Jf(n?.key)!==r.key)return!1;let c=!r.shift&&r.key.length===1&&/[^a-z0-9]/i.test(r.key);return Boolean(n?.ctrlKey)===r.ctrl&&Boolean(n?.metaKey)===r.meta&&Boolean(n?.altKey)===r.alt&&(c||Boolean(n?.shiftKey)===r.shift)}function bo(n,i){return ki(i).some((r)=>df(n,r))}var Tc="piclaw_keyboard_shortcuts_v1",yi,Yf,Lf,Cf,Of;var Nc=d(()=>{yi=[{id:"openHelp",label:"Open keyboard help",description:"Open Settings → Keyboard. Default: question mark and quote when focus is outside compose and other editable fields.",defaultBindings:["?",'"']},{id:"openSettings",label:"Open settings",description:"Open the settings dialog.",defaultBindings:["ctrl+,","meta+,","alt+,"]},{id:"previousChat",label:"Previous session",description:"Switch to the previous visible chat/session.",defaultBindings:["["]},{id:"nextChat",label:"Next session",description:"Switch to the next visible chat/session.",defaultBindings:["]"]},{id:"toggleDock",label:"Toggle dock",description:"Show or hide the bottom dock panes.",defaultBindings:["ctrl+`"]},{id:"toggleZenMode",label:"Toggle zen mode",description:"Collapse surrounding chrome for a focused chat view.",defaultBindings:["ctrl+shift+z","meta+shift+z"]}],Yf=new Map(yi.map((n)=>[n.id,n])),Lf={cmd:"meta",command:"meta",meta:"meta",super:"meta",ctrl:"ctrl",control:"ctrl",alt:"alt",option:"alt",shift:"shift"},Cf={esc:"escape",return:"enter",spacebar:"space"},Of=new Set(["tab","enter","space","backspace","delete","insert","clear","home","end","pageup","pagedown","up","down","left","right"])});var Rc={};on(Rc,{KeyboardSection:()=>Sf});function ef(n,i,r){let _=String(n||"").trim().toLowerCase();if(!_)return!0;return[i.label,i.description,r,...i.defaultBindings||[]].some((c)=>String(c||"").toLowerCase().includes(_))}function Sf({filter:n="",setStatus:i}){let{t:r}=L(),[_,c]=w(()=>{let o=Yi();return Object.fromEntries(Object.entries(o).map(([y,H])=>[y,jn(H)]))});X(()=>{let o=()=>{let y=Yi();c(Object.fromEntries(Object.entries(y).map(([H,$])=>[H,jn($)])))};return window.addEventListener("piclaw:keyboard-shortcuts-changed",o),()=>window.removeEventListener("piclaw:keyboard-shortcuts-changed",o)},[]);let s=J(()=>yi.filter((o)=>{let y=String(_[o.id]||"");return ef(n,o,y)}),[_,n]),u=(o)=>{let y=String(_[o]||"").trim(),$=(y?y.split(/[\n,]/).map((h)=>h.trim()).filter(Boolean):[]).filter((h)=>!mn(h));if($.length>0){i?.(r("settings.keyboard.invalidShortcut",{token:$[0]}),"error");return}let v=Pc(y);jc(o,v),c((h)=>({...h,[o]:jn(ki(o))})),i?.(r("settings.keyboard.saved"),"success")},f=(o)=>{Lr(o),c((y)=>({...y,[o]:jn(ki(o))})),i?.(r("settings.keyboard.resetOne"),"success")},l=()=>{Lr();let o=Yi();c(Object.fromEntries(Object.entries(o).map(([y,H])=>[y,jn(H)]))),i?.(r("settings.keyboard.resetAllDone"),"success")};return g`
        <div class="settings-section">
            <h3>${r("settings.keyboard.heading")}</h3>
            <p class="settings-hint">
                ${r("settings.keyboard.hint1")}
                <code>Escape</code> ${r("settings.keyboard.hint1b")}
            </p>
            <p class="settings-hint">
                <code>/help</code> ${r("settings.keyboard.hint2mid")} <code>"</code> ${r("settings.keyboard.hint2end")}
            </p>

            <div class="settings-row" style="align-items:center; gap:10px; margin-bottom:18px; justify-content:flex-end;">
                <button class="settings-addon-btn" style="min-width:180px; height:40px; font-size:14px;" onClick=${l}>${r("settings.keyboard.resetAll")}</button>
            </div>

            <div class="settings-shortcut-list" style="display:grid; gap:16px;">
                ${s.map((o)=>g`
                    <div class="settings-shortcut-card" key=${o.id} style="display:grid; grid-template-columns:minmax(240px, 1.25fr) minmax(320px, 1fr); gap:18px; align-items:start; padding:18px 20px; border:1px solid var(--border-color, rgba(120,120,120,.22)); border-radius:16px; background:var(--panel-bg, rgba(255,255,255,.04));">
                        <div class="settings-shortcut-copy" style="min-width:0;">
                            <div class="settings-shortcut-title" style="font-size:17px; font-weight:700; line-height:1.3;">${o.label}</div>
                            <div class="settings-hint" style="margin:6px 0 0 0; font-size:14px; line-height:1.5;">${o.description}</div>
                            <div class="settings-shortcut-default" style="margin-top:10px; font-size:13px; color:var(--text-secondary);">${r("settings.keyboard.defaultColon")} <code style="font-size:13px;">${jn(o.defaultBindings)}</code></div>
                        </div>
                        <div class="settings-shortcut-controls" style="display:grid; gap:10px; min-width:0;">
                            <input
                                type="text"
                                value=${_[o.id]||""}
                                placeholder=${jn(o.defaultBindings)}
                                onInput=${(y)=>c((H)=>({...H,[o.id]:y.target.value}))}
                                style="width:100%; min-height:46px; padding:10px 14px; font-size:16px; line-height:1.35; font-family:var(--font-mono, ui-monospace, monospace); border-radius:12px;"
                            />
                            <div class="settings-shortcut-actions" style="display:flex; justify-content:flex-end; align-items:center; gap:10px; flex-wrap:wrap;">
                                <button class="settings-addon-btn settings-addon-btn-install" style="min-width:96px; height:40px; font-size:14px;" onClick=${()=>u(o.id)}>${r("settings.keyboard.save")}</button>
                                <button class="settings-addon-btn" style="min-width:96px; height:40px; font-size:14px;" onClick=${()=>f(o.id)}>${r("settings.keyboard.defaultBtn")}</button>
                            </div>
                        </div>
                    </div>
                `)}
                ${s.length===0&&g`<div class="settings-hint">${r("settings.keyboard.noMatch")}</div>`}
            </div>
        </div>
    `}var Vc=d(()=>{rn();Nc();un()});function Mc(n,i=Cr){let r=Number(n);if(!Number.isFinite(r))return i;return Math.min(300,Math.max(15,Math.round(r)))}function Qc(n,i=Or){let r=Number(n);if(!Number.isFinite(r))return i;return Math.min(8,Math.max(0,Math.round(r)))}function Jr(){return{refreshIntervalSec:Mc(yr(Gc,Cr),Cr),folderPreviewDepth:Qc(yr(Xc,Or),Or)}}function qc(n={}){let i=Jr(),r={refreshIntervalSec:Mc(Object.prototype.hasOwnProperty.call(n,"refreshIntervalSec")?n.refreshIntervalSec:i.refreshIntervalSec,i.refreshIntervalSec),folderPreviewDepth:Qc(Object.prototype.hasOwnProperty.call(n,"folderPreviewDepth")?n.folderPreviewDepth:i.folderPreviewDepth,i.folderPreviewDepth)};if($n(Gc,String(r.refreshIntervalSec)),$n(Xc,String(r.folderPreviewDepth)),typeof window<"u")window.dispatchEvent(new CustomEvent(mf,{detail:{settings:r}}));return r}var mf="piclaw:workspace-client-settings-updated",Gc="workspaceRefreshIntervalSec",Xc="workspaceFolderPreviewDepth",Cr=60,Or=3;var Ac=()=>{};var Dc={};on(Dc,{WorkspaceSection:()=>af});function Zc(n={}){let i=n.workspaceSettings||{};return{webTerminalEnabled:i.webTerminalEnabled!==!1,vncAllowDirect:i.vncAllowDirect!==!1,treeMaxDepth:i.treeMaxDepth??4,treeMaxEntries:i.treeMaxEntries??5000}}function af({settingsData:n,setStatus:i,mergeSettingsData:r}){let{t:_}=L(),[c,s]=w(!0),[u,f]=w(!0),[l,o]=w(4),[y,H]=w(5000),[$,v]=w(60),[h,b]=w(3),[F,k]=w(!1),[x,N]=w(!1),M=E(""),W=E(null),z=E(null),p=E(null),P=E(!0);X(()=>{return P.current=!0,()=>{if(P.current=!1,W.current)clearTimeout(W.current);if(z.current)clearTimeout(z.current);if(p.current)clearTimeout(p.current)}},[]);let Q=U((B)=>{let V=Zc(B),Y=Jr();s(V.webTerminalEnabled),f(V.vncAllowDirect),o(V.treeMaxDepth),H(V.treeMaxEntries),v(Y.refreshIntervalSec),b(Y.folderPreviewDepth),M.current=JSON.stringify(V)},[]);X(()=>{Q(n||{})},[n,Q]);let t=J(()=>JSON.stringify(Zc({workspaceSettings:{webTerminalEnabled:c,vncAllowDirect:u,treeMaxDepth:l,treeMaxEntries:y}})),[c,u,l,y]);X(()=>{if(t===M.current)return;if(W.current)clearTimeout(W.current);return W.current=setTimeout(async()=>{if(!P.current)return;try{let B=await Xr(JSON.parse(t));if(!P.current||!B?.ok||!B?.settings)return;if(M.current=t,r?.({workspaceSettings:B.settings}),i?.(null),k(!0),z.current)clearTimeout(z.current);z.current=setTimeout(()=>{if(P.current)k(!1)},4000)}catch(B){i?.(String(B?.message||B),"error")}},800),()=>{if(W.current)clearTimeout(W.current)}},[t,r,i]);let j=U((B)=>{let V=qc(B);if(v(V.refreshIntervalSec),b(V.folderPreviewDepth),N(!0),p.current)clearTimeout(p.current);p.current=setTimeout(()=>{if(P.current)N(!1)},3000)},[]);return g`
        <div class="settings-section">
            ${F&&g`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${_("settings.workspace.serverApplied")}
                </div>
            `}
            ${x&&g`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${_("settings.workspace.browserApplied")}
                </div>
            `}

            <h3>${_("settings.workspace.access")}</h3>
            <div class="settings-row">
                <label>${_("settings.workspace.enableTerminal")}</label>
                <input type="checkbox" checked=${c} onChange=${(B)=>s(B.target.checked)} />
            </div>
            <div class="settings-row">
                <label>${_("settings.workspace.allowVnc")}</label>
                <input type="checkbox" checked=${u} onChange=${(B)=>f(B.target.checked)} />
            </div>
            <p class="settings-hint">${_("settings.workspace.accessHint")}</p>

            <h3 style="margin-top:20px">${_("settings.workspace.guardrails")}</h3>
            <div class="settings-row">
                <label>${_("settings.workspace.maxDepth")}</label>
                <${m}
                    label=${_("settings.workspace.maxDepthAria")}
                    value=${l}
                    min=${1}
                    max=${8}
                    fallback=${4}
                    width="80px"
                    onChange=${o}
                />
                <span class="settings-hint" style="margin:0">${_("settings.workspace.maxDepthHintPre")} <code>/workspace/tree</code> ${_("settings.workspace.maxDepthHintPost")}</span>
            </div>
            <div class="settings-row">
                <label>${_("settings.workspace.maxEntries")}</label>
                <${m}
                    label=${_("settings.workspace.maxEntriesAria")}
                    value=${y}
                    min=${250}
                    max=${5000}
                    step=${250}
                    fallback=${5000}
                    width="92px"
                    onChange=${H}
                />
                <span class="settings-hint" style="margin:0">${_("settings.workspace.maxEntriesHint")}</span>
            </div>

            <h3 style="margin-top:20px">${_("settings.workspace.thisBrowser")}</h3>
            <div class="settings-row">
                <label>${_("settings.workspace.refreshInterval")}</label>
                <${m}
                    label=${_("settings.workspace.refreshIntervalAria")}
                    value=${$}
                    min=${15}
                    max=${300}
                    step=${15}
                    fallback=${60}
                    width="92px"
                    onChange=${(B)=>j({refreshIntervalSec:B})}
                />
            </div>
            <div class="settings-row">
                <label>${_("settings.workspace.folderDepth")}</label>
                <${m}
                    label=${_("settings.workspace.folderDepthAria")}
                    value=${h}
                    min=${0}
                    max=${8}
                    fallback=${3}
                    width="80px"
                    onChange=${(B)=>j({folderPreviewDepth:B})}
                />
                <span class="settings-hint" style="margin:0">${_("settings.workspace.folderDepthHintPre")} <code>0</code> ${_("settings.workspace.folderDepthHintPost")}</span>
            </div>
            <p class="settings-hint">${_("settings.workspace.footerHint")}</p>
        </div>
    `}var Ic=d(()=>{rn();Hn();Ac();Sn();un()});var Yc={};on(Yc,{EnvironmentSection:()=>n0});function Er(n={}){let i=n.environmentSettings||n.settings||n.environment||{};return{variables:Array.isArray(i.variables)?i.variables:[],overrides:i.overrides&&typeof i.overrides==="object"?i.overrides:{},count:Number(i.count||0),overrideCount:Number(i.overrideCount||0),keychainEnvNames:Array.isArray(i.keychainEnvNames)?i.keychainEnvNames:[]}}function n0({settingsData:n,filter:i="",setStatus:r,mergeSettingsData:_}){let{t:c}=L(),[s,u]=w(()=>Er(n||{})),[f,l]=w({}),[o,y]=w(""),[H,$]=w(""),[v,h]=w(null);X(()=>{u(Er(n||{})),l({})},[n]);let b=U((W)=>{let z=Er({environmentSettings:W?.settings||W});return u(z),_?.({environmentSettings:z}),l({}),z},[_]),F=U(async()=>{try{let W=await Mr();if(W?.ok)b(W.settings);r?.(c("settings.environment.refreshedToast"),"info")}catch(W){r?.(String(W?.message||W),"error")}},[b,r]),k=U(async(W,z)=>{let p=String(W||"").trim();if(!p)return;h(p);try{let P=await qi({action:"set",name:p,value:String(z??"")});if(P?.ok)b(P.settings);if(r?.(c("settings.environment.savedToast",{name:p}),"info"),p===o.trim())y(""),$("")}catch(P){r?.(String(P?.message||P),"error")}finally{h(null)}},[b,o,r]),x=U(async(W)=>{let z=String(W||"").trim();if(!z)return;h(z);try{let p=await qi({action:"clear",name:z});if(p?.ok)b(p.settings);r?.(c("settings.environment.clearedToast",{name:z}),"info")}catch(p){r?.(String(p?.message||p),"error")}finally{h(null)}},[b,r]),N=J(()=>{let W=String(i||"").trim().toLowerCase(),z=Array.isArray(s.variables)?s.variables:[];if(!W)return z;return z.filter((p)=>{return`${p?.name||""} ${p?.value||""} ${p?.source||""}`.toLowerCase().includes(W)})},[s.variables,i]),M=U((W,z)=>{l((p)=>({...p||{},[W]:z}))},[]);return g`
        <div class="settings-section">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px;">
                <div>
                    <h3 style="margin-top:0">${c("settings.environment.heading")}</h3>
                    <p class="settings-hint" style="margin-top:4px">
                        ${c("settings.environment.introPre")} <code>process.env</code>${c("settings.environment.introPost")}
                    </p>
                </div>
                <button type="button" class="settings-secondary-btn" onClick=${F}>${c("settings.environment.refresh")}</button>
            </div>

            <div class="settings-row" style="align-items:flex-start; gap:10px;">
                <label>${c("settings.environment.addOverride")}</label>
                <div style="display:grid; grid-template-columns:minmax(180px, 0.7fr) minmax(240px, 1fr) auto; gap:8px; flex:1;">
                    <input
                        type="text"
                        value=${o}
                        placeholder="VARIABLE_NAME"
                        spellcheck="false"
                        onInput=${(W)=>y(W.target.value)}
                    />
                    <input
                        type="text"
                        value=${H}
                        placeholder=${c("settings.environment.valuePlaceholder")}
                        spellcheck="false"
                        onInput=${(W)=>$(W.target.value)}
                    />
                    <button
                        type="button"
                        disabled=${!o.trim()||v===o.trim()}
                        onClick=${()=>k(o,H)}
                    >${c("settings.environment.save")}</button>
                </div>
            </div>

            <p class="settings-hint">
                ${c("settings.environment.countLine",{count:s.count,overrides:s.overrideCount,keychain:s.keychainEnvNames.length})}
            </p>

            <div class="settings-tool-list" style="max-height:58vh; overflow:auto;">
                ${N.map((W)=>{let z=String(W?.name||""),p=Object.prototype.hasOwnProperty.call(f,z)?f[z]:W.value,P=p!==W.value,Q=v===z;return g`
                        <div class="settings-tool-row" key=${z} style="grid-template-columns:minmax(180px,0.45fr) minmax(240px,1fr) auto auto; align-items:center;">
                            <span class="settings-tool-name" title=${z}>${z}</span>
                            <input
                                type="text"
                                value=${p}
                                spellcheck="false"
                                onInput=${(t)=>M(z,t.target.value)}
                                style="min-width:0; width:100%; font-family:var(--font-mono, monospace);"
                            />
                            <span class="settings-tool-kind" title=${W.overridden?c("settings.environment.overridden"):c("settings.environment.inherited")}>
                                ${W.overridden?c("settings.environment.kindOverride"):c("settings.environment.kindProcess")}
                            </span>
                            <span style="display:flex; gap:6px; justify-content:flex-end;">
                                <button type="button" disabled=${Q||!P} onClick=${()=>k(z,p)}>${c("settings.environment.save")}</button>
                                <button type="button" disabled=${Q||!W.overridden} onClick=${()=>x(z)}>${c("settings.environment.clear")}</button>
                            </span>
                        </div>
                    `})}
                ${N.length===0&&g`<p class="settings-hint">${c("settings.environment.noMatch",{filter:i})}</p>`}
            </div>
        </div>
    `}var Lc=d(()=>{rn();Hn();un()});var Cc={};on(Cc,{ProvidersSection:()=>r0});function i0(n){switch(n){case"oauth":return"OAuth";case"api_key":return bn("settings.providers.authApiKey");case"custom":return bn("settings.providers.authConfigured");default:return bn("settings.providers.authConfigured")}}function r0({providers:n,setStatus:i}){let{t:r}=L(),[_,c]=w(null),[s,u]=w(null),[f,l]=w({}),o=U((k,x)=>{l((N)=>({...N,[k]:x}))},[]),y=U(async(k)=>{let x=(f.apiKey||"").trim();if(!x){i?.(r("settings.providers.apiKeyEmpty"),"error");return}c(k),i?.(r("settings.providers.configuringToast",{provider:k}),"info");try{let N=JSON.stringify({provider:k,method:"api_key",api_key:x}),M=await Bn("default",`/login __step2 ${N}`,null,[]);if(M?.command?.status==="error"){i?.(M.command.message,"error");return}i?.(M?.command?.message||r("settings.providers.configured",{provider:k}),"success"),u(null),l({})}catch(N){i?.(String(N.message||N),"error")}finally{c(null)}},[f,i]),H=U(async(k,x)=>{c(k),i?.(r("settings.providers.configuringToast",{provider:k}),"info");try{let N={provider:k,method:"custom"};for(let z of x.customFields||[])N[z.key]=(f[z.key]||"").trim();let M=JSON.stringify(N),W=await Bn("default",`/login __step2 ${M}`,null,[]);if(W?.command?.status==="error"){i?.(W.command.message,"error");return}i?.(W?.command?.message||r("settings.providers.configured",{provider:k}),"success"),u(null),l({})}catch(N){i?.(String(N.message||N),"error")}finally{c(null)}},[f,i]),$=U(async(k)=>{c(k),i?.(r("settings.providers.startingOAuth",{provider:k}),"info");try{let x=JSON.stringify({provider:k}),M=(await Bn("default",`/login __step1 ${x}`,null,[]))?.command?.message||"";if(M.includes("http")){let W=M.match(/(https?:\/\/[^\s)]+)/);if(W)window.open(W[1],"_blank","noopener"),i?.(r("settings.providers.oauthOpened"),"success");else i?.(M,"success")}else i?.(M||r("settings.providers.oauthStarted",{provider:k}),"success")}catch(x){i?.(String(x.message||x),"error")}finally{c(null)}},[i]),v=U(async(k)=>{if(_)return;c(k),i?.(r("settings.providers.loggingOut",{provider:k}),"info");try{await Bn("default",`/logout ${k}`,null,[]),i?.(r("settings.providers.loggedOut",{provider:k}),"success")}catch(x){i?.(String(x.message||x),"error")}finally{c(null)}},[_,i]),h=n||[],b=(k)=>s===k,F=(k)=>{u((x)=>x===k?null:k),l({})};return g`
        <div class="settings-section">
            <h3>${r("settings.providers.heading")}</h3>
            <div class="settings-provider-list">
                ${h.map((k)=>g`
                    <div class=${`settings-provider-card${k.configured?" configured":""}`}>
                        <div class="settings-provider-card-header" onClick=${()=>!k.configured&&F(k.id)}>
                            <div class="settings-provider-card-title">
                                <strong>${k.name}</strong>
                                <span class="settings-provider-id">${k.id}</span>
                                ${k.configured&&g`<span class="settings-tag settings-tag-skill">${i0(k.authType)}</span>`}
                            </div>
                            <div class="settings-provider-card-meta">
                                ${k.hasOAuth&&g`<span class="settings-tag">OAuth</span>`}
                                ${k.hasApiKey&&g`<span class="settings-tag">API Key</span>`}
                                ${k.isCustom&&g`<span class="settings-tag">${r("settings.providers.tagCustom")}</span>`}
                            </div>
                            <div class="settings-provider-card-actions">
                                ${k.configured?g`
                                    <button class="settings-addon-btn settings-addon-btn-remove"
                                        disabled=${_===k.id} onClick=${(x)=>{x.stopPropagation(),v(k.id)}}
                                    >${_===k.id?"…":r("settings.providers.logout")}</button>
                                    <button class="settings-addon-btn"
                                        disabled=${_===k.id} onClick=${(x)=>{x.stopPropagation(),F(k.id)}}
                                    >${r("settings.providers.reconfigure")}</button>
                                `:g`
                                    <button class="settings-addon-btn settings-addon-btn-install"
                                        disabled=${_===k.id} onClick=${(x)=>{x.stopPropagation(),F(k.id)}}
                                    >${r("settings.providers.setUp")}</button>
                                `}
                            </div>
                        </div>

                        ${b(k.id)&&g`
                            <div class="settings-provider-setup">
                                <p class="settings-hint settings-provider-setup-hint">${r("settings.providers.setupHint")}</p>
                                ${k.hasOAuth&&g`
                                    <div class="settings-provider-method">
                                        <button class="settings-addon-btn settings-addon-btn-install"
                                            disabled=${_===k.id}
                                            onClick=${()=>$(k.id)}>
                                            ${_===k.id?r("settings.providers.starting"):r("settings.providers.signInOAuth")}
                                        </button>
                                    </div>
                                `}
                                ${k.hasApiKey&&g`
                                    <div class="settings-provider-method">
                                        <div class="settings-provider-field-row">
                                            <label>${r("settings.providers.apiKeyLabel")}</label>
                                            <input type="password" value=${f.apiKey||""}
                                                onInput=${(x)=>o("apiKey",x.target.value)}
                                                placeholder=${k.apiKeyHint||r("settings.providers.apiKeyPlaceholder")} />
                                            <button class="settings-addon-btn settings-addon-btn-install"
                                                disabled=${_===k.id||!(f.apiKey||"").trim()}
                                                onClick=${()=>y(k.id)}>
                                                ${_===k.id?"…":r("settings.providers.save")}
                                            </button>
                                        </div>
                                    </div>
                                `}
                                ${k.isCustom&&g`
                                    <div class="settings-provider-method">
                                        ${(k.customFields||[]).map((x)=>g`
                                            <div class="settings-provider-field-row">
                                                <label>${x.label}${x.required?" *":""}</label>
                                                <input type="text" value=${f[x.key]||""}
                                                    onInput=${(N)=>o(x.key,N.target.value)}
                                                    placeholder=${x.placeholder||""} />
                                            </div>
                                        `)}
                                        <div class="settings-provider-form-actions">
                                            <button class="settings-addon-btn settings-addon-btn-install"
                                                disabled=${_===k.id}
                                                onClick=${()=>H(k.id,k)}>
                                                ${_===k.id?r("settings.providers.configuring"):r("settings.providers.saveConfig")}
                                            </button>
                                        </div>
                                    </div>
                                `}
                            </div>
                        `}
                    </div>
                `)}
            </div>
        </div>
    `}var Oc=d(()=>{rn();Hn();un()});var Jc={};on(Jc,{ModelsSection:()=>f0});function s0(n){return typeof n==="string"&&n.toLowerCase()==="anthropic"}function u0({thinkingLevel:n,supportsThinking:i,provider:r,availableLevels:_,onSetLevel:c,disabled:s}){let{t:u}=L(),f=_&&_.length>1?_:["off","minimal","low","medium","high"],l=s0(r)&&!f.includes("max")?_0:c0,o=Math.max(0,f.indexOf(n??"off"));if(!i)return g`<div class="settings-thinking-slider"><label>${u("settings.models.thinkingLevel")}</label><p class="settings-hint" style="margin:4px 0 0">${u("settings.models.noThinking")}</p></div>`;return g`
        <div class="settings-thinking-slider">
            <label>${u("settings.models.thinkingLevelLabel")} <strong>${l[f[o]]||f[o]}</strong></label>
            <div class="settings-slider-track">
                <input type="range" min="0" max=${f.length-1} step="1" value=${o} disabled=${s}
                    onInput=${(y)=>c(f[parseInt(y.target.value,10)])} />
                <div class="settings-slider-labels">
                    ${f.map((y,H)=>g`<span class=${H===o?"active":""} onClick=${()=>!s&&c(y)}>${l[y]||y}</span>`)}
                </div>
            </div>
        </div>
    `}function f0({filter:n=""}){let{t:i}=L(),[r,_]=w(null),[c,s]=w(!1),[u,f]=w("off"),[l,o]=w(!1),[y,H]=w(["off"]),[$,v]=w(!1),[h,b]=w(!1),[F,k]=w(!1),x=U(async()=>{let B=await Qr();if(_(B),B.thinking_level_label||B.thinking_level)f(B.thinking_level_label||B.thinking_level);o(Boolean(B.supports_thinking)),v(Boolean(B.scoped_models_only));let V=Array.isArray(B.available_thinking_level_labels)&&B.available_thinking_level_labels.length>0?B.available_thinking_level_labels:B.available_thinking_levels;if(Array.isArray(V)&&V.length>0)H(V);return B},[]);X(()=>{x().catch((B)=>{console.warn("[settings/models] Failed to load models.",B),_({models:[],model_options:[]})})},[]);let N=U(async(B)=>{if(c)return;s(!0);try{await Bn("default",`/model ${B}`,null,[]),await x()}catch(V){console.error("Failed to switch model:",V)}finally{s(!1)}},[c,x]),M=U(async(B)=>{if(h)return;b(!0),v(Boolean(B));try{let V=await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scopedModelsOnly:Boolean(B)})}),Y=await V.json().catch(()=>({}));if(!V.ok||!Y?.ok)throw Error(Y?.error||"Failed to save scoped model setting.");await x()}catch(V){console.error("Failed to set scoped model filtering:",V),await x().catch((Y)=>{console.warn("[settings/models] Reload after scoped model filtering failure failed.",Y)})}finally{b(!1)}},[h,x]),W=U(async(B)=>{if(F)return;k(!0),f(B);try{let V=await Bn("default",`/thinking ${B}`,null,[]);if(V?.command?.thinking_level_label||V?.command?.thinking_level)f(V.command.thinking_level_label||V.command.thinking_level);o(V?.command?.supports_thinking!==!1),await x()}catch(V){console.error("Failed to set thinking:",V),await x().catch((Y)=>{console.warn("[settings/models] Reload after thinking change failure failed.",Y)})}finally{k(!1)}},[F,x]);if(!r)return g`<div class="settings-loading">${i("settings.models.loading")}</div>`;let z=r.model_options||[],p=r.current,Q=z.find((B)=>B.label===p)?.provider||"",t=n.toLowerCase(),j=t?z.filter((B)=>B.label.toLowerCase().includes(t)||(B.provider||"").toLowerCase().includes(t)):z;return g`
        <div class="settings-models-split">
            <div class="settings-models-summary settings-hint">${i("settings.models.summary")}</div>
            <div class="settings-row" style="padding:0 0 10px 0; align-items:flex-start">
                <label>${i("settings.models.scopedOnly")}</label>
                <div style="display:flex; flex-direction:column; gap:4px; min-width:0">
                    <label style="display:flex; align-items:center; gap:8px; font-weight:500">
                        <input type="checkbox" checked=${$} disabled=${h} onChange=${(B)=>M(B.target.checked)} />
                        ${i("settings.models.scopedCheckboxPre")} <code>enabledModels</code> ${i("settings.models.scopedCheckboxPost")}
                    </label>
                    <span class="settings-hint" style="margin:0">
                        ${i("settings.models.scopedHintPre")} <code>list_models</code> ${i("settings.models.scopedHintPost")}
                    </span>
                </div>
            </div>
            <div class="settings-models-list">
                <table class="settings-table settings-borderless settings-models-table">
                    <thead><tr><th style="width:32px"></th><th>${i("settings.models.colModel")}</th><th>${i("settings.models.colProvider")}</th><th>${i("settings.models.colContext")}</th><th style="text-align:center">${i("settings.models.colReasoning")}</th></tr></thead>
                    <tbody>
                        ${j.map((B)=>g`
                            <tr class=${B.label===p?"settings-row-active":""}>
                                <td><input type="radio" name="settings-model" checked=${B.label===p} disabled=${c} onChange=${()=>N(B.label)} /></td>
                                <td>${B.name||B.label}</td><td>${B.provider}</td>
                                <td>${B.context_window?(B.context_window/1000).toFixed(0)+"K":"—"}</td>
                                <td style="text-align:center">${B.reasoning?"\uD83E\uDDE0":"—"}</td>
                            </tr>
                        `)}
                        ${j.length===0&&g`<tr><td colspan="5" class="settings-empty">${i("settings.models.noMatch",{filter:n})}</td></tr>`}
                    </tbody>
                </table>
            </div>
            <div class="settings-models-footer">
                <${u0}
                    thinkingLevel=${u}
                    supportsThinking=${l}
                    provider=${Q}
                    availableLevels=${y}
                    onSetLevel=${W}
                    disabled=${F||c} />
            </div>
        </div>
    `}var _0,c0;var Ec=d(()=>{rn();Hn();un();_0={off:"off",minimal:"minimal",low:"low",medium:"medium",high:"high",xhigh:"max",max:"max"},c0={off:"off",minimal:"minimal",low:"low",medium:"medium",high:"high",xhigh:"xhigh",max:"max"}});function Sr(n){let i=String(n||"").trim().toLowerCase();if(!i)return"default";if(i==="solarized-dark"||i==="solarized-light")return"solarized";if(i==="github-dark"||i==="github-light")return"github";if(i==="tokyo-night")return"tokyo";return i}function mc(n){if(!n)return null;let i=String(n).trim();if(!i)return null;let r=i.startsWith("#")?i.slice(1):i;if(!/^[0-9a-fA-F]{3}$/.test(r)&&!/^[0-9a-fA-F]{6}$/.test(r))return null;let _=r.length===3?r.split("").map((s)=>s+s).join(""):r,c=parseInt(_,16);return{r:c>>16&255,g:c>>8&255,b:c&255,hex:`#${_.toLowerCase()}`}}function o0(n,i){try{if(document.body){n.style.display="none",document.body.appendChild(n);let r=getComputedStyle(n).color||n.style.color;return document.body.removeChild(n),r}}catch{return i}return i}function $0(n){if(!n||typeof document>"u")return null;let i=String(n).trim();if(!i)return null;let r=document.createElement("div");if(r.style.color="",r.style.color=i,!r.style.color)return null;let c=o0(r,r.style.color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);if(!c)return null;let s=parseInt(c[1],10),u=parseInt(c[2],10),f=parseInt(c[3],10);if(![s,u,f].every((o)=>Number.isFinite(o)))return null;let l=`#${[s,u,f].map((o)=>o.toString(16).padStart(2,"0")).join("")}`;return{r:s,g:u,b:f,hex:l}}function An(n){return mc(n)||$0(n)}function mr(n,i,r){let _=Math.round(n.r+(i.r-n.r)*r),c=Math.round(n.g+(i.g-n.g)*r),s=Math.round(n.b+(i.b-n.b)*r);return`rgb(${_} ${c} ${s})`}function Li(n,i){return`rgba(${n.r}, ${n.g}, ${n.b}, ${i})`}function l0(n){let i=n.r/255,r=n.g/255,_=n.b/255,c=i<=0.03928?i/12.92:Math.pow((i+0.055)/1.055,2.4),s=r<=0.03928?r/12.92:Math.pow((r+0.055)/1.055,2.4),u=_<=0.03928?_/12.92:Math.pow((_+0.055)/1.055,2.4);return 0.2126*c+0.7152*s+0.0722*u}function w0(n){return l0(n)>0.4?"#000000":"#ffffff"}function ac(){if(typeof window>"u")return"light";try{return window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch{return"light"}}function ar(n){return dc[n]||dc.default}function t0(n){return n.mode==="auto"?ac():n.mode}function ns(n,i){let r=ar(n);if(i==="dark"&&r.dark)return r.dark;if(i==="light"&&r.light)return r.light;return r.dark||r.light||Fn}function zn(n,i,r){let _=An(n);if(!_)return n;return mr(_,i,r)}function is(n,i,r){let _=An(i);if(!_)return n;let s=mc(r==="dark"?"#ffffff":"#000000");return{...n,bgPrimary:zn(n.bgPrimary,_,0.08),bgSecondary:zn(n.bgSecondary,_,0.12),bgHover:zn(n.bgHover,_,0.16),textPrimary:zn(n.textPrimary,_,r==="dark"?0.08:0.06),textSecondary:zn(n.textSecondary,_,r==="dark"?0.12:0.1),borderColor:zn(n.borderColor,_,0.1),accent:_.hex,accentHover:s?mr(_,s,0.18):_.hex,warning:zn(n.warning||Fn.warning,_,0.14),danger:zn(n.danger,_,0.16),success:zn(n.success,_,0.16)}}function y0(n,i){let r=An(n?.warning);if(r)return r.hex;let _=An(i==="dark"?Ji.warning:Fn.warning)||An(Fn.warning),c=An(n?.accent);if(_&&c)return mr(_,c,i==="dark"?0.18:0.14);return i==="dark"?Ji.warning:Fn.warning}function k0(n,i){if(typeof document>"u")return;let r=document.documentElement,_=n.accent,c=An(_),s=c?Li(c,i==="dark"?0.35:0.2):n.searchHighlight||n.searchHighlightColor,u=c?Li(c,i==="dark"?0.16:0.12):"rgba(29, 155, 240, 0.12)",f=c?Li(c,i==="dark"?0.28:0.2):"rgba(29, 155, 240, 0.2)",l=c?w0(c):i==="dark"?"#000000":"#ffffff",o=c?Li(c,i==="dark"?0.35:0.25):"rgba(29, 155, 240, 0.25)",y=y0(n,i),H={"--bg-primary":n.bgPrimary,"--bg-secondary":n.bgSecondary,"--bg-hover":n.bgHover,"--text-primary":n.textPrimary,"--text-secondary":n.textSecondary,"--border-color":n.borderColor,"--accent-color":_,"--accent-hover":n.accentHover||_,"--accent-color-alpha":o,"--accent-soft":u,"--accent-soft-strong":f,"--accent-contrast-text":l,"--warning-color":y,"--danger-color":n.danger||Fn.danger,"--success-color":n.success||Fn.success,"--search-highlight-color":s||"rgba(29, 155, 240, 0.2)"};Object.entries(H).forEach(([$,v])=>{if(v)r.style.setProperty($,v)})}function pi(n){if(typeof document>"u")return;let i=Number(n),r=Number.isFinite(i)?Math.min(24,Math.max(0,Math.round(i))):0;document.documentElement.style.setProperty("--output-pad",`${r}px`),document.documentElement.dataset.outputPad=String(r)}function p0(){if(typeof document>"u")return;let n=document.documentElement;g0.forEach((i)=>n.style.removeProperty(i))}function an(n,i={}){if(typeof document>"u")return null;let r=typeof i.id==="string"&&i.id.trim()?i.id.trim():null,_=r?document.getElementById(r):document.querySelector(`meta[name="${n}"]`);if(!_)_=document.createElement("meta"),document.head.appendChild(_);if(_.setAttribute("name",n),r)_.setAttribute("id",r);return _}function ec(n){let i=Sr(Zn?.theme||"default"),r=Zn?.tint?String(Zn.tint).trim():null,_=ns(i,n);if(i==="default"&&r)_=is(_,r,n);if(_?.bgPrimary)return _.bgPrimary;return n==="dark"?Ji.bgPrimary:Fn.bgPrimary}function x0(n,i){if(typeof document>"u")return;let r=an("theme-color",{id:"dynamic-theme-color"});if(r&&n)r.removeAttribute("media"),r.setAttribute("content",n);let _=an("theme-color",{id:"theme-color-light"});if(_)_.setAttribute("media","(prefers-color-scheme: light)"),_.setAttribute("content",ec("light"));let c=an("theme-color",{id:"theme-color-dark"});if(c)c.setAttribute("media","(prefers-color-scheme: dark)"),c.setAttribute("content",ec("dark"));let s=an("msapplication-TileColor");if(s&&n)s.setAttribute("content",n);let u=an("msapplication-navbutton-color");if(u&&n)u.setAttribute("content",n);let f=an("apple-mobile-web-app-status-bar-style");if(f)f.setAttribute("content",i==="dark"?"black-translucent":"default")}function b0(){if(typeof window>"u")return;let n={...Zn,mode:Sc};window.dispatchEvent(new CustomEvent("piclaw-theme-change",{detail:n}))}function v0(){if(typeof window>"u")return"web:default";try{let i=new URL(window.location.href).searchParams.get("chat_jid");return i&&i.trim()?i.trim():"web:default"}catch{return"web:default"}}function h0(n){if(typeof document>"u"||!n)return;let i=document.documentElement;if(i?.style)i.style.background=n;if(document.body?.style)document.body.style.background=n}function n_(n,i={}){if(typeof window>"u"||typeof document>"u")return;let r=Sr(n?.theme||"default"),_=n?.tint?String(n.tint).trim():null,c=ar(r),s=t0(c),u=ns(r,s);Zn={theme:r,tint:_},Sc=s;let f=document.documentElement;f.dataset.theme=s,f.dataset.colorTheme=r,f.dataset.tint=_?String(_):"",f.style.colorScheme=s;let l=u;if(r==="default"&&_)l=is(u,_,s);if(r==="default"&&!_)p0();else k0(l,s);if(h0(l.bgPrimary),x0(l.bgPrimary,s),b0(),i.persist!==!1)if($n(er,r),_)$n(Oi,_);else $n(Oi,"")}function Ci(){if(ar(Zn.theme).mode!=="auto")return;n_(Zn,{persist:!1})}function K0(){if(typeof window>"u")return;let n=Sr(Un(er)||"default"),i=(()=>{let r=Un(Oi);return r?r.trim():null})();n_({theme:n,tint:i},{persist:!1})}function Zo(){if(typeof window>"u")return()=>{};if(K0(),window.matchMedia&&!dr){let n=window.matchMedia("(prefers-color-scheme: dark)");if(n.addEventListener)n.addEventListener("change",Ci);else if(n.addListener)n.addListener(Ci);return dr=!0,()=>{if(n.removeEventListener)n.removeEventListener("change",Ci);else if(n.removeListener)n.removeListener(Ci);dr=!1}}return()=>{}}function i_(n){if(!n||typeof n!=="object")return;if(n.outputPad!==void 0||n.output_pad!==void 0)pi(n.outputPad??n.output_pad);let i=n.theme!==void 0||n.name!==void 0||n.colorTheme!==void 0,r=n.tint!==void 0;if(!i&&!r)return;let _=v0(),c=n.chat_jid||n.chatJid||null,s=n.theme??n.name??n.colorTheme,u=n.tint??null;if(!c||c===_)n_({theme:s||"default",tint:u},{persist:!1});$n(er,s||"default"),$n(Oi,u||"")}function Do(){if(typeof document>"u")return"light";let n=document.documentElement?.dataset?.theme;if(n==="dark"||n==="light")return n;return ac()}var er="piclaw_theme",Oi="piclaw_tint",Fn,Ji,dc,g0,Zn,Sc="light",dr=!1;var rs=d(()=>{Fn={bgPrimary:"#ffffff",bgSecondary:"#f7f9fa",bgHover:"#e8ebed",textPrimary:"#0f1419",textSecondary:"#536471",borderColor:"#eff3f4",accent:"#1d9bf0",accentHover:"#1a8cd8",warning:"#f0b429",danger:"#f4212e",success:"#00ba7c"},Ji={bgPrimary:"#000000",bgSecondary:"#16181c",bgHover:"#1d1f23",textPrimary:"#e7e9ea",textSecondary:"#71767b",borderColor:"#2f3336",accent:"#1d9bf0",accentHover:"#1a8cd8",warning:"#f0b429",danger:"#f4212e",success:"#00ba7c"},dc={default:{label:"Default",mode:"auto",light:Fn,dark:Ji},tango:{label:"Tango",mode:"light",light:{bgPrimary:"#f6f5f4",bgSecondary:"#efedeb",bgHover:"#e5e3e1",textPrimary:"#2e3436",textSecondary:"#5c6466",borderColor:"#d3d7cf",accent:"#3465a4",accentHover:"#2c5890",danger:"#cc0000",success:"#4e9a06"}},xterm:{label:"XTerm",mode:"dark",dark:{bgPrimary:"#000000",bgSecondary:"#0a0a0a",bgHover:"#121212",textPrimary:"#d0d0d0",textSecondary:"#8a8a8a",borderColor:"#1f1f1f",accent:"#00a2ff",accentHover:"#0086d1",danger:"#ff5f5f",success:"#5fff87"}},monokai:{label:"Monokai",mode:"dark",dark:{bgPrimary:"#272822",bgSecondary:"#2f2f2f",bgHover:"#3a3a3a",textPrimary:"#f8f8f2",textSecondary:"#cfcfc2",borderColor:"#3e3d32",accent:"#f92672",accentHover:"#e81560",danger:"#f92672",success:"#a6e22e"}},"monokai-pro":{label:"Monokai Pro",mode:"dark",dark:{bgPrimary:"#2d2a2e",bgSecondary:"#363237",bgHover:"#403a40",textPrimary:"#fcfcfa",textSecondary:"#c1c0c0",borderColor:"#444046",accent:"#ff6188",accentHover:"#f74f7e",danger:"#ff4f5e",success:"#a9dc76"}},ristretto:{label:"Ristretto",mode:"dark",dark:{bgPrimary:"#2c2525",bgSecondary:"#362d2d",bgHover:"#403535",textPrimary:"#f4f1ef",textSecondary:"#cbbdb8",borderColor:"#4a3c3c",accent:"#ff9f43",accentHover:"#f28a2e",danger:"#ff5f56",success:"#a9dc76"}},dracula:{label:"Dracula",mode:"dark",dark:{bgPrimary:"#282a36",bgSecondary:"#303445",bgHover:"#3a3f52",textPrimary:"#f8f8f2",textSecondary:"#c5c8d6",borderColor:"#44475a",accent:"#bd93f9",accentHover:"#a87ded",danger:"#ff5555",success:"#50fa7b"}},catppuccin:{label:"Catppuccin",mode:"dark",dark:{bgPrimary:"#1e1e2e",bgSecondary:"#24273a",bgHover:"#2c2f41",textPrimary:"#cdd6f4",textSecondary:"#a6adc8",borderColor:"#313244",accent:"#89b4fa",accentHover:"#74a0f5",danger:"#f38ba8",success:"#a6e3a1"}},nord:{label:"Nord",mode:"dark",dark:{bgPrimary:"#2e3440",bgSecondary:"#3b4252",bgHover:"#434c5e",textPrimary:"#eceff4",textSecondary:"#d8dee9",borderColor:"#4c566a",accent:"#88c0d0",accentHover:"#78a9c0",danger:"#bf616a",success:"#a3be8c"}},gruvbox:{label:"Gruvbox",mode:"dark",dark:{bgPrimary:"#282828",bgSecondary:"#32302f",bgHover:"#3c3836",textPrimary:"#ebdbb2",textSecondary:"#bdae93",borderColor:"#3c3836",accent:"#d79921",accentHover:"#c28515",danger:"#fb4934",success:"#b8bb26"}},solarized:{label:"Solarized",mode:"auto",light:{bgPrimary:"#fdf6e3",bgSecondary:"#f5efdc",bgHover:"#eee8d5",textPrimary:"#586e75",textSecondary:"#657b83",borderColor:"#e0d8c6",accent:"#268bd2",accentHover:"#1f78b3",danger:"#dc322f",success:"#859900"},dark:{bgPrimary:"#002b36",bgSecondary:"#073642",bgHover:"#0b3c4a",textPrimary:"#eee8d5",textSecondary:"#93a1a1",borderColor:"#18424a",accent:"#268bd2",accentHover:"#1f78b3",danger:"#dc322f",success:"#859900"}},tokyo:{label:"Tokyo",mode:"dark",dark:{bgPrimary:"#1a1b26",bgSecondary:"#24283b",bgHover:"#2f3549",textPrimary:"#c0caf5",textSecondary:"#9aa5ce",borderColor:"#414868",accent:"#7aa2f7",accentHover:"#6b92e6",danger:"#f7768e",success:"#9ece6a"}},miasma:{label:"Miasma",mode:"dark",dark:{bgPrimary:"#1f1f23",bgSecondary:"#29292f",bgHover:"#33333a",textPrimary:"#e5e5e5",textSecondary:"#b4b4b4",borderColor:"#3d3d45",accent:"#c9739c",accentHover:"#b8618c",danger:"#e06c75",success:"#98c379"}},github:{label:"GitHub",mode:"auto",light:{bgPrimary:"#ffffff",bgSecondary:"#f6f8fa",bgHover:"#eaeef2",textPrimary:"#24292f",textSecondary:"#57606a",borderColor:"#d0d7de",accent:"#0969da",accentHover:"#0550ae",danger:"#cf222e",success:"#1a7f37"},dark:{bgPrimary:"#0d1117",bgSecondary:"#161b22",bgHover:"#21262d",textPrimary:"#c9d1d9",textSecondary:"#8b949e",borderColor:"#30363d",accent:"#2f81f7",accentHover:"#1f6feb",danger:"#f85149",success:"#3fb950"}},gotham:{label:"Gotham",mode:"dark",dark:{bgPrimary:"#0b0f14",bgSecondary:"#111720",bgHover:"#18212b",textPrimary:"#cbd6e2",textSecondary:"#9bb0c3",borderColor:"#1f2a37",accent:"#5ccfe6",accentHover:"#48b8ce",danger:"#d26937",success:"#2aa889"}}},g0=["--bg-primary","--bg-secondary","--bg-hover","--text-primary","--text-secondary","--border-color","--accent-color","--accent-hover","--accent-color-alpha","--accent-contrast-text","--accent-soft","--accent-soft-strong","--warning-color","--danger-color","--success-color","--search-highlight-color"],Zn={theme:"default",tint:null}});function B0(n){return D_.map((i)=>({value:i,label:I_[i],active:i===n}))}function _s({variant:n="inline",onChange:i}={}){let{locale:r,setLocale:_,t:c}=L(),s=B0(r),u=(f)=>{let l=f?.currentTarget?.value;_(l),i?.(l)};return g`
    <div class=${`language-switcher language-switcher-${n}`} role="none">
      <label class="language-switcher-label" for="language-switcher-select">${c("language.label")}</label>
      <select
        id="language-switcher-select"
        class="language-switcher-select"
        value=${r}
        aria-label=${c("language.label")}
        onClick=${(f)=>f.stopPropagation()}
        onChange=${u}
      >
        ${s.map((f)=>g`
          <option key=${f.value} value=${f.value}>${f.label}</option>
        `)}
      </select>
    </div>
  `}var cs=d(()=>{rn();un()});var us={};on(us,{ThemeSection:()=>H0});function Ei(n){let i=Number(n);if(!Number.isFinite(i))return 0;return Math.min(24,Math.max(0,Math.round(i)))}function ss(n={}){return{uiTheme:typeof n.uiTheme==="string"&&n.uiTheme.trim()?n.uiTheme.trim():"default",uiTint:typeof n.uiTint==="string"&&n.uiTint.trim()?n.uiTint.trim():"",outputPad:Ei(n.outputPad)}}function H0({themes:n,colorKeys:i,settingsData:r,setStatus:_,mergeSettingsData:c}){let{t:s}=L(),[u,f]=w("default"),[l,o]=w(""),[y,H]=w(0),[$,v]=w(!1),h=E(""),b=E(null),F=E(!0);X(()=>{return F.current=!0,()=>{F.current=!1}},[]);let k=U((z)=>{let p=ss(z);f(p.uiTheme),o(p.uiTint),H(p.outputPad),pi(p.outputPad),h.current=JSON.stringify(p)},[]);X(()=>{if(r){k(r);return}k({uiTheme:document.documentElement.dataset.colorTheme||"default",uiTint:document.documentElement.dataset.tint||"",outputPad:document.documentElement.dataset.outputPad||"0"})},[r,k]);let x=U((z,p,P=y)=>{i_({theme:z,tint:p||null,outputPad:P}),f(z||"default"),o(p||""),H(Ei(P))},[y]),N=J(()=>JSON.stringify(ss({uiTheme:u,uiTint:l,outputPad:y})),[u,l,y]);X(()=>{if(N===h.current)return;if(b.current)clearTimeout(b.current);return b.current=setTimeout(async()=>{if(!F.current)return;v(!0);try{let z=await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:N}),p=await z.json().catch(()=>({}));if(!F.current)return;if(!z.ok||!p?.ok||!p?.settings){_?.(p?.error||"Failed to save appearance settings.","error");return}h.current=N,c?.(p.settings),_?.("Appearance synced across clients.","success")}catch(z){if(!F.current)return;console.warn("[settings/appearance] Failed to persist appearance settings.",z),_?.("Failed to save appearance settings.","error")}finally{if(F.current)v(!1)}},250),()=>{if(b.current)clearTimeout(b.current)}},[N,c,_]);let M=i||[],W=n||[];return g`
        <div class="settings-section">
            <div class="settings-row settings-language-row">
                <${_s} variant="inline" />
            </div>
            ${$&&g`<div class="settings-hint" style="margin:0 0 12px 0;">${s("settings.appearance.syncing")}</div>`}
            <div class="settings-tint-row">
                <label class="settings-tint-label">
                    <input type="radio" name="settings-theme"
                        checked=${u==="default"}
                        onChange=${()=>x("default",l)} />
                    <strong>${s("settings.appearance.default")}</strong>
                    <span class="settings-hint" style="margin:0 0 0 6px">${s("settings.appearance.autoLightDark")}</span>
                </label>
                <div class="settings-tint-picker">
                    <label class="settings-hint" style="margin:0">${s("settings.appearance.tint")}</label>
                    <input type="color"
                        value=${l||"#1d9bf0"}
                        onInput=${(z)=>{let p=z.target.value;if(o(p),u==="default")i_({theme:"default",tint:p})}} />
                    ${l&&g`
                        <button class="settings-tint-clear" onClick=${()=>x("default","")}
                            title=${s("settings.appearance.clearTint")}>\u2715</button>
                    `}
                    <span class="settings-tint-hex">${l||s("settings.appearance.none")}</span>
                </div>
            </div>

            <div class="settings-output-pad-row">
                <label class="settings-output-pad-label" for="settings-output-pad">
                    <strong>${s("settings.appearance.outputPadding")}</strong>
                    <span class="settings-hint">${s("settings.appearance.outputPaddingHint")}</span>
                </label>
                <div class="settings-output-pad-control">
                    <input id="settings-output-pad" type="range" min="0" max="24" step="1"
                        value=${y}
                        onInput=${(z)=>{let p=Ei(z.target.value);H(p),pi(p)}} />
                    <input class="settings-output-pad-number" type="number" min="0" max="24" step="1"
                        value=${y}
                        onInput=${(z)=>{let p=Ei(z.target.value);H(p),pi(p)}} />
                    <span class="settings-hint">px</span>
                </div>
            </div>

            <table class="settings-table settings-borderless settings-theme-table">
                <thead>
                    <tr>
                        <th></th><th>Theme</th><th>Mode</th>
                        ${M.map((z)=>g`<th class="settings-swatch-header">${z.replace(/([A-Z])/g," $1").trim()}</th>`)}
                    </tr>
                </thead>
                <tbody>
                    ${W.filter((z)=>z.name!=="default").map((z)=>g`
                        <tr class=${z.name===u?"settings-row-active":""}
                            style="cursor:pointer" onClick=${()=>x(z.name,"")}>
                            <td><input type="radio" name="settings-theme" checked=${z.name===u} onChange=${()=>x(z.name,"")} /></td>
                            <td><strong>${z.label}</strong></td>
                            <td>${z.mode}</td>
                            ${M.map((p)=>{let P=z.colors?.[p];return g`<td class="settings-swatch-cell">
                                    ${P?g`<span class="settings-color-swatch" style=${"background:"+P} title=${P}></span>`:"—"}
                                </td>`})}
                        </tr>
                    `)}
                </tbody>
            </table>
        </div>
    `}var fs=d(()=>{rn();rs();cs();un()});var os={};on(os,{__scheduledTasksSettingsTest:()=>U0,ScheduledTasksSection:()=>P0});function Dn(n){if(!n)return"—";let i=new Date(n);if(Number.isNaN(i.getTime()))return n;return i.toLocaleString(void 0,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}function gs(n){let i=Number(n);if(!Number.isFinite(i))return"—";if(i<1000)return`${Math.round(i)}ms`;return`${(i/1000).toFixed(i<1e4?1:0)}s`}function r_(n){if(!n)return"—";if(n.schedule_type==="once")return`once · ${Dn(n.schedule_value)}`;if(n.schedule_type==="interval")return`interval · ${n.schedule_value}`;if(n.schedule_type==="cron")return`cron · ${n.schedule_value}`;return`${n.schedule_type||"schedule"} · ${n.schedule_value||"—"}`}function __(n){let i=n?.task_kind||"agent";return i==="internal"?bn("settings.tasks.internalProtected"):i}function c_(n){return(n?.task_kind||"agent")==="internal"}function F0(n){if(!n)return"";let i=String(n).replace(/\s+/g," ").trim();return i.length>180?`${i.slice(0,179)}…`:i}function ni({children:n,type:i="neutral"}){return g`<span class=${`settings-task-pill settings-task-pill-${i}`}>${n}</span>`}function T0({task:n}){let{t:i}=L(),r=Array.isArray(n?.recent_run_logs)?n.recent_run_logs:[];if(!r.length)return g`<p class="settings-hint">${i("settings.tasks.noRunLogs")}</p>`;return g`
        <div class="settings-task-run-list">
            ${r.map((_)=>g`
                <div class=${`settings-task-run-row settings-task-run-${_.status||"unknown"}`}>
                    <div class="settings-task-run-meta">
                        <${ni} type=${_.status==="error"?"error":"success"}>${_.status||"unknown"}<//>
                        <span>${Dn(_.run_at)}</span>
                        <span>${gs(_.duration_ms)}</span>
                    </div>
                    <div class="settings-task-run-summary">
                        ${_.error_summary||F0(_.error)||_.result_summary||_.result||i("settings.tasks.noSummary")}
                    </div>
                </div>
            `)}
        </div>
    `}function W0({task:n,onAction:i}){let{t:r}=L();if(!n)return g`<div class="settings-task-detail-empty">${r("settings.tasks.selectPrompt")}</div>`;let _=c_(n);return g`
        <div class="settings-task-detail">
            <div class="settings-task-detail-header">
                <div>
                    <h4>${n.summary||n.id}</h4>
                    <code>${n.id}</code>
                </div>
                <div class="settings-task-detail-actions">
                    ${n.status==="active"&&g`<button onClick=${()=>i("pause",n)}>${r("settings.tasks.pause")}</button>`}
                    ${n.status==="paused"&&g`<button onClick=${()=>i("resume",n)}>${r("settings.tasks.resume")}</button>`}
                    <button class="danger" onClick=${()=>i("delete",n)}>${r("settings.tasks.delete")}</button>
                </div>
            </div>
            <div class="settings-task-detail-grid">
                <span>${r("settings.tasks.status")}</span><strong>${n.status||"—"}</strong>
                <span>${r("settings.tasks.kind")}</span><strong>${__(n)}</strong>
                <span>${r("settings.tasks.schedule")}</span><strong>${r_(n)}</strong>
                <span>${r("settings.tasks.nextRun")}</span><strong>${Dn(n.next_run)}</strong>
                <span>${r("settings.tasks.lastRun")}</span><strong>${Dn(n.last_run)}</strong>
                <span>${r("settings.tasks.lastResult")}</span><strong>${n.latest_run_log?.status||n.last_result||"—"}</strong>
                <span>${r("settings.tasks.chat")}</span><code>${n.chat_jid||"—"}</code>
                <span>${r("settings.tasks.model")}</span><code>${n.model||"default"}</code>
                ${n.cwd&&g`<span>${r("settings.tasks.cwd")}</span><code>${n.cwd}</code>`}
                ${n.timeout_sec&&g`<span>${r("settings.tasks.timeout")}</span><strong>${n.timeout_sec}s</strong>`}
                ${_&&g`<span>${r("settings.tasks.protection")}</span><strong>${r("settings.tasks.protectionHint")}</strong>`}
            </div>
            <div class="settings-task-command-block">
                <strong>${n.task_kind==="shell"?r("settings.tasks.command"):r("settings.tasks.prompt")}</strong>
                <pre>${n.command||n.prompt||n.command_summary||n.prompt_summary||n.summary||"—"}</pre>
            </div>
            <h4>${r("settings.tasks.recentRuns")}</h4>
            <${T0} task=${n} />
        </div>
    `}function P0({filter:n="",setStatus:i}){let{t:r}=L(),[_,c]=w([]),[s,u]=w({active:0,paused:0,completed:0}),[f,l]=w("all"),[o,y]=w(""),[H,$]=w(!0),[v,h]=w(null),[b,F]=w(null),[k,x]=w(null),[N,M]=w(!1),W=U(async(t={})=>{$(!0),h(null);try{let j=await Hr({status:f,chatJid:o.trim()||void 0,limit:50,includeRunLogs:!0,runLogLimit:5});c(j.tasks||[]),u(j.counts||{active:0,paused:0,completed:0});let B=t.selectedId||b,V=(j.tasks||[]).find((Y)=>Y.id===B)||(j.tasks||[])[0]||null;F(V?.id||null),x(V)}catch(j){h(j?.message||r("settings.tasks.loadFailed"))}finally{$(!1)}},[f,o,b]);X(()=>{W()},[W]);let z=String(n||"").trim().toLowerCase(),p=J(()=>{if(!z)return _;return _.filter((t)=>[t.id,t.chat_jid,t.status,t.task_kind,t.schedule_type,t.schedule_value,t.summary,t.prompt_summary,t.command_summary,t.latest_run_log?.error_summary].some((j)=>String(j||"").toLowerCase().includes(z)))},[_,z]),P=U((t)=>{F(t?.id||null),x(t||null)},[]),Q=U(async(t,j)=>{if(!j||N)return;let B=c_(j),V=j.summary||j.command_summary||j.prompt_summary||j.id,Y=t==="delete"?r("settings.tasks.confirmDelete",{id:j.id})+`

${V}`:(t==="pause"?r("settings.tasks.confirmPause",{id:j.id}):r("settings.tasks.confirmResume",{id:j.id}))+`

${V}`;if(!window.confirm(Y))return;if(B&&!window.confirm(r("settings.tasks.confirmProtected",{id:j.id,action:t})))return;M(!0),i?.(t==="delete"?r("settings.tasks.deleting",{id:j.id}):t==="pause"?r("settings.tasks.pausing",{id:j.id}):r("settings.tasks.resuming",{id:j.id}),"info");try{await zr(t,j.id,{allowInternal:B}),i?.(t==="delete"?r("settings.tasks.deletedToast",{id:j.id}):t==="pause"?r("settings.tasks.pausedToast",{id:j.id}):r("settings.tasks.resumedToast",{id:j.id}),"success"),await W({selectedId:t==="delete"?null:j.id})}catch(K){i?.(K?.message||r("settings.tasks.actionFailed",{action:t}),"error")}finally{M(!1)}},[N,W,i]);return g`
        <div class="settings-section settings-scheduled-tasks-section">
            <div class="settings-task-toolbar">
                <div class="settings-task-counts">
                    <${ni} type="active">${r("settings.tasks.activeLabel")} ${s.active||0}<//>
                    <${ni} type="paused">${r("settings.tasks.pausedLabel")} ${s.paused||0}<//>
                    <${ni} type="completed">${r("settings.tasks.completedLabel")} ${s.completed||0}<//>
                </div>
                <div class="settings-task-filters">
                    <select value=${f} onChange=${(t)=>l(t.target.value)}>
                        ${z0.map((t)=>g`<option value=${t}>${t==="all"?r("settings.tasks.allStatuses"):t}</option>`)}
                    </select>
                    <input type="text" placeholder=${r("settings.tasks.filterChatPlaceholder")} value=${o} onInput=${(t)=>y(t.target.value)} />
                    <button onClick=${()=>W()} disabled=${H}>${r("settings.tasks.refresh")}</button>
                </div>
            </div>

            ${H&&g`<div class="settings-loading settings-loading-pane"><span class="settings-spinner"></span><span>${r("settings.tasks.loading")}</span></div>`}
            ${v&&g`<div class="settings-error-state">${v}</div>`}
            ${!H&&!v&&_.length===0&&g`
                <div class="settings-empty-state">
                    <strong>${r("settings.tasks.noneFound")}</strong>
                    <p>${r("settings.tasks.noneFoundHint")}</p>
                </div>
            `}
            ${!H&&!v&&_.length>0&&g`
                <div class="settings-task-layout">
                    <div class="settings-task-list" role="listbox" aria-label=${r("settings.tasks.listLabel")}>
                        ${p.map((t)=>g`
                            <button class=${`settings-task-row ${t.id===b?"active":""}`} onClick=${()=>P(t)}>
                                <span class="settings-task-row-main">
                                    <strong>${t.summary||t.id}</strong>
                                    <span>${r_(t)}</span>
                                </span>
                                <span class="settings-task-row-meta">
                                    <${ni} type=${t.status||"neutral"}>${t.status}<//>
                                    <${ni}>${__(t)}<//>
                                </span>
                                <span class="settings-task-row-times">${r("settings.tasks.next")} ${Dn(t.next_run)} · ${r("settings.tasks.last")} ${Dn(t.last_run)}${t.latest_run_log?.status?` · ${t.latest_run_log.status}`:""}</span>
                            </button>
                        `)}
                        ${p.length===0&&g`<p class="settings-hint">${r("settings.tasks.noMatch",{filter:n})}</p>`}
                    </div>
                    <${W0} task=${k&&p.some((t)=>t.id===k.id)?k:p[0]} onAction=${Q} />
                </div>
            `}
        </div>
    `}var z0,U0;var $s=d(()=>{rn();Hn();un();z0=["all","active","paused","completed"];U0={formatDateTime:Dn,formatDuration:gs,labelForSchedule:r_,kindLabel:__,isProtectedTask:c_}});function ls(n){return String(n||"").toLowerCase().replace(/^[@/]+/,"").replace(/\s+/g," ").trim()}function ii(n){return typeof n==="string"&&n.trim().length>0}function s_(n,...i){let r=ls(n);if(!r)return!0;let _=i.map((c)=>ls(c)).filter(Boolean);for(let c of _)if(c.startsWith(r)||c.includes(r))return!0;return!1}function ws(n){if(!Array.isArray(n))return null;let i=[],r=new Set;for(let _ of n){let c=String(_||"").trim();if(!c)continue;let s=c.toLowerCase();if(r.has(s))continue;r.add(s),i.push(c)}return i}function xi(n){let i=n&&typeof n==="object"?n:{};return{workspaceCommands:ws(i.workspaceCommands),slashCommands:ws(i.slashCommands)}}function ts(n,i){if(!Array.isArray(n))return!0;return n.some((r)=>r.toLowerCase()===i.toLowerCase())}function j0(n){let i=Array.isArray(n?.commands)?n.commands:[],r=xi(n?.settings),_=String(n?.query||"");return i.filter((c)=>ts(r.workspaceCommands,c.id)).filter((c)=>s_(_,c.label,c.description,...c.keywords||[])).map((c)=>({key:`workspace:${c.id}`,kind:"workspace",title:c.label,subtitle:c.description,searchText:`${c.label} ${c.description} ${(c.keywords||[]).join(" ")}`.trim(),visualHint:c.label.slice(0,1).toUpperCase()||"W",categoryLabel:"Workspace",actionHint:"Run",commandId:c.id}))}function N0(n){let i=Array.isArray(n?.agents)?n.agents:[],r=String(n?.query||""),_=new Set;return i.filter((c)=>{let s=ii(c?.chat_jid)?c.chat_jid.trim():"";if(!s||_.has(s))return!1;if(c?.archived_at)return!1;return _.add(s),!0}).filter((c)=>s_(r,`@${String(c?.agent_name||"").trim()}`,c?.session_name,c?.chat_jid)).map((c)=>{let s=ii(c?.agent_name)?c.agent_name.trim():String(c?.chat_jid||"").replace(/^[^:]+:/,""),u=ii(c?.session_name)?c.session_name.trim():"",f=String(c?.chat_jid||"").trim();return{key:`agent:${f}`,kind:"agent",title:`@${s}`,subtitle:u||f,searchText:`@${s} ${u} ${f}`.trim(),visualHint:s.slice(0,1).toUpperCase()||"@",categoryLabel:"Agent",actionHint:"Open",chatJid:f}})}function R0(n){let i=Array.isArray(n?.slashCommands)?n.slashCommands:[],r=xi(n?.settings),_=String(n?.query||""),c=new Set;return i.filter((s)=>{let u=ii(s?.name)?s.name.trim():"";if(!u||c.has(u.toLowerCase()))return!1;return c.add(u.toLowerCase()),ts(r.slashCommands,u)}).filter((s)=>s_(_,s?.name,s?.description,s?.source)).map((s)=>{let u=String(s?.name||"").trim(),f=ii(s?.description)?s.description.trim():"slash command",l=ii(s?.source)?s.source.trim():"";return{key:`slash:${u}`,kind:"slash",title:u,subtitle:f,searchText:`${u} ${f} ${String(s?.source||"")}`.trim(),visualHint:"/",categoryLabel:l||"Slash",actionHint:"Insert",commandName:u}})}function n$(n){return[...N0({agents:n?.agents,query:n?.query}),...j0({commands:n?.workspaceCommands,settings:n?.settings,query:n?.query}),...R0({slashCommands:n?.slashCommands,settings:n?.settings,query:n?.query})]}var ri;var ys=d(()=>{ri=[{id:"toggle-workspace",label:"Toggle workspace",description:"Show or hide the workspace sidebar.",keywords:["workspace","sidebar","explorer"]},{id:"open-explorer",label:"Open explorer",description:"Open the workspace explorer sidebar.",keywords:["workspace","explorer","sidebar"]},{id:"toggle-chat-only",label:"Chat-only mode",description:"Toggle chat-only mode.",keywords:["chat","mode","layout"]},{id:"open-terminal-tab",label:"Open terminal in tab",description:"Open the terminal pane in a workspace tab.",keywords:["terminal","shell","tab"]},{id:"open-vnc-tab",label:"Open VNC in tab",description:"Open the VNC viewer in a workspace tab.",keywords:["vnc","remote","desktop","tab"]},{id:"open-settings",label:"Settings",description:"Open the settings dialog.",keywords:["settings","preferences","config"]}]});var xs={};on(xs,{QuickActionsSection:()=>V0});function ks(n,...i){let r=String(n||"").trim().toLowerCase();if(!r)return!0;return i.some((_)=>String(_||"").toLowerCase().includes(r))}function ps(n){if(!Array.isArray(n))return null;return new Set(n.map((i)=>String(i||"").trim().toLowerCase()).filter(Boolean))}function V0({filter:n="",setStatus:i,mergeSettingsData:r}){let{t:_}=L(),[c,s]=w(()=>ri.map((p)=>p.id)),[u,f]=w([]),[l,o]=w([]),[y,H]=w(!0),[$,v]=w(!1),h=U(async()=>{H(!0);try{let[p,P]=await Promise.all([Vr(),Rr("web:default").catch(()=>({commands:[]}))]),Q=xi(p?.settings),t=Array.isArray(P?.commands)?P.commands:[];o(t),s(Array.isArray(Q.workspaceCommands)?Q.workspaceCommands:ri.map((j)=>j.id)),f(Array.isArray(Q.slashCommands)?Q.slashCommands:t.map((j)=>String(j?.name||"").trim()).filter(Boolean))}catch(p){i?.(String(p?.message||p),"error")}finally{H(!1)}},[i]);X(()=>{h()},[h]);let b=J(()=>ps(c),[c]),F=J(()=>ps(u),[u]),k=J(()=>ri.filter((p)=>ks(n,p.label,p.description,...p.keywords||[])),[n]),x=J(()=>l.filter((p)=>ks(n,p?.name,p?.description,p?.source)),[l,n]),N=U((p)=>{s((P)=>{let Q=new Set((Array.isArray(P)?P:[]).map((t)=>String(t||"").trim()).filter(Boolean));if(Q.has(p))Q.delete(p);else Q.add(p);return ri.map((t)=>t.id).filter((t)=>Q.has(t))})},[]),M=U((p)=>{f((P)=>{let Q=new Set((Array.isArray(P)?P:[]).map((t)=>String(t||"").trim()).filter(Boolean));if(Q.has(p))Q.delete(p);else Q.add(p);return l.map((t)=>String(t?.name||"").trim()).filter((t)=>t&&Q.has(t))})},[l]),W=U(()=>{s(ri.map((p)=>p.id)),f(l.map((p)=>String(p?.name||"").trim()).filter(Boolean))},[l]),z=U(async()=>{if($)return;v(!0),i?.(_("settings.quickActions.savingToast"),"info");try{let p=await Gr({workspaceCommands:c,slashCommands:u}),P=xi(p?.settings);r?.({quickActions:P}),window.dispatchEvent(new CustomEvent("piclaw:quick-actions-settings-updated",{detail:{settings:P}})),i?.(_("settings.quickActions.savedToast"),"success")}catch(p){i?.(String(p?.message||p),"error")}finally{v(!1)}},[r,$,i,u,c]);if(y)return g`<div class="settings-loading">${_("settings.quickActions.loading")}</div>`;return g`
        <div class="settings-section">
            <h3>${_("settings.quickActions.heading")}</h3>
            <p class="settings-hint">
                ${_("settings.quickActions.intro")}
            </p>

            <div class="settings-row" style="align-items:center; gap:10px; margin-bottom:12px;">
                <button class="settings-addon-btn" onClick=${W} disabled=${$}>${_("settings.quickActions.enableAll")}</button>
                <button class="settings-addon-btn settings-addon-btn-install" onClick=${z} disabled=${$}>
                    ${$?_("settings.quickActions.saving"):_("settings.quickActions.saveApply")}
                </button>
            </div>

            <h3 style="margin-top:8px;">${_("settings.quickActions.workspaceCommands")}</h3>
            <div class="settings-subsection-list">
                ${k.map((p)=>{let P=b?b.has(p.id.toLowerCase()):!0;return g`
                        <label class="settings-checkbox-row" key=${p.id}>
                            <input type="checkbox" checked=${P} onChange=${()=>N(p.id)} />
                            <div>
                                <div>${p.label}</div>
                                <div class="settings-hint" style="margin:2px 0 0 0;">${p.description}</div>
                            </div>
                        </label>
                    `})}
                ${k.length===0&&g`<div class="settings-hint">${_("settings.quickActions.noWorkspaceMatch")}</div>`}
            </div>

            <h3 style="margin-top:20px;">${_("settings.quickActions.slashCommands")}</h3>
            <div class="settings-subsection-list">
                ${x.map((p)=>{let P=String(p?.name||"").trim(),Q=F?F.has(P.toLowerCase()):!0;return g`
                        <label class="settings-checkbox-row" key=${P}>
                            <input type="checkbox" checked=${Q} onChange=${()=>M(P)} />
                            <div>
                                <div><code>${P}</code></div>
                                <div class="settings-hint" style="margin:2px 0 0 0;">${p?.description||_("settings.quickActions.slashFallback")}</div>
                            </div>
                        </label>
                    `})}
                ${x.length===0&&g`<div class="settings-hint">${_("settings.quickActions.noSlashMatch")}</div>`}
            </div>
        </div>
    `}var bs=d(()=>{rn();Hn();ys();un()});var vs={};on(vs,{KeychainSection:()=>M0});function G0(n){if(!n)return"—";try{return new Date(n).toLocaleDateString(void 0,{month:"short",day:"numeric",year:"numeric"})}catch{return n}}function M0({filter:n=""}){let{t:i}=L(),[r,_]=w([]),[c,s]=w(!0),[u,f]=w(null),[l,o]=w(!1),[y,H]=w(""),[$,v]=w(""),[h,b]=w(""),[F,k]=w(""),[x,N]=w(""),[M,W]=w("secret"),[z,p]=w(!1),[P,Q]=w({}),[t,j]=w(null),[B,V]=w(null),[Y,K]=w(null),A=E(null),C=E(null),cn=E(null),S=U(async()=>{s(!0),f(null);try{let q=await(await fetch("/agent/keychain")).json();if(q?.ok)_(q.entries||[]);else f(q?.error||i("settings.keychain.loadFailed"))}catch(T){f(i("settings.keychain.loadFailed"))}finally{s(!1)}},[]);X(()=>{S()},[S]);let fn=U(async()=>{let T=y.trim(),q=$;if(!T||!q)return;p(!0);try{let I=await(await fetch("/agent/keychain",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:T,secret:q,type:M,username:h.trim()||void 0,userNote:F,agentNote:x})})).json();if(I?.ok)H(""),v(""),b(""),k(""),N(""),W("secret"),o(!1),await S();else f(I?.error||i("settings.keychain.addFailed"))}catch{f(i("settings.keychain.addFailed"))}finally{p(!1)}},[y,$,h,F,x,M,S]),xn=U(async(T)=>{try{let gn=await(await fetch("/agent/keychain",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:T})})).json();if(gn?.ok)V(null),K((I)=>I?.name===T?null:I),await S();else f(gn?.error||i("settings.keychain.deleteFailed"))}catch{f(i("settings.keychain.deleteFailed"))}},[S]),kn=U(async(T)=>{let q=T?.name;if(!q)return;let gn=P[q]||{},I=Object.prototype.hasOwnProperty.call(gn,"userNote")?gn.userNote:T.userNote||"",G=Object.prototype.hasOwnProperty.call(gn,"agentNote")?gn.agentNote:T.agentNote||"";j(q);try{let Rn=await(await fetch("/agent/keychain/notes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:q,userNote:I,agentNote:G})})).json();if(Rn?.ok)Q((hi)=>{let ci={...hi||{}};return delete ci[q],ci}),await S();else f(Rn?.error||i("settings.keychain.saveNotesFailed"))}catch{f(i("settings.keychain.saveNotesFailed"))}finally{j(null)}},[P,S]),wn=U((T,q,gn)=>{Q((I)=>({...I||{},[T]:{...(I||{})[T]||{},[q]:gn}}))},[]),tn=U(async(T,q,gn)=>{try{let G=await(await fetch("/agent/keychain/reveal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:T,master_password:q||void 0,totp_code:gn||void 0})})).json();if(G?.ok)K({name:T,phase:"revealed",secret:G.secret,username:G.username,masterPassword:q});else if(G?.needs_master_password)K((ln)=>({name:T,phase:"password",masterPassword:"",error:ln?.name===T&&ln?.masterPassword?G.error:null})),requestAnimationFrame(()=>C.current?.focus());else if(G?.needs_totp)K((ln)=>({name:T,phase:"totp",masterPassword:q,totpCode:"",error:ln?.name===T&&ln?.phase==="totp"&&ln?.totpCode?G.error:null})),requestAnimationFrame(()=>cn.current?.focus());else K({name:T,phase:"error",error:G?.error||i("settings.keychain.revealFailed")})}catch{K({name:T,phase:"error",error:i("settings.keychain.revealFailed")})}},[]),Nn=U((T)=>{if(Y?.name===T&&Y?.phase==="revealed"){K(null);return}tn(T,null,null)},[Y,tn]),Tn=U((T)=>{let q=Y?.masterPassword||"";if(!q)return;tn(T,q,null)},[Y,tn]),R=U((T)=>{let q=Y?.totpCode||"";if(q.length<6)return;tn(T,Y?.masterPassword,q)},[Y,tn]),e=U(async(T)=>{try{await navigator.clipboard.writeText(T)}catch{let q=document.createElement("textarea");q.value=T,q.style.position="fixed",q.style.opacity="0",document.body.appendChild(q),q.select(),document.execCommand("copy"),document.body.removeChild(q)}},[]);X(()=>{if(l)requestAnimationFrame(()=>A.current?.focus())},[l]);let D=n.toLowerCase(),O=J(()=>{if(!D)return r;return r.filter((T)=>T.name.toLowerCase().includes(D)||(T.type||"").toLowerCase().includes(D)||(T.envVar||"").toLowerCase().includes(D)||(T.userNote||"").toLowerCase().includes(D)||(T.agentNote||"").toLowerCase().includes(D))},[r,D]);if(c)return g`<div class="settings-section"><div class="settings-loading">${i("settings.keychain.loading")}</div></div>`;return g`
        <div class="settings-section">
            ${u&&g`
                <div class="settings-keychain-error" role="alert">
                    ${u}
                    <button class="settings-keychain-dismiss" onClick=${()=>f(null)}>✕</button>
                </div>
            `}
            <div class="settings-keychain-toolbar" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                <span class="settings-hint" style="margin:0; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span>${O.length===1?i("settings.keychain.entryCountSingular",{count:O.length}):i("settings.keychain.entryCountPlural",{count:O.length})}${D?i("settings.keychain.matchingFilter",{filter:n}):""}${i("settings.keychain.encryptedSuffix")}</span>
                    <span style="display:inline-flex; align-items:center; gap:6px;">
                        <span>${i("settings.keychain.clickPrefix")}</span>
                        <span aria-hidden="true" style="display:inline-flex; width:18px; height:18px; align-items:center; justify-content:center; border-radius:999px; border:1px solid var(--border-color, rgba(120,120,120,.22)); background:var(--panel-bg, rgba(255,255,255,.04));">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </span>
                        <span>${i("settings.keychain.revealSuffix")}</span>
                    </span>
                </span>
                <button class="settings-keychain-add-btn" onClick=${()=>o(!l)}>
                    ${l?i("settings.keychain.cancel"):i("settings.keychain.addEntry")}
                </button>
            </div>

            ${l&&g`
                <div class="settings-keychain-add-form">
                    <div class="settings-keychain-add-row">
                        <input ref=${A} type="text" placeholder=${i("settings.keychain.namePlaceholder")}
                            value=${y} onInput=${(T)=>H(T.target.value)}
                            class="settings-keychain-input" />
                        <select value=${M} onChange=${(T)=>W(T.target.value)}
                            class="settings-keychain-select">
                            ${X0.map((T)=>g`<option value=${T}>${T}</option>`)}
                        </select>
                    </div>
                    <div class="settings-keychain-add-row">
                        <input type="password" placeholder=${i("settings.keychain.secretPlaceholder")}
                            value=${$} onInput=${(T)=>v(T.target.value)}
                            class="settings-keychain-input settings-keychain-secret" />
                        <input type="text" placeholder=${i("settings.keychain.usernamePlaceholder")}
                            value=${h} onInput=${(T)=>b(T.target.value)}
                            class="settings-keychain-input" style="max-width:200px" />
                        <button class="settings-keychain-save-btn" onClick=${fn}
                            disabled=${z||!y.trim()||!$}>
                            ${z?i("settings.keychain.saving"):i("settings.keychain.save")}
                        </button>
                    </div>
                    <div class="settings-keychain-add-row" style="align-items:stretch">
                        <textarea placeholder=${i("settings.keychain.userNotePlaceholder")}
                            value=${F} onInput=${(T)=>k(T.target.value)}
                            class="settings-keychain-input" rows="2" style="resize:vertical; min-height:56px"></textarea>
                        <textarea placeholder=${i("settings.keychain.agentNotePlaceholder")}
                            value=${x} onInput=${(T)=>N(T.target.value)}
                            class="settings-keychain-input" rows="2" style="resize:vertical; min-height:56px"></textarea>
                    </div>
                </div>
            `}

            <div class="settings-keychain-table-wrap">
                <table class="settings-table settings-keychain-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Env var</th>
                            <th>Updated</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${O.length===0&&g`
                            <tr><td colspan="5" class="settings-keychain-empty">
                                ${D?i("settings.keychain.noMatchFilter"):i("settings.keychain.noEntries")}
                            </td></tr>
                        `}
                        ${O.map((T)=>{let q=Y?.name===T.name?Y:null,gn=q?.phase==="revealed",I=q?.phase==="password",G=q?.phase==="totp",ln=q?.phase==="error",Rn=P[T.name]||{},hi=Object.prototype.hasOwnProperty.call(Rn,"userNote")?Rn.userNote:T.userNote||"",ci=Object.prototype.hasOwnProperty.call(Rn,"agentNote")?Rn.agentNote:T.agentNote||"",Xs=hi!==(T.userNote||"")||ci!==(T.agentNote||""),l_=t===T.name;return g`
                            <tr class="settings-keychain-row" key=${T.name}>
                                <td class="settings-keychain-name">${T.name}</td>
                                <td><span class="settings-keychain-type-badge">${T.type}</span></td>
                                <td class="settings-keychain-env">${T.envVar?g`<code>$${T.envVar}</code>`:"—"}</td>
                                <td class="settings-keychain-date">${G0(T.updatedAt)}</td>
                                <td class="settings-keychain-actions">
                                    <button class=${`settings-keychain-reveal-btn${gn?" active":""}`}
                                        onClick=${()=>Nn(T.name)}
                                        title=${gn?i("settings.keychain.hideSecret"):i("settings.keychain.revealSecret")}>
                                        ${gn?g`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`:g`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
                                    </button>
                                    ${B===T.name?g`
                                            <span class="settings-keychain-confirm">${i("settings.keychain.deleteQ")}
                                                <button class="settings-keychain-confirm-yes" onClick=${()=>xn(T.name)}>${i("settings.keychain.yes")}</button>
                                                <button class="settings-keychain-confirm-no" onClick=${()=>V(null)}>${i("settings.keychain.no")}</button>
                                            </span>
                                        `:g`<button class="settings-keychain-delete-btn" onClick=${()=>V(T.name)} title=${i("settings.keychain.deleteTitle")}>🗑</button>`}
                                </td>
                            </tr>
                            <tr class="settings-keychain-notes-row" key=${T.name+"-notes"}>
                                <td colspan="5">
                                    <div style="display:grid; grid-template-columns:1fr 1fr auto; gap:8px; align-items:start; padding:8px 0 10px 0;">
                                        <label style="display:flex; flex-direction:column; gap:4px; min-width:0;">
                                            <span class="settings-hint" style="margin:0">${i("settings.keychain.userNote")}</span>
                                            <textarea class="settings-keychain-input" rows="2" style="resize:vertical; min-height:52px; width:100%;" placeholder=${i("settings.keychain.userNoteHint")}
                                                value=${hi}
                                                onInput=${(yn)=>wn(T.name,"userNote",yn.target.value)}></textarea>
                                        </label>
                                        <label style="display:flex; flex-direction:column; gap:4px; min-width:0;">
                                            <span class="settings-hint" style="margin:0">${i("settings.keychain.agentNote")}</span>
                                            <textarea class="settings-keychain-input" rows="2" style="resize:vertical; min-height:52px; width:100%;" placeholder=${i("settings.keychain.agentNoteHint")}
                                                value=${ci}
                                                onInput=${(yn)=>wn(T.name,"agentNote",yn.target.value)}></textarea>
                                        </label>
                                        <button class="settings-keychain-save-btn" style="margin-top:20px" disabled=${!Xs||l_} onClick=${()=>kn(T)}>
                                            ${l_?i("settings.keychain.saving"):i("settings.keychain.saveNotes")}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            ${I&&g`
                                <tr class="settings-keychain-prompt-row" key=${T.name+"-pw"}>
                                    <td colspan="5">
                                        <div class="settings-keychain-prompt">
                                            <span class="settings-keychain-prompt-label">${i("settings.keychain.masterPassword")}</span>
                                            <input ref=${C} type="password" autocomplete="off"
                                                placeholder=${i("settings.keychain.masterPasswordPlaceholder")}
                                                class="settings-keychain-prompt-input"
                                                value=${q?.masterPassword||""}
                                                onInput=${(yn)=>K((nr)=>({...nr,masterPassword:yn.target.value}))}
                                                onKeyDown=${(yn)=>{if(yn.key==="Enter")Tn(T.name);if(yn.key==="Escape")K(null)}}
                                            />
                                            <button class="settings-keychain-prompt-submit" onClick=${()=>Tn(T.name)}
                                                disabled=${!q?.masterPassword}>${i("settings.keychain.unlock")}</button>
                                            <button class="settings-keychain-prompt-cancel" onClick=${()=>K(null)}>${i("settings.keychain.cancel")}</button>
                                            ${q?.error&&g`<span class="settings-keychain-prompt-error">${q.error}</span>`}
                                        </div>
                                    </td>
                                </tr>
                            `}
                            ${G&&g`
                                <tr class="settings-keychain-prompt-row" key=${T.name+"-totp"}>
                                    <td colspan="5">
                                        <div class="settings-keychain-prompt">
                                            <span class="settings-keychain-prompt-label">${i("settings.keychain.totpCode")}</span>
                                            <input ref=${cn} type="text" inputmode="numeric" autocomplete="one-time-code"
                                                maxlength="6" placeholder="000000"
                                                class="settings-keychain-prompt-input" style="width:90px;text-align:center;letter-spacing:0.15em"
                                                value=${q?.totpCode||""}
                                                onInput=${(yn)=>K((nr)=>({...nr,totpCode:yn.target.value.replace(/\\D/g,"").slice(0,6)}))}
                                                onKeyDown=${(yn)=>{if(yn.key==="Enter")R(T.name);if(yn.key==="Escape")K(null)}}
                                            />
                                            <button class="settings-keychain-prompt-submit" onClick=${()=>R(T.name)}
                                                disabled=${(q?.totpCode||"").length<6}>${i("settings.keychain.verify")}</button>
                                            <button class="settings-keychain-prompt-cancel" onClick=${()=>K(null)}>${i("settings.keychain.cancel")}</button>
                                            ${q?.error&&g`<span class="settings-keychain-prompt-error">${q.error}</span>`}
                                        </div>
                                    </td>
                                </tr>
                            `}
                            ${gn&&g`
                                <tr class="settings-keychain-reveal-row" key=${T.name+"-reveal"}>
                                    <td colspan="5">
                                        <div class="settings-keychain-reveal-panel">
                                            ${q.username&&g`
                                                <div class="settings-keychain-reveal-field">
                                                    <span class="settings-keychain-reveal-label">${i("settings.keychain.username")}</span>
                                                    <code class="settings-keychain-reveal-value">${q.username}</code>
                                                    <button class="settings-keychain-copy-btn" onClick=${()=>e(q.username)} title=${i("settings.keychain.copyUsername")}>
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                                    </button>
                                                </div>
                                            `}
                                            <div class="settings-keychain-reveal-field">
                                                <span class="settings-keychain-reveal-label">${i("settings.keychain.secret")}</span>
                                                <code class="settings-keychain-reveal-value">${q.secret}</code>
                                                <button class="settings-keychain-copy-btn" onClick=${()=>e(q.secret)} title=${i("settings.keychain.copySecret")}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `}
                            ${ln&&g`
                                <tr class="settings-keychain-reveal-row" key=${T.name+"-error"}>
                                    <td colspan="5">
                                        <div class="settings-keychain-reveal-panel" style="color: var(--error-color, #e55)">${q.error}</div>
                                    </td>
                                </tr>
                            `}
                        `})}
                    </tbody>
                </table>
            </div>
        </div>
    `}var X0;var hs=d(()=>{rn();un();X0=["secret","token","password","basic"]});var Ks={};on(Ks,{ToolsSection:()=>D0});function D0({toolsets:n,filter:i="",settingsData:r,mergeSettingsData:_}){let{t:c}=L(),s=n||[],[u,f]=w(()=>{let b={};for(let F of s)b[F.name]=!0;return b}),l=U((b)=>{f((F)=>({...F,[b]:!F[b]}))},[]),o=r?.searchMatchMode||"or",y=J(()=>{let b=Array.isArray(r?.toolResultCompactionTools)?r.toolResultCompactionTools:[];return new Set(b.filter((F)=>typeof F==="string").map((F)=>F.trim().toLowerCase()).filter(Boolean))},[r?.toolResultCompactionTools]),H=U(async()=>{let b=o==="or"?"and":"or";try{let k=await(await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchMatchMode:b})})).json().catch(()=>({}));if(k?.ok&&k?.settings)_?.(k.settings)}catch(F){console.warn("[settings/tools] Failed to save search match mode.",F)}},[o,_]),$=U(async(b)=>{let F=String(b||"").trim().toLowerCase();if(!F)return;let k=new Set(y);if(k.has(F))k.delete(F);else k.add(F);try{let N=await(await fetch("/agent/settings/compaction",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({toolResultCompactionTools:Array.from(k).sort()})})).json().catch(()=>({}));if(N?.ok&&N?.settings)_?.(N.settings)}catch(x){console.warn("[settings/tools] Failed to save tool compaction settings.",x)}},[y,_]),v=i.toLowerCase(),h=J(()=>{if(!v)return s;return s.map((b)=>{let F=b.tools.filter((k)=>k.name.toLowerCase().includes(v)||b.name.toLowerCase().includes(v)||(k.summary||"").toLowerCase().includes(v));return F.length>0?{...b,tools:F}:null}).filter(Boolean)},[s,v]);if(s.length===0)return g`<div class="settings-section"><p class="settings-hint">${c("settings.tools.unavailable")}</p></div>`;return g`
        <div class="settings-section">
            <div class="settings-search-options">
                <h4 style="margin:0 0 8px 0">${c("settings.tools.search")}</h4>
                <div class="settings-row">
                    <label>${c("settings.tools.matchMode")}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="checkbox" checked=${o==="and"} onChange=${H} />
                        <span class="settings-hint" style="margin:0">
                            ${o==="or"?c("settings.tools.orMode"):c("settings.tools.andMode")}
                        </span>
                    </div>
                </div>
            </div>
            ${h.map((b)=>{let F=u[b.name]!==!1;return g`
                <div class="settings-toolset">
                    <div class="settings-toolset-header">
                        <label class="settings-toolset-toggle">
                            <input type="checkbox" checked=${F} onChange=${()=>l(b.name)} />
                            <span class="settings-toolset-icon">${Q0[b.name]||Z0}</span>
                            <strong>${b.name}</strong>
                        </label>
                        <span class="settings-hint" style="margin:0">${b.description}</span>
                    </div>
                    ${F&&g`<div class="settings-tool-list">
                        <div class="settings-tool-row settings-tool-row-header" aria-hidden="true">
                            <span class="settings-tool-status-header">${c("settings.tools.colEnabled")}</span>
                            <span class="settings-tool-name">${c("settings.tools.colTool")}</span>
                            <span class="settings-tool-compact-header">${c("settings.tools.colCompact")}</span>
                            <span class="settings-tool-kind">${c("settings.tools.colKind")}</span>
                            <span class="settings-tool-summary">${c("settings.tools.colSummary")}</span>
                            <span class="settings-tool-source">${c("settings.tools.colSource")}</span>
                        </div>
                        ${b.tools.map((k)=>{let x=String(k.name||"").trim().toLowerCase(),N=y.has(x);return g`
                                <div class="settings-tool-row">
                                    <input type="checkbox" checked disabled />
                                    <span class="settings-tool-name">${k.name}</span>
                                    <span class="settings-tool-compact">
                                        <input
                                            type="checkbox"
                                            checked=${N}
                                            onChange=${()=>$(k.name)}
                                            title=${N?c("settings.tools.disableCompaction"):c("settings.tools.enableCompaction")}
                                        />
                                    </span>
                                    <span class="settings-tool-kind" title=${k.kind}>${A0[k.kind]||"?"}</span>
                                    ${k.summary&&g`<span class="settings-tool-summary">${k.summary}</span>`}
                                    ${!k.summary&&g`<span class="settings-tool-summary"></span>`}
                                    <span class="settings-tool-source">${q0[k.name]||b.name}</span>
                                </div>
                            `})}
                    </div>`}
                </div>
            `})}
            ${h.length===0&&g`<p class="settings-hint">${c("settings.tools.noMatch",{filter:i})}</p>`}
            <p class="settings-hint">${c("settings.tools.footer")}</p>
        </div>
    `}var Q0,q0,A0,Z0;var Bs=d(()=>{rn();un();Q0={core:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 10l2.5 2-2.5 2"/><path d="M12.5 15H16"/></svg>`,discovery:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`,attachments:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,"model-control":g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M9 15c.83.67 2 1 3 1s2.17-.33 3-1"/></svg>`,data:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,workspace:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,automation:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,remote:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,browser:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,ui:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`,experiments:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v7l4.6 7.7A1 1 0 0 1 18.7 19H5.3a1 1 0 0 1-.9-1.3L9 10z"/><line x1="9" y1="3" x2="15" y2="3"/></svg>`,lifecycle:g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`},q0={read:"pi-core",write:"pi-core",edit:"pi-core",bash:"pi-core",powershell:"pi-core",find:"pi-core",grep:"pi-core",ls:"pi-core",list_tools:"internal-tools",activate_tools:"tool-activation",reset_active_tools:"tool-activation",list_scripts:"runtime-scripts",attach_file:"file-attachments",read_attachment:"file-attachments",export_attachment:"file-attachments",get_model_state:"model-control",list_models:"model-control",switch_model:"model-control",switch_thinking:"model-control",messages:"messages-crud",introspect_sql:"sql-introspect",keychain:"keychain-tools",search_workspace:"workspace-search",refresh_workspace_index:"workspace-search",open_office_viewer:"office-viewer",office_read:"office-viewer",office_write:"office-viewer",open_workspace_file:"open-workspace-file",image_process:"image-processing",schedule_task:"scheduled-tasks",scheduled_tasks:"scheduled-tasks",bun_run:"bun-runner",exec_batch:"exec-batch",search_tool_output:"search-tool-output",ssh:"ssh",proxmox:"proxmox",portainer:"portainer",mcp:"mcp",cdp_browser:"cdp-browser",send_adaptive_card:"send-adaptive-card",send_dashboard_widget:"send-dashboard-widget",start_autoresearch:"autoresearch",stop_autoresearch:"autoresearch",autoresearch_status:"autoresearch",exit_process:"exit-process",env:"env-tools"},A0={"read-only":"\uD83D\uDD0D",mutating:"✏️",mixed:"\uD83D\uDD04"},Z0=g`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`});var Hs={};on(Hs,{AddonsSection:()=>I0});function I0({setStatus:n,filter:i=""}){let{t:r}=L(),[_,c]=w(null),[s,u]=w(!0),[f,l]=w(null),[o,y]=w(!1),[H,$]=w({runtime:"",windowsNative:!1}),[v,h]=w([]),[b,F]=w([]);function k(){let t=new URLSearchParams;try{let B=(localStorage.getItem("piclaw_addons_catalog_url")||"").trim(),V=(localStorage.getItem("piclaw_addons_catalog_urls")||"").split(/\r?\n/).map((K)=>K.trim()).filter(Boolean),Y=localStorage.getItem("piclaw_addons_repo_url");if(B)t.append("catalog_url",B);for(let K of V)t.append("catalog_url",K);if(Y)t.set("repo_url",Y)}catch(B){}let j=t.toString();return j?`?${j}`:""}let x=U(async()=>{try{let[t,j]=await Promise.all([fetch(`/agent/addons${k()}`),fetch("/agent/settings-data")]),B=await t.json();if(B.error)throw Error(B.error);c(B.addons||[]),h(B.sources||[]),F(B.failed_sources||[]);let V=await j.json().catch(()=>({})),Y=typeof V?.runtimePlatform==="string"?V.runtimePlatform:"";$({runtime:Y,windowsNative:Y==="win32"})}catch(t){c(null),n?.(String(t.message||t),"error")}finally{u(!1)}},[n]);X(()=>{x()},[]);let N=U(async(t)=>{if(f)return;l({slug:t,action:"install"}),n?.(r("settings.addons.installing",{slug:t}),"info");try{let B=await(await fetch(`/agent/addons/install${k()}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:t})})).json();if(B.error){n?.(B.error,"error");return}y(!0);let V=[B.message,B.warning].filter(Boolean).join(" ");n?.(V||r("settings.addons.installedToast"),"success"),await x()}catch(j){n?.(String(j.message||j),"error")}finally{l(null)}},[f,x,n]),M=U(async(t)=>{if(f)return;l({slug:t,action:"remove"}),n?.(r("settings.addons.removing",{slug:t}),"info");try{let B=await(await fetch(`/agent/addons/uninstall${k()}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:t})})).json();if(B.error){n?.(B.error,"error");return}y(!0);let V=[B.message,B.warning].filter(Boolean).join(" ");n?.(V||r("settings.addons.removedToast"),"success"),await x()}catch(j){n?.(String(j.message||j),"error")}finally{l(null)}},[f,x,n]),W=U(async()=>{if(f)return;l({slug:null,action:"restart"}),n?.(r("settings.addons.restarting"),"info");try{let j=await(await fetch("/agent/addons/restart",{method:"POST"})).json();if(j.error){n?.(j.error,"error"),l(null);return}n?.(j.message||r("settings.addons.restarting"),"success"),y(!1),(async(V=30,Y=2000)=>{for(let K=0;K<V;K++){await new Promise((A)=>setTimeout(A,Y));try{if((await fetch("/agent/addons",{signal:AbortSignal.timeout(3000)})).ok){await x(),l(null),n?.(r("settings.addons.restartComplete"),"success");return}}catch(A){}}l(null),n?.(r("settings.addons.restartTimeout"),"warning")})()}catch(t){n?.(String(t.message||t),"error"),l(null)}},[f,n,x]);if(s)return g`<div class="settings-loading">${r("settings.addons.fetching")}</div>`;if(!_)return g`<div class="settings-section"><p class="settings-hint">${r("settings.addons.loadFailed")}</p></div>`;let z=i.toLowerCase(),p=z?_.filter((t)=>t.slug.toLowerCase().includes(z)||(t.description||"").toLowerCase().includes(z)||(t.tags||[]).some((j)=>j.toLowerCase().includes(z))):_,P=f?.slug||null,Q=f?f.action==="remove"?r("settings.addons.removing",{slug:f.slug}):f.action==="restart"?r("settings.addons.restarting"):r("settings.addons.installing",{slug:f.slug}):"";return g`
        <div class=${`settings-section settings-addon-panel${f?" busy":""}`} aria-busy=${f?"true":"false"}>
            <div class="settings-addon-toolbar">
                <div>
                    <p class="settings-hint">
                        ${v.length<=1?g`${r("settings.addons.catalogFromPre")} <a href="https://github.com/rcarmo/piclaw-addons" target="_blank">rcarmo/piclaw-addons</a>.`:g`${r("settings.addons.catalogMerged",{count:v.length})}`}
                        ${" "}${r("settings.addons.installNote")}
                    </p>
                    ${b.length>0&&g`
                        <div class="settings-addon-error" role="alert">
                            ${b.length>1?r("settings.addons.failedFetchPlural",{count:b.length}):r("settings.addons.failedFetchSingular",{count:b.length})}
                            ${b.map((t)=>g` <code style="font-size:0.82em;word-break:break-all">${t}</code>`)}
                        </div>
                    `}
                    ${v.length>1&&g`
                        <details class="settings-hint" style="margin-top:4px">
                            <summary style="cursor:pointer">${r("settings.addons.activeSources",{count:v.length})}</summary>
                            <ul style="margin:4px 0 0 16px;font-size:0.82em">
                                ${v.map((t)=>g`<li style="word-break:break-all"><code>${t}</code></li>`)}
                            </ul>
                        </details>
                    `}
                    ${H.windowsNative&&g`
                        <div class="settings-addon-error" role="alert">
                            ${r("settings.addons.windowsWarning")}
                        </div>
                    `}
                </div>
            </div>
            <div class="settings-addon-list">
                ${f&&g`
                    <div class="settings-addon-panel-overlay" role="status" aria-live="polite" aria-label=${Q}>
                        <div class="settings-addon-panel-overlay-card">
                            <div class="settings-spinner"></div>
                            <span>${Q}</span>
                        </div>
                    </div>
                `}
                ${p.map((t)=>{let j=(t.skills||[]).length>0,B=t.type==="extension",V=j&&B?r("settings.addons.typeExtSkill"):j?r("settings.addons.typeSkill"):r("settings.addons.typeExt"),Y=j&&!B?"settings-tag-skill":"",K=typeof t.homepage==="string"&&t.homepage.trim()?t.homepage.trim():"";return g`
                    <div class=${`settings-addon-card${t.installed?" installed":""}`}>
                        <div class="settings-addon-card-header">
                            ${K?g`<a class="settings-addon-name-link" href=${K} target="_blank" rel="noopener noreferrer">${t.slug}</a>`:g`<strong>${t.slug}</strong>`}
                            <span class=${`settings-tag settings-tag-type ${Y}`}>${V}</span>
                            <span class="settings-addon-version">${t.installed?t.installedVersion||"?":t.version||""}</span>
                            ${t.installKind&&g`<span class="settings-tag">${t.installKind}</span>`}
                            ${t.hasUpdate&&g`<span class="settings-tag settings-tag-skill">\u2191 ${t.version}</span>`}
                            <div class="settings-addon-actions">
                                ${t.installed?g`
                                    ${t.hasUpdate&&g`<button class="settings-addon-btn settings-addon-btn-upgrade" disabled=${Boolean(f)} onClick=${()=>N(t.slug)}>${P===t.slug?"…":r("settings.addons.update")}</button>`}
                                    <button class="settings-addon-btn settings-addon-btn-remove" disabled=${Boolean(f)} onClick=${()=>M(t.slug)}>${P===t.slug?"…":r("settings.addons.remove")}</button>
                                `:g`
                                    <button class="settings-addon-btn settings-addon-btn-install" disabled=${Boolean(f)} onClick=${()=>N(t.slug)}>${P===t.slug?"…":r("settings.addons.install")}</button>
                                `}
                            </div>
                        </div>
                        <div class="settings-addon-card-body">${t.description}</div>
                        <div class="settings-addon-card-footer">
                            <div class="settings-addon-tags">${(t.tags||[]).map((A)=>g`<span class="settings-tag">${A}</span>`)}${(t.skills||[]).map((A)=>g`<span class="settings-tag settings-tag-skill">\ud83d\udcdd ${A}</span>`)}</div>
                        </div>
                    </div>
                `})}
                ${p.length===0&&g`<p class="settings-hint">${r("settings.addons.noMatch",{filter:i})}</p>`}
            </div>
            ${o&&g`
                <div class="settings-addon-restart-notice" role="status" aria-live="polite">
                    <span>${r("settings.addons.restartNotice")}</span>
                    <button class="settings-addon-btn settings-addon-btn-restart-now" type="button" disabled=${Boolean(f)} onClick=${W}>${r("settings.addons.restartNow")}</button>
                </div>
            `}
        </div>
    `}var zs=d(()=>{rn();un()});var d0={};function u_(n,i){try{let r=localStorage.getItem(n);return r===null?i:r==="true"}catch{return i}}function di(n,i){try{localStorage.setItem(n,String(i))}catch(r){}}function Y0(n,i){try{return localStorage.getItem(n)||i}catch{return i}}function L0(n,i){try{localStorage.setItem(n,i)}catch(r){}}function C0(n,i,r,_){try{return en(localStorage.getItem(n),{fallback:i,min:r,max:_})}catch{return en(i,{fallback:i,min:r,max:_})}}function O0(n,i){try{localStorage.setItem(n,String(i))}catch(r){}}function J0(){let{t:n}=L(),[i,r]=w(()=>u_("piclaw_vim_mode",!1)),[_,c]=w(()=>u_("piclaw_show_whitespace",!0)),[s,u]=w(()=>u_("piclaw_md_live_preview",!0)),[f,l]=w(()=>C0("piclaw_editor_font_size",13,10,24)),[o,y]=w(()=>Y0("piclaw_editor_font_family","")),H=U(($,v,h)=>{let b=!v;h(b),di($,b)},[]);return g`
        <div class="settings-section">
            <h3>${n("settings.editor.heading")}</h3>
            <div class="settings-row">
                <label>${n("settings.editor.vimMode")}</label>
                <input type="checkbox" checked=${i}
                    onChange=${()=>{let $=!i;r($),di("piclaw_vim_mode",$)}} />
            </div>
            <div class="settings-row">
                <label>${n("settings.editor.showWhitespace")}</label>
                <input type="checkbox" checked=${_}
                    onChange=${()=>{let $=!_;c($),di("piclaw_show_whitespace",$)}} />
            </div>
            <div class="settings-row">
                <label>${n("settings.editor.livePreview")}</label>
                <input type="checkbox" checked=${s}
                    onChange=${()=>{let $=!s;u($),di("piclaw_md_live_preview",$)}} />
            </div>
            <div class="settings-row">
                <label>${n("settings.editor.fontSize")}</label>
                <${m}
                    label=${n("settings.editor.fontSizeAria")}
                    value=${f}
                    min=${10}
                    max=${24}
                    fallback=${13}
                    width="70px"
                    onChange=${($)=>{l($),O0("piclaw_editor_font_size",$)}}
                />
            </div>
            <div class="settings-row">
                <label>${n("settings.editor.fontFamily")}</label>
                <input type="text" value=${o}
                    onInput=${($)=>{let v=$.target.value;y(v),L0("piclaw_editor_font_family",v)}}
                    placeholder=${n("settings.editor.fontFamilyPlaceholder")} />
            </div>
            <p class="settings-hint settings-local-only-hint">${n("settings.editor.localOnlyHint")}</p>
        </div>
    `}var E0;var Fs=d(()=>{rn();gi();Sn();un();E0=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;Jn({id:"editor",label:"Editor",icon:E0,component:J0,order:150})});var m0={};function f_(n,i){try{let r=localStorage.getItem(n);return r===null?i:r==="true"}catch{return i}}function g_(n,i){try{localStorage.setItem(n,String(i))}catch(r){}}function o_(n,i){try{return localStorage.getItem(n)||i}catch{return i}}function $_(n,i){try{localStorage.setItem(n,i)}catch(r){}}function e0(){let{t:n}=L(),[i,r]=w(()=>f_("piclaw_dev_mode",!1)),[_,c]=w(()=>o_("piclaw_addons_catalog_url","")),[s,u]=w(()=>o_("piclaw_addons_catalog_urls","")),[f,l]=w(()=>o_("piclaw_addons_repo_url","")),[o,y]=w(()=>f_("piclaw_debug_sse",!1)),[H,$]=w(()=>f_("piclaw_debug_tool_calls",!1)),v=U(()=>{let h=!i;r(h),g_("piclaw_dev_mode",h)},[i]);return g`
        <div class="settings-section">
            <h3>${n("settings.developer.heading")}</h3>
            <div class="settings-row">
                <label>${n("settings.developer.devMode")}</label>
                <input type="checkbox" checked=${i} onChange=${v} />
            </div>

            <p class="settings-hint settings-local-only-hint">${n("settings.developer.localHint")}</p>

            ${i&&g`
                <h3 style="margin-top:16px">${n("settings.developer.addonSources")}</h3>
                <div class="settings-row">
                    <label>${n("settings.developer.catalogUrl")}</label>
                    <input type="text" value=${_}
                        onInput=${(h)=>{let b=h.target.value;c(b),$_("piclaw_addons_catalog_url",b)}}
                        placeholder="https://raw.githubusercontent.com/.../catalog.json" style="max-width:400px" />
                </div>
                <p class="settings-hint" style="margin-top:0">${n("settings.developer.catalogHint")} (<code>rcarmo/piclaw-addons</code>).</p>
                <div class="settings-row" style="align-items:flex-start;">
                    <label>${n("settings.developer.additionalCatalogs")}</label>
                    <textarea
                        value=${s}
                        onInput=${(h)=>{let b=h.target.value;u(b),$_("piclaw_addons_catalog_urls",b)}}
                        placeholder="One URL per line\nhttps://example.com/catalog.json"
                        style="max-width:400px; min-height:86px; resize:vertical;"
                    ></textarea>
                </div>
                <p class="settings-hint" style="margin-top:0">${n("settings.developer.additionalHint")}</p>
                <div class="settings-row">
                    <label>${n("settings.developer.repoUrl")}</label>
                    <input type="text" value=${f}
                        onInput=${(h)=>{let b=h.target.value;l(b),$_("piclaw_addons_repo_url",b)}}
                        placeholder="https://github.com/.../piclaw-addons.git" style="max-width:400px" />
                </div>
                <p class="settings-hint" style="margin-top:0">${n("settings.developer.repoHintPre")} <code>bun add</code> ${n("settings.developer.repoHintPost")}</p>

                <h3 style="margin-top:16px">${n("settings.developer.debug")}</h3>
                <div class="settings-row">
                    <label>${n("settings.developer.logSse")}</label>
                    <input type="checkbox" checked=${o}
                        onChange=${()=>{let h=!o;y(h),g_("piclaw_debug_sse",h)}} />
                </div>
                <div class="settings-row">
                    <label>${n("settings.developer.logToolCalls")}</label>
                    <input type="checkbox" checked=${H}
                        onChange=${()=>{let h=!H;$(h),g_("piclaw_debug_tool_calls",h)}} />
                </div>
                <p class="settings-hint">${n("settings.developer.debugHint")}</p>
            `}
        </div>
    `}var S0;var Ts=d(()=>{rn();gi();un();S0=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;Jn({id:"developer",label:"Developer",icon:S0,component:e0,order:900})});var hg={};on(hg,{openSettingsDialog:()=>vg,SettingsDialogContent:()=>ai,SettingsDialog:()=>bg});function vi(n){bi.push({ts:performance.now(),label:n})}function a0(){if(!bi.length)return;let n=bi[0].ts,i=bi.map((r)=>`+${(r.ts-n).toFixed(1)}ms ${r.label}`);console.info(`[settings-dialog perf]
`+i.join(`
`));try{window.__piclawSettingsPerfLog=i}catch(r){}try{fetch("/agent/client-perf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:"settings-dialog",lines:i})}).catch((r)=>{})}catch(r){}bi.length=0}function rg(n){let i=mi.get(n);if(i)return Promise.resolve(i);let r=ei.get(n);if(r)return r;let _=ng[n]().then((c)=>{return mi.set(n,c),ei.delete(n),c}).catch((c)=>{throw ei.delete(n),c});return ei.set(n,_),_}function Si(n="Loading…"){return g`
        <div class="settings-loading settings-loading-pane" role="status" aria-live="polite">
            <span class="settings-spinner"></span>
            <span>${n}</span>
        </div>
    `}function ai({onClose:n}){vi("SettingsDialogContent-render-start");let[i,r]=w(()=>br()||"general"),[_,c]=w(Ws),[s,u]=w(null),[f,l]=w(""),[,o]=w(0),[y,H]=w(()=>Object.fromEntries(mi.entries())),[$,v]=w(null),[h,b]=w({compact:!1,narrow:!1}),F=E(null),k=E(null),{t:x}=L(),N=(K)=>K?.isExtension?K.label:x(`settings.section.${K.id}`),M=(K)=>K?.isExtension?K.placeholder||x("settings.filter"):x(`settings.placeholder.${K.id}`);X(()=>{vi("SettingsDialogContent-mounted"),a0()},[]),X(()=>{let K=(A)=>{if(A.key==="Escape")n()};return window.addEventListener("keydown",K),()=>window.removeEventListener("keydown",K)},[n]),X(()=>{let K=(A)=>{let C=typeof A?.detail?.section==="string"?A.detail.section.trim():"";if(C)r(C),l("")};return window.addEventListener("piclaw:open-settings",K),()=>window.removeEventListener("piclaw:open-settings",K)},[]),X(()=>{let K=()=>o((A)=>A+1);return window.addEventListener("piclaw:settings-panes-changed",K),()=>window.removeEventListener("piclaw:settings-panes-changed",K)},[]),X(()=>{fetch("/agent/settings-data").then((K)=>K.json()).then((K)=>{Ws=K,c(K)}).catch(()=>c({}))},[]),X(()=>{let K=k.current;if(!K)return;let A=()=>{let C=K.clientWidth||0;b((cn)=>{let S={compact:C>0&&C<=860,narrow:C>0&&C<=720};return cn.compact===S.compact&&cn.narrow===S.narrow?cn:S})};if(A(),typeof ResizeObserver==="function"){let C=new ResizeObserver(()=>A());return C.observe(K),()=>C.disconnect()}return window.addEventListener("resize",A),()=>window.removeEventListener("resize",A)},[]);let W=[...Us].sort((K,A)=>(K.order??500)-(A.order??500)),p=E_().map((K)=>({id:K.id,label:K.label,icon:K.icon,searchable:K.searchable||!1,placeholder:K.searchPlaceholder,order:K.order??500,isExtension:!0,component:K.component})).sort(xr),P=[...W,...p],Q=P.find((K)=>K.id===i)||Us.find((K)=>K.id===i);X(()=>{if(Q?.searchable)requestAnimationFrame(()=>F.current?.focus())},[i]),X(()=>{if(Q?.isExtension){v(null);return}let K=!1;if(y[i]){v(null);return}return v(i),rg(i).then((A)=>{if(K)return;H((C)=>C?.[i]?C:{...C||{},[i]:A})}).catch((A)=>{if(K)return;console.error(`[settings-dialog] Failed to lazy-load section "${i}".`,A)}).finally(()=>{if(!K)v((A)=>A===i?null:A)}),()=>{K=!0}},[i,Q?.isExtension,y]);let t=U((K,A="info")=>{u(K?{text:K,type:A}:null)},[]),j=U((K)=>{r(K),l("");let A=ig[K];if(A&&!Ps.has(K))Ps.add(K),A().then(()=>o((C)=>C+1)).catch((C)=>{})},[]),B=U((K)=>{c((A)=>({...A||{},...K||{}}))},[]),V=()=>{if(Q?.isExtension){if(!Q.component)return Si("Loading pane…");let A=Q.component;return g`<${A} filter=${f} />`}let K=y[i];if(!K||$===i)return Si(`${x("settings.loading")}`);switch(i){case"general":return g`<${K} settingsData=${_} setStatus=${t} mergeSettingsData=${B} />`;case"sessions":return g`<${K} settingsData=${_} setStatus=${t} mergeSettingsData=${B} />`;case"recordings":return g`<${K} filter=${f} setStatus=${t} />`;case"compaction":return g`<${K} settingsData=${_} setStatus=${t} mergeSettingsData=${B} />`;case"keyboard":return g`<${K} filter=${f} setStatus=${t} />`;case"workspace":return g`<${K} settingsData=${_} setStatus=${t} mergeSettingsData=${B} />`;case"environment":return g`<${K} settingsData=${_} filter=${f} setStatus=${t} mergeSettingsData=${B} />`;case"providers":return g`<${K} providers=${_?.providers} setStatus=${t} />`;case"models":return g`<${K} filter=${f} />`;case"theme":return g`<${K} themes=${_?.themes} colorKeys=${_?.colorKeys} settingsData=${_} setStatus=${t} mergeSettingsData=${B} />`;case"scheduled-tasks":return g`<${K} filter=${f} setStatus=${t} />`;case"quick-actions":return g`<${K} filter=${f} setStatus=${t} mergeSettingsData=${B} />`;case"keychain":return g`<${K} filter=${f} />`;case"tools":return g`<${K} toolsets=${_?.toolsets} filter=${f} settingsData=${_} mergeSettingsData=${B} />`;case"addons":return g`<${K} setStatus=${t} filter=${f} />`;default:return Si(x("settings.loading"))}},Y=!Q;return vi("SettingsDialogContent-render-end"),g`
        <div class="settings-dialog-backdrop" onClick=${(K)=>{if(K.target===K.currentTarget)n()}}>
            <div ref=${k} data-testid="settings-dialog" class=${`settings-dialog${h.compact?" settings-dialog-compact":""}${h.narrow?" settings-dialog-narrow":""}`}>
                <div class="settings-dialog-header">
                    <span class="settings-dialog-title">${x("settings.title")}</span>
                    ${Q?.searchable&&g`
                        <input ref=${F} type="text" class="settings-header-filter"
                            placeholder=${M(Q)}
                            value=${f} onInput=${(K)=>l(K.target.value)} />
                    `}
                    <button class="settings-dialog-close" onClick=${n} title=${x("settings.close")}>✕</button>
                </div>
                <div class="settings-dialog-body">
                    <nav class="settings-nav">
                        ${P.map((K,A)=>{let C=A>0&&!P[A-1].isExtension,cn=K.isExtension&&C;return g`
                                ${cn&&g`<div class="settings-nav-separator"></div>`}
                                <button class=${`settings-nav-item ${K.id===i?"active":""}`} onClick=${()=>j(K.id)}>
                                    <span class="settings-nav-icon">${K.icon}</span>
                                    <span class="settings-nav-label">${N(K)}</span>
                                </button>
                            `})}
                    </nav>
                    <main class="settings-content">
                        ${Y?Si(x("settings.loading")):V()}
                    </main>
                </div>
                ${s&&g`
                    <div class=${`settings-status-bar settings-status-bar-${s.type}`}>
                        ${s.type==="info"&&g`<span class="settings-spinner"></span>`}
                        <span>${s.text}</span>
                        ${s.type!=="info"&&g`<button class="settings-status-dismiss" onClick=${()=>u(null)}>✕</button>`}
                    </div>
                `}
            </div>
        </div>
    `}function bg(){let[n,i]=w(!1);if(X(()=>{let r=(c)=>{let s=Gi(c?.detail?.section);if(s)try{window.__piclawSettingsRequestedSection=s}catch(u){}i(!0)};window.addEventListener("piclaw:open-settings",r);let _=e_();if(_.open){if(_.section)try{window.__piclawSettingsRequestedSection=_.section}catch(c){}i(!0)}return()=>window.removeEventListener("piclaw:open-settings",r)},[]),!n)return null;return g`<${O_} className="settings-portal"><${ai} onClose=${()=>i(!1)} /><//>`}function vg(n={}){d_(n)}var bi,Ws=null,mi,ei,ng,ig,Ps,_g,cg,sg,ug,fg,gg,og,$g,lg,wg,tg,yg,kg,pg,xg,Us;var js=d(()=>{rn();un();J_();gi();xc();bi=[];vi("module-eval-start");vi("imports-done");mi=new Map,ei=new Map;mi.set("general",Ar);ng={general:()=>Promise.resolve(Ar),sessions:()=>Promise.resolve().then(() => (hc(),vc)).then((n)=>n.SessionsSection),recordings:()=>Promise.resolve().then(() => (Bc(),Kc)).then((n)=>n.RecordingsSection),compaction:()=>Promise.resolve().then(() => (Fc(),zc)).then((n)=>n.CompactionSection),keyboard:()=>Promise.resolve().then(() => (Vc(),Rc)).then((n)=>n.KeyboardSection),workspace:()=>Promise.resolve().then(() => (Ic(),Dc)).then((n)=>n.WorkspaceSection),environment:()=>Promise.resolve().then(() => (Lc(),Yc)).then((n)=>n.EnvironmentSection),providers:()=>Promise.resolve().then(() => (Oc(),Cc)).then((n)=>n.ProvidersSection),models:()=>Promise.resolve().then(() => (Ec(),Jc)).then((n)=>n.ModelsSection),theme:()=>Promise.resolve().then(() => (fs(),us)).then((n)=>n.ThemeSection),"scheduled-tasks":()=>Promise.resolve().then(() => ($s(),os)).then((n)=>n.ScheduledTasksSection),"quick-actions":()=>Promise.resolve().then(() => (bs(),xs)).then((n)=>n.QuickActionsSection),keychain:()=>Promise.resolve().then(() => (hs(),vs)).then((n)=>n.KeychainSection),tools:()=>Promise.resolve().then(() => (Bs(),Ks)).then((n)=>n.ToolsSection),addons:()=>Promise.resolve().then(() => (zs(),Hs)).then((n)=>n.AddonsSection)},ig={"editor-settings":()=>Promise.resolve().then(() => (Fs(),d0)).then(()=>{}),developer:()=>Promise.resolve().then(() => (Ts(),m0)).then(()=>{})},Ps=new Set;_g=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M8.5 5.9L9.6 2.3h4.8l1.1 3.6 3.7-.8 2.4 4.1-2.6 2.8 2.6 2.8-2.4 4.1-3.7-.8-1.1 3.6H9.6l-1.1-3.6-3.7.8-2.4-4.1L5 12 2.4 9.2l2.4-4.1z"/></svg>`,cg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,sg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.2"/><path d="m13 10 4-2.5v9L13 14z"/></svg>`,ug=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/><path d="M12 7v5l3 3"/></svg>`,fg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,gg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/><path d="M8 7v10"/><path d="M16 7v10"/></svg>`,og=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01"/><path d="M10 9h.01"/><path d="M14 9h.01"/><path d="M18 9h.01"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M7 17h10"/></svg>`,$g=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,lg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="9" width="14" height="10" rx="2"/><circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/><line x1="12" y1="9" x2="12" y2="5"/><circle cx="12" cy="4" r="1.5"/></svg>`,wg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.53-.21-1.01-.55-1.36-.34-.36-.55-.84-.55-1.37 0-1.1.9-2 2-2h2.36c3.08 0 5.64-2.56 5.64-5.64C22.9 5.85 18.05 2 12 2z"/><circle cx="8" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>`,tg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M7 3.5 4 6"/><path d="m17 3.5 3 2.5"/></svg>`,yg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,kg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,pg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="3"/><path d="M11 14h9"/><path d="M16 14v-2"/><path d="M19 14v2"/></svg>`,xg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,Us=[{id:"general",label:"General",icon:_g,searchable:!1,order:10},{id:"sessions",label:"Sessions",icon:cg,searchable:!1,order:12},{id:"recordings",label:"Recordings",icon:sg,searchable:!0,placeholder:"Filter recordings…",order:12.5},{id:"compaction",label:"Compaction",icon:ug,searchable:!1,order:13},{id:"keyboard",label:"Keyboard",icon:og,searchable:!0,placeholder:"Filter shortcuts…",order:14},{id:"workspace",label:"Workspace",icon:fg,searchable:!1,order:15},{id:"environment",label:"Environment",icon:gg,searchable:!0,placeholder:"Filter environment…",order:16},{id:"providers",label:"Providers",icon:$g,searchable:!1,order:20},{id:"models",label:"Models",icon:lg,searchable:!0,placeholder:"Filter models…",order:30},{id:"theme",label:"Appearance",icon:wg,searchable:!1,order:40},{id:"scheduled-tasks",label:"Scheduled Tasks",icon:tg,searchable:!0,placeholder:"Filter scheduled tasks…",order:65},{id:"quick-actions",label:"Quick Actions",icon:kg,searchable:!0,placeholder:"Filter quick actions…",order:70},{id:"keychain",label:"Keychain",icon:pg,searchable:!0,placeholder:"Filter entries…",order:75},{id:"tools",label:"Tools",icon:yg,searchable:!0,placeholder:"Filter tools…",order:80},{id:"addons",label:"Add-ons",icon:xg,searchable:!0,placeholder:"Filter add-ons…",order:90}]});rn();js();gi();var Kg=g`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`;function Bg({label:n,body:i,filter:r=""}){return g`
    <div class="settings-section">
      <h3>${n}</h3>
      <p class="settings-hint">Mock add-on pane rendered by the settings widget fixture.</p>
      <div class="settings-addon-grid">
        ${["Credentials","Routes","Runtime options"].filter((_)=>!r||_.toLowerCase().includes(String(r).toLowerCase())).map((_)=>g`
          <div class="settings-addon-card">
            <div class="settings-addon-card-header">
              <div>
                <div class="settings-addon-name">${_}</div>
                <div class="settings-addon-subtitle">${i}</div>
              </div>
              <span class="settings-addon-enabled">fixture</span>
            </div>
            <div class="settings-row settings-row-vertical">
              <label>Mock field</label>
              <input type="text" value=${`${n.toLowerCase().replace(/\s+/g,"-")}:${_.toLowerCase().replace(/\s+/g,"-")}`} readonly />
            </div>
          </div>
        `)}
      </div>
    </div>
  `}function Hg(){let n=[{id:"fixture-z-observability",label:"Observability",body:"Latency, traces, and metrics."},{id:"fixture-a-portainer",label:"Portainer",body:"Container endpoint settings."},{id:"fixture-m-proxmox",label:"Proxmox",body:"Cluster profile and token settings."},{id:"fixture-b-cheapskate",label:"Cheapskate",body:"Model cost controls."}];for(let i of n)Jn({id:i.id,label:i.label,icon:Kg,searchable:!0,searchPlaceholder:`Filter ${i.label} settings…`,order:i.id==="fixture-z-observability"?1:999,component:(r)=>g`<${Bg} label=${i.label} body=${i.body} filter=${r?.filter||""} />`})}var vn={userName:"Rui Carmo",assistantName:"Smith",userAvatar:"",assistantAvatar:"",composeUploadLimitMb:32,workspaceUploadLimitMb:256,widgetToken:"piclaw_widget_fixture_token_0123456789abcdef",searchMatchMode:"or",instanceTotp:{configured:!0,issuer:"Piclaw Fixture",label:"Piclaw Fixture:Rui Carmo",secret:"JBSWY3DPEHPK3PXP",otpauth:"otpauth://totp/Piclaw%20Fixture:Rui%20Carmo?secret=JBSWY3DPEHPK3PXP&issuer=Piclaw%20Fixture",qrSvg:'<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><rect width="96" height="96" rx="10" fill="#fff"/><g fill="#111"><rect x="10" y="10" width="22" height="22"/><rect x="64" y="10" width="22" height="22"/><rect x="10" y="64" width="22" height="22"/><rect x="40" y="14" width="8" height="8"/><rect x="52" y="26" width="8" height="8"/><rect x="42" y="42" width="10" height="10"/><rect x="62" y="46" width="8" height="8"/><rect x="76" y="60" width="8" height="8"/><rect x="48" y="72" width="8" height="8"/></g></svg>'},providers:[{id:"openai",label:"OpenAI",authType:"api_key",configured:!0},{id:"anthropic",label:"Anthropic",authType:"api_key",configured:!1},{id:"github-copilot",label:"GitHub Copilot",authType:"oauth",configured:!0}],models:["openai/gpt-5.1","anthropic/claude-sonnet-4-5","github-copilot/gpt-5.4-mini"],model_options:[{label:"openai/gpt-5.1",provider:"openai",name:"GPT-5.1",context_window:200000,reasoning:!0},{label:"anthropic/claude-sonnet-4-5",provider:"anthropic",name:"Claude Sonnet 4.5",context_window:200000,reasoning:!0},{label:"github-copilot/gpt-5.4-mini",provider:"github-copilot",name:"GPT-5.4 mini",context_window:128000,reasoning:!1}],current:"openai/gpt-5.1",thinking_level:"medium",supports_thinking:!0,available_thinking_levels:["off","minimal","low","medium","high"],themes:[{id:"system",label:"System",dark:!1},{id:"ipad-pro",label:"iPad Pro",dark:!0},{id:"terminal",label:"Terminal",dark:!0}],colorKeys:["accent","background","surface","text"],toolsets:[{name:"core",description:"Core shell and file tools",tools:[{name:"read",kind:"read-only"},{name:"bash",kind:"mutating"}]},{name:"ui",description:"Web UI posting tools",tools:[{name:"send_dashboard_widget",kind:"mutating"},{name:"send_adaptive_card",kind:"mutating"}]},{name:"remote",description:"Infrastructure tools",tools:[{name:"ssh",kind:"mixed"},{name:"proxmox",kind:"mixed"},{name:"portainer",kind:"mixed"}]}]},zg={current:vn.current,models:vn.models,model_options:vn.model_options,thinking_level:vn.thinking_level,supports_thinking:vn.supports_thinking,available_thinking_levels:vn.available_thinking_levels},Ns={sources:["fixture-catalog"],failed_sources:[],addons:[{slug:"cheapskate",name:"Cheapskate",description:"Model cost controls and routing hints.",installed:!0,enabled:!0,version:"0.1.0",bundled:!1},{slug:"observability",name:"Observability",description:"Local metrics and tracing panels.",installed:!0,enabled:!0,version:"0.2.0",bundled:!1},{slug:"portainer",name:"Portainer",description:"Container management add-on.",installed:!1,enabled:!1,version:"0.3.0",bundled:!1},{slug:"proxmox",name:"Proxmox",description:"Proxmox inventory and workflow add-on.",installed:!0,enabled:!1,version:"0.4.0",bundled:!1}]},Rs={entries:[{name:"github/piclaw-bot-pat",type:"token",envVar:"GITHUB_PICLAW_BOT_PAT",updatedAt:new Date().toISOString(),userNote:"Fixture note",agentNote:"Use only through env injection."},{name:"ssh/relay.local",type:"secret",envVar:"SSH_RELAY_LOCAL",updatedAt:new Date().toISOString(),userNote:"",agentNote:""}]},_i=new URLSearchParams(window.location.search).get("real")!=="1",Vs=window.fetch.bind(window);function pn(n,i=200){return new Response(JSON.stringify(n),{status:i,headers:{"Content-Type":"application/json"}})}function Fg(){window.fetch=async(n,i)=>{let r=new URL(typeof n==="string"?n:n.url,window.location.href),_=String(i?.method||"GET").toUpperCase();if(!_i)return Vs(n,i);if(r.pathname==="/agent/settings-data")return pn(vn);if(r.pathname==="/agent/models")return pn(zg);if(r.pathname==="/agent/addons")return pn(Ns);if(r.pathname.startsWith("/agent/addons/"))return pn({ok:!0,message:"Fixture add-on action accepted.",...Ns});if(r.pathname==="/agent/keychain"){if(_==="GET")return pn(Rs);if(_==="POST")return pn({ok:!0,...Rs})}if(r.pathname==="/agent/settings/general")return pn({ok:!0,settings:vn});if(r.pathname==="/agent/settings/widget-token/regenerate")return pn({ok:!0,settings:{...vn,widgetToken:`piclaw_widget_fixture_regenerated_${Date.now()}`}});if(r.pathname.startsWith("/agent/default/message"))return pn({command:{status:"success",message:"Fixture command accepted."}});if(r.pathname.startsWith("/agent/settings/"))return pn({ok:!0,settings:vn,items:[],entries:[]});if(r.pathname==="/agent/client-perf")return pn({ok:!0});return Vs(n,i)}}function Tg(){let n=document.createElement("style");n.textContent=`
    html, body, #settings-widget-fixture-root { margin: 0; width: 100%; height: 100%; overflow: hidden; background: var(--bg-primary, #111827); color: var(--text-primary, #e5e7eb); }
    .settings-fixture-shell { height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--bg-primary, #111827); }
    .settings-fixture-toolbar { position: relative; z-index: 2600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border-bottom: 1px solid var(--border-color, rgba(148,163,184,.22)); background: var(--bg-secondary, #0f172a); font: 12px var(--font-sans, system-ui, sans-serif); }
    .settings-fixture-toolbar strong { margin-right: 4px; }
    .settings-fixture-toolbar button, .settings-fixture-toolbar select, .settings-fixture-toolbar input { border: 1px solid var(--border-color, rgba(148,163,184,.28)); border-radius: 7px; background: var(--bg-primary, #111827); color: inherit; padding: 5px 8px; font: inherit; }
    .settings-fixture-toolbar input[type="range"] { padding: 0; width: 120px; }
    .settings-fixture-canvas { position: relative; min-height: 0; overflow: hidden; }
    .settings-fixture-canvas .settings-dialog-backdrop { position: absolute; inset: 0; background: color-mix(in srgb, var(--bg-primary, #111827) 82%, transparent); }
    .settings-fixture-canvas .settings-dialog { width: min(var(--fixture-width, 900px), 96vw); height: min(var(--fixture-height, 640px), 94%); max-width: none; max-height: none; }
    .settings-fixture-note { opacity: .72; }
  `,document.head.appendChild(n)}function Gs(n){try{window.__piclawSettingsRequestedSection=n}catch(i){}window.dispatchEvent(new CustomEvent("piclaw:open-settings",{detail:{section:n}}))}function Wg(){let n=new URLSearchParams(window.location.search),[i,r]=w(n.get("section")||"general"),[_,c]=w(Number(n.get("width")||900)),[s,u]=w(Number(n.get("height")||640)),[f,l]=w(_i),[o,y]=w(0),H=J(()=>["general","sessions","compaction","keyboard","workspace","environment","providers","models","theme","scheduled-tasks","quick-actions","keychain","tools","addons","fixture-b-cheapskate","fixture-z-observability","fixture-a-portainer","fixture-m-proxmox"],[]),$=U((h)=>{r(h),Gs(h)},[]),v=U(()=>{_i=!_i,l(_i),y((h)=>h+1)},[]);return g`
    <div class="settings-fixture-shell">
      <div class="settings-fixture-toolbar">
        <strong>Settings fixture</strong>
        <label>Section <select value=${i} onChange=${(h)=>$(h.target.value)}>${H.map((h)=>g`<option value=${h}>${h}</option>`)}</select></label>
        <label>Width <input type="range" min="480" max="1200" value=${_} onInput=${(h)=>c(Number(h.target.value))} /> ${_}px</label>
        <label>Height <input type="range" min="420" max="900" value=${s} onInput=${(h)=>u(Number(h.target.value))} /> ${s}px</label>
        <button type="button" onClick=${v}>${f?"Mock data":"Real endpoints"}</button>
        <button type="button" onClick=${()=>y((h)=>h+1)}>Remount</button>
        <span class="settings-fixture-note">Add-on panes are registered in scrambled order for nav ordering tests.</span>
      </div>
      <div class="settings-fixture-canvas" style=${`--fixture-width:${_}px;--fixture-height:${s}px;`}>
        <${ai} key=${o} onClose=${()=>{}} />
      </div>
    </div>
  `}function Pg(){Hg(),Fg(),Tg();let n=new URLSearchParams(window.location.search);Gs(n.get("section")||"general");let i=document.getElementById("settings-widget-fixture-root")||document.body.appendChild(document.createElement("div"));i.id="settings-widget-fixture-root",Ln(g`<${Wg} />`,i),window.piclawWidget?.ready?.({title:"Settings fixture",mockMode:_i})}Pg();

//# debugId=D3065270C9DC2B5D64756E2164756E21
//# sourceMappingURL=settings-widget-fixture.bundle.js.map
