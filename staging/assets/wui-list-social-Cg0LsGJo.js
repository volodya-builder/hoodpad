import{C as e,D as t,H as n,J as r,V as i,_ as a,r as o,st as s,x as c}from"./ApiController-BsBbpWtJ.js";import{c as l,f as u,o as d,r as f,t as p}from"./exports-ClBc5snA.js";import{c as m,o as h,u as g}from"./wui-text-CHT8qwsR.js";function _(){try{return i.returnOpenHref(`${s.SECURE_SITE_SDK_ORIGIN}/loading`,`popupWindow`,`width=600,height=800,scrollbars=yes`)}catch{throw Error(`Could not open social popup`)}}async function v(){e.push(`ConnectingFarcaster`);let n=a.getAuthConnector();if(n&&!o.getAccountData()?.farcasterUrl)try{let{url:e}=await n.provider.getFarcasterUri();o.setAccountProp(`farcasterUrl`,e,o.state.activeChain)}catch(n){e.goBack(),t.showError(n)}}async function y(s){e.push(`ConnectingSocial`);let l=a.getAuthConnector(),u=null;try{let e=setTimeout(()=>{throw Error(`Social login timed out. Please try again.`)},45e3);if(l&&s){if(i.isTelegram()||(u=_()),u)o.setAccountProp(`socialWindow`,r(u),o.state.activeChain);else if(!i.isTelegram())throw Error(`Could not create social popup`);let{uri:t}=await l.provider.getSocialRedirectUri({provider:s});if(!t)throw u?.close(),Error(`Could not fetch the social redirect uri`);if(u&&(u.location.href=t),i.isTelegram()){n.setTelegramSocialProvider(s);let e=i.formatTelegramSocialLoginUrl(t);i.openHref(e,`_top`)}clearTimeout(e)}}catch(e){u?.close();let n=i.parseError(e);t.showError(n),c.sendEvent({type:`track`,event:`SOCIAL_LOGIN_ERROR`,properties:{provider:s,message:n}})}}async function b(e){o.setAccountProp(`socialProvider`,e,o.state.activeChain),c.sendEvent({type:`track`,event:`SOCIAL_LOGIN_STARTED`,properties:{provider:e}}),e===`farcaster`?await v():await y(e)}var x=d`
  :host {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 40px;
    height: 40px;
    border-radius: ${({borderRadius:e})=>e[20]};
    overflow: hidden;
  }

  wui-icon {
    width: 100%;
    height: 100%;
  }
`,S=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},C=class extends l{constructor(){super(...arguments),this.logo=`google`}render(){return u`<wui-icon color="inherit" size="inherit" name=${this.logo}></wui-icon> `}};C.styles=[f,x],S([g()],C.prototype,`logo`,void 0),C=S([h(`wui-logo`)],C);var w=d`
  :host {
    width: 100%;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${({spacing:e})=>e[3]};
    width: 100%;
    background-color: transparent;
    border-radius: ${({borderRadius:e})=>e[4]};
  }

  wui-text {
    text-transform: capitalize;
  }

  @media (hover: hover) {
    button:hover:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    }
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`,T=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},E=class extends l{constructor(){super(...arguments),this.logo=`google`,this.name=`Continue with google`,this.disabled=!1}render(){return u`
      <button ?disabled=${this.disabled} tabindex=${m(this.tabIdx)}>
        <wui-flex gap="2" alignItems="center">
          <wui-image ?boxed=${!0} logo=${this.logo}></wui-image>
          <wui-text variant="lg-regular" color="primary">${this.name}</wui-text>
        </wui-flex>
        <wui-icon name="chevronRight" size="lg" color="default"></wui-icon>
      </button>
    `}};E.styles=[f,p,w],T([g()],E.prototype,`logo`,void 0),T([g()],E.prototype,`name`,void 0),T([g()],E.prototype,`tabIdx`,void 0),T([g({type:Boolean})],E.prototype,`disabled`,void 0),E=T([h(`wui-list-social`)],E);export{b as t};